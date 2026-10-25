// Passage au moteur Chromium. La 0.1.12 est la dernière version Electron : quand une
// version Chromium de PouleyPwolu est publiée sur GitHub (fichier moteur.json dans la
// dernière version), elle :
// 1. copie onglets, favoris, poulaillers, réglages, extensions et mots de passe dans
//    %LOCALAPPDATA%\PouleyPwolu\Migration, chiffrés (AES-256-GCM) par une clé que seule
//    ta session Windows peut relire (DPAPI) ;
// 2. télécharge l'installateur Chromium et vérifie son empreinte SHA-256 ;
// 3. le lance puis se ferme : l'installateur retire cette version Electron et le nouveau
//    navigateur importe le dossier au premier démarrage, puis l'efface.
// Le format est décrit dans docs/migration-electron.md : le patch Chromium le relit.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { app, net } = require('electron');
const { seal, writeAtomic, shred } = require('./seal');

const LATEST = 'https://api.github.com/repos/nadsous/PouleyPwolu/releases/latest';
const DIR = path.join(process.env.LOCALAPPDATA || app.getPath('userData'), 'PouleyPwolu', 'Migration');
const ENTROPY = 'pouley-migration';
const AAD_STATE = 'pouley-migration-etat';
const AAD_PASSWORDS = 'pouley-migration-mdp';

// DPAPI (portée utilisateur) via PowerShell : Node n'y a pas accès directement.
// La clé passe par l'entrée standard, jamais par la ligne de commande.
function dpapiProtect(buf) {
  const script = "Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); " +
    `$e=[Text.Encoding]::UTF8.GetBytes('${ENTROPY}'); ` +
    "[Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$e,'CurrentUser')))";
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true });
    let out = '';
    let err = '';
    ps.stdout.on('data', (d) => { out += d; });
    ps.stderr.on('data', (d) => { err += d; });
    ps.on('error', reject);
    ps.on('close', (code) => {
      const res = Buffer.from(out.trim(), 'base64');
      if (code || !res.length) reject(new Error('Windows n’a pas pu protéger la clé de migration. ' + err.trim().split(/\r?\n/)[0]));
      else resolve(res);
    });
    ps.stdin.end(buf.toString('base64'));
  });
}

// Format CSV de Chrome : name,url,username,password,note.
function toCsv(items) {
  const cell = (v) => {
    const s = String(v == null ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const rows = [['name', 'url', 'username', 'password', 'note']];
  for (const x of items) rows.push([x.site || '', x.origin || (x.site ? 'https://' + x.site : ''), x.username, x.password, x.note]);
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

const tabOut = (t) => ({ url: t.url, title: t.title, pinned: !!t.pinned, groupId: t.groupId || null });

function snapshotState(state, extensions) {
  return {
    settings: state.settings,
    activePoulailler: state.activePoulailler,
    poulaillers: state.poulaillers.map((p) => ({
      id: p.id, name: p.name, color: p.color, icon: p.icon, isolated: !!p.isolated,
      groups: (p.groups || []).map((g) => ({ id: g.id, name: g.name, color: g.color, collapsed: !!g.collapsed })),
      tabs: p.tabs.filter((t) => !t.ephemeral && /^https?:/.test(t.url || '')).map(tabOut),
    })),
    favorites: state.favorites.filter((t) => /^https?:/.test(t.url || '')).map(tabOut),
    extensions,
  };
}

async function fetchJson(url) {
  const r = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'PouleyPwolu' } });
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return r.json();
}

// Télécharge en vérifiant l'empreinte ; le fichier n'apparaît qu'une fois vérifié.
async function download(url, file, sha256, size, onProgress) {
  const r = await net.fetch(url);
  if (!r.ok || !r.body) throw new Error('Téléchargement impossible (' + r.status + ').');
  const tmp = file + '.partiel';
  const out = fs.createWriteStream(tmp);
  const hash = crypto.createHash('sha256');
  let got = 0;
  try {
    for await (const chunk of r.body) {
      hash.update(chunk);
      got += chunk.length;
      if (!out.write(chunk)) await new Promise((res) => out.once('drain', res));
      if (size) onProgress(got / size);
    }
  } finally {
    await new Promise((res) => out.end(res));
  }
  if (hash.digest('hex') !== String(sha256).toLowerCase()) {
    fs.rmSync(tmp, { force: true });
    throw new Error('L’installateur téléchargé est abîmé (empreinte différente) : réessaie plus tard.');
  }
  fs.renameSync(tmp, file);
}

