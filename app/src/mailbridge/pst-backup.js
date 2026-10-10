const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');

async function exportPstBackup({ root, destination, executable, signal, onProgress = () => {}, spawnExporter = spawn, idleTimeoutMs = 15 * 60 * 1000 }) {
  await fs.promises.mkdir(destination, { recursive: true });
  const id = crypto.randomUUID();
  const staging = path.join(destination, `.mailbridge-incomplete-${id}`);
  await fs.promises.mkdir(staging);
  onProgress({ message: 'Preparing PST backup…', count: 0 });
  let complete;
  let child;
  let timeout;
  let failure;
  let cancelTimeout;
  const cancel = () => {
    failure = new Error('Backup canceled. Previous completed backups are unchanged.');
    try { fs.writeFileSync(path.join(staging, 'cancel-request'), 'cancel'); } catch {}
    cancelTimeout = setTimeout(() => child?.kill(), 3000);
  };
  const touch = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => { failure = new Error('Outlook stopped reporting backup progress. Check its profile or password prompts and retry.'); child.kill(); }, idleTimeoutMs);
  };
  try {
    if (signal?.aborted) throw new Error('Backup canceled.');
    child = spawnExporter(executable, [root, staging], { windowsHide: true });
    signal?.addEventListener('abort', cancel, { once: true });
    let stderr = '';
    child.stderr.on('data', data => { stderr = (stderr + data).slice(-12000); });
    const exit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 && !failure ? resolve() : reject(failure || new Error(stderr.trim() || `PST exporter exited with code ${code}`)));
    });
    // Observe rejection immediately while stdout is consumed.
    exit.catch(() => {});
    touch();
    for await (const line of readline.createInterface({ input: child.stdout })) {
      touch();
      let progress;
      try { progress = JSON.parse(line); } catch { continue; }
      if (progress.complete) complete = progress;
      else onProgress(progress);
    }
    await exit;
    if (!complete || !Number.isInteger(complete.count) || complete.count <= 0 || complete.count !== complete.total || !Array.isArray(complete.files) || !complete.files.length)
      throw new Error('The PST backup did not finish. Previous backups are unchanged.');
    for (const name of complete.files) {
      if (!/^MailBridge(?:-part[0-9]+)?\.pst$/.test(name)) throw new Error('Invalid PST backup filename');
      const file = await fs.promises.open(path.join(staging, name), 'r');
      try {
        const signature = Buffer.alloc(4);
        await file.read(signature, 0, 4, 0);
        if (signature.toString('hex') !== '2142444e') throw new Error('The backup contains an invalid PST file');
      } finally { await file.close(); }
    }
    await fs.promises.writeFile(path.join(staging, 'backup.json'), JSON.stringify({ ...complete, completedAt: Date.now() }, null, 2));
    const completed = path.join(destination, `MailBridge-${new Date().toISOString().replace(/[:.]/g, '-')}-${id.slice(0, 8)}`);
    for (let attempt = 0; ; attempt++) {
      try { await fs.promises.rename(staging, completed); break; }
      catch (error) {
        if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code) || attempt >= 10) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return { count: complete.count, path: completed, completedAt: Date.now() };
  } finally {
    clearTimeout(timeout);
    clearTimeout(cancelTimeout);
    signal?.removeEventListener('abort', cancel);
  }
}
module.exports = { exportPstBackup };
