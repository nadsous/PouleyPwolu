// Coffre à mots de passe de PouleyPwolu.
//
// - Un mot de passe maître, jamais enregistré, passe par scrypt (128 Mo de
//   mémoire par essai, ce qui rend les attaques par carte graphique très
//   lentes) pour donner une clé qui déverrouille la clé du coffre.
// - Les identifiants sont chiffrés en AES-256-GCM avec la clé du coffre.
// - Option Windows Hello : une copie de la clé du coffre est protégée par
//   Windows (DPAPI) et ne sert qu'après confirmation par Windows Hello
//   (visage, empreinte ou code PIN).
// - Déverrouillé, la clé ne vit que dans la mémoire du processus principal.
//   Les pages web n'y ont jamais accès : elles reçoivent seulement
//   l'identifiant de leur propre site, après un clic de ta part.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { seal, unseal, writeAtomic, windowsProtect, windowsUnprotect } = require('./seal');

const KDF = { alg: 'scrypt', N: 131072, r: 8, p: 1 };
const AAD_KEY = 'pouley-coffre-cle';
const AAD_DATA = 'pouley-coffre-donnees';

const b64 = (b) => Buffer.from(b).toString('base64');
const unb64 = (s) => Buffer.from(String(s || ''), 'base64');

function derive(master, kdf) {
  if (kdf.alg !== 'scrypt') return Promise.reject(new Error('Format de coffre inconnu.'));
  return new Promise((resolve, reject) => {
    const pw = Buffer.from(String(master).normalize('NFC'), 'utf8');
    crypto.scrypt(pw, unb64(kdf.salt), 32, { N: kdf.N, r: kdf.r, p: kdf.p, maxmem: 256 * 1024 * 1024 }, (err, key) => {
      pw.fill(0);
      if (err) reject(err); else resolve(key);
    });
  });
}

