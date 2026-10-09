'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const MAX_MESSAGE = 512 * 1024 * 1024;
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const validId = id => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);

function durableWrite(file, data, immutable = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (immutable && fs.existsSync(file)) {
    if (!fs.readFileSync(file).equals(Buffer.from(data))) throw new Error('Local archive integrity conflict');
    return;
  }
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  if (process.platform !== 'win32') {
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  }
}

function encode(key, workspace, name, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`mailbridge:1:${workspace}:${name}`));
  return Buffer.concat([Buffer.from('MB01'), iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}
function decode(key, workspace, name, data) {
  if (!Buffer.isBuffer(data) || data.length < 32 || data.subarray(0, 4).toString() !== 'MB01') throw new Error('Invalid encrypted archive');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, data.subarray(4, 16));
  decipher.setAAD(Buffer.from(`mailbridge:1:${workspace}:${name}`));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(16, -16)), decipher.final()]);
}
function pairingCode(workspace, key) { return `MB1.${workspace}.${key.toString('base64url')}`; }
function parsePairing(code) {
  const [version, workspace, secret, extra] = code.trim().split('.');
  const key = Buffer.from(secret || '', 'base64url');
  if (version !== 'MB1' || extra || !/^[a-f0-9]{32}$/.test(workspace || '') || key.length !== 32) throw new Error('Invalid pairing code');
  return { workspace, key };
}
function newer(a, b) { return !b || a.clock > b.clock || (a.clock === b.clock && a.device > b.device); }

