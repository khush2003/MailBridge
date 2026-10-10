const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PasswordLock } = require('../../app/src/mailbridge/password-lock');
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, lock: new PasswordLock(directory) };
}
test('optional password preserves exact user choice, stores a salted hash, and locks on restart', async t => {
  const { directory, lock } = fixture(t);
  assert.deepEqual(lock.status(), { enabled: false, locked: false });
  const password = ' arbitrary choice 🔐 ';
  await lock.configure('', password);
  assert.equal(await lock.verify(password), true);
  assert.equal(await lock.verify(password.trim()), false);
  assert.ok(!fs.readFileSync(lock.file, 'utf8').includes(password));
  const restarted = new PasswordLock(directory);
  assert.equal(restarted.status().locked, true);
  await restarted.unlock(password);
  assert.equal(restarted.status().locked, false);
});
test('changing or disabling requires the existing password and never resets mail files', async t => {
  const { directory, lock } = fixture(t);
  const mail = path.join(directory, 'retained.eml'); fs.writeFileSync(mail, 'retained mail');
  await lock.configure('', 'x');
  await assert.rejects(lock.configure('wrong', null), /incorrect/);
  await lock.configure('x', 'new password');
  assert.equal(await lock.verify('x'), false);
  await lock.configure('new password', null);
  assert.deepEqual(lock.status(), { enabled: false, locked: false });
  assert.equal(fs.readFileSync(mail, 'utf8'), 'retained mail');
});
test('wrong unlock is throttled and a locked app cannot change its password', async t => {
  const { lock } = fixture(t);
  await lock.configure('', 'abc'); lock.lock();
  await assert.rejects(lock.unlock('wrong'), /Incorrect/);
  await assert.rejects(lock.unlock('abc'), /Wait/);
  await assert.rejects(lock.configure('abc', null), /Unlock/);
});
test('damaged verifier is rejected rather than silently disabling the lock', async t => {
  const { directory, lock } = fixture(t);
  fs.writeFileSync(lock.file, '{}');
  assert.throws(() => new PasswordLock(directory), /damaged/);
});
