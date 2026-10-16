// Chiffrement local de PouleyPwolu.
// - seal / unseal : AES-256-GCM (chiffre et détecte toute modification).
// - dataKey : clé aléatoire de 32 octets qui chiffre tes onglets, favoris et
//   poulaillers. Elle est elle-même protégée par Windows (DPAPI, via
//   safeStorage) : elle n'est lisible que depuis ta session Windows.
// - shred : écrase un fichier avant de le supprimer.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

const MAGIC = Buffer.from('PLY1');

function seal(plain, key, aad) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  if (aad) c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, c.getAuthTag(), ct]);
}

function unseal(buf, key, aad) {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('format inconnu');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
  if (aad) d.setAAD(Buffer.from(aad));
  d.setAuthTag(buf.subarray(16, 32));
  return Buffer.concat([d.update(buf.subarray(32)), d.final()]);
}

function writeAtomic(file, data) {
  const tmp = file + '.tmp';
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

function shred(file) {
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r+');
    try {
      fs.writeSync(fd, crypto.randomBytes(Math.max(1, size)), 0, Math.max(1, size), 0);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  } catch {}
  try { fs.unlinkSync(file); } catch {}
}

const windowsProtect = (buf) => safeStorage.encryptString(buf.toString('base64'));
const windowsUnprotect = (buf) => Buffer.from(safeStorage.decryptString(buf), 'base64');

let dataKey;
let keyProblem = null;
// Renvoie la clé de données (créée au premier lancement), ou null si Windows
// ne peut pas protéger de clé (le stockage reste alors en clair).
function getDataKey() {
  if (dataKey !== undefined) return dataKey;
  dataKey = null;
  if (!safeStorage.isEncryptionAvailable()) {
    keyProblem = 'unavailable';
    return null;
  }
  const file = path.join(app.getPath('userData'), 'pouley-cle.bin');
  if (fs.existsSync(file)) {
    try {
      const k = windowsUnprotect(fs.readFileSync(file));
      if (k.length === 32) return (dataKey = k);
    } catch {}
    // Clé illisible (profil Windows changé) : on garde l'ancienne de côté.
    keyProblem = 'lost';
    try { fs.renameSync(file, file + '.illisible-' + Date.now()); } catch {}
  }
  const k = crypto.randomBytes(32);
  writeAtomic(file, windowsProtect(k));
  return (dataKey = k);
}

module.exports = { seal, unseal, writeAtomic, shred, getDataKey, windowsProtect, windowsUnprotect, keyProblem: () => keyProblem };
