import { BrowserWindow, ipcMain, app } from 'electron';
import { isMailspringWindowContents } from './mailspring-window';
const { PasswordLock } = require('../mailbridge/password-lock');
let lock: any;
let lockListener: (() => void) | undefined;
export const onMailbridgeLock = (listener: () => void) => {
  lockListener = listener;
};
export const mailbridgeLocked = () => Boolean(lock?.locked);
export function initializeMailbridgeLock(configDirectory: string) {
  lock = new PasswordLock(configDirectory);
  const hiddenPreviews = new Set<BrowserWindow>();
  const hidePreview = (window: BrowserWindow) => {
    if (lock.locked && !isMailspringWindowContents(window.webContents) && window.isVisible()) {
      hiddenPreviews.add(window);
      window.hide();
    }
  };
  app.on('browser-window-created', (_event, window) => {
    window.on('show', () => hidePreview(window));
    window.on('closed', () => hiddenPreviews.delete(window));
  });
  const broadcast = () => {
    const status = lock.status();
    if (status.locked) lockListener?.();
    BrowserWindow.getAllWindows().forEach((window) => {
      hidePreview(window);
      if (isMailspringWindowContents(window.webContents))
        window.webContents.send('mailbridge-lock-changed', status);
    });
    if (!status.locked) {
      hiddenPreviews.forEach((window) => {
        if (!window.isDestroyed()) window.show();
      });
      hiddenPreviews.clear();
    }
    return status;
  };
  ipcMain.on('mailbridge-lock-status', (event) => {
    if (isMailspringWindowContents(event.sender)) event.returnValue = lock.status();
    else event.returnValue = { enabled: true, locked: true };
  });
  ipcMain.handle('mailbridge-lock-action', async (event, action, currentPassword, newPassword) => {
    if (!isMailspringWindowContents(event.sender)) throw new Error('Untrusted app window');
    if (action === 'unlock') await lock.unlock(currentPassword);
    else if (action === 'configure') await lock.configure(currentPassword, newPassword);
    else if (action === 'lock') lock.lock();
    else if (action !== 'status') throw new Error('Unknown password action');
    return broadcast();
  });
}
