'use strict';
const https = require('node:https');
const http = require('node:http');
const crypto = require('node:crypto');

function request(url, { method = 'GET', headers = {}, body, maxBytes = 800 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['www.googleapis.com', 'oauth2.googleapis.com'].includes(target.hostname)) return reject(new Error('Untrusted Google API URL'));
    const req = https.request(target, { method, headers }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > maxBytes) { res.destroy(new Error('Google response exceeds size limit')); return; }
        chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }));
    });
    req.setTimeout(120000, () => req.destroy(new Error('Google Drive request timed out')));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
function jsonResponse(response) {
  let value;
  try { value = JSON.parse(response.bytes.toString('utf8')); } catch (_) { value = {}; }
  if (response.status < 200 || response.status >= 300) {
    const message = value.error?.message || value.error_description || `Google request failed (${response.status})`;
    const error = new Error(message); error.status = response.status; throw error;
  }
  return value;
}

class GoogleDrive {
  constructor({ clientId, clientSecret, tokens, saveTokens, openExternal, requestImpl = request }) {
    if (!clientId || !clientSecret) throw new Error('Google Drive desktop OAuth credentials are not configured');
    Object.assign(this, { clientId, clientSecret, tokens: tokens || {}, saveTokens, openExternal, requestImpl });
    this.files = new Map();
  }
  async tokenRequest(fields) {
    const body = new URLSearchParams({ client_id: this.clientId, client_secret: this.clientSecret, ...fields }).toString();
    return jsonResponse(await this.requestImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) }, body,
    }));
  }
  async authorize() {
    if (this.authorizing) throw new Error('Google sign-in is already in progress');
    this.authorizing = true;
    const state = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(48).toString('base64url');
    let server, timeout;
    try {
      const codePromise = new Promise((resolve, reject) => {
        server = http.createServer((req, res) => {
          const url = new URL(req.url, 'http://127.0.0.1');
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          if (url.pathname !== '/callback' || req.method !== 'GET' || url.searchParams.get('state') !== state) {
            res.writeHead(400); res.end('Invalid sign-in callback.'); return;
          }
          const error = url.searchParams.get('error');
          const code = url.searchParams.get('code');
          if (error || !code) { res.end('Google Drive connection was cancelled.'); reject(new Error('Google sign-in cancelled')); return; }
          res.end('Google Drive is connected. You can return to MailBridge.'); resolve(code);
        });
        server.on('error', reject);
        timeout = setTimeout(() => reject(new Error('Google sign-in timed out')), 5 * 60 * 1000);
      });
      // Attach immediately so a bind/browser failure cannot leave an unhandled rejection.
      codePromise.catch(() => {});
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      const redirect = `http://127.0.0.1:${server.address().port}/callback`;
      const params = new URLSearchParams({ client_id: this.clientId, redirect_uri: redirect, response_type: 'code',
        scope: 'https://www.googleapis.com/auth/drive.appdata', access_type: 'offline', prompt: 'consent', state,
        code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
      await this.openExternal(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
      const result = await this.tokenRequest({ code: await codePromise, redirect_uri: redirect, code_verifier: verifier, grant_type: 'authorization_code' });
      if (!result.refresh_token) throw new Error('Google did not return an offline access token');
      this.tokens = { ...result, expiresAt: Date.now() + result.expires_in * 1000 };
      await this.saveTokens(this.tokens);
      return await this.health();
    } finally { clearTimeout(timeout); server?.close(); this.authorizing = false; }
  }
  async accessToken(force = false) {
    if (!force && this.tokens.access_token && this.tokens.expiresAt > Date.now() + 60000) return this.tokens.access_token;
    if (!this.tokens.refresh_token) throw new Error('Connect Google Drive to start syncing');
    if (!this.refreshing) {
      this.refreshing = (async () => {
        const result = await this.tokenRequest({ refresh_token: this.tokens.refresh_token, grant_type: 'refresh_token' });
        this.tokens = { ...this.tokens, ...result, expiresAt: Date.now() + result.expires_in * 1000 };
        await this.saveTokens(this.tokens);
        return this.tokens.access_token;
      })().finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async api(url, options = {}) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await this.accessToken(attempt > 0 && this.forceRefresh);
      const response = await this.requestImpl(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
      this.forceRefresh = response.status === 401;
      if (attempt < 3 && [401, 429, 500, 502, 503, 504].includes(response.status)) {
        const retry = Math.min(5000, Number(response.headers['retry-after'] || 0) * 1000 || 500 * 2 ** attempt);
        await new Promise(resolve => setTimeout(resolve, retry)); continue;
      }
      jsonResponse(response); return response;
    }
  }
  async health() {
    const response = await this.api('https://www.googleapis.com/drive/v3/about?fields=storageQuota,user(displayName,emailAddress)');
    const data = jsonResponse(response);
    const quota = { used: Number(data.storageQuota?.usage || 0), limit: Number(data.storageQuota?.limit || 15 * 1024 ** 3) };
    return { quota, user: data.user };
  }
  async list(prefix) {
    let pageToken; const all = [];
    do {
      const params = new URLSearchParams({ spaces: 'appDataFolder', q: `trashed = false and name contains '${prefix.replace(/'/g, "\\'")}'`,
        fields: 'nextPageToken,files(id,name,size,modifiedTime,md5Checksum)', pageSize: '1000' });
      if (pageToken) params.set('pageToken', pageToken);
      const page = jsonResponse(await this.api(`https://www.googleapis.com/drive/v3/files?${params}`));
      all.push(...page.files.filter(file => file.name.startsWith(prefix))); pageToken = page.nextPageToken;
    } while (pageToken);
    const byName = new Map();
    for (const file of all) {
      const old = byName.get(file.name);
      if (!old || old.modifiedTime < file.modifiedTime) byName.set(file.name, file);
    }
    this.files = new Map([...this.files, ...byName]);
    return [...byName.values()];
  }
  async get(id) {
    const response = await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`);
    return response.bytes;
  }
  async put(name, bytes) {
    const existing = this.files.get(name);
    const metadata = JSON.stringify(existing ? { name } : { name, parents: ['appDataFolder'] });
    const endpoint = `https://www.googleapis.com/upload/drive/v3/files${existing ? '/' + encodeURIComponent(existing.id) : ''}?uploadType=resumable&fields=id,name,size,modifiedTime,md5Checksum`;
    const session = await this.api(endpoint, { method: existing ? 'PATCH' : 'POST', body: metadata,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(metadata), 'X-Upload-Content-Type': 'application/octet-stream', 'X-Upload-Content-Length': bytes.length } });
    const location = session.headers.location;
    if (!location || new URL(location).origin !== 'https://www.googleapis.com') throw new Error('Invalid Google Drive upload session');
    const result = jsonResponse(await this.api(location, { method: 'PUT', body: bytes,
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': bytes.length } }));
    if (result.md5Checksum !== crypto.createHash('md5').update(bytes).digest('hex') || Number(result.size) !== bytes.length) throw new Error('Google Drive upload verification failed');
    this.files.set(name, result); return result;
  }
  async remove(id) { await this.api(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}`, { method: 'DELETE' }); }
}
module.exports = { GoogleDrive, request };
