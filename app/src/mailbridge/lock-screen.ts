import { ipcRenderer } from 'electron';

export function initializeLockScreen() {
  const style = document.createElement('style');
  style.textContent = `body.mb-app-locked > :not(#mb-password-overlay):not(style):not(script) { visibility:hidden!important; pointer-events:none!important; }
    #mb-password-overlay { position:fixed; inset:0; z-index:2147483647; display:none; align-items:center; justify-content:center; background:#f4f7fb; font:14px 'Segoe UI',Arial,sans-serif; color:#18344e; -webkit-app-region:no-drag; }
    body.mb-app-locked #mb-password-overlay { display:flex; }
    #mb-password-overlay form { width:340px; padding:32px; background:white; border:1px solid #dbe4ef; border-radius:12px; box-shadow:0 12px 36px #17355012; }
    #mb-password-overlay h1 { margin:0 0 8px; font-size:24px; }
    #mb-password-overlay p { line-height:1.5; }
    #mb-password-overlay label { display:block; margin:24px 0 8px; }
    #mb-password-overlay input { box-sizing:border-box; width:100%; padding:12px; border:1px solid #b4c6d9; border-radius:6px; color:#18344e; background:white; }
    #mb-password-overlay input:focus { outline:2px solid #0f5ca8; outline-offset:2px; }
    #mb-password-overlay button { width:100%; margin-top:16px; padding:12px; border:0; border-radius:6px; background:#0f5ca8; color:white; cursor:pointer; }
    #mb-password-overlay button:disabled { opacity:.6; cursor:wait; }
    #mb-password-overlay .mb-lock-bar { position:absolute; top:0; left:0; right:0; height:34px; background:#0f5ca8; color:white; display:flex; align-items:center; -webkit-app-region:drag; }
    #mb-password-overlay .mb-lock-bar span { padding:0 16px; flex:1; font-weight:600; font-size:12px; }
    #mb-password-overlay .mb-lock-bar button { width:40px; height:34px; margin:0; padding:0; border-radius:0; -webkit-app-region:no-drag; }
    #mb-password-overlay .mb-lock-bar button:hover { background:#c42b1c; }
    #mb-password-overlay [role=alert] { color:#ac2a23; min-height:20px; margin:12px 0 0; }`;
  document.head.appendChild(style);
  const overlay = document.createElement('div');
  overlay.id = 'mb-password-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Unlock MailBridge');
  overlay.innerHTML =
    '<div class="mb-lock-bar"><span>MailBridge · Locked</span><button type="button" aria-label="Close window">×</button></div><form><h1>MailBridge is locked</h1><p>Enter your app password to access your mail.</p><label for="mb-unlock-password">Password</label><input id="mb-unlock-password" type="password" autocomplete="current-password" required><button type="submit">Unlock</button><p role="alert" aria-live="polite"></p></form>';
  document.body.appendChild(overlay);
  const input = overlay.querySelector('input');
  const button = overlay.querySelector<HTMLButtonElement>('button[type=submit]');
  overlay
    .querySelector('.mb-lock-bar button')
    .addEventListener('click', () => AppEnv.getCurrentWindow().close());
  const error = overlay.querySelector('[role=alert]');
  const update = (status: { locked: boolean }) => {
    document.body.classList.toggle('mb-app-locked', status.locked);
    input.value = '';
    error.textContent = '';
    if (status.locked) setTimeout(() => input.focus(), 0);
  };
  overlay.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      update(await ipcRenderer.invoke('mailbridge-lock-action', 'unlock', input.value));
    } catch (failure) {
      error.textContent = failure.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        ''
      );
      input.focus();
    } finally {
      button.disabled = false;
    }
  });
  window.addEventListener(
    'keydown',
    (event) => {
      if (!document.body.classList.contains('mb-app-locked')) return;
      event.stopImmediatePropagation();
      if (event.key === 'Tab') {
        event.preventDefault();
        const controls = [
          ...overlay.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button'),
        ].filter((control) => !control.disabled);
        const current = controls.indexOf(document.activeElement as any);
        controls[(current + (event.shiftKey ? controls.length - 1 : 1)) % controls.length].focus();
      }
    },
    true
  );
  ipcRenderer.on('mailbridge-lock-changed', (_event, status) => update(status));
  update(ipcRenderer.sendSync('mailbridge-lock-status'));
}
