// Reprise de session, comme « Continuer là où je me suis arrêté » de Chrome.
// Un onglet mis en veille (ou fermé avec le navigateur) perd son sessionStorage
// et son window.name. Beaucoup de sites (Proton, banques…) y gardent la
// connexion et déconnectent alors. On garde ces données chiffrées (clé protégée
// par Windows) et on ne les rend qu'au même site, dans le même espace. Les
// cookies de session, eux, sont déjà gardés par Electron.
const fs = require('fs');
const path = require('path');
const { seal, unseal, writeAtomic, shred } = require('./seal');

const AAD = 'pouley-session';
// Monde isolé à part : la page ne peut pas fausser la lecture.
const WORLD = 1999;
const READ = `(() => {
  if (!/^https?:$/.test(location.protocol)) return null;
  const items = [];
  try { for (let i = 0; i < sessionStorage.length; i++) { const k = sessionStorage.key(i); items.push([k, sessionStorage.getItem(k)]); } } catch {}
  return { origin: location.origin, name: window.name || '', items };
})()`;
const MAX_BYTES = 4 * 1024 * 1024;

class SessionKeep {
  constructor(dir, key) {
    this.file = path.join(dir, 'pouley-session.enc');
    this.key = key;
    this.tabs = new Map(); // tabId -> { partition, origin, name, items }
    if (!fs.existsSync(this.file)) return;
    try {
      if (key) {
        const data = JSON.parse(unseal(fs.readFileSync(this.file), key, AAD).toString('utf8'));
        for (const [id, snap] of Object.entries(data.tabs || {})) this.tabs.set(id, snap);
      }
    } catch (err) {
      console.warn('[session]', err.message);
    }
    // Lu une seule fois : ne reste pas sur le disque pendant la navigation.
    shred(this.file);
  }

  async snapshot(tabId, wc, partition) {
    if (!wc || wc.isDestroyed() || !partition || partition.startsWith('pouley-ephemere-')) return;
    try {
      const snap = await Promise.race([
        wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: READ }]),
        new Promise((r) => setTimeout(() => r(undefined), 800)),
      ]);
      if (snap === undefined) return;
      if (!snap || (!snap.items.length && !snap.name)) { this.tabs.delete(tabId); return; }
      if (JSON.stringify(snap).length > MAX_BYTES) return;
      this.tabs.set(tabId, { partition, ...snap });
    } catch {}
  }

  // Une seule fois, pour la première page du même site dans le même espace.
  take(tabId, partition, origin) {
    const snap = this.tabs.get(tabId);
    if (!snap || snap.partition !== partition || snap.origin !== origin) return null;
    this.tabs.delete(tabId);
    return { name: snap.name, items: snap.items };
  }

  drop(tabId) { this.tabs.delete(tabId); }

  // En fermant le navigateur : les onglets ouverts + ceux qui dormaient.
  async save(liveTabs) {
    if (!this.key) return;
    await Promise.all(liveTabs.map(([id, wc, partition]) => this.snapshot(id, wc, partition)));
    if (!this.tabs.size) return;
    try {
      writeAtomic(this.file, seal(Buffer.from(JSON.stringify({ v: 1, tabs: Object.fromEntries(this.tabs) })), this.key, AAD));
    } catch (err) {
      console.warn('[session]', err.message);
    }
  }
}

module.exports = { SessionKeep };
