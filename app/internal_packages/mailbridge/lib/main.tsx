import React from 'react';
import {
  ComponentRegistry,
  WorkspaceStore,
  PreferencesUIStore,
  Actions,
  AccountStore,
  FocusedContentStore,
  FocusedPerspectiveStore,
  TaskFactory,
  Thread,
} from 'mailspring-exports';
import MailBridge from '../../../src/mailbridge/controller';
import ArchivePreferences from './preferences';
import ThreadListStore from '../../thread-list/lib/thread-list-store';
import DraftListStore from '../../draft-list/lib/draft-list-store';
import ThreadSearchBar from '../../thread-search/lib/thread-search-bar';
import SearchStore from '../../thread-search/lib/search-store';
import MovePickerPopover from '../../category-picker/lib/move-picker-popover';

const openSettings = (tabId?: string) => {
  if (!AppEnv.isMainWindow()) {
    require('electron').ipcRenderer.send('command', 'application:open-preferences', tabId);
    return;
  }
  Actions.openPreferences();
  if (tabId) Actions.switchPreferencesTab(tabId);
};
const preferences = () => openSettings('Archive');
import Icon, { IconName } from '../../../src/mailbridge/icon';
import { showMailBridgeMenu } from '../../../src/mailbridge/context-menu';
function Command({
  icon,
  label,
  onClick,
  disabled = false,
  title,
}: {
  icon: IconName;
  label: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      className={`mb-ribbon-command mb-command-${icon}`}
      onClick={onClick}
      disabled={disabled}
      title={title || label}
    >
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}
function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-ribbon-group">
      <div className="mb-ribbon-group-actions">{children}</div>
      <span className="mb-ribbon-group-label">{label}</span>
    </div>
  );
}

class ArchiveStatus extends React.Component<Record<string, never>, { status: any }> {
  static displayName = 'MailBridgeArchiveStatus';
  state = { status: MailBridge.status() };
  timer: any;
  componentDidMount() {
    this.timer = setInterval(() => this.setState({ status: MailBridge.status() }), 1000);
  }
  componentWillUnmount() {
    clearInterval(this.timer);
  }
  render() {
    const { status } = this.state;
    const notice = Date.now() - status.noticeAt < 12000 ? status.notice : null;
    const text =
      status.phase === 'local'
        ? `${status.retained || 0} messages retained on this PC`
        : status.phase === 'connected'
          ? `Drive connected · ${status.retained} retained`
          : status.phase === 'folder-ready'
            ? `Drive folder ready · ${status.pending || 0} awaiting other PC`
            : status.running
              ? 'Synchronizing archive…'
              : status.phase === 'setup'
                ? 'Set up optional archive sync'
                : status.phase === 'paused'
                  ? 'Archive sync paused'
                  : 'Mail sync needs attention';
    return (
      <div className="mb-office-statusbar">
        <span>MailBridge</span>
        <button
          className={`mailbridge-status ${status.phase} ${notice ? 'has-notice' : ''}`}
          title={notice || status.error || 'Local retention and optional Drive sync'}
          onClick={preferences}
        >
          <span className="mailbridge-status-dot" />
          <span className="mb-status-label" aria-live="polite">
            {notice || text}
          </span>
        </button>
        <span className="mb-status-end">
          {MailBridge.peerSyncEnabled() ? 'IMAP + archive sync' : 'IMAP · local retention'}
          <span className="mb-status-zoom">
            {Math.round((AppEnv.config.get('core.workspace.interfaceZoom') || 1) * 100)}%
          </span>
        </span>
      </div>
    );
  }
}
class OfficeHeader extends React.Component<
  Record<string, never>,
  {
    tab: string;
    thread: Thread | null;
    email: string;
    selected: number;
    mailbox: string;
    compact: boolean;
  }
