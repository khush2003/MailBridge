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
      records.set(descriptor.key, { ...descriptor, ...records.get(descriptor.key), ...(state || (records.has(descriptor.key) ? {} : { unread: true, starred: false })) });
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

test('Drive desktop folders require actual peer delivery before reporting safe cleanup', async () => {
  const { FolderTransport } = require('../../app/src/mailbridge/folder-transport');
  const folders = [0, 1].map(() => fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-drive-')));
  const transports = folders.map(root => new FolderTransport(root));
  const workspace = crypto.randomBytes(16).toString('hex'), key = crypto.randomBytes(32);
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  const a = pc(transports[0], workspace, key, ids[0], [ids[1]]);
  const b = pc(transports[1], workspace, key, ids[1], [ids[0]]);
  const record = a.add(Buffer.from('Mail before Drive finishes uploading'));
  await a.sync.run(); await b.sync.run();
  assert.equal(a.sync.status.phase, 'folder-ready');
  assert.equal(a.sync.safeToClean(record), false);
  assert.equal(b.records.size, 0);
  fs.writeFileSync(path.join(folders[1], `${workspace}-mail-partial.mb.tmp`), 'partial transfer');
  const replicate = (from, to) => { for (const name of fs.readdirSync(from).filter(n => n.endsWith('.mb'))) fs.copyFileSync(path.join(from, name), path.join(to, name)); };
  replicate(folders[0], folders[1]); await b.sync.run();
  assert.equal(b.records.size, 1);
  assert.equal(a.sync.safeToClean(record), false);
  replicate(folders[1], folders[0]); await a.sync.run();
  assert.equal(a.sync.safeToClean(record), true);
  await assert.rejects(transports[0].get('../secret.mb'), /Invalid/);
  fs.rmSync(folders[0], { recursive: true });
  await assert.rejects(a.sync.run(), /unavailable/);
  assert.equal(fs.existsSync(path.join(a.root, 'blobs', `${record.digest}.eml`)), true);
});

test('independent offline folder, read, and flag changes converge without an echo', async () => {
  const { a, b, remote } = pair();
  const record = a.add(Buffer.from('Offline concurrent changes'));
  await a.sync.run(); await b.sync.run(); await a.sync.run(); await b.sync.run();
  remote.online = false;
  a.records.get(record.key).folder = 'Projects';
  b.records.get(record.key).unread = false; b.records.get(record.key).starred = true;
  await assert.rejects(a.sync.run()); await assert.rejects(b.sync.run());
  remote.online = true;
  await a.sync.run(); await b.sync.run(); await a.sync.run(); await b.sync.run();
  for (const peer of [a, b]) {
    assert.equal(peer.records.get(record.key).folder, 'Projects');
    assert.equal(peer.records.get(record.key).unread, false);
    assert.equal(peer.records.get(record.key).starred, true);
  }
  const state = JSON.stringify(a.sync.journal.messages[record.key].state);
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal(JSON.stringify(a.sync.journal.messages[record.key].state), state);
});

test('bounded upload batches make progress and a full Drive does not prevent confirmed collection', async () => {
  const { a, b, remote } = pair(false);
  const first = a.add(Buffer.from('First mail to deliver'));
  a.add(Buffer.from('Second mail to deliver'));
  a.sync.maxUploadBytes = 1;
  await a.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 1);
  assert.equal([...remote.objects.keys()].filter(n => n.includes(`-ack-${a.sync.device}`)).length, 1);
  await b.sync.run();
  const put = remote.put.bind(remote);
  remote.put = async (name, bytes) => {
    if (name.includes('-mail-')) { const error = new Error('Drive storage quota exceeded'); error.status = 403; throw error; }
    return put(name, bytes);
  };
  await assert.rejects(a.sync.run(), /quota/);
  assert.equal(a.sync.safeToClean(first), true);
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 0);
  assert.equal(a.records.size, 2);
  remote.put = put;
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal(b.records.size, 2);
});

test('a PC first encountering mail in server Trash cannot relocate an existing retained Inbox copy', async () => {
  const { a, b } = pair();
  const raw = Buffer.from('Retain original Inbox even when another PC first sees server Trash');
  const record = a.add(raw);
  const second = b.add(raw); second.folder = 'Trash'; second.role = 'trash';
  await b.sync.run(); await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal(a.records.get(record.key).folder, 'INBOX');
  assert.equal(b.records.get(record.key).folder, 'INBOX');
});

