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
      assert.equal(args[args.indexOf('-SourcePstPath') + 1], source);
      const directory = args[args.indexOf('-OutputDirectory') + 1];
      const snapshot = args[args.indexOf('-PstPath') + 1];
      assert.deepEqual(fs.readFileSync(snapshot), original);
      return spawn(process.execPath, ['-e', program, directory, args[args.indexOf('-CancelPath') + 1]]);
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
    console.log(JSON.stringify({snapshotDetached:true}));
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
    console.log(JSON.stringify({snapshotDetached:true}));
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

test('cancel stops a stalled exporter but retains the snapshot if Outlook detachment is unconfirmed', async (t) => {
  const f = await fixture(t, 'setInterval(()=>{},1000);');
  f.options.onProgress = (p) => {
    if (p.message.startsWith('Starting')) setTimeout(() => f.abort.abort(), 100);
  };
  await assert.rejects(importOutlookPst(f.options), /Import canceled.*temporary PST copy is kept/);
  assert.deepEqual(fs.readFileSync(f.source), f.original);
  assert.equal(fs.readdirSync(path.join(f.root, 'imports')).filter(name=>name.endsWith('.pst')).length, 1);
});

test('a silent Outlook exporter fails with an actionable timeout rather than disabling import forever', async (t) => {
  const f = await fixture(t, 'setInterval(()=>{},1000);', { idleTimeoutMs: 1000 });
  await assert.rejects(importOutlookPst(f.options), /Outlook has not responded/);
  assert.equal(fs.readdirSync(path.join(f.root, 'imports')).filter(name=>name.endsWith('.pst')).length, 1);
});

test('cancellation allows a responsive Outlook worker to detach before removing its snapshot', async t => {
  const f = await fixture(t, `const fs=require('fs'),path=require('path');const timer=setInterval(()=>{if(fs.existsSync(process.argv[2])){fs.writeFileSync(path.join(process.argv[1],'..','detached.marker'),'detached');clearInterval(timer);console.log(JSON.stringify({snapshotDetached:true}));process.exitCode=1;}},20);`);
  f.options.onProgress = p => { if(p.message.startsWith('Starting'))setTimeout(()=>f.abort.abort(),100); };
  await assert.rejects(importOutlookPst(f.options), /Import canceled/);
  assert.equal(fs.readFileSync(path.join(f.root,'detached.marker'),'utf8'),'detached');
  assert.deepEqual(fs.readFileSync(f.source),f.original);
  assert.deepEqual(fs.readdirSync(path.join(f.root,'imports')),[]);
});

test('failed protected-PST attachment retains its copy when the worker cannot detach it', async t => {
  const f=await fixture(t, `console.log(JSON.stringify({retainSnapshot:true,progress:'Outlook could not detach the temporary PST.'}));console.error('Opening the temporary PST copy failed: The Outlook data file failed to load for this session');process.exitCode=1;`);
  await assert.rejects(importOutlookPst(f.options), /failed to load.*temporary PST copy is kept/s);
  const files=fs.readdirSync(path.join(f.root,'imports'));
  assert.equal(files.length,1);
  assert.match(files[0],/\.pst$/);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'imports',files[0])),f.original);
  assert.deepEqual(fs.readFileSync(f.source),f.original);
});

test('successful message import still reports a retained copy if Outlook cleanup fails', async t => {
  const f=await fixture(t, `const fs=require('fs'),path=require('path');fs.writeFileSync(path.join(process.argv[1],'message.eml'),'complete');console.log(JSON.stringify({file:'message.eml',folder:'Sent',role:'sent'}));console.log(JSON.stringify({retainSnapshot:true,progress:'Outlook could not detach the temporary PST.'}));`);
  const result=await importOutlookPst(f.options);
  assert.equal(result.count,1);
  assert.equal(result.warnings,0);
  assert.match(result.retainedSnapshot,/\.pst$/);
  assert.deepEqual(fs.readFileSync(result.retainedSnapshot),f.original);
});
