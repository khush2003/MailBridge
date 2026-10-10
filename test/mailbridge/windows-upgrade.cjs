// Launch the upgraded installation using its existing, populated profile.
const { _electron: electron, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
(async () => {
  const profile = path.join(process.env.APPDATA, 'MailBridge');
  const binary = process.env.MAILBRIDGE_UPGRADE_BINARY || path.join(process.env.LOCALAPPDATA, 'Programs', 'MailBridge', 'MailBridge.exe');
  const args = process.env.MAILBRIDGE_UPGRADE_BINARY ? [path.resolve('app'), '--dev', '--config-dir-path', profile] : ['--config-dir-path', profile];
  const application = await electron.launch({ executablePath: binary, args, env: { ...process.env, PLAYWRIGHT: '1' }, timeout: 60000 });
  const errors=[];const attach=page=>page.on('pageerror',error=>errors.push(error.stack));
  application.on('window',attach);application.windows().forEach(attach);
  try {
    let page;
    await expect.poll(async () => { for (const candidate of application.windows()) if(await candidate.locator('body.window-type-default #mb-password-overlay').isVisible().catch(()=>false)){ page=candidate;return true;}return false; },{timeout:60000}).toBe(true);
    await expect(page.locator('.mb-office-header')).not.toBeVisible();
    await page.getByLabel('Password',{exact:true}).fill('upgrade-fixture-password');
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await expect.poll(async () => { for (const candidate of application.windows()) if(await candidate.locator('body.window-type-default .mb-office-header').isVisible().catch(()=>false)){ page=candidate;return true;}return false; },{timeout:60000}).toBe(true);
    assert.equal(errors.length,0,errors.join('\n'));
    const status = await page.evaluate(()=>({ version:AppEnv.getVersion(), accounts:require('mailspring-exports').AccountStore.accounts().map(a=>({id:a.id,email:a.emailAddress})), settings:require(AppEnv.getLoadSettings().resourcePath+'/src/mailbridge/controller').default.settings() }));
    assert.equal(status.version.split('-')[0],'0.1.4');if(process.env.GITHUB_SHA)assert.equal(status.version,`0.1.4-${process.env.GITHUB_SHA.slice(0,8)}`);assert.deepEqual(status.accounts,[{id:'c0ffee-peer',email:'test@example.test'}]);
    assert.equal(status.settings.backupEnabled,true);assert.equal(status.settings.backupInterval,'weekly');assert.equal(status.settings.backupFolder,'D:\\Backups');
    await page.getByText('Message 43001',{exact:true}).first().click();
    await expect(page.locator('.message-subject')).toHaveText('Message 43001');
    await expect(page.frameLocator('.message-iframe-container iframe').first().locator('body')).toContainText('body of message 43001');
    assert.ok(!/Mailspring Pro|payment|billing/i.test(await page.locator('body').innerText()));
    await page.screenshot({animations:'disabled',path:'mailbridge-artifacts/windows-upgraded-profile.png'});
    fs.appendFileSync('mailbridge-artifacts/upgrade-verification.txt','\nThe installed 0.1.4 opened the existing locked profile, unlocked with its original password, retained the existing account and backup schedule, and displayed retained mail with its full body.\n');
  } catch(error) {
    const diagnostics=[];
    for (const [index,candidate] of application.windows().entries()) {
      diagnostics.push({url:candidate.url(),body:await candidate.locator('body').innerText().catch(()=>''),settings:await candidate.evaluate(()=>typeof AppEnv==='undefined'?null:AppEnv.getLoadSettings()).catch(()=>null)});
      await candidate.screenshot({animations:'disabled',path:`mailbridge-artifacts/windows-upgrade-failure-${index}.png`}).catch(()=>{});
    }
    fs.writeFileSync('mailbridge-artifacts/upgrade-failure.json',JSON.stringify({error:error.stack,errors,windows:diagnostics},null,2));
    throw error;
  } finally { await application.close(); }
})().catch(error=>{console.error(error);process.exitCode=1});