> {
  static displayName = 'MailBridgeOfficeHeader';
  state = {
    tab: 'Home',
    compact: window.innerWidth < 1280,
    thread: FocusedContentStore.focused('thread') as Thread,
    email: '',
    selected: ThreadListStore.dataSource()?.selection.count() || 0,
    mailbox: FocusedPerspectiveStore.current().name || 'Mail',
  };
  unsubscribers: (() => void)[] = [];
  sidebar: Element;
  sidebarObserver: ResizeObserver;
  sidebarFrame = 0;
  observeSidebar = () => {
    cancelAnimationFrame(this.sidebarFrame);
    this.sidebarFrame = requestAnimationFrame(() => {
      const sidebar = document.querySelector('.column-RootSidebar');
      if (!sidebar || sidebar === this.sidebar) return;
      this.sidebarObserver?.disconnect();
      this.sidebar = sidebar;
      this.sidebarObserver = new ResizeObserver(() => {
        document
          .querySelector<HTMLElement>('mailspring-workspace')
          ?.style.setProperty(
            '--mailbridge-sidebar-width',
            `${sidebar.getBoundingClientRect().width}px`
          );
      });
      this.sidebarObserver.observe(sidebar);
    });
  };
  componentDidUpdate() {
    this.observeSidebar();
  }
  updateMailbox = () => {
    const perspective = FocusedPerspectiveStore.current();
    const accounts = perspective.accountIds
      .map((id) => AccountStore.accountForId(id))
      .filter(Boolean);
    this.setState({
      mailbox: perspective.name || 'Mail',
      email: accounts.length === 1 ? accounts[0].emailAddress : 'All accounts',
    });
  };
  updateSize = () => this.setState({ compact: window.innerWidth < 1280 });
  componentDidMount() {
    window.addEventListener('resize', this.updateSize);
    this.updateMailbox();
    this.observeSidebar();
    const draftSelection = DraftListStore.selectionObservable().subscribe(() => this.forceUpdate());
    this.unsubscribers = [
      () => draftSelection.dispose(),
      ThreadListStore.listen(() =>
        this.setState({ selected: ThreadListStore.dataSource()?.selection.count() || 0 })
      ),
      FocusedPerspectiveStore.listen(this.updateMailbox),
      FocusedContentStore.listen(() =>
        this.setState({ thread: FocusedContentStore.focused('thread') as Thread })
      ),
      AccountStore.listen(this.updateMailbox),
      WorkspaceStore.listen(() => this.forceUpdate()),
    ];
  }
  componentWillUnmount() {
    window.removeEventListener('resize', this.updateSize);
    this.unsubscribers.forEach((fn) => fn());
    cancelAnimationFrame(this.sidebarFrame);
    this.sidebarObserver?.disconnect();
  }
  selectedThreads = () => {
    const selected = ThreadListStore.dataSource()?.selection.items() as Thread[];
    return selected?.length ? selected : this.state.thread ? [this.state.thread] : [];
  };
  queue = (kind: 'delete' | 'archive' | 'read' | 'flag') => {
    const threads = this.selectedThreads();
    if (!threads.length) return;
    const source = 'MailBridge ribbon';
    if (kind === 'delete')
      Actions.queueTasks(TaskFactory.tasksForMovingToTrash({ threads, source }));
    if (kind === 'archive')
      Actions.queueTasks(
        TaskFactory.tasksForArchiving({
          threads,
          source,
          perspective: FocusedPerspectiveStore.current(),
        })
      );
    if (kind === 'read') Actions.queueTask(TaskFactory.taskForInvertingUnread({ threads, source }));
    if (kind === 'flag')
      Actions.queueTask(TaskFactory.taskForInvertingStarred({ threads, source }));
  };
  reply = (type: string) => {
    const threads = this.selectedThreads();
    if (threads.length !== 1) return;
    if (type === 'forward') Actions.composeForward({ threadId: threads[0].id });
    else
      Actions.composeReply({
        threadId: threads[0].id,
        type,
        behavior: 'prefer-existing-if-pristine',
      });
  };
  render() {
    const { tab, thread, email, mailbox, selected } = this.state;
    const count = selected || (thread ? 1 : 0);
    const perspective = FocusedPerspectiveStore.current();
    const isDrafts = 'drafts' in perspective && perspective.drafts === true;
    const threads = isDrafts ? [] : this.selectedThreads();
    const account = AccountStore.accountForItems(threads);
    const allRead = threads.length > 0 && threads.every((item) => !item.unread);
    const allFlagged = threads.length > 0 && threads.every((item) => item.starred);
    const win = () => require('@electron/remote').getCurrentWindow();
    return (
      <div className="mb-office-header">
        <div className="mb-office-appbar">
          <span className="mb-office-brand">
            <Icon name="mail" />
            MailBridge
          </span>
          <span className="mb-office-window-title">
            {mailbox}
            {email ? ` - ${email}` : ''} - MailBridge
          </span>
          <div className="mb-office-window-controls">
            <button aria-label="Minimize" onClick={() => win().minimize()}>
              ―
            </button>
            <button
              aria-label="Maximize or restore"
              onClick={() => (win().isMaximized() ? win().unmaximize() : win().maximize())}
            >
              □
            </button>
            <button aria-label="Close" onClick={() => win().close()}>
              ×
            </button>
          </div>
        </div>
        <nav className="mb-office-tabs" aria-label="Ribbon tabs">
          <button onClick={() => openSettings()}>File</button>
          {(AppEnv.isMainWindow()
            ? ['Home', 'Send / Receive', 'View']
            : ['Home', 'Send / Receive']
          ).map((name) => (
            <button
              key={name}
              className={tab === name ? 'active' : ''}
              aria-pressed={tab === name}
              onClick={() => this.setState({ tab: name })}
            >
              {name}
            </button>
          ))}
          <button className="mb-office-settings-tab" onClick={preferences}>
            <Icon name="archive" /> Mail retention
          </button>
        </nav>
        <div className="mb-office-ribbon" role="toolbar" aria-label={`${tab} commands`}>
          {tab === 'Home' && isDrafts && (
            <>
              <Group label="New">
                <Command
                  icon="mail"
                  label="New Email"
                  onClick={() => Actions.composeNewBlankDraft()}
                />
              </Group>
              <Group label="Drafts">
                <Command
                  icon="delete"
                  label="Delete drafts"
                  disabled={!DraftListStore.dataSource()?.selection.count()}
                  onClick={() => {
                    const selection = DraftListStore.dataSource().selection;
                    [...selection.items()].forEach((draft) => Actions.destroyDraft(draft));
                    selection.clear();
                  }}
                />
              </Group>
              <Group label="Settings">
                <Command icon="settings" label="Mail Retention" onClick={preferences} />
              </Group>
            </>
          )}
          {tab === 'Home' && !isDrafts && (
            <>
              <Group label="New">
                <Command
                  icon="mail"
                  label="New Email"
                  onClick={() => Actions.composeNewBlankDraft()}
                />
              </Group>
              <Group label="Delete">
                <Command
                  icon="delete"
                  label="Delete"
                  title="Move to Trash on this PC. The server copy stays available for your other PC."
                  onClick={() => this.queue('delete')}
                  disabled={!count || !perspective.canMoveThreadsTo(threads, 'trash')}
                />
                <Command
                  icon="archive"
                  label="Archive"
                  onClick={() => this.queue('archive')}
                  disabled={!count || !perspective.canArchiveThreads(threads)}
                />
              </Group>
              <Group label="Respond">
                <Command
                  icon="reply"
                  label="Reply"
                  onClick={() => this.reply('reply')}
                  disabled={count !== 1}
                />
                <Command
                  icon="replyAll"
                  label="Reply All"
                  onClick={() => this.reply('reply-all')}
                  disabled={count !== 1}
                />
                <Command
                  icon="forward"
                  label="Forward"
                  onClick={() => this.reply('forward')}
                  disabled={count !== 1}
                />
              </Group>
              {!this.state.compact && (
                <Group label="Move">
                  <Command
                    icon="folder"
                    label="Move to Folder"
                    disabled={!count || !account}
                    onClick={(event) =>
                      Actions.openPopover(
                        <MovePickerPopover threads={threads} account={account} />,
                        {
                          originRect: event.currentTarget.getBoundingClientRect(),
                          direction: 'down',
                        }
                      )
                    }
                  />
                </Group>
              )}
              {!this.state.compact && (
                <Group label="Tags">
                  <Command
                    icon="mail"
                    label={allRead ? 'Mark unread' : 'Mark read'}
                    onClick={() => this.queue('read')}
                    disabled={!count}
                  />
                  <Command
                    icon="flag"
                    label={allFlagged ? 'Unflag' : 'Flag'}
                    onClick={() => this.queue('flag')}
                    disabled={!count}
                  />
                </Group>
              )}
              <Group label="Send / Receive">
                <Command icon="sync" label="Sync Mail" onClick={() => MailBridge.requestSync()} />
              </Group>
              <Group label="More">
                <Command
                  icon="more"
                  label="More"
                  onClick={(event) => {
                    const originRect = event.currentTarget.getBoundingClientRect();
                    showMailBridgeMenu(
                      [
                        {
                          label: 'Move to folder',
                          icon: 'folder',
                          enabled: !!count && !!account,
                          click: () =>
                            Actions.openPopover(
                              <MovePickerPopover threads={threads} account={account} />,
                              { originRect, direction: 'down' }
                            ),
                        },
                        {
                          label: allRead ? 'Mark unread' : 'Mark read',
                          icon: 'mail',
                          enabled: !!count,
                          click: () => this.queue('read'),
                        },
                        {
                          label: allFlagged ? 'Unflag' : 'Flag',
                          icon: 'flag',
                          enabled: !!count,
                          click: () => this.queue('flag'),
                        },
                        { type: 'separator' },
                        { label: 'Archive & sync', icon: 'archive', click: preferences },
                        {
                          label: 'Settings',
                          icon: 'settings',
                          click: () => openSettings(),
                        },
                      ],
                      { x: originRect.left, y: originRect.bottom }
                    );
                  }}
                />
              </Group>
            </>
          )}
          {tab === 'Send / Receive' && (
            <>
              <Group label="Send / Receive">
                <Command
                  icon="sync"
                  label="Sync All Accounts"
                  onClick={() => MailBridge.requestSync()}
                />
              </Group>
              <Group label="Archive">
                <Command
                  icon="archive"
                  label="Local Archive"
                  onClick={() => MailBridge.openArchive()}
                />
                <Command icon="settings" label="Sync Settings" onClick={preferences} />
              </Group>
            </>
          )}
          {tab === 'View' && (
            <>
              <Group label="Layout">
                <button
                  className="mb-ribbon-text-command"
                  aria-pressed={WorkspaceStore.layoutMode() === 'split'}
                  onClick={() => AppEnv.commands.dispatch('navigation:split-mode-off')}
                >
                  Reading pane right
                </button>
                <button
                  className="mb-ribbon-text-command"
                  aria-pressed={WorkspaceStore.layoutMode() === 'list'}
                  onClick={() => AppEnv.commands.dispatch('navigation:list-mode-off')}
                >
                  Message list only
                </button>
              </Group>
              <Group label="People">
                <button
                  className="mb-ribbon-text-command"
                  onClick={() =>
                    Actions.toggleWorkspaceLocationHidden(
                      WorkspaceStore.Location.MessageListSidebar
                    )
                  }
                >
                  Show / hide contact pane
                </button>
              </Group>
              <Group label="Appearance">
                <Command icon="settings" label="Preferences" onClick={() => openSettings()} />
              </Group>
            </>
          )}
        </div>
      </div>
    );
  }
}
class MailListHeading extends React.Component<Record<string, never>, { query: string }> {
  static displayName = 'MailBridgeMailListHeading';
  static containerStyles = { order: -100, flexShrink: 0 };
  state = { query: SearchStore.query() };
  unsubscribe: () => void;
  componentDidMount() {
    this.unsubscribe = SearchStore.listen(() => this.setState({ query: SearchStore.query() }));
  }
  componentWillUnmount() {
    this.unsubscribe();
  }
  unread = () => {
    const perspective = FocusedPerspectiveStore.current() as any;
    const source = perspective.sourcePerspective || perspective;
    const scopes = [
      ...new Set(
        source
          .categories()
          .map((category) => category.role || `"${category.path.replace(/"/g, '\\"')}"`)
      ),
    ];
    Actions.searchQuerySubmitted(
      `is:unread${scopes.length ? ` (in:${scopes.join(' OR in:')})` : ''}`
    );
  };
  render() {
    const unread = this.state.query.startsWith('is:unread');
    return (
      <div className="mb-list-heading">
        <ThreadSearchBar />
        <div className="mb-list-filters">
          <button aria-pressed={!this.state.query} onClick={() => Actions.searchQuerySubmitted('')}>
            All
          </button>
          <button aria-pressed={unread} onClick={this.unread}>
            Unread
          </button>
          <span>Newest first</span>
        </div>
      </div>
    );
  }
}
let tab: any;
let stopWatchingHeaders: (() => void) | undefined;
let registeredHeaders: any[] = [];
function registerMailHeaders() {
  const locations = [
    WorkspaceStore.Sheet.Threads?.Header,
    WorkspaceStore.Sheet.Drafts?.Header,
    WorkspaceStore.Sheet.Thread?.Header,
    ...(!AppEnv.isMainWindow() ? [WorkspaceStore.Sheet.Global?.Header] : []),
  ].filter(Boolean);
  if (
    locations.length === registeredHeaders.length &&
    locations.every((location, index) => location === registeredHeaders[index])
  )
    return;
  registeredHeaders = locations;
  ComponentRegistry.register(OfficeHeader, { locations });
  ComponentRegistry.register(ArchiveStatus, {
    locations: [WorkspaceStore.Sheet.Threads?.Footer, WorkspaceStore.Sheet.Drafts?.Footer].filter(
      Boolean
    ),
  });
}
export function activate() {
  // Default to the supplied three-pane layout; the contact pane remains available under View.
  if (AppEnv.isMainWindow() && AppEnv.config.get('core.workspace.hiddenLocations') === undefined) {
    Actions.toggleWorkspaceLocationHidden(WorkspaceStore.Location.MessageListSidebar);
  }
  if (AppEnv.isMainWindow()) {
    if (!AppEnv.getColumnWidth('RootSidebar'))
      AppEnv.storeColumnWidth({ id: 'RootSidebar', width: 190 });
    if (!AppEnv.getColumnWidth('ThreadList'))
      AppEnv.storeColumnWidth({ id: 'ThreadList', width: 300 });
  }
  registerMailHeaders();
  stopWatchingHeaders = WorkspaceStore.listen(registerMailHeaders);
  if (!AppEnv.isMainWindow()) return;
  ComponentRegistry.register(MailListHeading, {
    location: WorkspaceStore.Location.ThreadList,
    modes: ['split', 'list', 'splitVertical'],
  });
  tab = new PreferencesUIStore.TabItem({
    tabId: 'Archive',
    displayName: 'Archive & sync',
    componentClassFn: () => ArchivePreferences,
    order: 2.5,
  });
  PreferencesUIStore.registerPreferencesTab(tab);
}
export function deactivate() {
  stopWatchingHeaders?.();
  registeredHeaders = [];
  [ArchiveStatus, OfficeHeader, MailListHeading].forEach((component) =>
    ComponentRegistry.unregister(component)
  );
  PreferencesUIStore.unregisterPreferencesTab('Archive');
}
