// Launch the upgraded installation using its existing, populated profile.
const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const profile = path.join(process.env.APPDATA, 'MailBridge');
  const application = await electron.launch({ executablePath: path.join(process.env.LOCALAPPDATA, 'Programs', 'MailBridge', 'MailBridge.exe'), args: ['--config-dir-path', profile], timeout: 60000 });
  try {
    let page;
    await expect.poll(async () => { for (const candidate of application.windows()) if(await candidate.locator('#mb-password-overlay').isVisible().catch(()=>false)){ page=candidate;return true;}return false; },{timeout:60000}).toBe(true);
    await expect(page.locator('.mb-office-header')).not.toBeVisible();
    await page.getByLabel('Password',{exact:true}).fill('upgrade-fixture-password');
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await expect(page.locator('.mb-office-header')).toBeVisible();
    const status = await page.evaluate(()=>({ version:AppEnv.getVersion(), accounts:require('mailspring-exports').AccountStore.accounts().map(a=>({id:a.id,email:a.emailAddress})), settings:require(AppEnv.getLoadSettings().resourcePath+'/src/mailbridge/controller').default.settings() }));
    assert.equal(status.version,'0.1.4');assert.deepEqual(status.accounts,[{id:'c0ffee-peer',email:'test@example.test'}]);
    assert.equal(status.settings.backupEnabled,true);assert.equal(status.settings.backupInterval,'weekly');assert.equal(status.settings.backupFolder,'D:\\Backups');
    await page.getByText('Message 43001',{exact:true}).first().click();
    await expect(page.locator('.message-subject')).toHaveText('Message 43001');
    await expect(page.frameLocator('.message-iframe-container iframe').first().locator('body')).toContainText('body of message 43001');
    assert.ok(!/Mailspring Pro|payment|billing/i.test(await page.locator('body').innerText()));
    await page.screenshot({animations:'disabled',path:'mailbridge-artifacts/windows-upgraded-profile.png'});
    fs.appendFileSync('mailbridge-artifacts/upgrade-verification.txt','\nThe installed 0.1.4 opened the existing locked profile, unlocked with its original password, retained the existing account and backup schedule, and displayed retained mail with its full body.\n');
  } finally { await application.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
