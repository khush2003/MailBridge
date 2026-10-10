import React from 'react';
import { ComponentRegistry, WorkspaceStore, PreferencesUIStore, Actions, AccountStore,
  FocusedContentStore, FocusedPerspectiveStore, TaskFactory, Thread } from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
import ArchivePreferences from './preferences';
import ThreadListStore from '../../thread-list/lib/thread-list-store';

const preferences = () => { Actions.openPreferences(); Actions.switchPreferencesTab('Archive'); };
const paths = {
  mail: 'M3 5h18v14H3z M3 5l9 7 9-7',
  delete: 'M5 7h14 M9 7V4h6v3 M7 7l1 14h8l1-14 M10 10v8 M14 10v8',
  archive: 'M3 4h18v5H3z M5 9v12h14V9 M9 13h6',
  reply: 'M10 4L3 10l7 6v-4c6 0 8 2 11 7-1-9-5-11-11-11z',
  replyAll: 'M7 5L2 10l5 5 M13 4l-7 6 7 6v-4c5 0 6 2 9 6-1-8-4-10-9-10z',
  forward: 'M14 4l7 6-7 6v-4c-6 0-8 2-11 7 1-9 5-11 11-11z',
  sync: 'M20 8a8 8 0 0 0-13-3L3 8 M3 3v5h5 M4 16a8 8 0 0 0 13 3l4-3 M21 21v-5h-5',
  flag: 'M5 22V3 M5 3h14l-3 5 3 5H5',
  settings: 'M4 5h16 M4 12h16 M4 19h16 M8 2v6 M16 9v6 M10 16v6',
  folder: 'M2 6h8l2 3h10v12H2z',
};
function Icon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round"><path d={paths[name]} /></svg>;
}
function Command({ icon, label, onClick, disabled = false }: { icon: keyof typeof paths; label: string; onClick: () => void; disabled?: boolean }) {
  return <button className={`mb-ribbon-command mb-command-${icon}`} onClick={onClick} disabled={disabled}><Icon name={icon} /><span>{label}</span></button>;
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mb-ribbon-group"><div className="mb-ribbon-group-actions">{children}</div><span className="mb-ribbon-group-label">{label}</span></div>;
}

