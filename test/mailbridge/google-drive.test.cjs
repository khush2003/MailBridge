const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const { GoogleDrive, request } = require('../../app/src/mailbridge/google-drive');
const response = (value, status = 200, headers = {}) => ({ status, headers, bytes: Buffer.from(JSON.stringify(value)) });
const options = requestImpl => ({ clientId: 'test-client', clientSecret: 'test-secret', tokens: { refresh_token: 'offline-token' }, saveTokens: async () => {}, requestImpl });
test('OAuth loopback uses PKCE, ignores a bad state, and saves refresh credentials', async () => {
  let verifier, saved;
  const drive = new GoogleDrive({ ...options(async (url, req) => {
    if (url.endsWith('/token')) {
      const form = new URLSearchParams(req.body);
      assert.equal(form.get('grant_type'), 'authorization_code');
      assert.equal(form.get('code'), 'authorized-code');
      assert.equal(crypto.createHash('sha256').update(form.get('code_verifier')).digest('base64url'), verifier);
      return response({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    }
    return response({ user: { emailAddress: 'test@example.test' }, storageQuota: { usage: '123', limit: '456' } });
  }), saveTokens: async value => { saved = value; }, openExternal: async address => {
    const url = new URL(address), redirect = new URL(url.searchParams.get('redirect_uri'));
    assert.equal(redirect.hostname, '127.0.0.1');
    assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata');
    verifier = url.searchParams.get('code_challenge');
    const send = (state) => new Promise(resolve => {
      http.get(`${redirect}?state=${state}&code=authorized-code`, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    });
    assert.equal(await send('incorrect'), 400);
    assert.equal(await send(url.searchParams.get('state')), 200);
  } });
  assert.equal((await drive.authorize()).quota.used, 123);
  assert.equal(saved.refresh_token, 'refresh');
});
test('refresh tokens are reused, file pagination deduplicates names, and upload checks integrity', async () => {
  let refreshes = 0, pages = 0;
  const bytes = Buffer.from('Encrypted archive bytes');
  const drive = new GoogleDrive(options(async (address, req) => {
    const url = new URL(address);
    if (url.pathname === '/token') { refreshes++; return response({ access_token: 'access', expires_in: 3600 }); }
    assert.equal(req.headers.Authorization, 'Bearer access');
    if (url.pathname === '/drive/v3/files') {
      pages++;
      assert.equal(url.searchParams.get('spaces'), 'appDataFolder');
      return url.searchParams.has('pageToken') ? response({ files: [{ id: 'new', name: 'prefix-state-pc', modifiedTime: '2026' }] }) :
        response({ nextPageToken: 'second', files: [{ id: 'old', name: 'prefix-state-pc', modifiedTime: '2025' }, { id: 'other', name: 'different', modifiedTime: '2026' }] });
    }
    if (url.pathname.startsWith('/upload/')) return response({}, 200, { location: 'https://www.googleapis.com/session' });
    assert.equal(req.method, 'PUT'); assert.deepEqual(req.body, bytes);
    return response({ id: 'verified', name: 'prefix-mail-message', size: String(bytes.length), md5Checksum: crypto.createHash('md5').update(bytes).digest('hex') });
  }));
  assert.deepEqual((await drive.list('prefix-')).map(f => f.id), ['new']);
  assert.equal(pages, 2);
  assert.equal((await drive.put('prefix-mail-message', bytes)).id, 'verified');
  assert.equal(refreshes, 1);
  drive.requestImpl = async url => url.includes('/upload/') ? response({}, 200, { location: 'https://www.googleapis.com/session' }) : response({ size: bytes.length, md5Checksum: 'bad' });
  await assert.rejects(drive.put('prefix-corrupt', bytes), /verification failed/);
});
test('requests and upload redirects cannot leave the Google API origin', async () => {
  await assert.rejects(request('http://www.googleapis.com/'), /Untrusted/);
  await assert.rejects(request('https://example.com/'), /Untrusted/);
  const drive = new GoogleDrive(options(async url => url.endsWith('/token') ? response({ access_token: 'access', expires_in: 3600 }) : response({}, 200, { location: 'https://example.com/upload' })));
  await assert.rejects(drive.put('test', Buffer.from('bytes')), /Invalid Google/);
});