// Peer import receipts prove delivery; local transport acceptance alone never authorizes collection.
class ArchiveSync extends EventEmitter {
  constructor({ root, workspace, key, device, transport, native, peers = [], cloudRetention = true, maxUploadBytes = 64 * 1024 * 1024 }) {
    super();
    if (!/^[a-f0-9]{32}$/.test(workspace) || key.length !== 32 || !/^[a-f0-9-]{36}$/.test(device)) throw new Error('Invalid sync identity');
    Object.assign(this, { root, workspace, key, device, transport, native, peers, cloudRetention, maxUploadBytes });
    this.journalPath = path.join(root, 'sync-journal.json');
    this.journal = fs.existsSync(this.journalPath) ? JSON.parse(fs.readFileSync(this.journalPath, 'utf8')) :
      { workspace, clock: 0, messages: {}, acknowledgements: {}, deletedCloud: {}, devices: {}, seen: {} };
    if (this.journal.workspace !== workspace) throw new Error('This local archive is paired to another workspace');
    this.status = { phase: 'idle', running: false, retained: 0, pending: 0, peers: [], lastSuccess: null, error: null };
  }
  save() { durableWrite(this.journalPath, JSON.stringify(this.journal)); }
  updateStatus(values) { Object.assign(this.status, values); this.emit('status', { ...this.status }); }
  name(kind, id) { return `${this.workspace}-${kind}-${id}`; }
  async put(name, data) {
    const encrypted = encode(this.key, this.workspace, name, Buffer.from(JSON.stringify(data)));
    await this.transport.put(name, encrypted);
  }
  async get(object) {
    const bytes = await this.transport.get(object.id);
    if (bytes.length > MAX_MESSAGE * 1.5) throw new Error('Remote archive object exceeds maximum size');
    return JSON.parse(decode(this.key, this.workspace, object.name, bytes).toString('utf8'));
  }
  observe(record) {
    const { key, digest, email, folder, size } = record;
    if (!validId(key) || !validId(digest) || typeof email !== 'string' || typeof folder !== 'string' || size > MAX_MESSAGE) throw new Error('Invalid native archive record');
    const old = this.journal.messages[key] || { descriptor: { key, digest, email, folder, role: record.role || '', size, schema: 1 }, state: {}, applied: {} };
    for (const field of ['unread', 'starred', 'folder']) {
      if (field === 'folder' ? typeof record[field] !== 'string' || !record[field] : typeof record[field] !== 'boolean') throw new Error('Invalid native mail state');
      if (field === 'folder' && ['trash', 'spam'].includes(record.role)) {
        // A first capture in server Trash has no authority to relocate a peer's retained Inbox copy.
        old.state[field] ||= { value: record[field], clock: 0, device: this.device };
      } else if (!old.state[field] || old.applied[field] !== record[field]) {
        const initialValue = !old.state[field];
        const clock = ++this.journal.clock;
        // Initial origin is independent of mailbox enumeration order. Later moves use the logical clock.
        old.state[field] = { value: record[field], clock: initialValue ? (field === 'folder' ? (record.role === 'sent' ? 2 : 1) : 0) : clock, device: this.device };
      }
      old.applied[field] = record[field];
    }
    this.journal.messages[key] = old;
    this.journal.acknowledgements[`${key}-${digest}`] ||= {};
    this.journal.acknowledgements[`${key}-${digest}`][this.device] = true;
    return old;
  }
  async run() {
    if (this.status.running) return;
    this.updateStatus({ running: true, phase: 'connecting', error: null });
    try {
      const health = await this.transport.health();
      const local = await this.native.list();
      for (const record of local) this.observe(record);
      this.save();
      const objects = await this.transport.list(`${this.workspace}-`);
      const byName = new Map(objects.map(object => [object.name, object]));
      const known = new Set(objects.map(object => object.name));
      // Tombstones are authenticated before they can suppress uploads or authorize cloud collection.
      for (const object of objects.filter(o => o.name.startsWith(this.name('gc', '')))) {
        const gc = await this.get(object);
        if (!validId(gc.key) || !validId(gc.digest) || object.name !== this.name('gc', `${gc.key}-${gc.digest}`)) throw new Error('Invalid archive checkpoint');
        this.journal.deletedCloud[`${gc.key}-${gc.digest}`] = true;
      }
      this.updateStatus({ phase: 'downloading' });
      for (const object of objects.filter(o => o.name.startsWith(this.name('mail', '')))) {
        if (this.journal.seen[object.name]) continue;
        const payload = await this.get(object);
        const d = payload.descriptor;
        if (!d || !validId(d.key) || !validId(d.digest) || object.name !== this.name('mail', `${d.key}-${d.digest}`)) throw new Error('Invalid archive envelope');
        const raw = Buffer.from(payload.raw, 'base64');
        if (raw.length > MAX_MESSAGE || raw.length !== d.size || hash(raw) !== d.digest) throw new Error('Remote message checksum mismatch');
        durableWrite(path.join(this.root, 'blobs', `${d.digest}.eml`), raw, true);
        // Import includes parsed body, attachments, search indexes, and independent local placement.
        const initial = payload.state || { unread: { value: true, clock: 0, device: this.device }, starred: { value: false, clock: 0, device: this.device } };
        const applied = { unread: initial.unread.value, starred: initial.starred.value, folder: initial.folder?.value || d.folder };
        if (typeof applied.unread !== 'boolean' || typeof applied.starred !== 'boolean') throw new Error('Invalid archived initial state');
        await this.native.import(d, this.journal.messages[d.key] ? undefined : applied);
        if (!this.journal.messages[d.key]) this.journal.messages[d.key] = { descriptor: d, state: initial, applied };
        this.journal.acknowledgements[`${d.key}-${d.digest}`] ||= {};
        this.journal.acknowledgements[`${d.key}-${d.digest}`][this.device] = true;
        this.journal.seen[object.name] = true;
        this.save();
      }
      this.updateStatus({ phase: 'uploading' });
      let uploadedBytes = 0; let uploadFailure = null;
      const reservedBytes = Math.max(8 * 1024 * 1024, Buffer.byteLength(JSON.stringify(this.journal.messages)) * 2);
      const availableBytes = health.quota ? health.quota.limit - health.quota.used - reservedBytes : Infinity;
      for (const record of local) {
        const identity = `${record.key}-${record.digest}`;
        const name = this.name('mail', identity);
        if (known.has(name) || this.journal.deletedCloud[identity]) continue;
        if (uploadedBytes > 0 && uploadedBytes + record.size > this.maxUploadBytes) break;
        if (Math.ceil((uploadedBytes + record.size) * 4 / 3) + 4096 > availableBytes) {
          uploadFailure = new Error('Google Drive storage is nearly full. Free space or enable the transfer buffer after confirming both PCs.');
          break;
        }
        const raw = fs.readFileSync(path.join(this.root, 'blobs', `${record.digest}.eml`));
        if (raw.length !== record.size || hash(raw) !== record.digest) throw new Error('Local retained message checksum mismatch');
        const { key, digest, email, folder, size } = record;
        const role = record.role || '';
        try {
          await this.put(name, { descriptor: { schema: 1, key, digest, email, folder, role, size }, raw: raw.toString('base64'), state: this.journal.messages[key].state });
        } catch (error) {
          if (error.code !== 'ENOSPC' && !(error.status === 403 && /quota|storage/i.test(error.message))) throw error;
          uploadFailure = error; break;
        }
        uploadedBytes += size;
        known.add(name);
      }
      // Receipts are emitted only after durable storage and a successful native import on that PC.
      for (const [identity, receipts] of Object.entries(this.journal.acknowledgements)) {
        const name = this.name('ack', `${this.device}-${identity}`);
        if (receipts[this.device] && !known.has(name) && (known.has(this.name('mail', identity)) || this.journal.deletedCloud[identity])) await this.put(name, { device: this.device, identity });
      }
      for (const object of objects.filter(o => o.name.startsWith(this.name('ack', '')))) {
        const receipt = await this.get(object);
        if (!/^[a-f0-9-]{36}$/.test(receipt.device) || !/^[a-f0-9]{64}-[a-f0-9]{64}$/.test(receipt.identity) ||
          object.name !== this.name('ack', `${receipt.device}-${receipt.identity}`)) throw new Error('Invalid device receipt');
        this.journal.acknowledgements[receipt.identity] ||= {};
        this.journal.acknowledgements[receipt.identity][receipt.device] = true;
      }
      // Independent snapshots per device avoid two PCs overwriting one another's offline changes.
      const snapshot = { device: this.device, clock: this.journal.clock, updated: Date.now(), messages: {} };
      for (const [key, message] of Object.entries(this.journal.messages)) snapshot.messages[key] = message.state;
      await this.put(this.name('state', this.device), snapshot);
      for (const object of objects.filter(o => o.name.startsWith(this.name('state', '')) && o.name !== this.name('state', this.device))) {
        const incoming = await this.get(object);
        if (!/^[a-f0-9-]{36}$/.test(incoming.device) || object.name !== this.name('state', incoming.device) || !Number.isSafeInteger(incoming.clock)) throw new Error('Invalid device state');
        this.journal.devices[incoming.device] = { updated: incoming.updated };
        this.journal.clock = Math.max(this.journal.clock, incoming.clock);
        for (const [key, state] of Object.entries(incoming.messages)) {
          if (!validId(key)) throw new Error('Invalid message state identity');
          const message = this.journal.messages[key];
          if (!message) continue;
          let changed = false;
          for (const field of ['unread', 'starred', 'folder']) {
            const value = state[field];
            if (!value || (field === 'folder' ? typeof value.value !== 'string' || !value.value || value.value.length > 1000 : typeof value.value !== 'boolean') || !Number.isSafeInteger(value.clock) || value.clock < 0 || value.device !== incoming.device && !/^[a-f0-9-]{36}$/.test(value.device)) throw new Error('Invalid mail state clock');
            if (newer(value, message.state[field])) { message.state[field] = value; changed = true; }
          }
          if (changed) {
            const applied = Object.fromEntries(Object.entries(message.state).map(([field, value]) => [field, value.value]));
            await this.native.import(message.descriptor, applied);
            message.applied = applied;
          }
        }
      }
      // Refresh imported descriptors before publishing their changes on the next pass.
      for (const record of await this.native.list()) this.observe(record);
      this.save();
      if (!this.cloudRetention && this.peers.length === 1) {
        for (const [identity, receipts] of Object.entries(this.journal.acknowledgements)) {
          if (!receipts[this.device] || !receipts[this.peers[0]]) continue;
          const name = this.name('mail', identity);
          const object = byName.get(name);
          if (!object) continue;
          const [key, digest] = identity.split('-');
          await this.put(this.name('gc', identity), { key, digest });
          await this.transport.remove(object.id);
          this.journal.deletedCloud[identity] = true;
        }
        this.save();
      }
      if (uploadFailure) throw uploadFailure;
      let pending = 0;
      for (const receipts of Object.values(this.journal.acknowledgements)) if (!this.peers.length || !this.peers.every(peer => receipts[peer])) pending++;
      this.updateStatus({ phase: health.type === 'folder' ? 'folder-ready' : 'connected', retained: Object.keys(this.journal.messages).length, pending,
        peers: Object.entries(this.journal.devices).map(([device, info]) => ({ device, ...info })),
        lastSuccess: Date.now(), quota: health.quota, error: null });
    } catch (error) {
      const pending = Object.values(this.journal.acknowledgements).filter(receipts => !this.peers.length || !this.peers.every(peer => receipts[peer])).length;
      this.updateStatus({ phase: 'error', error: error.message, pending });
      throw error;
    } finally { this.updateStatus({ running: false }); }
  }
  safeToClean(record) {
    const receipts = this.journal.acknowledgements[`${record.key}-${record.digest}`] || {};
    return Boolean(this.peers.length === 1 && receipts[this.device] && receipts[this.peers[0]]);
  }
}

module.exports = { ArchiveSync, durableWrite, encode, decode, hash, pairingCode, parsePairing, newer, MAX_MESSAGE };
