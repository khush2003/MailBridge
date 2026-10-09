'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { durableWrite } = require('./core');

// Delivery is proved by the second PC's encrypted receipt, never by a local folder write.
class FolderTransport {
  constructor(root) { this.root = path.resolve(root); }
  file(id) {
    if (!/^[a-z0-9-]{1,240}\.mb$/.test(id)) throw new Error('Invalid shared archive object name');
    return path.join(this.root, id);
  }
  async health() {
    if (!fs.existsSync(this.root) || !fs.statSync(this.root).isDirectory()) throw new Error('Google Drive folder is unavailable. Check Drive for desktop.');
    fs.accessSync(this.root, fs.constants.R_OK | fs.constants.W_OK);
    return { type: 'folder', quota: null };
  }
  async list(prefix) {
    await this.health();
    return fs.readdirSync(this.root).filter(id => id.startsWith(prefix) && id.endsWith('.mb') && /^[a-z0-9-]{1,240}\.mb$/.test(id))
      .map(id => ({ name: id.slice(0, -3), id }));
  }
  async get(id) {
    const file = this.file(id);
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 800 * 1024 * 1024) throw new Error('Invalid shared archive file');
    return fs.readFileSync(file);
  }
  async put(name, bytes) { await this.health(); durableWrite(this.file(`${name}.mb`), bytes); }
  async remove(id) { fs.unlinkSync(this.file(id)); }
}
module.exports = { FolderTransport };