class EngineSwitch {
  // getState : état du store ; getVault : coffre (ou null) ; listExtensions : extensions installées ;
  // send(payload) : informe l'interface ; beforeQuit : enregistre tout avant de fermer.
  constructor({ getState, getVault, listExtensions, send, beforeQuit }) {
    Object.assign(this, { getState, getVault, listExtensions, send, beforeQuit });
    this.offer = null; // { version, installerUrl, sha256, size, name }
    this.busy = false;
  }

  status() { return { available: !!this.offer, version: this.offer && this.offer.version, busy: this.busy }; }

  // Cherche une version Chromium publiée. Silencieux en cas d'erreur réseau.
  async check() {
    if (process.platform !== 'win32' || this.busy) return this.status();
    try {
      const rel = await fetchJson(LATEST);
      const assets = rel.assets || [];
      const meta = assets.find((a) => a.name === 'moteur.json');
      if (!meta) { this.offer = null; return this.status(); }
      const m = await fetchJson(meta.browser_download_url);
      const inst = assets.find((a) => a.name === m.installer);
      if (m.format !== 1 || !inst || !/^[0-9a-f]{64}$/i.test(m.sha256 || '')) { this.offer = null; return this.status(); }
      this.offer = { version: m.version, name: m.installer, installerUrl: inst.browser_download_url, sha256: m.sha256, size: inst.size };
      this.send({ ...this.status(), stage: 'offer' });
    } catch (err) {
      console.warn('[moteur]', err.message);
    }
    return this.status();
  }

  // Écrit le dossier de migration. Renvoie le nombre d'éléments copiés.
  async exportData() {
    const vault = this.getVault();
    const passwords = vault && vault.exists() ? vault.items.map((x) => ({ ...x })) : [];
    fs.rmSync(DIR, { recursive: true, force: true });
    fs.mkdirSync(DIR, { recursive: true });
    const key = crypto.randomBytes(32);
    try {
      const state = snapshotState(this.getState(), this.listExtensions());
      writeAtomic(path.join(DIR, 'cle.dpapi'), await dpapiProtect(key));
      writeAtomic(path.join(DIR, 'etat.bin'), seal(Buffer.from(JSON.stringify(state)), key, AAD_STATE));
      if (passwords.length) writeAtomic(path.join(DIR, 'mots-de-passe.bin'), seal(Buffer.from(toCsv(passwords)), key, AAD_PASSWORDS));
      const counts = {
        poulaillers: state.poulaillers.length,
        onglets: state.poulaillers.reduce((n, p) => n + p.tabs.length, 0),
        favoris: state.favorites.length,
        extensions: state.extensions.length,
        motsDePasse: passwords.length,
      };
      // manifest.json en dernier : sa présence signifie que le dossier est complet.
      writeAtomic(path.join(DIR, 'manifest.json'), JSON.stringify({
        format: 1, depuis: app.getVersion(), creeLe: new Date().toISOString(),
        etat: 'etat.bin', motsDePasse: passwords.length ? 'mots-de-passe.bin' : null, compte: counts,
      }, null, 2));
      return counts;
    } finally {
      key.fill(0);
      for (const p of passwords) p.password = '';
    }
  }

  // Tout le passage. Renvoie { need: 'vault' } si le coffre doit d'abord être ouvert.
  async run() {
    if (!this.offer) return { error: 'Aucune version Chromium disponible pour l’instant.' };
    const vault = this.getVault();
    if (vault && vault.exists() && !vault.isOpen()) return { need: 'vault' };
    if (this.busy) return { busy: true };
    this.busy = true;
    try {
      this.send({ ...this.status(), stage: 'export' });
      const counts = await this.exportData();
      const file = path.join(DIR, 'installateur', this.offer.name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await download(this.offer.installerUrl, file, this.offer.sha256, this.offer.size,
        (p) => this.send({ ...this.status(), stage: 'download', progress: p }));
      this.send({ ...this.status(), stage: 'install', counts });
      await this.beforeQuit();
      // --migration indique à l'installateur d'où vient l'utilisateur ; /S : sans questions
      // (l'utilisateur vient d'accepter le passage).
      spawn(file, ['/S', '--migration=' + DIR], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      setTimeout(() => app.quit(), 500);
      return { ok: true, counts };
    } catch (err) {
      this.busy = false;
      // Pas de mots de passe déchiffrables qui traînent si on s'arrête en route.
      shred(path.join(DIR, 'mots-de-passe.bin'));
      this.send({ ...this.status(), stage: 'error', error: err.message });
      return { error: err.message };
    }
  }
}

module.exports = { EngineSwitch, toCsv, snapshotState, MIGRATION_DIR: DIR };
