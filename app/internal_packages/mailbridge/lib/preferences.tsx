import React from 'react';
import { AccountStore } from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
const { clipboard } = require('@electron/remote');
const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

export default class ArchivePreferences extends React.Component<{}, any> {
  state = { status: MailBridge.status(), config: MailBridge.settings(), busy: false, message: '', pairing: '', clientId: '', clientSecret: '', importAccount: '' };
  timer: any;
  componentDidMount() { this.timer = setInterval(() => this.setState({ status: MailBridge.status(), config: MailBridge.settings() }), 1000); }
  componentWillUnmount() { clearInterval(this.timer); }
  perform = async (action: () => Promise<any>, success = '') => {
    this.setState({ busy: true, message: '' });
    try { const result = await action(); this.setState({ ...(success && result !== false ? { message: success } : {}), config: MailBridge.settings(), pairing: '', clientSecret: '' }); }
    catch (error) { this.setState({ message: error.message }); }
    finally { this.setState({ busy: false }); }
  };
  render() {
    const { status, config, busy, message, pairing, clientId, clientSecret } = this.state;
    const devices = status.peers || [];
    return <div className="mailbridge-preferences">
      <div className="mb-eyebrow">YOUR MAIL, ON BOTH PCS</div>
      <h1>Archive & sync</h1>
      <p>Every received and sent message stays on your PC. Encrypted copies travel through Google Drive to your other PC, even after the company mailbox is cleared.</p>
      <div className={`mb-health ${status.phase}`} role="status">
        <span className="mailbridge-status-dot" /><div><strong>{status.phase === 'connected' ? 'Google Drive connected' : status.phase === 'folder-ready' ? 'Shared Drive folder available' : status.running ? 'Synchronizing archive' : status.phase === 'setup' ? 'Finish setup to connect your PCs' : 'Sync needs attention'}</strong>
          <p>{status.error || (status.lastSuccess ? `Last sync ${new Date(status.lastSuccess).toLocaleString()}` : 'Local retention runs whenever the mail app is open.')}</p></div>
      </div>
      {(status.unretained > 0 || status.mailSyncBusy || !status.mailSyncInitialized) && <div className="mb-feedback" role="status">Your mailbox is still being downloaded. {status.unretained || 0} known messages still need permanent local copies. Keep the company mailbox intact until downloading finishes.</div>}
      <div className="mb-metrics">
        <div><strong>{status.retained || 0}</strong><span>Messages retained</span></div>
        <div><strong>{status.pending || 0}</strong><span>Awaiting the other PC</span></div>
        <div><strong>{status.quota ? size(status.quota.used) : '—'}</strong><span>{status.quota ? `of ${size(status.quota.limit)} on Drive` : 'Google Drive storage'}</span></div>
      </div>
      {message && <div className="mb-feedback" role="alert">{message}</div>}
      <section><h2>1. Connect Google Drive</h2><p>Use the same Google account and shared folder on both PCs. Direct sign-in uses this app’s private Drive storage.</p>
        {config.driveAccount ? <div className="mb-inline"><strong>{config.driveAccount}</strong><button disabled={busy} onClick={() => this.perform(() => MailBridge.disconnectDrive())}>Disconnect</button></div> :
          <div className="mb-inline"><button className="btn btn-emphasis" disabled={busy} onClick={() => this.perform(() => MailBridge.connectFolder(), 'Shared folder selected. Choose the same folder on your other PC.')}>Choose Drive for desktop folder</button><button disabled={busy} onClick={() => this.perform(() => MailBridge.connectDrive(), 'Google Drive connected.')}>Connect directly</button></div>}
        {config.transport === 'folder' && <p className="mb-muted">{config.sharedFolder}<br />Folder access is checked locally. Google Drive handles uploading; receipts from the other PC confirm delivery.</p>}
        <details><summary>Developer connection settings</summary><p>For a build without bundled Google credentials, enter a Desktop OAuth client from your Google Cloud project.</p>
          <label>Client ID<input value={clientId} onChange={e => this.setState({ clientId: e.target.value })} /></label>
          <label>Client secret<input type="password" value={clientSecret} onChange={e => this.setState({ clientSecret: e.target.value })} /></label>
          <button disabled={busy || !clientId || !clientSecret} onClick={() => this.perform(async () => MailBridge.saveSettings({ clientId }, { ...(await MailBridge.secrets()), clientSecret }), 'Connection settings saved.')}>Save connection settings</button>
        </details>
      </section>
      <section><h2>2. Pair the other PC</h2><p>Create an archive on the first PC. Paste its pairing code on the second PC. The code contains your encryption key; keep it private.</p>
        <div className="mb-inline"><button disabled={busy || !!config.workspace} onClick={() => this.perform(async () => { const code = await MailBridge.createWorkspace(); clipboard.writeText(code); }, 'Archive created. Pairing code copied to clipboard.')}>Create archive</button>
          <button disabled={busy || !config.workspace} onClick={() => this.perform(() => MailBridge.copyPairingCode(), 'Pairing code copied. Paste it on your other PC.')}>Copy pairing code</button></div>
        <label>Pairing code<input type="password" autoComplete="off" value={pairing} onChange={e => this.setState({ pairing: e.target.value })} placeholder="Paste the code from your first PC" /></label>
        <button disabled={busy || !pairing} onClick={() => this.perform(() => MailBridge.joinWorkspace(pairing), 'Paired. Connect the same Google account to begin.')}>Join archive</button>
        <p className="mb-muted">This PC: {config.device}</p>
        {devices.map((device: any) => <div className="mb-device" key={device.device}><div><strong>{device.device}</strong><p>Last seen {new Date(device.updated).toLocaleString()}</p></div>
          <button disabled={busy || (config.peers || []).includes(device.device)} onClick={() => this.perform(() => MailBridge.saveSettings({ peers: [device.device] }), 'Second PC confirmed. Verified receipts will now unlock cloud cleanup.')}>{(config.peers || []).includes(device.device) ? 'Confirmed second PC' : 'Confirm this PC'}</button></div>)}
      </section>
      <section><h2>3. Keep sync running</h2>
        <label className="mb-check"><input type="checkbox" checked={config.startup || false} disabled={busy || process.platform !== 'win32'} onChange={e => this.perform(() => MailBridge.setStartup(e.target.checked))} />Start MailBridge when I sign in to Windows</label>
        <label className="mb-check"><input type="checkbox" checked={config.cloudRetention !== false} disabled={busy} onChange={e => this.perform(() => MailBridge.saveSettings({ cloudRetention: e.target.checked }))} />Keep a permanent encrypted archive on Google Drive</label>
        <p className="mb-muted">Turn this off on both PCs to use Drive as a transfer buffer. Copies are removed from Drive only after both confirmed PCs have stored them locally. Turning permanent archive mode back on uploads the retained local copies again. Keep both PCs backed up; a replacement PC needs the existing archive to recover older mail.</p>
        <div className="mb-inline"><button className="btn btn-emphasis" disabled={busy || status.running} onClick={() => this.perform(async () => MailBridge.requestSync(), 'Sync requested.')}>Sync now</button><button onClick={() => MailBridge.openArchive()}>Open local message archive</button></div>
      </section>
      {process.platform === 'win32' && <section><h2>Import existing Outlook mail</h2><p>Choose a PST backup from Outlook 2010 or classic Outlook. MailBridge copies it first, then imports mail, attachments, read status, and flags into the selected account. Classic Outlook must be installed. Drafts, calendars, and contacts are excluded.</p>
        <label>Destination account<select value={this.state.importAccount} onChange={e => this.setState({ importAccount: e.target.value })}><option value="">Choose your company account</option>{AccountStore.accounts().map(account => <option key={account.id} value={account.id}>{account.emailAddress}</option>)}</select></label>
        <button disabled={busy || !this.state.importAccount} onClick={() => this.perform(async () => { const result = await MailBridge.importOutlook(this.state.importAccount); if (result) this.setState({ message: `Imported ${result.count} messages. ${result.warnings} messages could not be exported; keep your original PST.` }); })}>Import Outlook PST</button>
        {status.importProgress && <p>{status.importProgress.count} messages imported · {status.importProgress.warnings} export warnings</p>}
      </section>}
      <section><h2>Clearing the company mailbox</h2><strong>{status.safeToClear ? 'Both PCs have confirmed the retained mail. Old server mail can be cleared.' : 'Keep server mail until capture and two-PC delivery are confirmed.'}</strong><p>Wait until the mailbox has finished downloading, “Awaiting the other PC” reaches zero, the second PC is confirmed, and sync reports no errors. You can then clear old messages in webmail; retained folders keep complete local copies. Server deletions are never sent to the local archive.</p></section>
    </div>;
  }
}
