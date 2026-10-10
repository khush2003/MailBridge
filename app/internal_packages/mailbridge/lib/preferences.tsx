import React from 'react';
import { ipcRenderer } from 'electron';
import { AccountStore } from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
const { clipboard } = require('@electron/remote');
const size = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;

export default class ArchivePreferences extends React.Component<Record<string, never>, any> {
  state = {
    status: MailBridge.status(),
    config: MailBridge.settings(),
    busy: false,
    message: '',
    pairing: '',
    clientId: '',
    clientSecret: '',
    importAccount: '',
    importMessage: '',
    importError: false,
    importing: false,
    passwordEnabled: false,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    passwordMessage: '',
    updateMessage: '',
    updateReady: false,
  };
  importFeedback: HTMLDivElement;
  backupFeedback: HTMLDivElement;
  passwordFeedback: HTMLDivElement;
  updateFeedback: HTMLDivElement;
  componentDidUpdate(_previousProps, previousState) {
    if (
      previousState.importing !== this.state.importing ||
      Boolean(previousState.status.importRunning) !== Boolean(this.state.status.importRunning)
    )
      this.importFeedback?.scrollIntoView({ block: 'nearest' });
    if (
      Boolean(previousState.status.backupRunning) !== Boolean(this.state.status.backupRunning) ||
      (!previousState.status.backupProgress && this.state.status.backupProgress)
    )
      this.backupFeedback?.scrollIntoView({ block: 'nearest' });
    if (previousState.passwordMessage !== this.state.passwordMessage)
      this.passwordFeedback?.scrollIntoView({ block: 'nearest' });
    if (
      previousState.updateMessage !== this.state.updateMessage &&
      (!previousState.updateMessage ||
        previousState.busy !== this.state.busy ||
        previousState.updateReady !== this.state.updateReady)
    )
      this.updateFeedback?.scrollIntoView({ block: 'nearest' });
  }
  timer: any;
  mounted = false;
  componentDidMount() {
    this.mounted = true;
    ipcRenderer.on('mailbridge-update-status', this.updateStatus);
    ipcRenderer
      .invoke('mailbridge-update-get-status')
      .then((value) => this.updateStatus(null, value))
      .catch(() => {});
    ipcRenderer
      .invoke('mailbridge-lock-action', 'status')
      .then((value) => {
        if (this.mounted) this.setState({ passwordEnabled: value.enabled });
      })
      .catch(() => {});
    this.timer = setInterval(
      () => this.setState({ status: MailBridge.status(), config: MailBridge.settings() }),
      1000
    );
  }
  componentWillUnmount() {
    this.mounted = false;
    ipcRenderer.removeListener('mailbridge-update-status', this.updateStatus);
    clearInterval(this.timer);
  }
  perform = async (action: () => Promise<any>, success = '') => {
    this.setState({ busy: true, message: '' });
    try {
      const result = await action();
      this.setState({
        ...(success && result !== false ? { message: success } : {}),
        config: MailBridge.settings(),
        pairing: '',
        clientSecret: '',
      });
    } catch (error) {
      this.setState({ message: error.message });
    } finally {
      this.setState({ busy: false });
    }
  };
  importOutlook = async (accountId: string) => {
    this.setState({
      busy: true,
      importing: true,
      importError: false,
      importMessage: 'Opening the PST file picker…',
    });
    try {
      const result = await MailBridge.importOutlook(
        accountId,
        (importMessage: string) => this.mounted && this.setState({ importMessage })
      );
      if (this.mounted)
        this.setState({
          importMessage: result
            ? `Imported ${result.count} messages. ${result.warnings} messages could not be exported; keep your original PST.`
            : 'Import canceled. No PST was imported.',
        });
    } catch (error) {
      if (this.mounted) this.setState({ importError: true, importMessage: error.message });
    } finally {
      if (this.mounted) this.setState({ busy: false, importing: false });
    }
  };
  updateStatus = (_event: any, value: any) => {
    if (this.mounted)
      this.setState({
        updateMessage: value.message,
        updateReady: value.state === 'update-available',
      });
  };
  checkForUpdates = async () => {
    this.setState({ busy: true, updateMessage: 'Checking for updates…' });
    try {
      this.updateStatus(null, await ipcRenderer.invoke('mailbridge-update-check'));
    } catch (error) {
      if (this.mounted) this.setState({ updateMessage: error.message });
    } finally {
      if (this.mounted) this.setState({ busy: false });
    }
  };
  changeAppPassword = async (disable = false) => {
    if (!disable && this.state.newPassword !== this.state.confirmPassword) {
      this.setState({ passwordMessage: 'The new passwords do not match.' });
      return;
    }
    this.setState({ busy: true, passwordMessage: '' });
    try {
      const result = await ipcRenderer.invoke(
        'mailbridge-lock-action',
        'configure',
        this.state.currentPassword,
        disable ? null : this.state.newPassword
      );
      if (this.mounted)
        this.setState({
          passwordEnabled: result.enabled,
          currentPassword: '',
          newPassword: '',
          confirmPassword: '',
          passwordMessage: result.enabled
            ? 'App password saved. MailBridge will lock at startup.'
            : 'App password removed.',
        });
    } catch (error) {
      if (this.mounted)
        this.setState({
          passwordMessage: error.message.replace(
            /^Error invoking remote method '[^']+': Error: /,
            ''
          ),
        });
    } finally {
      if (this.mounted) this.setState({ busy: false });
    }
  };
  render() {
    const { status, config, message, pairing, clientId, clientSecret } = this.state;
    const importing = this.state.importing || status.importRunning;
    const busy = this.state.busy || importing || status.backupRunning;
    const importMessage = this.state.importMessage || status.importProgress?.message;
    const importError = this.state.importMessage
      ? this.state.importError
      : status.importProgress?.error;
    const devices = status.peers || [];
    const accounts = AccountStore.accounts();
    const importAccount = this.state.importAccount || (accounts.length === 1 ? accounts[0].id : '');
    return (
      <div className="mailbridge-preferences">
        <div className="mb-eyebrow">YOUR MAIL, ON BOTH PCS</div>
        <h1>Archive & sync</h1>
        <p>
          IMAP receives your mail and SMTP sends it. Complete downloaded messages stay on this PC
          when you clear the company mailbox. Google Drive is optional.
        </p>
        <section>
          <h2>Sync between your PCs</h2>
          <label className="mb-check">
            <input
              type="checkbox"
              checked={MailBridge.peerSyncEnabled()}
              disabled={busy || status.running}
              onChange={(e) =>
                this.perform(async () => {
                  await MailBridge.saveSettings({ peerSyncEnabled: e.target.checked });
                  MailBridge.requestSync();
                })
              }
            />
            Use Google Drive for additional archive sync
          </label>
          <p>
            {MailBridge.peerSyncEnabled()
              ? 'Drive transfers encrypted archived mail and read status, even after messages leave the server.'
              : 'Each PC connects to the company mailbox independently. Open both PCs regularly and allow several days before clearing older mail in webmail. Mail removed before a PC downloads it will be missing on that PC. Read status and folder changes for messages already removed from the server remain local.'}
          </p>
        </section>
        <div className={`mb-health ${status.phase}`} role="status">
          <span className="mailbridge-status-dot" />
          <div>
            <strong>
              {status.phase === 'connected'
                ? 'Google Drive connected'
                : status.phase === 'folder-ready'
                  ? 'Shared Drive folder available'
                  : status.phase === 'local'
                    ? 'Local retention · no Google Drive required'
                    : status.running
                      ? 'Synchronizing archive'
                      : status.phase === 'setup'
                        ? 'Finish setup to connect your PCs'
                        : 'Sync needs attention'}
            </strong>
            <p>
              {status.error ||
                (status.lastSuccess
                  ? `Last sync ${new Date(status.lastSuccess).toLocaleString()}`
                  : 'Local retention runs whenever the mail app is open.')}
            </p>
          </div>
        </div>
        {(status.unretained > 0 || status.mailSyncBusy || !status.mailSyncInitialized) && (
          <div className="mb-feedback" role="status">
            {status.error
              ? 'Connect your mailbox to verify download progress.'
              : 'Your mailbox is still being downloaded.'}{' '}
            {status.unretained > 0
              ? `${status.unretained} known messages still need permanent local copies.`
              : 'Download completion has not yet been verified.'}{' '}
            Keep the company mailbox intact until downloading finishes.
          </div>
        )}
        <div className="mb-metrics">
          <div>
            <strong>{status.retained || 0}</strong>
            <span>Messages retained</span>
          </div>
          <div>
            <strong>{MailBridge.peerSyncEnabled() ? status.pending || 0 : 'IMAP'}</strong>
            <span>
              {MailBridge.peerSyncEnabled() ? 'Awaiting the other PC' : 'Company mailbox sync'}
            </span>
          </div>
          <div>
            <strong>
              {!MailBridge.peerSyncEnabled() ? 'Off' : status.quota ? size(status.quota.used) : '—'}
            </strong>
            <span>
              {status.quota ? `of ${size(status.quota.limit)} on Drive` : 'Google Drive storage'}
            </span>
          </div>
        </div>
        {message && (
          <div className="mb-feedback" role="alert">
            {message}
          </div>
        )}
        {MailBridge.peerSyncEnabled() && (
          <section>
            <h2>1. Connect Google Drive</h2>
            <p>
              Use the same Google account and shared folder on both PCs. Direct sign-in uses this
              app’s private Drive storage.
            </p>
            {config.driveAccount ? (
              <div className="mb-inline">
                <strong>{config.driveAccount}</strong>
                <button
                  disabled={busy}
                  onClick={() => this.perform(() => MailBridge.disconnectDrive())}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <div className="mb-inline">
                <button
                  className="btn btn-emphasis"
                  disabled={busy}
                  onClick={() =>
                    this.perform(
                      () => MailBridge.connectFolder(),
                      'Shared folder selected. Choose the same folder on your other PC.'
                    )
                  }
                >
                  Choose Drive for desktop folder
                </button>
                <button
                  disabled={busy}
                  onClick={() =>
                    this.perform(() => MailBridge.connectDrive(), 'Google Drive connected.')
                  }
                >
                  Connect directly
                </button>
              </div>
            )}
            {config.transport === 'folder' && (
              <p className="mb-muted">
                {config.sharedFolder}
                <br />
                Folder access is checked locally. Google Drive handles uploading; receipts from the
                other PC confirm delivery.
              </p>
            )}
            <details>
              <summary>Developer connection settings</summary>
              <p>
                For a build without bundled Google credentials, enter a Desktop OAuth client from
                your Google Cloud project.
              </p>
              <label>
                Client ID
                <input
                  value={clientId}
                  onChange={(e) => this.setState({ clientId: e.target.value })}
                />
              </label>
              <label>
                Client secret
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => this.setState({ clientSecret: e.target.value })}
                />
              </label>
              <button
                disabled={busy || !clientId || !clientSecret}
                onClick={() =>
                  this.perform(
                    async () =>
                      MailBridge.saveSettings(
                        { clientId },
                        { ...(await MailBridge.secrets()), clientSecret }
                      ),
                    'Connection settings saved.'
                  )
                }
              >
                Save connection settings
              </button>
            </details>
          </section>
        )}
        {MailBridge.peerSyncEnabled() && (
          <section>
            <h2>2. Pair the other PC</h2>
            <p>
              Create an archive on the first PC. Paste its pairing code on the second PC. The code
              contains your encryption key; keep it private.
            </p>
            <div className="mb-inline">
              <button
                disabled={busy || !!config.workspace}
                onClick={() =>
                  this.perform(async () => {
                    const code = await MailBridge.createWorkspace();
                    clipboard.writeText(code);
                  }, 'Archive created. Pairing code copied to clipboard.')
                }
              >
                Create archive
              </button>
              <button
                disabled={busy || !config.workspace}
                onClick={() =>
                  this.perform(
                    () => MailBridge.copyPairingCode(),
                    'Pairing code copied. Paste it on your other PC.'
                  )
                }
              >
                Copy pairing code
              </button>
            </div>
            <label>
              Pairing code
              <input
                type="password"
                autoComplete="off"
                value={pairing}
                onChange={(e) => this.setState({ pairing: e.target.value })}
                placeholder="Paste the code from your first PC"
              />
            </label>
            <button
              disabled={busy || !pairing}
              onClick={() =>
                this.perform(
                  () => MailBridge.joinWorkspace(pairing),
                  'Paired. Connect the same Google account to begin.'
                )
              }
            >
              Join archive
            </button>
            <p className="mb-muted">This PC: {config.device}</p>
            {devices.map((device: any) => (
              <div className="mb-device" key={device.device}>
                <div>
                  <strong>{device.device}</strong>
                  <p>Last seen {new Date(device.updated).toLocaleString()}</p>
                </div>
                <button
                  disabled={busy || (config.peers || []).includes(device.device)}
                  onClick={() =>
                    this.perform(
                      () => MailBridge.saveSettings({ peers: [device.device] }),
                      'Second PC confirmed. Verified receipts will now unlock cloud cleanup.'
                    )
                  }
                >
                  {(config.peers || []).includes(device.device)
                    ? 'Confirmed second PC'
                    : 'Confirm this PC'}
                </button>
              </div>
            ))}
          </section>
        )}
        <section>
          <h2>App updates</h2>
          <p>
            Updates replace the app in place and preserve your accounts, mail, app password, and
            backup settings. Connect to Tailscale to reach the private update server.
          </p>
          <div className="mb-inline">
            <button disabled={busy} onClick={this.checkForUpdates}>
              Check for updates
            </button>
            {this.state.updateReady && (
              <button
                disabled={busy}
                onClick={() => this.perform(() => ipcRenderer.invoke('mailbridge-update-install'))}
              >
                Restart and update
              </button>
            )}
          </div>
          {this.state.updateMessage && (
            <div
              ref={(element) => {
                this.updateFeedback = element;
              }}
              className="mb-feedback"
              role="status"
            >
              {this.state.updateMessage}
            </div>
          )}
        </section>
        <section>
          <h2>App password</h2>
          <p>
            Optionally lock access to MailBridge when it starts. Mail keeps downloading in the
            background while locked. This access lock does not encrypt your stored mail or PST
            backups.
          </p>
          {this.state.passwordEnabled && (
            <label>
              Current app password
              <input
                type="password"
                autoComplete="current-password"
                value={this.state.currentPassword}
                onChange={(e) => this.setState({ currentPassword: e.target.value })}
              />
            </label>
          )}
          <label>
            {this.state.passwordEnabled ? 'New app password' : 'Choose an app password'}
            <input
              type="password"
              autoComplete="new-password"
              value={this.state.newPassword}
              onChange={(e) => this.setState({ newPassword: e.target.value })}
            />
          </label>
          <label>
            Confirm new password
            <input
              type="password"
              autoComplete="new-password"
              value={this.state.confirmPassword}
              onChange={(e) => this.setState({ confirmPassword: e.target.value })}
            />
          </label>
          <div className="mb-inline">
            <button
              disabled={busy || !this.state.newPassword}
              onClick={() => this.changeAppPassword()}
            >
              {this.state.passwordEnabled ? 'Change app password' : 'Enable app password'}
            </button>
            {this.state.passwordEnabled && (
              <>
                <button disabled={busy} onClick={() => this.changeAppPassword(true)}>
                  Remove app password
                </button>
                <button
                  disabled={busy}
                  onClick={() => ipcRenderer.invoke('mailbridge-lock-action', 'lock')}
                >
                  Lock now
                </button>
              </>
            )}
          </div>
          {this.state.passwordMessage && (
            <div
              ref={(element) => {
                this.passwordFeedback = element;
              }}
              className="mb-feedback"
              role="status"
            >
              {this.state.passwordMessage}
            </div>
          )}
        </section>
        <section>
          <h2>Keep MailBridge running</h2>
          <label className="mb-check">
            <input
              type="checkbox"
              checked={config.startup || false}
              disabled={busy || process.platform !== 'win32'}
              onChange={(e) => this.perform(() => MailBridge.setStartup(e.target.checked))}
            />
            Start MailBridge when I sign in to Windows
          </label>
          {MailBridge.peerSyncEnabled() && (
            <>
              <label className="mb-check">
                <input
                  type="checkbox"
                  checked={config.cloudRetention !== false}
                  disabled={busy}
                  onChange={(e) =>
                    this.perform(() =>
                      MailBridge.saveSettings({ cloudRetention: e.target.checked })
                    )
                  }
                />
                Keep a permanent encrypted archive on Google Drive
              </label>
              <p className="mb-muted">
                Turn this off on both PCs to use Drive as a transfer buffer. Copies are removed from
                Drive only after both confirmed PCs have stored them locally. Turning permanent
                archive mode back on uploads the retained local copies again. Keep both PCs backed
                up; a replacement PC needs the existing archive to recover older mail.
              </p>
            </>
          )}
          <div className="mb-inline">
            <button
              className="btn btn-emphasis"
              disabled={busy || status.running}
              onClick={() => this.perform(async () => MailBridge.requestSync(), 'Sync requested.')}
            >
              Sync now
            </button>
            <button onClick={() => MailBridge.openArchive()}>Open local message archive</button>
          </div>
        </section>
        {MailBridge.outlookImportAvailable() && (
          <section>
            <h2>PST backups</h2>
            <p>
              Export complete retained mail, including Sent mail and attachments, into a new PST
              backup. Classic Outlook must be installed. Backups run while MailBridge is open.
            </p>
            <p className="mb-muted">Live mail storage: {MailBridge.root}</p>
            <div className="mb-inline">
              <button
                disabled={busy}
                onClick={() => this.perform(() => MailBridge.chooseBackupFolder())}
              >
                Choose backup folder
              </button>
              {config.backupFolder && (
                <button onClick={() => MailBridge.openBackupFolder()}>Open backup folder</button>
              )}
            </div>
            <p className="mb-muted">{config.backupFolder || 'No backup folder selected.'}</p>
            <label className="mb-check">
              <input
                type="checkbox"
                checked={config.backupEnabled || false}
                disabled={busy || !config.backupFolder}
                onChange={(e) =>
                  this.perform(() => MailBridge.saveSettings({ backupEnabled: e.target.checked }))
                }
              />
              Back up automatically
            </label>
            <label>
              Backup frequency
              <select
                value={config.backupInterval || 'weekly'}
                disabled={busy}
                onChange={(e) =>
                  this.perform(() => MailBridge.saveSettings({ backupInterval: e.target.value }))
                }
              >
                <option value="weekly">Every week</option>
                <option value="daily">Every day</option>
              </select>
            </label>
            <p>
              Each backup creates a complete snapshot. Older backups are kept; remove unwanted
              snapshots yourself to manage disk space. Incomplete attempts are marked separately.
            </p>
            <div className="mb-inline">
              <button
                className="btn btn-emphasis"
                disabled={busy || !config.backupFolder}
                onClick={() => this.perform(() => MailBridge.backupPst())}
              >
                {status.backupRunning ? 'Backing up…' : 'Back up now'}
              </button>
              {status.backupRunning && (
                <button onClick={() => MailBridge.cancelPstBackup()}>Cancel backup</button>
              )}
            </div>
            {status.backupProgress?.message && (
              <div
                ref={(element) => {
                  this.backupFeedback = element;
                }}
                className="mb-feedback"
                role={status.backupProgress.error ? 'alert' : 'status'}
              >
                {status.backupProgress.message}
                {status.backupRunning && status.backupProgress.total
                  ? ` · ${status.backupProgress.count} of ${status.backupProgress.total} messages`
                  : ''}
              </div>
            )}
            {config.lastBackup && (
              <p className="mb-muted">
                Last completed backup: {new Date(config.lastBackup.completedAt).toLocaleString()} ·{' '}
                {config.lastBackup.count} messages
              </p>
            )}
          </section>
        )}
        {MailBridge.outlookImportAvailable() && (
          <section>
            <h2>Import existing Outlook mail</h2>
            <p>
              Choose a PST backup from Outlook 2010 or classic Outlook. MailBridge copies it first,
              then imports mail, attachments, read status, and flags into the selected account.
              Classic Outlook must be installed. Drafts, calendars, and contacts are excluded.
            </p>
            <label>
              Destination account
              <select
                value={importAccount}
                onChange={(e) => this.setState({ importAccount: e.target.value })}
              >
                <option value="">Choose your company account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.emailAddress}
                  </option>
                ))}
              </select>
            </label>
            {!importAccount && (
              <p>
                {accounts.length
                  ? 'Select a destination account to enable PST import.'
                  : 'Add your company mail account before importing a PST.'}
              </p>
            )}
            <button
              disabled={busy || !importAccount}
              onClick={() => this.importOutlook(importAccount)}
            >
              {importing ? 'Importing Outlook PST…' : 'Import Outlook PST'}
            </button>
            {importing && (
              <button
                onClick={() => {
                  MailBridge.cancelOutlookImport();
                  this.setState({
                    importMessage: 'Canceling import. Already imported messages will be kept.',
                  });
                }}
              >
                Cancel import
              </button>
            )}
            {importMessage && (
              <div
                ref={(element) => {
                  this.importFeedback = element;
                }}
                className="mb-feedback"
                role={importError ? 'alert' : 'status'}
              >
                {importMessage}
              </div>
            )}
            {importing && status.importProgress && (
              <p>
                {status.importProgress.count} messages imported · {status.importProgress.warnings}{' '}
                export warnings
              </p>
            )}
          </section>
        )}
        <section>
          <h2>Clearing the company mailbox</h2>
          <strong>
            {MailBridge.peerSyncEnabled()
              ? status.safeToClear
                ? 'Both PCs have confirmed the retained mail.'
                : 'Keep server mail until capture and two-PC delivery are confirmed.'
              : status.localCaptureReady
                ? 'Downloaded mail is retained on this PC.'
                : 'Keep server mail until this PC has finished downloading.'}
          </strong>
          <p>
            {MailBridge.peerSyncEnabled()
              ? 'Wait for downloading to finish and the pending count to reach zero, with the second PC confirmed and no errors.'
              : 'Check that both PCs have finished downloading before clearing older messages in webmail. Without Drive, this PC cannot verify the other PC has received them.'}{' '}
            Server deletions leave retained messages intact. Deleting retained mail inside
            MailBridge affects this PC only; it does not clear server storage.
          </p>
        </section>
      </div>
    );
  }
}
