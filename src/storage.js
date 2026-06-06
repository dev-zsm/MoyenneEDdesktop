const fs = require('fs');
const path = require('path');
const { safeStorage } = require('electron');

let storePath = null;

function init(app) {
  storePath = path.join(app.getPath('userData'), 'session.bin');
}

function save(payload) {
  if (!storePath) throw new Error('storage non initialisé');
  if (!safeStorage.isEncryptionAvailable()) {
    return { ok: false, error: 'Chiffrement OS indisponible' };
  }
  const json = JSON.stringify(payload);
  const enc = safeStorage.encryptString(json);
  fs.writeFileSync(storePath, enc);
  return { ok: true };
}

function load() {
  if (!storePath) return null;
  if (!fs.existsSync(storePath)) return null;
  if (!safeStorage.isEncryptionAvailable()) return null;
  try {
    const buf = fs.readFileSync(storePath);
    const json = safeStorage.decryptString(buf);
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function clear() {
  if (storePath && fs.existsSync(storePath)) fs.unlinkSync(storePath);
  return { ok: true };
}

module.exports = { init, save, load, clear };
