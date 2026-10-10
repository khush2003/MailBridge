// Verify the actual packaged mail workspace against mail captured by the native tests.
const { _electron: electron, expect } = require('@playwright/test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
(async () => {
  const native = path.resolve('mailbridge-artifacts/native');
  const scenario = process.env.MAILBRIDGE_WORKSPACE_PROFILE ? null : fs.readdirSync(native).find(name => name.startsWith('test_two_pcs_keep_imap_mail'));
  assert.ok(scenario || process.env.MAILBRIDGE_WORKSPACE_PROFILE, 'Native two-PC fixture must exist');
  const source = process.env.MAILBRIDGE_WORKSPACE_PROFILE || path.join(native, scenario, 'b', 'config');
  const config = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-workspace-'));
  fs.cpSync(source, config, { recursive: true });
  const id = process.env.MAILBRIDGE_WORKSPACE_ACCOUNT_ID || 'c0ffee-peer';
  fs.writeFileSync(path.join(config, 'config.json'), JSON.stringify({ '*': {
    core: { keymapTemplate: 'Outlook', reading: { markAsReadDelay: -1 }, workspace: { mode: 'split' }, disabledPackages: ['mcp-server', 'open-tracking', 'link-tracking', 'activity', 'thread-sharing'] },
    env: 'production', containerFolderDefault: '', accountsVersion: 19, accounts: [{ id, metadata: [], name: 'Offline workspace fixture', provider: 'imap', emailAddress: 'test@example.test', label: 'test@example.test',
      settings: { imap_host: '127.0.0.1', imap_port: 65530, imap_username: 'test', imap_security: 'none', smtp_host: '127.0.0.1', smtp_port: 65530, smtp_username: 'test', smtp_security: 'none' },
      autoaddress: { type: 'bcc', value: '' }, aliases: [], authedAt: 0, syncState: 'sync_error', __cls: 'Account' }],
  } }));
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
    path.resolve('test/mailbridge/seed-workspace-folders.py'), path.join(config, 'edgehill.db'), id,
  ]);
  const binary = process.env.MAILBRIDGE_WORKSPACE_BINARY || path.resolve('app/dist/MailBridge-win32-x64/MailBridge.exe');
  const args = process.env.MAILBRIDGE_WORKSPACE_BINARY ? [path.resolve('app'), '--dev', '--config-dir-path', config] : ['--config-dir-path', config];
  const application = await electron.launch({ executablePath: binary, args, env: { ...process.env, PLAYWRIGHT: '1' }, timeout: 60000 });
  const errors = [];
  const attach = page => {
    page.on('pageerror', error => errors.push(error.stack));
    page.on('dialog', dialog => {
      if (dialog.type() !== 'beforeunload') errors.push(`Unexpected ${dialog.type()} dialog: ${dialog.message()}`);
      dialog.accept().catch(() => {});
    });
  };
  application.on('window', attach);
  application.windows().forEach(attach);
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
    const bodyText = process.env.MAILBRIDGE_WORKSPACE_BODY || 'body of message 43001';
    const assertBody = async () => {
      await expect(page.locator('.message-subject')).toHaveText(title);
      await expect(page.frameLocator('.message-iframe-container iframe').first().locator('body')).toContainText(bodyText);
      await expect(page.locator('.message-body-loading')).toHaveCount(0);
    };
    await assertBody();
    const sidebar = page.locator('.column-RootSidebar');
    const resize = async delta => {
      const handle = await sidebar.locator('.flexbox-handle-right').boundingBox();
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
      await page.mouse.down();
      await page.mouse.move(handle.x + handle.width / 2 + delta, handle.y + handle.height / 2, { steps: 4 });
      await page.mouse.up();
      await expect.poll(async () => Math.abs((await sidebar.boundingBox()).width - (await page.locator('.nav-rail').boundingBox()).width)).toBeLessThan(2);
    };
    await resize(40);
    await resize(-40);
    const folderSpacing = await page.locator('.account-sidebar .outline-view .item').evaluateAll(items => items.filter(item => item.querySelector('.icon')).map(item => ({
      name: item.querySelector('.name').textContent,
      inset: item.querySelector('.icon').getBoundingClientRect().left - item.getBoundingClientRect().left,
      rightInset: item.getBoundingClientRect().right - (item.querySelector('.item-count-box') || item.querySelector('.name')).getBoundingClientRect().right,
    })));
    assert.ok(folderSpacing.length > 0, 'Rendered folder rows must exist');
    for (const row of folderSpacing) {
      assert.ok(row.inset >= 10, `${row.name}: icon must have room inside its selection background`);
      assert.ok(row.rightInset >= 9, `${row.name}: label or unread badge must have right padding`);
    }
    const branch = name => page.locator(`.account-sidebar .name[title="${name}"]`).locator('xpath=ancestor::*[@role="treeitem"][1]');
    for (const name of ['Projects', 'Design']) {
      const folder = branch(name);
      if (await folder.getAttribute('aria-expanded') === 'false') await folder.locator('> .item-container > .disclosure-triangle').click();
    }
    const nestedIcons = [];
    for (const name of ['Projects', 'Design', 'Review']) nestedIcons.push((await branch(name).locator('> .item-container > .item .icon').boundingBox()).x);
    assert.equal(nestedIcons[1] - nestedIcons[0], 16, 'Child folders must be visibly indented');
    assert.equal(nestedIcons[2] - nestedIcons[1], 16, 'Deeper folders must retain their indentation');
    await page.screenshot({ path: 'mailbridge-artifacts/windows-nested-folders.png' });
    await branch('Projects').locator('> .item-container > .disclosure-triangle').click();
    await page.locator('.account-sidebar .scroll-region-content').evaluateAll(elements => elements.forEach(element => { element.scrollTop = 0; }));
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
    await assertBody();
    await page.getByRole('button', { name: 'Move to Folder', exact: true }).click();
    await expect(page.locator('.category-picker-popover')).toBeVisible();
    await page.locator('.category-picker-popover input').press('Escape');
    await expect(page.locator('.category-picker-popover')).toHaveCount(0);
    const search = page.locator('.mb-list-heading').getByRole('searchbox');
    await page.keyboard.press('F3');
    await expect(search).toBeFocused();
    await search.fill(title);
    await search.press('Enter');
    await expect(page.locator('.thread-list .list-item')).toHaveCount(1);
    await page.locator('.mb-list-filters').getByRole('button', { name: 'All', exact: true }).click();
    await page.getByText(title, { exact: true }).first().click();
    await assertBody();
    if (!process.env.MAILBRIDGE_WORKSPACE_PROFILE) await expect(page.getByText('invoice.bin', { exact: true }).first()).toBeVisible();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.mb-ribbon-command').first()).toHaveCSS('transition-duration', '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running'));
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
    const clippedTabs = await preferences.getByRole('tab').locator('.name').evaluateAll(labels => labels.filter(label => label.scrollWidth > label.clientWidth + 1 || label.scrollHeight > label.clientHeight + 1).map(label => label.textContent));
    assert.deepEqual(clippedTabs, [], 'Settings tab labels must remain fully visible');
    await preferences.screenshot({ path: 'mailbridge-artifacts/windows-retention-settings.png' });
    // Exercise the packaged import UI with a controlled exporter response; CI has no Outlook profile.
    await preferences.evaluate(() => {
      const controller = require(AppEnv.getLoadSettings().resourcePath + '/src/mailbridge/controller').default;
      window._pstUiRestore = { controller, importOutlook: controller.importOutlook,
        cancelOutlookImport: controller.cancelOutlookImport, available: controller.outlookImportAvailable };
      controller.outlookImportAvailable = () => true;
      controller.importOutlook = async (id, progress) => {
        progress('Copying PST: 37% (5.9 of 16.0 GB). Your original is unchanged.');
        return new Promise((resolve, reject) => { window._pstUiReject = reject; });
      };
      controller.cancelOutlookImport = () => window._pstUiReject(new Error('Import canceled. Any messages already imported are kept.'));
    });
    await expect(preferences.getByRole('heading', { name: 'PST backups', exact: true })).toBeVisible();
    await expect(preferences.getByRole('button', { name: 'Back up now', exact: true })).toBeDisabled();
    await preferences.getByRole('heading', { name: 'PST backups', exact: true }).scrollIntoViewIfNeeded();
    await preferences.screenshot({ path: 'mailbridge-artifacts/windows-pst-backup-settings.png' });
    const importButton = preferences.getByRole('button', { name: 'Import Outlook PST', exact: true });
    await expect(importButton).toBeEnabled();
    await importButton.click();
    await expect(preferences.getByText('Copying PST: 37% (5.9 of 16.0 GB). Your original is unchanged.', { exact: true })).toBeVisible();
    await expect(preferences.getByRole('button', { name: 'Importing Outlook PST…', exact: true })).toBeDisabled();
    await preferences.waitForTimeout(250);
    await preferences.screenshot({ path: 'mailbridge-artifacts/windows-pst-import-progress.png' });
    await preferences.getByRole('button', { name: 'Cancel import', exact: true }).click();
    await expect(importButton).toBeEnabled();
    await expect(preferences.getByRole('alert').filter({ hasText: 'Import canceled.' })).toBeVisible();
    await preferences.evaluate(() => {
      const { controller, importOutlook, cancelOutlookImport, available } = window._pstUiRestore;
      Object.assign(controller, { importOutlook, cancelOutlookImport, outlookImportAvailable: available });
      delete window._pstUiRestore; delete window._pstUiReject;
    });
    const tabNames = await preferences.getByRole('tab').allTextContents();
    for (const tabName of tabNames) {
      await preferences.getByRole('tab', { name: tabName.trim(), exact: true }).click();
      await preferences.waitForTimeout(200);
      await preferences.screenshot({ path: `mailbridge-artifacts/windows-settings-${tabName.trim().replace(/[^a-zA-Z0-9]/g, '-')}.png` });
    }
    await preferences.getByRole('tab', { name: 'General', exact: true }).click();
    await expect(preferences.locator('.container-general')).toBeVisible();
    await preferences.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(preferences.getByRole('tab', { name: 'Appearance', exact: true })).toHaveAttribute('aria-selected', 'true');
    await preferences.evaluate(() => require('mailspring-exports').Actions.popSheet());
    await search.focus();
    await page.evaluate(() => AppEnv.commands.dispatch('window:launch-theme-picker'));
    await expect(page.getByRole('dialog')).toBeVisible();
    const closeDialog = page.getByRole('button', { name: 'Close dialog', exact: true });
    await closeDialog.focus();
    await page.keyboard.press('Shift+Tab');
    await expect(page.getByText('Create a Theme', { exact: true })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeDialog).toBeFocused();
    await page.waitForTimeout(200);
    const themeCards = page.locator('.clickable-theme-option');
    const firstCard = await themeCards.nth(0).boundingBox();
    const secondCard = await themeCards.nth(1).boundingBox();
    assert.ok(Math.abs(firstCard.y - secondCard.y) < 2, 'Theme cards must fit side by side');
    await page.screenshot({ path: 'mailbridge-artifacts/windows-theme-dialog.png' });
    await closeDialog.press('Enter');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(search).toBeFocused();
    // This offline fixture has no account secret or live engine. Render composition without
    // forwarding draft tasks; actual sending is covered by the native SMTP integration tests.
    await page.evaluate(() => { AppEnv.mailsyncBridge.sendMessageToAccount = () => {}; });
    await page.getByRole('button', { name: 'New Email', exact: true }).click();
    let composer;
    await expect.poll(async () => {
      for (const candidate of application.windows()) if (await candidate.locator('.composer-header').isVisible().catch(() => false)) { composer = candidate; return true; }
      return false;
    }, { timeout: 15000 }).toBe(true);
    await expect(composer.locator('.mailbridge-composer-appbar')).toBeVisible();
    assert.equal((await composer.locator('.mailbridge-composer-appbar').boundingBox()).y, 0, 'Composer title bar must sit at the top without an empty inherited toolbar');
    const subjectInput = composer.getByPlaceholder('Subject', { exact: true });
    await subjectInput.fill('MailBridge interface review');
    await subjectInput.press('End');
    await subjectInput.pressSequentially(' — typing stays focused');
    await expect(subjectInput).toBeFocused();
    await expect(subjectInput).toHaveValue('MailBridge interface review — typing stays focused');
    await expect(composer.locator('.secondary-picker')).toHaveCount(0);
    await expect(composer.getByRole('button', { name: 'Text color', exact: true })).toBeVisible();
    await composer.getByText('Cc', { exact: true }).click();
    await composer.getByText('Bcc', { exact: true }).click();
    await expect(composer.locator('.tokenizing-field.bcc input').first()).toHaveCSS('outline-style', 'none');
    await composer.waitForTimeout(250);
    await composer.screenshot({ path: 'mailbridge-artifacts/windows-compose.png' });
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('Packaged workspace, full bodies, search, folder padding, readable settings tabs, all settings screens, composition, reduced motion, and optional Drive settings passed.');
  } finally { await application.close(); }
  assert.equal(errors.length, 0, errors.join('\n'));
})().catch(error => { console.error(error); process.exit(1); });
