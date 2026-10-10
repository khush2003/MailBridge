import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { EventEmitter } from 'events';
import { AccountStore } from '../flux/stores/account-store';
import { secureStorage } from '../key-manager';

const { shell, app, clipboard, dialog } = require('@electron/remote');
const { ArchiveSync, durableWrite, pairingCode, parsePairing } = require('./core');
const { GoogleDrive } = require('./google-drive');
const { FolderTransport } = require('./folder-transport');

class MailBridgeController extends EventEmitter {
  bridge: any;
  core: any;
  drive: any;
  timer: any;
  root: string;
  publicStatus: any = { phase: 'setup', running: false, retained: 0, pending: 0, peers: [] };
  configurationVersion = '';
  defaultDevice = crypto.randomUUID();
  retentionStats = { unretained: 0, mailSyncBusy: false, mailSyncInitialized: false };
  constructor() {
    super();
    this.root = path.join(AppEnv.getLoadSettings().configDirPath, 'mailbridge');
  }
  configPath() { return path.join(this.root, 'settings.json'); }
  settings() {
    return fs.existsSync(this.configPath()) ? JSON.parse(fs.readFileSync(this.configPath(), 'utf8')) :
      { device: this.defaultDevice, peers: [], peerSyncEnabled: false, cloudRetention: true, startup: false };
  }
  peerSyncEnabled() {
    const config = this.settings();
    // Preserve previously paired installations; new profiles need only IMAP/SMTP.
    return config.peerSyncEnabled ?? Boolean(config.workspace && config.driveAccount);
  }
  retainedOnDisk() {
    const directory = path.join(this.root, 'records');
    if (!fs.existsSync(directory)) return 0;
    return new Set(fs.readdirSync(directory)
      .filter(name => /^[a-f0-9]{64}-[a-f0-9]{64}\.json$/.test(name))
      .map(name => name.split('-')[0])).size;
  }
  async secrets() {
    const settings = this.settings();
    if (!settings.secrets) return {};
    return JSON.parse((await secureStorage.decrypt(Buffer.from(settings.secrets, 'base64'))).result);
  }
  async saveSettings(changes: any, secrets?: any) {
    const settings = { ...this.settings(), ...changes };
    if (secrets !== undefined) {
      if (!(await secureStorage.isAvailable())) throw new Error('Unlock the Windows credential store to save the archive key');
      const encrypted = await secureStorage.encrypt(JSON.stringify(secrets));
      if (process.platform === 'linux' && encrypted.subarray(0, 3).toString() === 'v10') {
        throw new Error('A desktop keyring is required to protect archive credentials');
      }
      settings.secrets = encrypted.toString('base64');
    }
    durableWrite(this.configPath(), JSON.stringify(settings));
    this.emit('settings', settings);
    return settings;
  }
  async createWorkspace() {
    const config = this.settings();
    if (config.workspace) throw new Error('This PC is already paired. Use its existing pairing code.');
    const key = crypto.randomBytes(32);
    const workspace = crypto.randomBytes(16).toString('hex');
    await this.saveSettings({ workspace }, { ...(await this.secrets()), key: key.toString('base64') });
    return pairingCode(workspace, key);
  }
  async joinWorkspace(code: string) {
    const config = this.settings();
    const paired = parsePairing(code);
    if (config.workspace && config.workspace !== paired.workspace) throw new Error('This PC is already paired to another archive');
    await this.saveSettings({ workspace: paired.workspace }, { ...(await this.secrets()), key: paired.key.toString('base64') });
  }
  async copyPairingCode() {
    const config = this.settings();
    const secret = await this.secrets();
    if (!config.workspace || !secret.key) throw new Error('Create an archive first');
    clipboard.writeText(pairingCode(config.workspace, Buffer.from(secret.key, 'base64')));
  }
  async driveClient() {
    const config = this.settings();
    const secret = await this.secrets();
    // Developers supply their own desktop OAuth client. End users connect with one click in configured builds.
    const bundled = require('../../mailbridge-oauth.json');
    const clientId = bundled.clientId || config.clientId;
    const clientSecret = bundled.clientSecret || secret.clientSecret;
    return new GoogleDrive({ clientId, clientSecret, tokens: secret.tokens,
      openExternal: (url: string) => shell.openExternal(url),
      saveTokens: async (tokens: any) => { await this.saveSettings({}, { ...(await this.secrets()), tokens }); },
    });
  }
  async connectDrive() {
    const client = await this.driveClient();
    const health = await client.authorize();
    await this.saveSettings({ transport: 'google-api', driveAccount: health.user?.emailAddress || 'Google Drive', connectionGeneration: Date.now() });
    return health;
  }
  async connectFolder() {
    const result = await dialog.showOpenDialog({ title: 'Choose the shared Google Drive folder', properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || !result.filePaths[0]) return false;
    const selected = fs.realpathSync(result.filePaths[0]);
    const local = path.resolve(this.root);
    if (local === selected || local.startsWith(selected + path.sep) || selected.startsWith(local + path.sep)) {
      throw new Error('Choose a separate shared folder. Your local unencrypted mail archive must stay private on this PC.');
    }
    const sharedFolder = path.join(selected, 'MailBridge-Encrypted');
    fs.mkdirSync(sharedFolder, { recursive: true });
    await new FolderTransport(sharedFolder).health();
    return this.saveSettings({ transport: 'folder', sharedFolder, driveAccount: 'Drive for desktop folder', connectionGeneration: Date.now() });
  }
  async disconnectDrive() {
    const secret = await this.secrets();
    delete secret.tokens;
    await this.saveSettings({ driveAccount: null }, secret);
  }
  setStartup(enabled: boolean) {
    if (process.platform !== 'win32') throw new Error('Start at sign-in is available in the Windows build');
    app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath });
    return this.saveSettings({ startup: enabled });
  }
  status() {
    const file = path.join(this.root, 'status.json');
    if (!fs.existsSync(file)) return this.publicStatus;
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - value.heartbeat > 60000) return { ...value, phase: 'stopped', running: false, error: 'Mail sync is not running. Open the main mail window.' };
    return value;
  }
  publish(values: any) {
    this.publicStatus = { ...this.publicStatus, ...values, ...this.retentionStats, device: this.settings().device, heartbeat: Date.now() };
    const config = this.settings();
    this.publicStatus.peerSyncEnabled = this.peerSyncEnabled();
    this.publicStatus.localCaptureReady = !this.importing && !this.publicStatus.error &&
      AccountStore.accounts().length > 0 && this.publicStatus.mailSyncInitialized &&
      this.publicStatus.unretained === 0 && !this.publicStatus.mailSyncBusy &&
      this.publicStatus.retained > 0 && AccountStore.accounts().every(account => account.syncState === 'ok');
    this.publicStatus.safeToClear = ['connected', 'folder-ready'].includes(this.publicStatus.phase) &&
      !this.importing && !this.publicStatus.error && !this.publicStatus.running && config.peers.length === 1 &&
      this.publicStatus.mailSyncInitialized && this.publicStatus.unretained === 0 && !this.publicStatus.mailSyncBusy && this.publicStatus.pending === 0 &&
      this.publicStatus.retained > 0 && AccountStore.accounts().every(account => account.syncState === 'ok');
    durableWrite(path.join(this.root, 'status.json'), JSON.stringify(this.publicStatus));
    this.emit('status', this.publicStatus);
  }
  start(bridge: any) {
    if (this.timer) return;
    this.bridge = bridge;
    this.timer = setInterval(() => this.tick().catch(error => this.publish({ phase: 'error', error: error.message })), 15000);
    this.tick().catch(error => this.publish({ phase: 'error', error: error.message }));
  }
  stop() { clearInterval(this.timer); this.timer = null; }
  async tick() {
    if (this.core?.status.running || this.ticking) { this.publish({}); return; }
    this.ticking = true;
    try {
      const config = this.settings();
      if (!this.peerSyncEnabled() || !config.workspace || !config.driveAccount) {
        const records = [];
        let unretained = 0; let mailSyncBusy = false; let mailSyncInitialized = AccountStore.accounts().length > 0;
        for (const account of AccountStore.accounts()) {
          if (!this.bridge._clients[account.id]) { mailSyncInitialized = false; continue; }
          const result = await this.bridge.mailbridgeRequest(account.id, { operation: 'list' });
          records.push(...result.records);
          unretained += result.unretained || 0; mailSyncBusy ||= result.mailSyncBusy; mailSyncInitialized &&= result.mailSyncInitialized === true;
        }
        this.retentionStats = { unretained, mailSyncBusy, mailSyncInitialized };
        const accountError = AccountStore.accounts().find(account => account.syncState === 'sync_error');
        this.publish({ phase: accountError ? 'error' : this.peerSyncEnabled() ? 'setup' : 'local', running: false,
          retained: Math.max(new Set(records.map(record => record.key)).size, this.retainedOnDisk()),
          pending: 0, peers: [], quota: null,
          error: accountError ? `Mail connection needs attention: ${accountError.emailAddress}` : null }); return;
      }
      const version = JSON.stringify({ workspace: config.workspace, device: config.device, peers: config.peers,
        driveAccount: config.driveAccount, transport: config.transport, sharedFolder: config.sharedFolder, connectionGeneration: config.connectionGeneration, cloudRetention: config.cloudRetention });
      if (!this.core || this.configurationVersion !== version) {
        this.drive = config.transport === 'folder' ? new FolderTransport(config.sharedFolder) : await this.driveClient();
        const secret = await this.secrets();
        this.core = new ArchiveSync({ root: this.root, ...config, key: Buffer.from(secret.key, 'base64'), transport: this.drive,
          native: {
            list: async () => {
              const records = [];
              let unretained = 0; let mailSyncBusy = false; let mailSyncInitialized = true;
              for (const account of AccountStore.accounts()) {
                if (!this.bridge._clients[account.id]) throw new Error(`Mail engine is not running for ${account.emailAddress}`);
                const result = await this.bridge.mailbridgeRequest(account.id, { operation: 'list' });
                records.push(...result.records);
                unretained += result.unretained || 0; mailSyncBusy ||= result.mailSyncBusy; mailSyncInitialized &&= result.mailSyncInitialized === true;
              }
              this.retentionStats = { unretained, mailSyncBusy, mailSyncInitialized };
              return records;
            },
            import: async (descriptor: any, state: any) => {
              const account = AccountStore.accounts().find(a => a.emailAddress.toLowerCase() === descriptor.email);
              if (!account) throw new Error(`Add the mail account ${descriptor.email} to receive its archive`);
              return this.bridge.mailbridgeRequest(account.id, { operation: 'import', descriptor, ...(state ? { state } : {}) });
            },
          },
        });
        this.core.on('status', (status: any) => this.publish(status));
        this.configurationVersion = version;
      }
      if (!AccountStore.accounts().length) { this.publish({ phase: 'setup', error: 'Add your company mail account first' }); return; }
      await this.core.run();
    } finally { this.ticking = false; }
  }
  ticking = false;
  requestSync() {
    this.bridge?.sendSyncMailNow();
    durableWrite(path.join(this.root, 'sync-request.json'), JSON.stringify({ requested: Date.now() }));
    if (this.bridge) return this.tick().catch(error => this.publish({ phase: 'error', running: false, error: error.message }));
  }
  importing = false;
  async importOutlook(accountId: string) {
    if (process.platform !== 'win32') throw new Error('Outlook PST import requires classic Outlook on Windows');
    if (this.importing) throw new Error('An Outlook import is already running');
    const account = AccountStore.accounts().find(a => a.id === accountId);
    if (!account || !this.bridge?._clients[accountId]) throw new Error('Add and connect the destination mail account first');
    const chosen = await dialog.showOpenDialog({ title: 'Choose an Outlook PST backup to import', filters: [{ name: 'Outlook data files', extensions: ['pst'] }], properties: ['openFile'] });
    if (chosen.canceled || !chosen.filePaths[0]) return;
    this.importing = true;
    const temporary = path.join(this.root, 'imports');
    const snapshot = path.join(temporary, `outlook-${crypto.randomUUID()}.pst`);
    fs.mkdirSync(temporary, { recursive: true });
    let count = 0; let warnings = 0;
    try {
      // Outlook reads a disposable snapshot; the selected PST remains untouched.
      await fs.promises.copyFile(chosen.filePaths[0], snapshot);
      const script = path.join(app.getAppPath().replace(/app\.asar$/, 'app.asar.unpacked'), 'mailbridge-tools', 'import-outlook.ps1');
      const { spawn } = require('child_process');
      const readline = require('readline');
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-PstPath', snapshot, '-OutputDirectory', temporary], { windowsHide: true });
      let failure = '';
      child.stderr.on('data', (bytes: Buffer) => { failure = (failure + bytes.toString('utf8')).slice(-2000); });
      const finished = new Promise<number>((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      finished.catch(() => {});
      try {
        for await (const line of readline.createInterface({ input: child.stdout, crlfDelay: Infinity })) {
          if (!line.trim()) continue;
          const record = JSON.parse(line);
          if (record.warning) { warnings++; continue; }
          await this.bridge.mailbridgeRequest(accountId, { operation: 'import-file', ...record });
          fs.unlinkSync(path.join(temporary, record.file));
          count++;
          this.publish({ importProgress: { count, warnings } });
        }
        const code = await finished;
        if (code !== 0) throw new Error(failure || 'Outlook export failed');
      } finally { if (child.exitCode === null) child.kill(); }
      this.requestSync();
      return { count, warnings };
    } finally {
      this.importing = false;
      // Preserve failed EML exports for recovery, but remove the disposable source snapshot.
      await fs.promises.unlink(snapshot).catch(() => {});
    }
  }
  openArchive() { return shell.openPath(path.join(this.root, 'blobs')); }
}
export default new MailBridgeController();
