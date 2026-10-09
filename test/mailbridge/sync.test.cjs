const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ArchiveSync, durableWrite, hash, encode, decode, pairingCode, parsePairing } = require('../../app/src/mailbridge/core');
class Remote {
  constructor() { this.objects = new Map(); this.online = true; }
  check() { if (!this.online) throw new Error('Offline'); }
  async health() { this.check(); return { quota: { used: 0, limit: 15 * 1024 ** 3 } }; }
  async list(prefix) { this.check(); return [...this.objects.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name, id: name })); }
  async put(name, bytes) { this.check(); this.objects.set(name, bytes); }
  async get(id) { this.check(); return this.objects.get(id); }
  async remove(id) { this.check(); this.objects.delete(id); }
}
function pc(remote, workspace, key, device, peers = [], cloudRetention = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-test-'));
  const records = new Map();
  const native = {
    async list() { return [...records.values()]; },
    async import(descriptor, state) {
      const raw = fs.readFileSync(path.join(root, 'blobs', `${descriptor.digest}.eml`));
      assert.equal(hash(raw), descriptor.digest);
      records.set(descriptor.key, { ...descriptor, ...records.get(descriptor.key), ...(state || { unread: true, starred: false }) });
    },
  };
  const sync = new ArchiveSync({ root, workspace, key, device, transport: remote, native, peers, cloudRetention });
  return { sync, root, native, records, add(raw, unread = true) {
    const key = hash(`identity:${raw}`), digest = hash(raw);
    durableWrite(path.join(root, 'blobs', `${digest}.eml`), raw, true);
    records.set(key, { schema: 1, key, digest, email: 'company@example.test', folder: 'INBOX', size: raw.length, unread, starred: false });
    return records.get(key);
  } };
}
function pair(cloudRetention = true) {
  const remote = new Remote(), key = crypto.randomBytes(32), workspace = crypto.randomBytes(16).toString('hex');
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  return { remote, key, workspace, a: pc(remote, workspace, key, ids[0], [ids[1]], cloudRetention), b: pc(remote, workspace, key, ids[1], [ids[0]], cloudRetention) };
}
test('authenticated encryption rejects tampering, wrong keys, and swapped filenames', () => {
  const key = crypto.randomBytes(32), bytes = encode(key, 'workspace', 'object', Buffer.from('mail'));
  assert.equal(decode(key, 'workspace', 'object', bytes).toString(), 'mail');
  assert.throws(() => decode(key, 'workspace', 'other', bytes));
  assert.throws(() => decode(crypto.randomBytes(32), 'workspace', 'object', bytes));
  bytes[20] ^= 1; assert.throws(() => decode(key, 'workspace', 'object', bytes));
  const workspace = crypto.randomBytes(16).toString('hex');
  assert.deepEqual(parsePairing(pairingCode(workspace, key)), { workspace, key });
});
test('two PCs retain incoming and sent mail, sync read/flag state, and survive restarts', async () => {
  const { a, b, remote, workspace, key } = pair();
  const received = a.add(Buffer.from('Date: old\r\n\r\nComplete mail with attachment\x00'));
  b.add(Buffer.from('Sent mail from second PC'));
  await a.sync.run(); assert.equal(a.sync.safeToClean(received), false);
  await b.sync.run(); await a.sync.run(); await b.sync.run();
  assert.equal(a.records.size, 2); assert.equal(b.records.size, 2);
  assert.equal(a.sync.safeToClean(received), true);
  assert.equal(b.records.get(received.key).unread, true);
  b.records.get(received.key).unread = false;
  b.records.get(received.key).starred = true;
  await b.sync.run(); await a.sync.run();
  assert.equal(a.records.get(received.key).unread, false);
  assert.equal(a.records.get(received.key).starred, true);
  const restarted = new ArchiveSync({ root: a.root, workspace, key, device: a.sync.device, transport: remote,
    native: a.native, peers: a.sync.peers });
  await restarted.run(); assert.equal(restarted.status.retained, 2);
  assert.equal(restarted.safeToClean(received), true);
});
test('offline changes retry; corrupt downloads never receive a receipt', async () => {
  const { a, b, remote } = pair();
  const record = a.add(Buffer.from('Unsent transport while offline'));
  remote.online = false; await assert.rejects(a.sync.run(), /Offline/);
  assert.equal(a.records.size, 1);
  remote.online = true; await a.sync.run();
  const name = [...remote.objects.keys()].find(name => name.includes('-mail-'));
  remote.objects.get(name)[20] ^= 1;
  await assert.rejects(b.sync.run());
  assert.equal(b.records.size, 0);
  assert.equal([...remote.objects.keys()].some(name => name.includes(`-ack-${b.sync.device}`)), false);
  assert.notEqual(a.sync.safeToClean(record), true);
});
test('Drive buffer collection requires both PCs and never removes permanent local mail', async () => {
  const { a, b, remote } = pair(false);
  const record = a.add(Buffer.from('Keep locally after cloud collection'));
  await a.sync.run(); assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 1);
  await b.sync.run(); await a.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 0);
  assert.equal(fs.readFileSync(path.join(a.root, 'blobs', `${record.digest}.eml`)).toString(), 'Keep locally after cloud collection');
  await a.sync.run(); await b.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 0);
  assert.equal(b.records.size, 1);
});
test('failure to import or write never acknowledges a remote message', async () => {
  const { a, b, remote } = pair(); a.add(Buffer.from('Message requiring native import'));
  await a.sync.run(); b.sync.native.import = async () => { throw new Error('Mail engine import failed'); };
  await assert.rejects(b.sync.run(), /import failed/);
  assert.equal([...remote.objects.keys()].some(n => n.includes(`-ack-${b.sync.device}`)), false);
});
