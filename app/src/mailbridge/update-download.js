const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
function verifyManifest(envelope, publicKey) {
  const payload = Buffer.from(envelope.payload || '', 'base64');
  if (!crypto.verify(null, payload, publicKey, Buffer.from(envelope.signature || '', 'base64')))
    throw new Error('The update signature is invalid. The installed app has not been changed.');
  const value = JSON.parse(payload);
  if (!/^\d+\.\d+\.\d+$/.test(value.version) || !/^[a-f0-9]{64}$/.test(value.sha256) || !Number.isSafeInteger(value.size) || value.size <= 0 || value.size > 1024 ** 3 || !/^https?:\/\//.test(value.url))
    throw new Error('Invalid update metadata');
  return value;
}
function newerVersion(candidate, installed) {
  const left = candidate.split('.').map(Number), right = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) { if (left[i] !== right[i]) return left[i] > right[i]; }
  return false;
}
async function downloadUpdate(manifest, directory, onProgress = () => {}) {
  await fs.promises.mkdir(directory, { recursive: true });
  const target = path.join(directory, `MailBridge-Setup-${manifest.version}-${manifest.sha256.slice(0, 12)}.exe`);
  const partial = `${target}.${crypto.randomUUID()}.partial`;
  const response = await fetch(manifest.url, { signal: AbortSignal.timeout(20 * 60 * 1000) });
  if (!response.ok) throw new Error(`Update download failed (${response.status})`);
  const hash = crypto.createHash('sha256');
  let bytes = 0;
  let lastReport = 0;
  try {
    await pipeline(Readable.fromWeb(response.body), new Transform({ transform(chunk, _, callback) {
      bytes += chunk.length;
      if (bytes > manifest.size) return callback(new Error('The update size does not match its signed metadata.'));
      hash.update(chunk);
      if (Date.now() - lastReport > 500) { lastReport = Date.now(); onProgress(Math.floor(bytes / manifest.size * 100)); }
      callback(null, chunk);
    } }), fs.createWriteStream(partial, { flags: 'wx' }));
    if (bytes !== manifest.size || hash.digest('hex') !== manifest.sha256) throw new Error('The update checksum does not match. The installed app has not been changed.');
    await fs.promises.rename(partial, target);
    return target;
  } finally { await fs.promises.unlink(partial).catch(() => {}); }
}
module.exports = { verifyManifest, newerVersion, downloadUpdate };
