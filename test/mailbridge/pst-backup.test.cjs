const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { exportPstBackup } = require('../../app/src/mailbridge/pst-backup');
function fixture(t, program, extra = {}) {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-backup-'));
  t.after(() => fs.rmSync(destination, { recursive: true, force: true }));
  fs.mkdirSync(path.join(destination, 'previous-completed'));
  fs.writeFileSync(path.join(destination, 'previous-completed', 'MailBridge.pst'), 'previous');
  return { destination, options: { root: 'archive', destination, executable: 'helper.exe', spawnExporter: (_, args) => spawn(process.execPath, ['-e', program, args[1]]), ...extra } };
}
const valid = `const fs=require('fs'),path=require('path'); fs.writeFileSync(path.join(process.argv[1],'MailBridge.pst'),Buffer.from('2142444e00000000','hex'));`;
const completed = `console.log(JSON.stringify({complete:true,count:2,total:2,files:['MailBridge.pst']}));`;
test('publishes only a verified completed snapshot and preserves earlier backups', async t => {
  const f = fixture(t, valid + completed);
  const result = await exportPstBackup(f.options);
  assert.equal(result.count, 2);
  assert.ok(fs.existsSync(path.join(result.path, 'backup.json')));
  assert.equal(fs.readFileSync(path.join(f.destination, 'previous-completed', 'MailBridge.pst'), 'utf8'), 'previous');
  assert.ok(!fs.readdirSync(f.destination).some(name => name.startsWith('.mailbridge-incomplete')));
});
test('failure after partial output cannot publish a completed backup', async t => {
  const f = fixture(t, valid + `console.error('Outlook failed');process.exit(1);`);
  await assert.rejects(exportPstBackup(f.options), /Outlook failed/);
  assert.equal(fs.readdirSync(f.destination).filter(name => name.startsWith('MailBridge-')).length, 0);
  assert.ok(fs.readdirSync(f.destination).some(name => name.startsWith('.mailbridge-incomplete')));
});
test('rejects a false completion count and an invalid PST signature', async t => {
  const f = fixture(t, valid + `console.log(JSON.stringify({complete:true,count:1,total:2,files:['MailBridge.pst']}));`);
  await assert.rejects(exportPstBackup(f.options), /did not finish/);
  const g = fixture(t, `const fs=require('fs'),path=require('path');fs.writeFileSync(path.join(process.argv[1],'MailBridge.pst'),'fake');` + completed);
  await assert.rejects(exportPstBackup(g.options), /invalid PST/);
});
test('cancels and times out stalled Outlook workers without touching older snapshots', async t => {
  const abort = new AbortController();
  const f = fixture(t, 'setInterval(()=>{},1000);', { signal: abort.signal });
  setTimeout(() => abort.abort(), 100);
  await assert.rejects(exportPstBackup(f.options), /canceled/);
  const g = fixture(t, 'setInterval(()=>{},1000);', { idleTimeoutMs: 100 });
  await assert.rejects(exportPstBackup(g.options), /stopped reporting/);
});
