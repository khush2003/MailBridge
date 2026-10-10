import React from 'react';
import ReactDOM from 'react-dom';
import { ipcRenderer } from 'electron';
import Icon, { IconName } from './icon';

export interface MailBridgeMenuItem {
  type?: 'separator';
  label?: string;
  icon?: IconName;
  enabled?: boolean;
  click?: () => void;
}
let dismissCurrent: (() => void) | undefined;

export function showMailBridgeMenu(items: MailBridgeMenuItem[], point?: { x: number; y: number }) {
  dismissCurrent?.();
  const previousFocus = document.activeElement as HTMLElement;
  const host = document.createElement('div');
  host.className = 'mb-context-menu-host';
  document.body.appendChild(host);
  let closed = false;
  const dismiss = () => {
    if (closed) return;
    closed = true;
    window.removeEventListener('blur', dismiss);
    ipcRenderer.removeListener('mailbridge-lock-changed', lockChanged);
    document.removeEventListener('mousedown', outside, true);
    document.removeEventListener('contextmenu', outside, true);
    document.removeEventListener('keydown', keydown, true);
    ReactDOM.unmountComponentAtNode(host);
    host.remove();
    dismissCurrent = undefined;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const lockChanged = (_event, status: { locked: boolean }) => {
    if (status.locked) dismiss();
  };
  const outside = (event: Event) => {
    if (!host.contains(event.target as Node)) dismiss();
  };
  const buttons = () =>
    Array.from(host.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const keydown = (event: KeyboardEvent) => {
    event.stopPropagation();
    const enabled = buttons();
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'ArrowDown') next = (index + 1) % enabled.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + enabled.length) % enabled.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = enabled.length - 1;
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      next = enabled.findIndex(
        (button, i) =>
          i > index && button.textContent.toLowerCase().startsWith(event.key.toLowerCase())
      );
      if (next < 0)
        next = enabled.findIndex((button) =>
          button.textContent.toLowerCase().startsWith(event.key.toLowerCase())
        );
    } else return;
    event.preventDefault();
    enabled[next]?.focus();
  };
  ReactDOM.render(
    <div className="mb-context-menu" role="menu" aria-label="Mail actions">
      {items.map((item, index) =>
        item.type === 'separator' ? (
          <div key={index} className="mb-menu-divider" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            title={item.label}
            className={item.icon === 'delete' ? 'mb-menu-delete' : ''}
            disabled={item.enabled === false}
            onClick={() => {
              dismiss();
              try {
                Promise.resolve(item.click?.()).catch((error) =>
                  AppEnv.showErrorDialog({
                    title: 'Unable to complete action',
                    message: error?.message || String(error),
                  })
                );
              } catch (error) {
                AppEnv.showErrorDialog({
                  title: 'Unable to complete action',
                  message: error?.message || String(error),
                });
              }
            }}
          >
            <Icon name={item.icon || 'mail'} />
            <span>{item.label}</span>
          </button>
        )
      )}
    </div>,
    host
  );
  const menu = host.firstElementChild as HTMLElement;
  const rect = menu.getBoundingClientRect();
  const origin = point || { x: window.innerWidth / 2, y: window.innerHeight / 3 };
  menu.style.left = `${Math.max(8, Math.min(origin.x, window.innerWidth - rect.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(origin.y, window.innerHeight - rect.height - 8))}px`;
  dismissCurrent = dismiss;
  window.addEventListener('blur', dismiss);
  ipcRenderer.on('mailbridge-lock-changed', lockChanged);
  document.addEventListener('mousedown', outside, true);
  document.addEventListener('contextmenu', outside, true);
  document.addEventListener('keydown', keydown, true);
  buttons()[0]?.focus({ preventScroll: true });
}