test('a freshly captured self-addressed Inbox copy does not override the sender\'s Sent archive', async () => {
  const { a, b } = pair();
  for (let index = 0; index < 10; index++) b.add(Buffer.from(`Other existing mail ${index}`));
  const raw = Buffer.from('Self-addressed outgoing mail');
  const record = a.add(raw); record.folder = 'Sent'; record.role = 'sent';
  b.add(raw);
  await b.sync.run(); await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal(a.records.get(record.key).folder, 'Sent');
  assert.equal(b.records.get(record.key).folder, 'Sent');
});

test('a large initial archive scan cannot overwrite existing peer read and flag changes', async () => {
  const { a, b } = pair();
  const raw = Buffer.from('Read and flag before the second PC starts syncing');
  const record = a.add(raw);
  await a.sync.run();
  record.unread = false; record.starred = true;
  await a.sync.run();
  for (let index = 0; index < 10; index++) b.add(Buffer.from(`Initial scan mail ${index}`));
  b.add(raw);
  await b.sync.run(); await a.sync.run(); await b.sync.run();
  for (const peer of [a, b]) {
    assert.equal(peer.records.get(record.key).unread, false);
    assert.equal(peer.records.get(record.key).starred, true);
  }
});

test('verified immutable receipts are cached while peer state is still refreshed', async () => {
  const { a, b, remote } = pair();
  a.add(Buffer.from('Receipt caching'));
  await a.sync.run(); await b.sync.run(); await a.sync.run(); await b.sync.run();
  const fetched = [], original = remote.get.bind(remote);
  remote.get = async id => { fetched.push(id); return original(id); };
  b.records.values().next().value.starred = true;
  await b.sync.run(); await a.sync.run();
  assert.equal(fetched.some(id => id.includes('-ack-') || id.includes('-mail-')), false);
  assert.equal(a.records.values().next().value.starred, true);
});

test('both PCs must select the buffer, and permanent mode restores collected cloud copies', async () => {
  const { a, b, remote } = pair(false);
  b.sync.cloudRetention = true;
  a.add(Buffer.from('Retention policy changes'));
  await a.sync.run(); await b.sync.run(); await a.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 1);
  b.sync.cloudRetention = false;
  await b.sync.run(); await a.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 0);
  a.sync.cloudRetention = true;
  await a.sync.run(); await a.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 1);
  await b.sync.run();
  assert.equal([...remote.objects.keys()].filter(n => n.includes('-mail-')).length, 1);
});

test('unchanged large snapshots avoid transfers but edits invalidate the revision cache', async () => {
  const { a, b, remote } = pair();
  const originalList = remote.list.bind(remote);
  remote.list = async prefix => (await originalList(prefix)).map(o => ({ ...o, md5Checksum: hash(remote.objects.get(o.id)) }));
  a.add(Buffer.from('Snapshot revision cache'));
  await a.sync.run(); await b.sync.run(); await a.sync.run(); await b.sync.run(); await a.sync.run();
  const fetched = [], uploaded = [], get = remote.get.bind(remote), put = remote.put.bind(remote);
  remote.get = async id => { fetched.push(id); return get(id); };
  remote.put = async (name, data) => { uploaded.push(name); return put(name, data); };
  await a.sync.run(); await b.sync.run();
  assert.deepEqual(fetched, []); assert.deepEqual(uploaded, []);
  b.records.values().next().value.unread = false;
  await b.sync.run(); await a.sync.run();
  assert.equal(a.records.values().next().value.unread, false);
  assert.equal(fetched.filter(id => id.includes('-state-')).length, 1);
});

test('pausing archive transfers preserves completed work and resumes without duplicating mail', async t => {
  const {a,b,remote}=pair();t.after(()=>{fs.rmSync(a.root,{recursive:true,force:true});fs.rmSync(b.root,{recursive:true,force:true});});
  const one=a.add(Buffer.from('First mail')),two=a.add(Buffer.from('Second mail'));
  let paused=false; a.sync.isCanceled=()=>paused;
  const put=remote.put.bind(remote); remote.put=async(name,bytes)=>{await put(name,bytes);if(name.includes('-mail-'))paused=true;};
  assert.equal(await a.sync.run(),false); assert.equal(a.sync.status.phase,'paused');assert.equal(a.sync.status.running,false);
  assert.ok(fs.existsSync(path.join(a.root,'blobs',one.digest+'.eml')));assert.ok(fs.existsSync(path.join(a.root,'blobs',two.digest+'.eml')));
  paused=false;remote.put=put;await a.sync.run();await b.sync.run();
  assert.equal(b.records.size,2);assert.equal([...remote.objects.keys()].filter(name=>name.includes('-mail-')).length,2);
});
