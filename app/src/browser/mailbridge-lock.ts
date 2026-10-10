import { BrowserWindow, ipcMain } from 'electron';
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
  const broadcast = () => {
    const status = lock.status();
    if (status.locked) lockListener?.();
    BrowserWindow.getAllWindows().forEach((window) =>
      window.webContents.send('mailbridge-lock-changed', status)
    );
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
