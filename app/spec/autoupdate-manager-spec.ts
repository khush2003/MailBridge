import AutoUpdateManager from '../src/browser/autoupdate-manager';

describe('MailBridge updates', () => {
  it('keeps upstream updates disabled for release and development versions', () => {
    for (const version of ['0.1.0', '0.1.0-abc']) {
      const manager = new AutoUpdateManager(version, {} as any, true);
      expect(manager.getState()).toBe('unsupported');
      expect(manager.feedURL).toBeUndefined();
    }
  });
  it('never reads an upstream identity or registers an update feed', () => {
    const config = {
      get: jasmine.createSpy('config.get'),
      onDidChange: jasmine.createSpy('config.onDidChange'),
    };
    const manager = new AutoUpdateManager('0.1.0', config as any, true);
    manager.updateFeedURL();
    manager.setupAutoUpdater();
    manager.check();
    manager.install();
    expect(config.get).not.toHaveBeenCalled();
    expect(config.onDidChange).not.toHaveBeenCalled();
    expect(manager.feedURL).toBeUndefined();
    expect(manager.getState()).toBe('unsupported');
  });
});
