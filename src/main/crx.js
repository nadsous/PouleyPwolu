// Installation d'extensions du Chrome Web Store, sans Chrome.
// - download : récupère le fichier .crx chez Google (seulement quand tu
//   installes ou mets à jour une extension).
// - verify : vérifie la signature CRX3 du développeur. L'identifiant d'une
//   extension est l'empreinte de sa clé publique : un fichier modifié ou une
//   autre extension sont refusés.
// - extract : décompresse le zip sans sortir du dossier cible.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ID_RE = /\b([a-p]{32})\b/;

function idFromInput(text) {
  const m = ID_RE.exec(String(text || ''));
  return m ? m[1] : null;
}

const crxUrl = (id, chromeVersion) =>
  `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
const updateUrl = (id, version, chromeVersion) =>
  `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=${chromeVersion}&acceptformat=crx2,crx3&x=id%3D${id}%26v%3D${version}%26uc`;

// ── Protobuf minimal (en-tête CRX3)
function readVarint(buf, pos) {
  let result = 0;
  let shift = 0;
  for (;;) {
    if (pos >= buf.length) throw new Error('en-tête CRX tronqué');
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
  }
}
function fields(buf) {
  const out = [];
  let pos = 0;
  while (pos < buf.length) {
    let key;
    [key, pos] = readVarint(buf, pos);
    const num = Math.floor(key / 8);
    const type = key & 7;
    if (type === 2) {
      let len;
      [len, pos] = readVarint(buf, pos);
      out.push([num, buf.subarray(pos, pos + len)]);
      pos += len;
    } else if (type === 0) {
      [, pos] = readVarint(buf, pos);
    } else if (type === 5) pos += 4;
    else if (type === 1) pos += 8;
    else throw new Error('en-tête CRX illisible');
  }
  return out;
}

// Empreinte → identifiant Chrome (chiffres hexadécimaux 0-f écrits a-p).
const idFromKey = (der) => [...crypto.createHash('sha256').update(der).digest().subarray(0, 16)]
  .map((b) => String.fromCharCode(97 + (b >> 4)) + String.fromCharCode(97 + (b & 15))).join('');

function verify(crx, expectedId) {
  if (crx.length < 12 || crx.toString('latin1', 0, 4) !== 'Cr24') throw new Error('Ce fichier n’est pas une extension Chrome.');
  if (crx.readUInt32LE(4) !== 3) throw new Error('Format d’extension trop ancien (CRX2).');
  const headerLen = crx.readUInt32LE(8);
  const header = crx.subarray(12, 12 + headerLen);
  const archive = crx.subarray(12 + headerLen);
  const top = fields(header);
  const signedData = (top.find(([n]) => n === 10000) || [])[1];
  if (!signedData) throw new Error('Extension non signée.');
  const crxId = (fields(signedData).find(([n]) => n === 1) || [])[1];
  if (!crxId || crxId.length !== 16) throw new Error('Identifiant de signature absent.');
  const msg = Buffer.concat([Buffer.from('CRX3 SignedData\x00', 'latin1'), Buffer.alloc(4), signedData, archive]);
  msg.writeUInt32LE(signedData.length, 16);
  for (const [n, proof] of top) {
    if (n !== 2) continue; // sha256_with_rsa
    const parts = fields(proof);
    const pub = (parts.find(([k]) => k === 1) || [])[1];
    const sig = (parts.find(([k]) => k === 2) || [])[1];
    if (!pub || !sig) continue;
    if (!crypto.createHash('sha256').update(pub).digest().subarray(0, 16).equals(crxId)) continue;
    const key = crypto.createPublicKey({ key: pub, format: 'der', type: 'spki' });
    if (!crypto.verify('sha256', msg, key, sig)) throw new Error('Signature invalide : le fichier a été modifié.');
    const id = idFromKey(pub);
    if (expectedId && id !== expectedId) throw new Error('Ce fichier ne correspond pas à l’extension demandée.');
    return { id, key: pub.toString('base64'), archive };
  }
  throw new Error('Aucune signature du développeur trouvée.');
}

// ── Zip (méthodes « stocké » et « deflate »)
function extract(zip, dest) {
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archive de l’extension illisible.');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const root = path.resolve(dest);
  fs.mkdirSync(root, { recursive: true });
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('Archive de l’extension abîmée.');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    const target = path.resolve(root, name.replace(/\\/g, '/'));
    if (target !== root && !target.startsWith(root + path.sep)) throw new Error('Archive dangereuse (chemin hors du dossier).');
    if (name.endsWith('/')) { fs.mkdirSync(target, { recursive: true }); continue; }
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compSize);
    const data = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!data) throw new Error('Compression non gérée dans l’archive.');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, data);
  }
}

// Décompresse et ajoute la clé publique au manifeste, pour que l'extension
// garde son vrai identifiant (certaines en dépendent pour se connecter).
function unpack(crx, expectedId, dest) {
  const { id, key, archive } = verify(crx, expectedId);
  fs.rmSync(dest, { recursive: true, force: true });
  extract(archive, dest);
  const mfile = path.join(dest, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mfile, 'utf8').replace(/^﻿/, ''));
  manifest.key = key;
  fs.writeFileSync(mfile, JSON.stringify(manifest, null, 2));
  return { id, manifest };
}

// Nom lisible : les manifestes utilisent souvent __MSG_nom__ (fichiers _locales).
function localized(dir, manifest, value) {
  const m = /^__MSG_(\w+)__$/.exec(String(value || ''));
  if (!m) return value || '';
  for (const loc of ['fr', manifest.default_locale, 'en'].filter(Boolean)) {
    try {
      const msgs = JSON.parse(fs.readFileSync(path.join(dir, '_locales', loc, 'messages.json'), 'utf8'));
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (hit) return hit[1].message;
    } catch {}
  }
  return m[1];
}

module.exports = { idFromInput, crxUrl, updateUrl, verify, unpack, localized, idFromKey };
