import { fireEvent } from '@testing-library/react';
import { showMailBridgeMenu } from '../src/mailbridge/context-menu';

describe('MailBridge action menu', () => {
  afterEach(() => window.dispatchEvent(new Event('blur')));
  it('skips disabled actions, supports keyboard navigation, and returns focus on dismissal', () => {
    const origin = document.createElement('button');
    document.body.appendChild(origin);
    origin.focus();
    showMailBridgeMenu([
      { label: 'Reply', icon: 'reply' },
      { label: 'Archive', enabled: false },
      { type: 'separator' },
      { label: 'Save', icon: 'download' },
    ]);
    const actions = document.querySelectorAll<HTMLButtonElement>('.mb-context-menu button');
    expect(document.activeElement).toBe(actions[0]);
    fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(actions[2]);
    fireEvent.keyDown(document.activeElement, { key: 'Home' });
    expect(document.activeElement).toBe(actions[0]);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(document.querySelector('[role="menu"]')).toBe(null);
    expect(document.activeElement).toBe(origin);
    origin.remove();
  });
  it('invokes an action once and closes before that action changes the window', () => {
    const action = jasmine
      .createSpy('action')
      .andCallFake(() => expect(document.querySelector('.mb-context-menu')).toBe(null));
    showMailBridgeMenu([{ label: 'Open draft', icon: 'edit', click: action }]);
    fireEvent.click(document.querySelector('[role="menuitem"]'));
    expect(action.calls.length).toBe(1);
  });
  it('dismisses on outside click and replaces an earlier menu without leaving handlers behind', () => {
    showMailBridgeMenu([{ label: 'First' }]);
    showMailBridgeMenu([{ label: 'Second' }]);
    expect(document.querySelectorAll('[role="menu"]').length).toBe(1);
    expect(document.querySelector('[role="menuitem"]').textContent).toBe('Second');
    fireEvent.mouseDown(document.body);
    expect(document.querySelector('.mb-context-menu-host')).toBe(null);
  });
});
