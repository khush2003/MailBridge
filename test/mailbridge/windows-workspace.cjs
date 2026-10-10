// Verify the actual packaged mail workspace against mail captured by the native tests.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const native = path.resolve('mailbridge-artifacts/native');
  const scenario = process.env.MAILBRIDGE_WORKSPACE_PROFILE ? null : fs.readdirSync(native).find(name => name.startsWith('test_two_pcs_keep_imap_mail'));
  assert.ok(scenario || process.env.MAILBRIDGE_WORKSPACE_PROFILE, 'Native two-PC fixture must exist');
  const source = process.env.MAILBRIDGE_WORKSPACE_PROFILE || path.join(native, scenario, 'b', 'config');
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-workspace-'));
  fs.cpSync(source, config, { recursive: true });
  const id = process.env.MAILBRIDGE_WORKSPACE_ACCOUNT_ID || 'c0ffee-peer';
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ '*': {
    core: { reading: { markAsReadDelay: -1 }, workspace: { mode: 'split' }, disabledPackages: ['mcp-server', 'open-tracking', 'link-tracking', 'activity', 'thread-sharing'] },
    env: 'production', containerFolderDefault: '', accountsVersion: 19, accounts: [{ id, metadata: [], name: 'Offline workspace fixture', provider: 'imap', emailAddress: 'test@example.test', label: 'test@example.test',
      settings: { imap_host: '127.0.0.1', imap_port: 65530, imap_username: 'test', imap_security: 'none', smtp_host: '127.0.0.1', smtp_port: 65530, smtp_username: 'test', smtp_security: 'none' },
      autoaddress: { type: 'bcc', value: '' }, aliases: [], authedAt: 0, syncState: 'sync_error', __cls: 'Account' }],
  } }));
  const binary = process.env.MAILBRIDGE_WORKSPACE_BINARY || path.resolve('app/dist/MailBridge-win32-x64/MailBridge.exe');
  const args = process.env.MAILBRIDGE_WORKSPACE_BINARY ? [path.resolve('app'), '--dev', '--config-dir-path', config] : ['--config-dir-path', config];
  const application = await electron.launch({ executablePath: binary, args, env: { ...process.env, PLAYWRIGHT: '1' }, timeout: 60000 });
  const errors = [];
  application.on('window', page => page.on('pageerror', error => errors.push(error.stack)));
  try {
    let page;
    await expect.poll(async () => {
      for (const candidate of application.windows()) if (await candidate.locator('.mb-office-header').isVisible().catch(() => false)) { page = candidate; return true; }
      return false;
    }, { timeout: 60000 }).toBe(true);
    await expect(page.locator('body')).toHaveClass(/theme-ui-mailbridge/);
    await expect(page.getByRole('button', { name: 'New Email', exact: true })).toBeVisible();
    const title = process.env.MAILBRIDGE_WORKSPACE_SUBJECT || 'Message 43001';
    await page.getByText(title, { exact: true }).first().click();
    await expect(page.locator('.message-subject')).toHaveText(title);
    const tabs = page.locator('.mb-office-tabs');
    await tabs.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Message list only', exact: true }).click();
    await expect(page.locator('.column-MessageList')).toHaveCount(0);
    await tabs.getByRole('button', { name: 'View', exact: true }).click();
    await page.getByRole('button', { name: 'Reading pane right', exact: true }).click();
    await expect(page.locator('.column-MessageList')).toHaveCount(1);
    await tabs.getByRole('button', { name: 'Home', exact: true }).click();
    await page.getByText(title, { exact: true }).first().click();
    await expect(page.getByRole('button', { name: 'Reply', exact: true }).first()).toBeEnabled();
    await page.screenshot({ path: 'mailbridge-artifacts/windows-workspace.png' });
    await page.getByRole('button', { name: 'Mail Retention', exact: true }).click();
    let preferences;
    await expect.poll(async () => {
      for (const candidate of application.windows()) if (await candidate.locator('.mailbridge-preferences').isVisible().catch(() => false)) { preferences = candidate; return true; }
      return false;
    }, { timeout: 15000 }).toBe(true);
    const optionalDrive = preferences.getByRole('checkbox', { name: 'Use Google Drive for additional archive sync', exact: true });
    await expect(optionalDrive).not.toBeChecked();
    await expect(preferences.getByRole('button', { name: 'Connect directly', exact: true })).toHaveCount(0);
    await optionalDrive.check();
    await expect(preferences.getByRole('button', { name: 'Connect directly', exact: true })).toBeVisible();
    await optionalDrive.uncheck();
    await expect(preferences.getByRole('button', { name: 'Connect directly', exact: true })).toHaveCount(0);
    await preferences.screenshot({ path: 'mailbridge-artifacts/windows-retention-settings.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Packaged Office workspace, reading-pane switches, and optional Drive settings passed.');
  } finally { await application.close(); }
})().catch(error => { console.error(error); process.exit(1); });
