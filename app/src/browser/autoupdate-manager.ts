import { EventEmitter } from 'events';

// MailBridge installs must never be replaced by an upstream Mailspring update.
// Enable automatic updates only after a dedicated, signed MailBridge feed exists.
export default class AutoUpdateManager extends EventEmitter {
  state = 'unsupported';
  feedURL: string;
  constructor(
    public version: string,
    public config: import('../config').default,
    public specMode: boolean
  ) {
    super();
  }
  getState() {
    return this.state;
  }
  getReleaseDetails() {
    return { releaseVersion: undefined, releaseNotes: undefined };
  }
  updateFeedURL() {}
  setupAutoUpdater() {}
  check(_options: { hidePopups?: boolean } = {}) {}
  install() {}
}
