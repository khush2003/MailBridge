const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const options = require('../../app/build/mailbridge/asar-options');
test('Outlook scripts and nested PST helper files remain real files after ASAR packaging', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-asar-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, 'app');
  const files = ['mailbridge-tools/import-outlook.ps1', 'mailbridge-tools/pst-backup/MailBridge.PstBackup.exe', 'mailbridge-tools/pst-backup/MsgKit.dll', 'mailbridge-tools/pst-backup/MailBridge.PstBackup.exe.config', 'mailbridge-tools/pst-backup/licenses/OpenMcdf-MPL-2.0.txt'];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
    fs.writeFileSync(path.join(source, file), file);
  }
  const archive = path.join(directory, 'app.asar');
  await asar.createPackageWithOptions(source, archive, options);
  for (const file of files) {
    assert.equal(asar.statFile(archive, path.normalize(file)).unpacked, true);
    assert.equal(fs.readFileSync(path.join(`${archive}.unpacked`, file), 'utf8'), file);
  }
});
