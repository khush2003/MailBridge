const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Transform } = require('stream');
const { pipeline } = require('stream/promises');
const readline = require('readline');
const { spawn } = require('child_process');

async function importOutlookPst({
  source,
  root,
  script,
  importRecord,
  onProgress,
  signal,
  idleTimeoutMs = 15 * 60 * 1000,
  spawnExporter = spawn,
}) {
  const temporary = path.join(root, 'imports');
  const snapshot = path.join(temporary, `outlook-${crypto.randomUUID()}.pst`);
  let child;
  let exporterFinished;
  let cancelTimer;
  const cancelPath = `${snapshot}.cancel`;
  let idleTimer;
  let timeoutError;
  let count = 0;
  let warnings = 0;
  const abort = () => {
    if (!child) return;
    try { fs.writeFileSync(cancelPath, 'cancel'); } catch {}
    cancelTimer = setTimeout(() => child.kill(), 3000);
  };
  const checkCanceled = () => {
    if (signal.aborted) {
      const error = new Error('Import canceled. Any messages already imported are kept.');
      error.name = 'AbortError';
      throw error;
    }
  };
  try {
    checkCanceled();
    await fs.promises.mkdir(temporary, { recursive: true });
    const { size } = await fs.promises.stat(source);
    if (typeof fs.promises.statfs === 'function') {
      const disk = await fs.promises.statfs(temporary).catch(() => null);
      if (disk && disk.bavail * disk.bsize < size) {
        throw new Error(
          'Not enough free disk space to copy this PST. Free space for the temporary PST copy and the imported mail, then try again.'
        );
      }
    }
    let copied = 0;
    let lastUpdate = 0;
    const reportCopy = () =>
      onProgress({
        count,
        warnings,
        message: `Copying PST: ${Math.floor(size ? (copied / size) * 100 : 100)}% (${(copied / 1024 ** 3).toFixed(1)} of ${(size / 1024 ** 3).toFixed(1)} GB). Your original is unchanged.`,
      });
    reportCopy();
    const progress = new Transform({
      transform(chunk, encoding, done) {
        copied += chunk.length;
        if (Date.now() - lastUpdate >= 1000) {
          reportCopy();
          lastUpdate = Date.now();
        }
        done(null, chunk);
      },
    });
    await pipeline(
      fs.createReadStream(source),
      progress,
      fs.createWriteStream(snapshot, { flags: 'wx' }),
      { signal }
    );
    reportCopy();
    checkCanceled();
    onProgress({
      count,
      warnings,
      message:
        'Starting classic Outlook. Complete any Outlook profile or password prompts that appear.',
    });
    child = spawnExporter(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        script,
        '-PstPath',
        snapshot,
        '-OutputDirectory',
        temporary,
        '-CancelPath',
        cancelPath,
      ],
      { windowsHide: true }
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    let failure = '';
    child.stderr.on('data', (bytes) => {
      failure = (failure + bytes.toString('utf8')).slice(-2000);
    });
    const finished = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    exporterFinished = finished;
    finished.catch(() => {});
    const resetIdle = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        timeoutError = new Error(
          `Outlook has not responded for ${Math.ceil(idleTimeoutMs / 60000)} minutes. Open classic Outlook, complete any profile or password prompts, then retry the import. Already imported messages are kept.`
        );
        child.kill();
      }, idleTimeoutMs);
      idleTimer.unref?.();
    };
    resetIdle();
    for await (const line of readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })) {
      checkCanceled();
      if (!line.trim()) continue;
      resetIdle();
      const record = JSON.parse(line);
      if (record.progress) {
        onProgress({ count, warnings, message: record.progress });
        continue;
      }
      if (record.warning) {
        warnings++;
        onProgress({
          count,
          warnings,
          message: `Imported ${count} messages; ${warnings} export warnings. Keep your original PST.`,
        });
        continue;
      }
      if (
        typeof record.file !== 'string' ||
        path.basename(record.file) !== record.file ||
        !/\.eml$/i.test(record.file)
      ) {
        throw new Error('Outlook returned an invalid exported message filename.');
      }
      await importRecord(record);
      await fs.promises.unlink(path.join(temporary, record.file));
      count++;
      onProgress({
        count,
        warnings,
        message: `Imported ${count} messages; ${warnings} export warnings. Large PSTs can take a long time.`,
      });
      resetIdle();
    }
    const code = await finished;
    checkCanceled();
    if (timeoutError) throw timeoutError;
    if (code !== 0)
      throw new Error(
        failure ||
          'Outlook export failed. Check that classic Outlook is installed and its profile opens normally.'
      );
    return { count, warnings };
  } catch (error) {
    if (signal.aborted) checkCanceled();
    throw error;
  } finally {
    clearTimeout(idleTimer);
    signal.removeEventListener('abort', abort);
    if (signal.aborted && child && child.exitCode === null && exporterFinished) {
      await exporterFinished.catch(() => {});
    }
    clearTimeout(cancelTimer);
    if (child && child.exitCode === null) child.kill();
    await fs.promises.unlink(cancelPath).catch(() => {});
    // Preserve failed EML exports; the disposable PST is never the user's source.
    await fs.promises.unlink(snapshot).catch(() => {});
  }
}

module.exports = { importOutlookPst };