// ── Windows Hello (UserConsentVerifier) via PowerShell
const HELLO_PS = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | ? { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
function Await($op, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op)); $t.Wait(-1) | Out-Null; $t.Result }
$null = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
$V = [Windows.Security.Credentials.UI.UserConsentVerifier]
if ($mode -eq 'check') { Await ($V::CheckAvailabilityAsync()) ([Windows.Security.Credentials.UI.UserConsentVerifierAvailability]) }
else { Await ($V::RequestVerificationAsync('PouleyPwolu veut ouvrir ton coffre à mots de passe')) ([Windows.Security.Credentials.UI.UserConsentVerificationResult]) }
`;
function hello(mode) {
  if (process.platform !== 'win32') return Promise.resolve('NotSupported');
  return new Promise((resolve) => {
    // -EncodedCommand ne prend pas d'argument : le mode est écrit dans le script.
    const script = `$mode = '${mode === 'check' ? 'check' : 'ask'}'\n` + HELLO_PS;
    const encoded = Buffer.from(script, 'utf16le').toString('base64');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], { windowsHide: true });
    let out = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.on('error', () => resolve('NotSupported'));
    ps.on('close', () => resolve(out.trim().split(/\r?\n/).pop() || 'Failed'));
    setTimeout(() => { try { ps.kill(); } catch {} }, mode === 'check' ? 15000 : 120000);
  });
}

class Vault {
  constructor(dir) {
    this.file = path.join(dir, 'pouley-coffre.enc');
    this.box = null; // contenu du fichier (non secret : paramètres + données chiffrées)
    this.key = null; // clé du coffre, seulement quand il est ouvert
    this.items = null;
    this.fails = 0;
    this.blockedUntil = 0;
    this.helloAvailable = null;
    try { this.box = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { this.box = null; }
  }

  exists() { return !!(this.box && this.box.master); }
  isOpen() { return !!this.key; }
  hasHello() { return !!(this.box && this.box.windows); }

  status() {
    return {
      exists: this.exists(),
      open: this.isOpen(),
      hello: this.hasHello(),
      helloAvailable: this.helloAvailable,
      count: this.items ? this.items.length : null,
      blockedFor: Math.max(0, Math.ceil((this.blockedUntil - Date.now()) / 1000)),
    };
  }

  async checkHello() {
    if (this.helloAvailable === null) this.helloAvailable = (await hello('check')) === 'Available';
    return this.helloAvailable;
  }

  async create(master, { useHello } = {}) {
    if (this.exists()) throw new Error('Le coffre existe déjà.');
    if (String(master || '').length < 8) throw new Error('Le mot de passe maître doit faire au moins 8 caractères.');
    const kdf = { ...KDF, salt: b64(crypto.randomBytes(16)) };
    const key = crypto.randomBytes(32);
    const kek = await derive(master, kdf);
    this.box = { v: 1, kdf, master: b64(seal(key, kek, AAD_KEY)), windows: null, data: null };
    this.key = key;
    this.items = [];
    if (useHello) this.box.windows = b64(windowsProtect(key));
    this.save();
  }

  async unlock(master) {
    if (!this.exists()) throw new Error('Aucun coffre.');
    const wait = this.blockedUntil - Date.now();
    if (wait > 0) throw new Error(`Trop d’essais. Réessaie dans ${Math.ceil(wait / 1000)} s.`);
    const kek = await derive(master, this.box.kdf);
    let key;
    try {
      key = unseal(unb64(this.box.master), kek, AAD_KEY);
    } catch {
      this.fails++;
      // Après 3 erreurs, chaque essai attend de plus en plus longtemps.
      if (this.fails >= 3) this.blockedUntil = Date.now() + Math.min(300, 2 ** (this.fails - 2)) * 1000;
      throw new Error('Mot de passe maître incorrect.');
    }
    this.fails = 0;
    this.openWith(key);
  }

  async unlockHello() {
    if (!this.hasHello()) throw new Error('Windows Hello n’est pas activé pour le coffre.');
    const r = await hello('ask');
    if (r !== 'Verified') throw new Error(r === 'Canceled' ? 'Annulé.' : 'Windows Hello n’a pas confirmé ton identité.');
    let key;
    try {
      key = windowsUnprotect(unb64(this.box.windows));
    } catch {
      throw new Error('La clé Windows est illisible : utilise ton mot de passe maître.');
    }
    this.openWith(key);
  }

  openWith(key) {
    const items = this.box.data ? JSON.parse(unseal(unb64(this.box.data), key, AAD_DATA).toString('utf8')) : [];
    this.key = key;
    this.items = Array.isArray(items) ? items : [];
  }

  lock() {
    if (this.key) this.key.fill(0);
    this.key = null;
    this.items = null;
  }

  save() {
    if (!this.key) return;
    this.box.data = b64(seal(Buffer.from(JSON.stringify(this.items)), this.key, AAD_DATA));
    writeAtomic(this.file, JSON.stringify(this.box));
  }

  async changeMaster(oldMaster, newMaster) {
    if (String(newMaster || '').length < 8) throw new Error('Le nouveau mot de passe doit faire au moins 8 caractères.');
    const kek = await derive(oldMaster, this.box.kdf);
    let key;
    try { key = unseal(unb64(this.box.master), kek, AAD_KEY); } catch { throw new Error('Ancien mot de passe incorrect.'); }
    const kdf = { ...KDF, salt: b64(crypto.randomBytes(16)) };
    this.box.kdf = kdf;
    this.box.master = b64(seal(key, await derive(newMaster, kdf), AAD_KEY));
    this.openWith(key);
    this.save();
  }

  setHello(on) {
    if (!this.key) throw new Error('Ouvre d’abord le coffre.');
    this.box.windows = on ? b64(windowsProtect(this.key)) : null;
    this.save();
  }

  destroy() {
    this.lock();
    this.box = null;
    try { fs.unlinkSync(this.file); } catch {}
  }

  // ── Identifiants
  need() { if (!this.key) throw new Error('Le coffre est verrouillé.'); }

  list() {
    this.need();
    return this.items.map(({ password, ...rest }) => ({ ...rest, strength: strength(password) }));
  }

  get(id) {
    this.need();
    return this.items.find((x) => x.id === id) || null;
  }

  forSite(site) {
    this.need();
    return this.items.filter((x) => x.site === site).sort((a, b) => (b.used || 0) - (a.used || 0));
  }

  upsert({ id, origin, site, username = '', password = '', note = '' }) {
    this.need();
    const now = Date.now();
    let item = id ? this.items.find((x) => x.id === id) : this.items.find((x) => x.site === site && x.username === username);
    if (item) Object.assign(item, { origin: origin || item.origin, site: site || item.site, username, password, note, updated: now });
    else {
      item = { id: 'k' + crypto.randomBytes(6).toString('hex'), origin, site, username, password, note, created: now, updated: now, used: 0 };
      this.items.push(item);
    }
    this.save();
    return item;
  }

  touch(id) {
    const item = this.get(id);
    if (item) { item.used = Date.now(); this.save(); }
  }

  remove(id) {
    this.need();
    this.items = this.items.filter((x) => x.id !== id);
    this.save();
  }

  // Mots de passe faibles ou utilisés sur plusieurs sites.
  audit() {
    this.need();
    const byPw = new Map();
    for (const x of this.items) {
      if (!byPw.has(x.password)) byPw.set(x.password, []);
      byPw.get(x.password).push(x.id);
    }
    const reused = new Set([...byPw.values()].filter((ids) => ids.length > 1).flat());
    return this.items.map((x) => ({ id: x.id, weak: strength(x.password) < 2, reused: reused.has(x.id) }));
  }
}

// Force approximative : 0 très faible … 4 très fort.
function strength(pw) {
  pw = String(pw || '');
  if (!pw) return 0;
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/\d/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  let bits = pw.length * Math.log2(pool || 1);
  if (/^(.)\1+$/.test(pw) || /^(?:123|azerty|qwerty|password|motdepasse|admin)/i.test(pw)) bits = Math.min(bits, 20);
  return bits < 36 ? 0 : bits < 50 ? 1 : bits < 64 ? 2 : bits < 90 ? 3 : 4;
}

// Générateur : caractères tirés par crypto.randomInt (aucun biais).
function generate({ length = 20, symbols = true } = {}) {
  const sets = ['abcdefghijkmnopqrstuvwxyz', 'ABCDEFGHJKLMNPQRSTUVWXYZ', '23456789'];
  if (symbols) sets.push('-_.!@#$%&*+=?');
  const all = sets.join('');
  const n = Math.max(12, Math.min(64, length));
  const out = sets.map((s) => s[crypto.randomInt(s.length)]);
  while (out.length < n) out.push(all[crypto.randomInt(all.length)]);
  for (let i = out.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

// CSV exporté par Chrome, Comet, Edge, Brave, Opera (name,url,username,password,note).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const head = (rows.shift() || []).map((x) => x.trim().toLowerCase());
  const col = (names) => head.findIndex((h) => names.includes(h));
  const iu = col(['url', 'login_uri', 'website', 'origin']);
  const in_ = col(['username', 'login_username', 'login', 'user', 'email']);
  const ip = col(['password', 'login_password']);
  const io = col(['note', 'notes', 'extra']);
  if (iu < 0 || ip < 0) throw new Error('Ce fichier ne ressemble pas à un export de mots de passe (colonnes url et password introuvables).');
  return rows.filter((r) => r[ip]).map((r) => ({ url: r[iu] || '', username: in_ >= 0 ? r[in_] || '' : '', password: r[ip], note: io >= 0 ? r[io] || '' : '' }));
}

module.exports = { Vault, strength, generate, parseCsv, hello };
