const assert = require('node:assert/strict');
const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = path.resolve('app/dist/MailBridge-win32-x64');
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-smoke-'));
  const application = await electron.launch({ executablePath: process.env.MAILBRIDGE_DESKTOP_BINARY || path.join(root, 'MailBridge.exe'),
    args: ['--config-dir-path', config], timeout: 60000 });
  try {
    const protection = await application.evaluate(async ({ app, safeStorage }) => {
      await app.whenReady();
      if (!safeStorage.isEncryptionAvailable()) return { available: false, name: app.getName() };
      const encrypted = safeStorage.encryptString('mailbridge-windows-test');
      const asyncAvailable = await safeStorage.isAsyncEncryptionAvailable();
      const asyncEncrypted = asyncAvailable ? await safeStorage.encryptStringAsync('mailbridge-windows-test') : null;
      const asyncRoundtrip = asyncEncrypted ? (await safeStorage.decryptStringAsync(asyncEncrypted)).result : null;
      return { available: true, roundtrip: safeStorage.decryptString(encrypted), asyncAvailable, asyncRoundtrip, name: app.getName() };
    });
    if (process.platform === 'win32') {
      assert.equal(protection.available, true, 'Windows credential protection must be available');
      assert.equal(protection.roundtrip, 'mailbridge-windows-test');
      assert.equal(protection.asyncAvailable, true);
      assert.equal(protection.asyncRoundtrip, 'mailbridge-windows-test');
    }
    assert.equal(protection.name, 'MailBridge');
    const window = await application.firstWindow();
    await window.getByText('Connect an email account', { exact: true }).waitFor({ timeout: 60000 });
    await window.getByText('IMAP / SMTP', { exact: true }).click();
    await window.getByText('IMAP', { exact: false }).first().waitFor();
    fs.writeFileSync('app/dist/mailbridge-smoke.log', 'Packaged application launched and account setup opened successfully.\n');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exit(1); });
