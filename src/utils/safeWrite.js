const fs = require('fs');
const fsp = require('fs').promises;

/**
 * Crash-safe JSON writes.
 *
 * Strategy: write to "<file>.tmp", fsync to disk, then atomic rename.
 * If power is lost mid-write the original file is never partially overwritten
 * — either the rename completed (new file present) or it didn't (old file
 * intact). Without this, a debounced writeFile in stateProxy could leave a
 * truncated state-proxy.json on disk after a power cut.
 */

async function safeWriteJson(filePath, data) {
  const tmp = filePath + '.tmp';
  const payload = JSON.stringify(data, null, 2);
  const handle = await fsp.open(tmp, 'w');
  try {
    await handle.writeFile(payload);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fsp.rename(tmp, filePath);
}

function safeWriteJsonSync(filePath, data) {
  const tmp = filePath + '.tmp';
  const payload = JSON.stringify(data, null, 2);
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, payload);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, filePath);
}

module.exports = { safeWriteJson, safeWriteJsonSync };
