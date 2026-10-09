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
  retentionStats = { unretained: 0, mailSyncBusy: false };
  constructor() {
    super();
    this.root = path.join(AppEnv.getLoadSettings().configDirPath, 'mailbridge');
  }
  configPath() { return path.join(this.root, 'settings.json'); }
  settings() {
    return fs.existsSync(this.configPath()) ? JSON.parse(fs.readFileSync(this.configPath(), 'utf8')) :
      { device: this.defaultDevice, peers: [], cloudRetention: true, startup: false };
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
    if (result.canceled || !result.filePaths[0]) return;
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
      if (!config.workspace || !config.driveAccount) {
        const records = [];
        let unretained = 0; let mailSyncBusy = false;
        for (const account of AccountStore.accounts()) {
          if (!this.bridge._clients[account.id]) continue;
          const result = await this.bridge.mailbridgeRequest(account.id, { operation: 'list' });
          records.push(...result.records);
          unretained += result.unretained || 0; mailSyncBusy ||= result.mailSyncBusy;
        }
        this.retentionStats = { unretained, mailSyncBusy };
        this.publish({ phase: 'setup', running: false, retained: new Set(records.map(record => record.key)).size, error: null }); return;
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
              let unretained = 0; let mailSyncBusy = false;
              for (const account of AccountStore.accounts()) {
                if (!this.bridge._clients[account.id]) throw new Error(`Mail engine is not running for ${account.emailAddress}`);
                const result = await this.bridge.mailbridgeRequest(account.id, { operation: 'list' });
                records.push(...result.records);
                unretained += result.unretained || 0; mailSyncBusy ||= result.mailSyncBusy;
              }
              this.retentionStats = { unretained, mailSyncBusy };
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
    durableWrite(path.join(this.root, 'sync-request.json'), JSON.stringify({ requested: Date.now() }));
    if (this.bridge) return this.tick();
  }
  openArchive() { return shell.openPath(path.join(this.root, 'blobs')); }
}
export default new MailBridgeController();
