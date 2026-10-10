const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const { durableWrite } = require('./core');

class PasswordLock {
  constructor(configDirectory) {
    this.file = path.join(configDirectory, 'mailbridge-password.json');
    this.locked = Boolean(this.read());
    this.retryAfter = 0;
    this.failures = 0;
  }
  read() {
    if (!fs.existsSync(this.file)) return null;
    const value = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (value.schema !== 1 || !/^[a-f0-9]{64}$/.test(value.salt) || !/^[a-f0-9]{128}$/.test(value.hash))
      throw new Error('The app password file is damaged. Restore it from your profile backup.');
    return value;
  }
  status() { return { enabled: Boolean(this.read()), locked: this.locked }; }
  async verify(password) {
    if (typeof password !== 'string' || password.length > 1024) return false;
    const record = this.read();
    if (!record) return true;
    const actual = await scrypt(password, Buffer.from(record.salt, 'hex'), 64);
    return crypto.timingSafeEqual(actual, Buffer.from(record.hash, 'hex'));
  }
  async unlock(password) {
    if (Date.now() < this.retryAfter) throw new Error('Wait a few seconds before trying again.');
    if (!await this.verify(password)) {
      this.failures++;
      this.retryAfter = Date.now() + Math.min(5000, this.failures * 1000);
      throw new Error('Incorrect password.');
    }
    this.locked = false;
    this.failures = 0;
    this.retryAfter = 0;
    return this.status();
  }
  async configure(currentPassword, newPassword) {
    if (this.locked) throw new Error('Unlock MailBridge before changing its password.');
    if (!await this.verify(currentPassword)) throw new Error('Current password is incorrect.');
    if (newPassword === null) {
      if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    } else {
      if (typeof newPassword !== 'string' || !newPassword.length || newPassword.length > 1024)
        throw new Error('Enter a password between 1 and 1024 characters.');
      const salt = crypto.randomBytes(32);
      const hash = await scrypt(newPassword, salt, 64);
      durableWrite(this.file, JSON.stringify({ schema: 1, salt: salt.toString('hex'), hash: hash.toString('hex') }));
      fs.chmodSync(this.file, 0o600);
    }
    return this.status();
  }
  lock() { this.locked = Boolean(this.read()); return this.status(); }
}
module.exports = { PasswordLock };
