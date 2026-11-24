// Extensions de PouleyPwolu (moteur Firefox) : celles d'addons.mozilla.org (AMO).
// - Installation : la page de l'extension sur AMO, dont le bouton « Ajouter » marche
//   tel quel dans PouleyPwolu (Firefox vérifie la signature de Mozilla).
// - Liste pour la barre : boutons d'extensions à côté de « Inspecter ».
// - Mises à jour : Firefox s'en charge tout seul.

const SELF = chrome.runtime.id;
export const AMO = 'https://addons.mozilla.org/fr/firefox/';

// Lien AMO, nom court (« ublock-origin ») ou nom tapé (« uBlock Origin ») → page AMO.
export function amoUrl(input) {
  const text = String(input || '').trim();
  if (!text) return null;
  const m = /addons\.mozilla\.org\/(?:[a-z-]+\/)?(?:firefox\/)?addon\/([^/?#\s]+)/i.exec(text);
  if (m) return `${AMO}addon/${m[1]}/`;
  if (/^[a-z0-9][a-z0-9-]*$/i.test(text) && text.includes('-')) return `${AMO}addon/${text.toLowerCase()}/`;
  return `${AMO}search/?q=${encodeURIComponent(text)}`;
}

export async function installFromStore(input, tabId) {
  const url = amoUrl(input);
  if (!url) return { error: 'Indique le nom ou le lien d’une extension.' };
  try {
    if (tabId == null) {
      await chrome.tabs.create({ url });
    } else {
      await chrome.tabs.update(tabId, { url });
    }
    return { ok: true };
  } catch (err) {
    return { error: 'Ouverture impossible : ' + (err && err.message || err) };
  }
}

// Extensions installées par l'utilisateur (pas celles du navigateur).
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
        options: !!e.optionsUrl, popup: true, fromStore: e.installType === 'normal',
      };
    });
}

// Firefox met lui-même les extensions à jour.
export async function checkUpdates() {
  return [];
}
