import AutoUpdateManager from '../src/browser/autoupdate-manager';
const configuration = require('../mailbridge-updates.json');

describe('MailBridge updates', () => {
  it('uses only the dedicated MailBridge feed and its pinned signing key', () => {
    const manager = new AutoUpdateManager('0.1.3', {} as any, true);
    expect(manager.feedURL).toBe(configuration.feed);
    expect(manager.feedURL).not.toContain('mailspring');
    expect(configuration.publicKey).toContain('BEGIN PUBLIC KEY');
    expect(manager.getState()).toBe('idle');
  });
  it('never reads upstream identity and refuses to install an unverified download', async () => {
    const config = {
      get: jasmine.createSpy('config.get'),
      onDidChange: jasmine.createSpy('config.onDidChange'),
    };
    const manager = new AutoUpdateManager('0.1.3', config as any, true);
    manager.updateFeedURL();
    manager.setupAutoUpdater();
    await manager.check();
    expect(() => manager.install()).toThrow();
    expect(config.get).not.toHaveBeenCalled();
    expect(config.onDidChange).not.toHaveBeenCalled();
    expect(manager.getState()).toBe('idle');
  });
});
