// Outils pour les développeurs : réglages en JSON (pouley.json), code source, rapport de
// la page en JSON, JavaScript du site, cache et données du site.
import { store, commands, runtime, current, sendUi, openTab } from './main.js';
import { DEFAULT_STATE } from './state.js';

const chromeIdOf = (recId) => { const rt = runtime.get(recId); return rt && rt.chromeId != null ? rt.chromeId : null; };

// Valeurs possibles des réglages à choix.
const CHOICES = {
  theme: ['nads', 'light'],
  shieldLevel: ['off', 'standard', 'strict'],
  memoryMode: ['econome', 'equilibre', 'performance', 'perso'],
  newTabPosition: ['start', 'end', 'next'],
  sidebarPosition: ['left', 'right', 'top'],
  windowMaterial: ['acrylic', 'mica', 'none'],
};
const kind = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

// pouley.json : chaque clé doit exister et garder son type ; les choix sont vérifiés.
function validate(next) {
  const errors = [];
  if (kind(next) !== 'object') return { errors: ['Le fichier doit contenir un objet { … }.'] };
  const defaults = DEFAULT_STATE.settings;
  const { SEARCH_ENGINES, AI_PROVIDERS, withCustomEngine } = self.PouleyConfig;
  withCustomEngine({ ...store.state.settings, ...next });
  const patch = {};
  for (const [k, v] of Object.entries(next)) {
    if (!(k in defaults)) { errors.push(`« ${k} » n’existe pas`); continue; }
    const want = kind(defaults[k]);
    if (want !== 'null' && kind(v) !== want) { errors.push(`« ${k} » doit être ${{ string: 'un texte', number: 'un nombre', boolean: 'true ou false', array: 'une liste', object: 'un objet' }[want] || want}`); continue; }
    if (CHOICES[k] && !CHOICES[k].includes(v)) { errors.push(`« ${k} » : ${CHOICES[k].join(', ')}`); continue; }
    if ((k === 'searchEngine' || k === 'searchEngine2') && !SEARCH_ENGINES[v]) { errors.push(`« ${k} » : ${Object.keys(SEARCH_ENGINES).join(', ')}`); continue; }
    if (k === 'ai' && !AI_PROVIDERS[v]) { errors.push(`« ai » : ${Object.keys(AI_PROVIDERS).join(', ')}`); continue; }
    if (want === 'number' && !Number.isFinite(v)) { errors.push(`« ${k} » doit être un nombre`); continue; }
    if (JSON.stringify(v) !== JSON.stringify(store.state.settings[k])) patch[k] = v;
  }
  return { errors, patch };
}

async function pageOf() {
  const recId = current();
  const chromeId = chromeIdOf(recId);
  const tab = chromeId != null ? await chrome.tabs.get(chromeId).catch(() => null) : null;
  if (!tab || !/^https?:/.test(tab.url || '')) {
    sendUi('toast', { text: 'Ouvre d’abord un site web.' });
    return null;
  }
  return { recId, tab, origin: new URL(tab.url).origin };
}

const SITE_DATA = { cache: true, cacheStorage: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true };

Object.assign(commands, {
  'settings.replace': async (next) => {
    const { errors, patch } = validate(next);
    if (errors.length) return { errors, changed: 0 };
    const changed = Object.keys(patch).length;
    if (changed) await commands['settings.set'](patch);
    return { errors: [], changed };
  },
  'dev.source': async () => {
    const p = await pageOf();
    if (p) openTab({ url: 'view-source:' + p.tab.url });
  },
  // Rapport de l'inspecteur (en-têtes, technos, cookies, charte…) affiché en JSON.
  'dev.report': async () => {
    const p = await pageOf();
    if (!p) return;
    const data = await commands.inspect(p.recId);
    await chrome.storage.session.set({ devJson: { title: 'Rapport · ' + new URL(p.tab.url).hostname, data } });
    openTab({ url: 'pouley://json' });
  },
  'dev.javascript': async () => {
    const p = await pageOf();
    if (!p) return;
    const now = await chrome.contentSettings.javascript.get({ primaryUrl: p.tab.url });
    const block = now.setting !== 'block';
    await chrome.contentSettings.javascript.set({ primaryPattern: p.origin + '/*', setting: block ? 'block' : 'allow' });
    await chrome.tabs.reload(p.tab.id);
    sendUi('toast', { text: (block ? 'JavaScript coupé sur ' : 'JavaScript remis sur ') + new URL(p.origin).hostname + '.' });
  },
  'dev.hardReload': async () => {
    const p = await pageOf();
    if (!p) return;
    await chrome.browsingData.removeCache({ origins: [p.origin] }).catch(() => {});
    await chrome.tabs.reload(p.tab.id, { bypassCache: true });
  },
  'dev.clearSite': async () => {
    const p = await pageOf();
    if (!p) return;
    await chrome.browsingData.remove({ origins: [p.origin] }, SITE_DATA);
    await chrome.tabs.reload(p.tab.id, { bypassCache: true });
    sendUi('toast', { text: 'Cookies, stockage et cache de ' + new URL(p.origin).hostname + ' effacés.' });
  },
});
