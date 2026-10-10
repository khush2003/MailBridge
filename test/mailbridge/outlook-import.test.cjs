const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { importOutlookPst } = require('../../app/src/mailbridge/outlook-import');

async function fixture(t, program, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-pst-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, 'original.pst');
  const original = Buffer.alloc(2 * 1024 * 1024, 42);
  fs.writeFileSync(source, original);
  const events = [];
  const abort = new AbortController();
  const options = {
    source,
    root,
    script: 'export.ps1',
    signal: abort.signal,
    onProgress: (progress) => events.push(progress),
    importRecord: async () => {},
    spawnExporter: (command, args) => {
      assert.equal(command, 'powershell.exe');
      assert.ok(args.includes('-STA'));
      const directory = args[args.indexOf('-OutputDirectory') + 1];
      const snapshot = args[args.indexOf('-PstPath') + 1];
      assert.deepEqual(fs.readFileSync(snapshot), original);
      return spawn(process.execPath, ['-e', program, directory]);
    },
    ...overrides,
  };
  return { options, source, original, root, events, abort };
}

test('PST import reports copying and Outlook stages; counts messages only after native import', async (t) => {
  let imported = 0;
  const f = await fixture(
    t,
    `
    const fs=require('fs'), path=require('path'), dir=process.argv[1];
    console.log(JSON.stringify({progress:'Opening your Outlook profile.'}));
    fs.writeFileSync(path.join(dir,'message.eml'),'complete message');
    console.log(JSON.stringify({file:'message.eml',folder:'Sent',role:'sent'}));
    console.log(JSON.stringify({warning:'Cannot export item'}));
  `,
    {
      importRecord: async (record) => {
        assert.equal(record.folder, 'Sent');
        imported++;
      },
    }
  );
  assert.deepEqual(await importOutlookPst(f.options), { count: 1, warnings: 1 });
  assert.equal(imported, 1);
  assert.ok(f.events.some((p) => p.message.includes('Copying PST: 100%')));
  assert.ok(f.events.some((p) => p.message === 'Opening your Outlook profile.'));
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'imports')), []);
});

test('exporter failures retain recovery EMLs, remove the snapshot, and leave source unchanged', async (t) => {
  const f = await fixture(
    t,
    `
    const fs=require('fs'),path=require('path');
    fs.writeFileSync(path.join(process.argv[1],'recovery.eml'),'recovery');
    console.error('Classic Outlook could not open this PST'); process.exit(1);
  `
  );
  await assert.rejects(importOutlookPst(f.options), /Classic Outlook could not open/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'imports')), ['recovery.eml']);
});

test('cancel during copy preserves original and never starts Outlook', async (t) => {
  const f = await fixture(t, '');
  f.options.onProgress = () => f.abort.abort();
  f.options.spawnExporter = () => {
    throw new Error('Exporter must not start');
  };
  await assert.rejects(importOutlookPst(f.options), /Import canceled/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'imports')), []);
});

test('cancel stops a stalled exporter and releases its disposable snapshot', async (t) => {
  const f = await fixture(t, 'setInterval(()=>{},1000);');
  f.options.onProgress = (p) => {
    if (p.message.startsWith('Starting')) setTimeout(() => f.abort.abort(), 100);
  };
  await assert.rejects(importOutlookPst(f.options), /Import canceled/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'imports')), []);
});

test('a silent Outlook exporter fails with an actionable timeout rather than disabling import forever', async (t) => {
  const f = await fixture(t, 'setInterval(()=>{},1000);', { idleTimeoutMs: 1000 });
  await assert.rejects(importOutlookPst(f.options), /Outlook has not responded/);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'imports')), []);
});
