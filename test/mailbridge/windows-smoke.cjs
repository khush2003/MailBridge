const { _electron: electron } = require('@playwright/test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = path.resolve('app/dist/MailBridge-win32-x64');
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-smoke-'));
  const application = await electron.launch({ executablePath: path.join(root, 'MailBridge.exe'),
    args: ['--config-dir-path', config], timeout: 60000 });
  try {
    const window = await application.firstWindow();
    await window.getByText('Connect an email account', { exact: true }).waitFor({ timeout: 60000 });
    await window.getByText('IMAP / SMTP', { exact: true }).click();
    await window.getByText('IMAP', { exact: false }).first().waitFor();
    fs.writeFileSync('app/dist/mailbridge-smoke.log', 'Packaged application launched and account setup opened successfully.\n');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exit(1); });
