import React from 'react';
import { ComponentRegistry, WorkspaceStore, PreferencesUIStore, Actions } from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
import ArchivePreferences from './preferences';

class ArchiveStatus extends React.Component<{}, { status: any }> {
  static displayName = 'MailBridgeArchiveStatus';
  state = { status: MailBridge.status() };
  timer: any;
  componentDidMount() { this.timer = setInterval(() => this.setState({ status: MailBridge.status() }), 1000); }
  componentWillUnmount() { clearInterval(this.timer); }
  render() {
    const { status } = this.state;
    return <button className={`mailbridge-status ${status.phase}`} title={status.error || 'Archive & sync settings'}
      onClick={() => { Actions.openPreferences(); Actions.switchPreferencesTab('Archive'); }}>
      <span className="mailbridge-status-dot" />
      {status.phase === 'connected' ? `Synced · ${status.retained} retained` : status.phase === 'folder-ready' ? `Drive folder ready · ${status.pending || 0} awaiting peer` : status.running ? 'Syncing archive…' : status.phase === 'setup' ? 'Set up archive sync' : 'Sync needs attention'}
    </button>;
  }
}
class OfficeHeader extends React.Component {
  static displayName = 'MailBridgeOfficeHeader';
  render() { return <div className="mb-office-header"><div className="mb-office-appbar"><span className="mb-office-mark">M</span><strong>MailBridge</strong><span className="mb-office-appbar-caption">Mail</span><span className="mb-office-private">Your complete mail archive</span></div><nav className="mb-office-ribbon" aria-label="Mail commands"><span className="mb-office-tab active">Home</span><button className="mb-office-compose" onClick={() => Actions.composeNewBlankDraft()}>＋ New mail</button><button onClick={() => MailBridge.requestSync()}>↻ Sync</button><button onClick={() => { Actions.openPreferences(); Actions.switchPreferencesTab('Archive'); }}>Archive & sync</button><span className="mb-office-ribbon-spacer" /><span className="mb-office-label">Server deletes keep your local copies</span></nav></div>; }
}
let tab: any;
export function activate() {
  ComponentRegistry.register(OfficeHeader, { location: WorkspaceStore.Sheet.Threads.Header });
  tab = new PreferencesUIStore.TabItem({ tabId: 'Archive', displayName: 'Archive & sync', componentClassFn: () => ArchivePreferences, order: 2.5 });
  PreferencesUIStore.registerPreferencesTab(tab);
  ComponentRegistry.register(ArchiveStatus, { location: WorkspaceStore.Sheet.Threads.Toolbar.Right, modes: ['split', 'splitVertical', 'list'] });
}
export function deactivate() {
  ComponentRegistry.unregister(ArchiveStatus);
  ComponentRegistry.unregister(OfficeHeader);
  PreferencesUIStore.unregisterPreferencesTab('Archive');
}
