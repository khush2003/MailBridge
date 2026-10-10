import { EventEmitter } from 'events';
import { app, ipcMain, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { isMailspringWindowContents } from './mailspring-window';
import { mailbridgeLocked } from './mailbridge-lock';
const { verifyManifest, newerVersion, downloadUpdate } = require('../mailbridge/update-download');
const configuration = require('../../mailbridge-updates.json');

export default class AutoUpdateManager extends EventEmitter {
  state = 'idle';
  feedURL = configuration.feed;
  details: any = { message: 'Check for MailBridge updates.' };
  installer: string;
  checking = false;
  constructor(
    public version: string,
    public config: import('../config').default,
    public specMode: boolean
  ) {
    super();
    if (!specMode) {
      ipcMain.handle('mailbridge-update-check', async (event) => {
        if (!isMailspringWindowContents(event.sender) || mailbridgeLocked())
          throw new Error('Unlock MailBridge first.');
        return this.check();
      });
      ipcMain.handle('mailbridge-update-install', (event) => {
        if (!isMailspringWindowContents(event.sender) || mailbridgeLocked())
          throw new Error('Unlock MailBridge first.');
        return this.install();
      });
    }
  }
  getState() {
    return this.state;
  }
  getReleaseDetails() {
    return this.details;
  }
  updateFeedURL() {}
  setupAutoUpdater() {}
  publish(message: string) {
    this.details = { ...this.details, message, state: this.state };
    this.emit('state-changed', this.state);
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send('mailbridge-update-status', this.details)
    );
    return this.details;
  }
  async check(_options: { hidePopups?: boolean } = {}) {
    if (this.checking || this.specMode) return this.details;
    if (process.platform !== 'win32')
      return this.publish('Updates are available in the Windows build.');
    this.checking = true;
    this.state = 'checking';
    this.publish(
      'Checking for an update. Connect to Tailscale to reach the private update server.'
    );
    try {
      const response = await fetch(this.feedURL, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`Update server returned ${response.status}`);
      const envelope = await response.text();
      if (envelope.length > 65536) throw new Error('Update metadata is too large');
      const manifest = verifyManifest(JSON.parse(envelope), configuration.publicKey);
      if (!newerVersion(manifest.version, this.version)) {
        this.state = 'no-update-available';
        return this.publish(`MailBridge ${this.version} is up to date.`);
      }
      this.details = { ...this.details, ...manifest, releaseVersion: manifest.version };
      this.state = 'downloading';
      this.installer = await downloadUpdate(
        manifest,
        path.join(app.getPath('userData'), 'updates'),
        (percent: number) => this.publish(`Downloading MailBridge ${manifest.version}: ${percent}%`)
      );
      this.state = 'update-available';
      return this.publish(
        `MailBridge ${manifest.version} is ready. Restart to update; your accounts and mail will be kept.`
      );
    } catch (error) {
      this.state = 'error';
      return this.publish(
        `Could not update: ${error.message}. Your current installation is unchanged.`
      );
    } finally {
      this.checking = false;
    }
  }
  install() {
    if (mailbridgeLocked()) throw new Error('Unlock MailBridge before updating.');
    if (this.state !== 'update-available' || !this.installer)
      throw new Error('Download a verified update first.');
    const statusFile = path.join(global.application.configDirPath, 'mailbridge', 'status.json');
    if (fs.existsSync(statusFile)) {
      const status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
      if (status.importRunning || status.backupRunning)
        throw new Error('Finish or cancel the Outlook operation before updating.');
    }
    if (
      crypto.createHash('sha256').update(fs.readFileSync(this.installer)).digest('hex') !==
      this.details.sha256
    )
      throw new Error('The downloaded update has changed. Download it again.');
    const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    const directory = path.dirname(process.execPath);
    const script = path.join(path.dirname(this.installer), 'install-update.ps1');
    fs.writeFileSync(
      script,
      `$deadline = (Get-Date).AddSeconds(30)\nwhile (Get-Process -Id ${process.pid} -ErrorAction SilentlyContinue) { if ((Get-Date) -gt $deadline) { exit 1 }; Start-Sleep -Milliseconds 250 }\n$p = Start-Process -FilePath ${quote(this.installer)} -ArgumentList '/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART',${quote(`/DIR="${directory}"`)} -PassThru -Wait\nif ($p.ExitCode -eq 0) { Start-Process -FilePath ${quote(process.execPath)} }\n`
    );
    const installer = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
      { detached: true, stdio: 'ignore', windowsHide: true }
    );
    installer.unref();
    app.quit();
    return { message: 'Restarting to update MailBridge.' };
  }
}
