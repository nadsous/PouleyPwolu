// Extensions du Chrome Web Store dans PouleyPwolu (Chromium).
// - Installation : PouleyPwolu télécharge l'extension chez Google ; Chromium l'installe
//   après sa fenêtre de confirmation (engine/patches/store.patch).
// - Liste pour la barre : boutons d'extensions à côté de « Inspecter ».
// - Mises à jour : ungoogled-chromium ne les fait pas ; PouleyPwolu vérifie une fois par
//   jour et propose la nouvelle version.

const SELF = chrome.runtime.id;
const chromeVersion = () => (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '155.0.0.0';

export const crxUrl = (id) =>
  `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=${chromeVersion()}&acceptformat=crx2,crx3&x=id%3D${id}%26uc`;
const updateCheckUrl = (id, version) =>
  `https://clients2.google.com/service/update2/crx?response=updatecheck&prodversion=${chromeVersion()}&acceptformat=crx2,crx3&x=id%3D${id}%26v%3D${version}%26uc`;

const ID_RE = /\b([a-p]{32})\b/;
export const idFromInput = (text) => { const m = ID_RE.exec(String(text || '')); return m ? m[1] : null; };

// L'onglet ouvre l'adresse de l'extension, comme un lien : Chromium reconnaît une
// extension et affiche sa fenêtre de confirmation. (Un téléchargement par l'API
// chrome.downloads, lui, est enregistré comme simple fichier.)
export async function installFromStore(input, tabId) {
  const id = idFromInput(input);
  if (!id) return { error: 'Ce n’est pas une adresse d’extension du Chrome Web Store.' };
  try {
    if (tabId == null) {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      tabId = tab && tab.id;
    }
    if (tabId == null) return { error: 'Ouvre d’abord un onglet.' };
    await chrome.tabs.update(tabId, { url: crxUrl(id) });
    return { ok: true, id };
  } catch (err) {
    return { error: 'Téléchargement impossible : ' + (err && err.message || err) };
  }
}

// Extensions installées par l'utilisateur (pas les composants du navigateur).
export async function listUserExtensions(pins = {}) {
  const all = await chrome.management.getAll().catch(() => []);
  return all
    .filter((e) => e.id !== SELF && e.type === 'extension' && e.installType !== 'other')
    .map((e) => {
      const icons = (e.icons || []).slice().sort((a, b) => b.size - a.size);
      return {
        id: e.id, name: e.name, version: e.version, description: e.description,
        enabled: e.enabled, available: true, pinned: pins[e.id] !== false,
        icon: icons.length ? icons[icons.length > 1 ? icons.length - 2 : 0].url : null,
        options: !!e.optionsUrl, popup: true, fromStore: !!e.updateUrl,
      };
    });
}

// Versions plus récentes sur le Store, pour les extensions venues du Store.
export async function checkUpdates() {
  const all = await chrome.management.getAll().catch(() => []);
  const found = [];
  for (const e of all) {
    if (e.id === SELF || e.type !== 'extension' || !e.updateUrl || !e.updateUrl.includes('clients2.google.com')) continue;
    try {
      const xml = await (await fetch(updateCheckUrl(e.id, e.version))).text();
      const m = /<updatecheck[^>]*\bversion="([\d.]+)"[^>]*status="ok"|<updatecheck[^>]*status="ok"[^>]*\bversion="([\d.]+)"/.exec(xml);
      const v = m && (m[1] || m[2]);
      if (v && newer(v, e.version)) found.push({ id: e.id, name: e.name, from: e.version, to: v });
    } catch {}
  }
  return found;
}

function newer(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}
