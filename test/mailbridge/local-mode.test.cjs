const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { createRequire } = require('node:module');
const source = path.resolve('app/src/mailbridge/controller.ts');
function fixture(t, accounts = [{ id: 'a', emailAddress: 'mail@example.test', syncState: 'ok' }]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mailbridge-local-mode-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const realRequire = createRequire(source);
  const exports = {};
  const script = ts.transpileModule(fs.readFileSync(source, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(script, { exports, process, Buffer, setInterval, clearInterval, console,
    AppEnv: { getLoadSettings: () => ({ configDirPath: root }) },
    require: name => name === '../flux/stores/account-store' ? { AccountStore: { accounts: () => accounts } } :
      name === '../key-manager' ? { secureStorage: {} } : name === '@electron/remote' ? {} : realRequire(name),
  }, { filename: source });
  return exports.default;
}
test('a new profile retains mail without requiring Drive or pairing', async t => {
  const controller = fixture(t);
  assert.equal(controller.peerSyncEnabled(), false);
  controller.bridge = { _clients: { a: {} }, mailbridgeRequest: async () => ({ records: [{ key: 'mail' }], unretained: 0, mailSyncInitialized: true, mailSyncBusy: false }) };
  await controller.tick();
  const status = controller.status();
  assert.equal(status.phase, 'local');
  assert.equal(status.retained, 1);
  assert.equal(status.localCaptureReady, true);
  assert.equal(status.safeToClear, false, 'local capture is not proof of delivery to another PC');
});
test('a missing mail engine never reports capture complete', async t => {
  const controller = fixture(t);
  const records = path.join(controller.root, 'records');
  fs.mkdirSync(records, { recursive: true });
  for (const digest of ['b'.repeat(64), 'c'.repeat(64)]) fs.writeFileSync(path.join(records, `${'a'.repeat(64)}-${digest}.json`), '{}');
  controller.bridge = { _clients: {}, mailbridgeRequest: () => { throw new Error('not running'); } };
  await controller.tick();
  assert.equal(controller.status().retained, 1, 'offline retention count deduplicates message revisions');
  assert.equal(controller.status().mailSyncInitialized, false);
  assert.equal(controller.status().localCaptureReady, false);
});
test('existing paired installations stay enabled, but explicitly disabling Drive avoids transport access', async t => {
  const controller = fixture(t);
  await controller.saveSettings({ workspace: 'existing', driveAccount: 'Drive' });
  const legacy = controller.settings();
  delete legacy.peerSyncEnabled;
  fs.writeFileSync(controller.configPath(), JSON.stringify(legacy));
  assert.equal(controller.peerSyncEnabled(), true);
  await controller.saveSettings({ peerSyncEnabled: false });
  controller.driveClient = () => { throw new Error('Drive must not be accessed'); };
  controller.bridge = { _clients: { a: {} }, mailbridgeRequest: async () => ({ records: [], mailSyncInitialized: true }) };
  await controller.tick();
  assert.equal(controller.status().phase, 'local');
});
test('Sync Mail wakes the IMAP workers in server-only mode', async t => {
  const controller = fixture(t);
  let wakes = 0;
  controller.bridge = { _clients: {}, sendSyncMailNow: () => wakes++ };
  await controller.requestSync();
  assert.equal(wakes, 1);
});
