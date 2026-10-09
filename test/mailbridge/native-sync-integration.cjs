// Invoked by the native harness against two independently running engine processes.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ArchiveSync } = require('../../app/src/mailbridge/core');
(async () => {
  const [base, rootA, rootB] = process.argv.slice(2);
  const objects = new Map();
  const transport = {
    health: async () => ({ type: 'folder' }),
    list: async prefix => [...objects.keys()].filter(name => name.startsWith(prefix)).map(name => ({ name, id: name })),
    put: async (name, bytes) => objects.set(name, bytes), get: async name => objects.get(name), remove: async name => objects.delete(name),
  };
  const call = async (pc, packet) => {
    const res = await fetch(`${base}/${pc}`, { method: 'POST', body: JSON.stringify(packet) });
    const value = await res.json();
    if (!res.ok) throw new Error(value.error);
    return value;
  };
  const adapter = pc => ({ list: async () => (await call(pc, { operation: 'list' })).records,
    import: (descriptor, state) => call(pc, { operation: 'import', descriptor, ...(state ? { state } : {}) }) });
  const key = crypto.randomBytes(32), workspace = crypto.randomBytes(16).toString('hex');
  const devices = [crypto.randomUUID(), crypto.randomUUID()];
  const a = new ArchiveSync({ root: rootA, key, workspace, device: devices[0], peers: [devices[1]], transport, native: adapter('a') });
  const b = new ArchiveSync({ root: rootB, key, workspace, device: devices[1], peers: [devices[0]], transport, native: adapter('b') });
  await a.run(); await b.run(); await a.run();
  const record = (await a.native.list())[0], imported = (await b.native.list())[0];
  assert.equal(imported.key, record.key); assert.equal(imported.digest, record.digest);
  assert.equal(a.safeToClean(record), true);
  await b.native.import(imported, { unread: false, starred: true, folder: 'Projects' });
  await b.run(); await a.run(); await b.run();
  for (const peer of [a, b]) {
    const row = (await peer.native.list())[0];
    assert.equal(row.folder, 'Projects'); assert.equal(row.unread, false); assert.equal(row.starred, true);
  }
})().catch(error => { console.error(error); process.exit(1); });
