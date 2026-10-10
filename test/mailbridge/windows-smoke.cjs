const assert = require('node:assert/strict');
const { _electron: electron, expect } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
  const root = path.resolve('app/dist/MailBridge-win32-x64');
  if (process.platform === 'win32') {
    const applicationDirectory = process.env.MAILBRIDGE_DESKTOP_BINARY ? path.dirname(process.env.MAILBRIDGE_DESKTOP_BINARY) : root;
    const helper = path.join(applicationDirectory, 'resources', 'app.asar.unpacked', 'mailbridge-tools', 'pst-backup', 'MailBridge.PstBackup.exe');
    assert.ok(fs.existsSync(helper), 'PST backup helper must ship with the application');
    const result = execFileSync(helper, ['--self-test'], { encoding: 'utf8', timeout: 60000 });
    assert.equal(JSON.parse(result.trim()).selfTest, 'passed', 'Installed PST conversion dependencies must work');
  }
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-smoke-'));
  const application = await electron.launch({ executablePath: process.env.MAILBRIDGE_DESKTOP_BINARY || path.join(root, 'MailBridge.exe'),
    args: ['--config-dir-path', config], timeout: 60000 });
  const diagnostics = [];
  const attach = page => {
    page.on('pageerror', error => diagnostics.push(`PAGE ERROR: ${error.stack}`));
    page.on('console', message => { if (message.type() === 'error') diagnostics.push(`CONSOLE: ${message.text()}`); });
    page.on('crash', () => diagnostics.push(`RENDERER CRASH: ${page.url()}`));
  };
  application.on('window', attach);
  for (const page of application.windows()) attach(page);
  application.process().stderr.on('data', data => diagnostics.push(`STDERR: ${data.toString()}`));
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
      const startup = await application.evaluate(({ app }) => {
        app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
        return app.getLoginItemSettings({ path: process.execPath }).openAtLogin;
      });
      assert.equal(startup, true, 'Windows startup registration must work');
      await application.evaluate(({ app }) => app.setLoginItemSettings({ openAtLogin: false, path: process.execPath }));
    }
    assert.equal(protection.name, 'MailBridge');
    let window;
    await expect.poll(async () => {
      for (const candidate of application.windows()) {
        if (await candidate.getByText('Connect an email account', { exact: true }).isVisible().catch(() => false)) {
          window = candidate;
          return true;
        }
      }
      return false;
    }, { timeout: 60000, message: 'Account setup window must open' }).toBe(true);
    await window.waitForTimeout(300);
    await window.screenshot({ path: 'mailbridge-artifacts/windows-onboarding.png' });
    await window.getByRole('button', { name: 'IMAP / SMTP', exact: true }).focus();
    await window.keyboard.press('Enter');
    await expect(window.getByText('Add your IMAP account', { exact: true })).toBeVisible();
    await window.waitForTimeout(300);
    await window.screenshot({ path: 'mailbridge-artifacts/windows-onboarding-imap.png' });
    fs.writeFileSync('app/dist/mailbridge-smoke.log', 'Packaged application launched and account setup opened successfully.\n');
  } catch (error) {
    const windows = [];
    for (const page of application.windows()) windows.push({ url: page.url(), body: await page.locator('body').innerText().catch(() => '') });
    fs.writeFileSync('app/dist/mailbridge-smoke.log', `${error.stack}\n${diagnostics.join("\n")}\n${JSON.stringify(windows, null, 2)}\n`);
    throw error;
  } finally {
    if (process.platform === 'win32') await application.evaluate(({ app }) => app.setLoginItemSettings({ openAtLogin: false, path: process.execPath })).catch(() => {});
    await application.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