class ArchiveStatus extends React.Component<{}, { status: any }> {
  static displayName = 'MailBridgeArchiveStatus';
  state = { status: MailBridge.status() };
  timer: any;
  componentDidMount() { this.timer = setInterval(() => this.setState({ status: MailBridge.status() }), 1000); }
  componentWillUnmount() { clearInterval(this.timer); }
  render() {
    const { status } = this.state;
    const text = status.phase === 'local' ? `${status.retained || 0} messages retained on this PC` :
      status.phase === 'connected' ? `Drive connected · ${status.retained} retained` :
      status.phase === 'folder-ready' ? `Drive folder ready · ${status.pending || 0} awaiting other PC` :
      status.running ? 'Synchronizing archive…' : status.phase === 'setup' ? 'Set up optional archive sync' : 'Mail sync needs attention';
    return <div className="mb-office-statusbar"><span>MailBridge</span><button className={`mailbridge-status ${status.phase}`} title={status.error || 'Local retention and optional Drive sync'} onClick={preferences}><span className="mailbridge-status-dot" />{text}</button><span className="mb-status-end">{MailBridge.peerSyncEnabled() ? 'IMAP + archive sync' : 'IMAP · local retention'}<span className="mb-status-zoom">{Math.round((AppEnv.config.get('core.workspace.interfaceZoom') || 1) * 100)}%</span></span></div>;
  }
}
class OfficeHeader extends React.Component<{}, { tab: string; thread: Thread | null; email: string; selected: number; mailbox: string }> {
  static displayName = 'MailBridgeOfficeHeader';
  state = { tab: 'Home', thread: FocusedContentStore.focused('thread') as Thread, email: AccountStore.accounts()[0]?.emailAddress || '', selected: 0, mailbox: FocusedPerspectiveStore.current().name || 'Mail' };
  unsubscribers: (() => void)[] = [];
  componentDidMount() {
    this.unsubscribers = [ThreadListStore.listen(() => this.setState({ selected: ThreadListStore.dataSource()?.selection.count() || 0 })), FocusedPerspectiveStore.listen(() => this.setState({ mailbox: FocusedPerspectiveStore.current().name || 'Mail' })), FocusedContentStore.listen(() => this.setState({ thread: FocusedContentStore.focused('thread') as Thread })), AccountStore.listen(() => this.setState({ email: AccountStore.accounts()[0]?.emailAddress || '' }))];
  }
  componentWillUnmount() { this.unsubscribers.forEach(fn => fn()); }
  selectedThreads = () => {
    const selected = ThreadListStore.dataSource()?.selection.items() as Thread[];
    return selected?.length ? selected : this.state.thread ? [this.state.thread] : [];
  };
  queue = (kind: 'delete' | 'archive' | 'read' | 'flag') => {
    const threads = this.selectedThreads();
    if (!threads.length) return;
    const source = 'MailBridge ribbon';
    if (kind === 'delete') Actions.queueTasks(TaskFactory.tasksForMovingToTrash({ threads, source }));
    if (kind === 'archive') Actions.queueTasks(TaskFactory.tasksForArchiving({ threads, source, perspective: FocusedPerspectiveStore.current() }));
    if (kind === 'read') Actions.queueTask(TaskFactory.taskForInvertingUnread({ threads, source }));
    if (kind === 'flag') Actions.queueTask(TaskFactory.taskForInvertingStarred({ threads, source }));
  };
  reply = (type: string) => {
    const threads = this.selectedThreads();
    if (threads.length !== 1) return;
    if (type === 'forward') Actions.composeForward({ threadId: threads[0].id });
    else Actions.composeReply({ threadId: threads[0].id, type, behavior: 'prefer-existing-if-pristine' });
  };
  render() {
    const { tab, thread, email, mailbox, selected } = this.state;
    const count = selected || (thread ? 1 : 0);
    const win = () => require('@electron/remote').getCurrentWindow();
    return <div className="mb-office-header">
      <div className="mb-office-appbar"><span className="mb-office-brand"><Icon name="mail" />MailBridge</span><span className="mb-office-window-title">{mailbox}{email ? ` - ${email}` : ''} - MailBridge</span><div className="mb-office-window-controls"><button aria-label="Minimize" onClick={() => win().minimize()}>―</button><button aria-label="Maximize or restore" onClick={() => win().isMaximized() ? win().unmaximize() : win().maximize()}>□</button><button aria-label="Close" onClick={() => win().close()}>×</button></div></div>
      <nav className="mb-office-tabs" aria-label="Ribbon tabs"><button onClick={() => Actions.openPreferences()}>File</button>{['Home', 'Send / Receive', 'View'].map(name => <button key={name} className={tab === name ? 'active' : ''} aria-pressed={tab === name} onClick={() => this.setState({ tab: name })}>{name}</button>)}<button className="mb-office-settings-tab" onClick={preferences}>Mail retention</button></nav>
      <div className="mb-office-ribbon" role="toolbar" aria-label={`${tab} commands`}>
        {tab === 'Home' && <>
          <Group label="New"><Command icon="mail" label="New Email" onClick={() => Actions.composeNewBlankDraft()} /></Group>
          <Group label="Delete"><Command icon="delete" label="Delete" onClick={() => this.queue('delete')} disabled={!count} /><Command icon="archive" label="Archive" onClick={() => this.queue('archive')} disabled={!count} /></Group>
          <Group label="Respond"><Command icon="reply" label="Reply" onClick={() => this.reply('reply')} disabled={count !== 1} /><Command icon="replyAll" label="Reply All" onClick={() => this.reply('reply-all')} disabled={count !== 1} /><Command icon="forward" label="Forward" onClick={() => this.reply('forward')} disabled={count !== 1} /></Group>
          <Group label="Tags"><Command icon="mail" label="Unread / Read" onClick={() => this.queue('read')} disabled={!count} /><Command icon="flag" label="Follow Up" onClick={() => this.queue('flag')} disabled={!count} /></Group>
          <Group label="Send / Receive"><Command icon="sync" label="Sync Mail" onClick={() => MailBridge.requestSync()} /></Group>
          <Group label="Settings"><Command icon="settings" label="Mail Retention" onClick={preferences} /></Group>
        </>}
        {tab === 'Send / Receive' && <><Group label="Send / Receive"><Command icon="sync" label="Sync All Accounts" onClick={() => MailBridge.requestSync()} /></Group><Group label="Archive"><Command icon="archive" label="Local Archive" onClick={() => MailBridge.openArchive()} /><Command icon="settings" label="Sync Settings" onClick={preferences} /></Group></>}
        {tab === 'View' && <><Group label="Layout"><button className="mb-ribbon-text-command" onClick={() => AppEnv.commands.dispatch('navigation:split-mode-off')}>Reading pane right</button><button className="mb-ribbon-text-command" onClick={() => AppEnv.commands.dispatch('navigation:list-mode-off')}>Message list only</button></Group><Group label="People"><button className="mb-ribbon-text-command" onClick={() => Actions.toggleWorkspaceLocationHidden(WorkspaceStore.Location.MessageListSidebar)}>Show / hide contact pane</button></Group><Group label="Appearance"><Command icon="settings" label="Preferences" onClick={() => Actions.openPreferences()} /></Group></>}
      </div>
    </div>;
  }
}
class MailListHeading extends React.Component<{}, { query: string }> {
  static displayName = 'MailBridgeMailListHeading';
  static containerStyles = { order: -100, flexShrink: 0 };
  state = { query: '' };
  render() {
    return <div className="mb-list-heading"><form onSubmit={e => { e.preventDefault(); Actions.searchQuerySubmitted(this.state.query); }}><input type="search" aria-label="Search mail" placeholder="Search mail" value={this.state.query} onChange={e => this.setState({ query: e.target.value })} /><button aria-label="Search" type="submit">⌕</button></form><div className="mb-list-filters"><button onClick={() => { this.setState({ query: '' }); Actions.searchQuerySubmitted(''); }}>All</button><button onClick={() => Actions.searchQuerySubmitted('is:unread')}>Unread</button><span>Newest first</span></div></div>;
  }
}
let tab: any;
export function activate() {
  // Default to the supplied three-pane layout; the contact pane remains available under View.
  if (AppEnv.isMainWindow() && AppEnv.config.get('core.workspace.hiddenLocations') === undefined) {
    Actions.toggleWorkspaceLocationHidden(WorkspaceStore.Location.MessageListSidebar);
  }
  if (AppEnv.isMainWindow()) {
    if (!AppEnv.getColumnWidth('RootSidebar')) AppEnv.storeColumnWidth({ id: 'RootSidebar', width: 190 });
    if (!AppEnv.getColumnWidth('ThreadList')) AppEnv.storeColumnWidth({ id: 'ThreadList', width: 300 });
  }
  ComponentRegistry.register(OfficeHeader, { location: WorkspaceStore.Sheet.Threads.Header });
  ComponentRegistry.register(MailListHeading, { location: WorkspaceStore.Location.ThreadList, modes: ['split'] });
  ComponentRegistry.register(ArchiveStatus, { location: WorkspaceStore.Sheet.Threads.Footer });
  tab = new PreferencesUIStore.TabItem({ tabId: 'Archive', displayName: 'Archive & sync', componentClassFn: () => ArchivePreferences, order: 2.5 });
  PreferencesUIStore.registerPreferencesTab(tab);
}
export function deactivate() {
  [ArchiveStatus, OfficeHeader, MailListHeading].forEach(component => ComponentRegistry.unregister(component));
  PreferencesUIStore.unregisterPreferencesTab('Archive');
}
