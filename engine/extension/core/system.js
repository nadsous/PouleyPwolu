// Réglages « Performances », « Données » et « À propos » dans Chromium : mémoire,
// effacement des données, navigateur par défaut, mises à jour.
import { store, commands, runtime, findTab, current, scheduleBroadcast, sendUi, snapshotExtra, openTab, ready } from './main.js';

const S = () => store.state.settings;
const REPO = 'nadsous/PouleyPwolu';

async function freePct() {
  try {
    const m = await chrome.system.memory.getInfo();
    return Math.round((m.availableCapacity / m.capacity) * 100);
  } catch { return null; }
}

// Onglets éveillés en arrière-plan (ceux qu'on peut endormir).
function awakeBackground() {
  const out = [];
  for (const [id, rt] of runtime) if (rt.chromeId != null && id !== current() && !rt.audible && findTab(id)) out.push(id);
  return out;
}

function sleepAll(ids) {
  for (const id of ids) commands['tab.sleep'](id);
  scheduleBroadcast();
  return ids.length;
}

// Veille d'urgence : moins de 10 % de mémoire libre, les onglets d'arrière-plan s'endorment.
chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'pouley-menage') return;
  const pct = await freePct();
  if (pct != null && pct < 10) {
    const n = sleepAll(awakeBackground());
    if (n) sendUi('toast', { text: `Mémoire presque pleine : ${n} onglet${n > 1 ? 's' : ''} mis en veille.` });
  }
});

// Effacer à la fermeture : les cookies et données des sites ne durent que la session.
async function applyClearOnExit() {
  const cs = chrome.contentSettings && chrome.contentSettings.cookies;
  if (!cs) return;
  if (S().clearOnExit) await cs.set({ primaryPattern: '<all_urls>', setting: 'session_only' }).catch(() => {});
  else await cs.clear({}).catch(() => {});
}

const ALL_DATA = { appcache: true, cache: true, cacheStorage: true, cookies: true, fileSystems: true, indexedDB: true, localStorage: true, serviceWorkers: true, webSQL: true };

// Démarrage du navigateur : le cache des pages de la session précédente est effacé.
chrome.runtime.onStartup.addListener(async () => {
  await ready;
  if (S().wipeCacheOnExit !== false) chrome.browsingData.removeCache({}).catch(() => {});
});

// ─────────────────────────────────────────────────────────────────────────────
// Mises à jour : la dernière version publiée sur GitHub contient moteur.json
// (docs/migration-electron.md), avec le numéro de la version Chromium.

const update = { status: 'idle' };
snapshotExtra.update = update;

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

async function checkUpdate() {
  Object.assign(update, { status: 'checking', error: null });
  scheduleBroadcast();
  try {
    const rel = await (await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })).json();
    const asset = (rel.assets || []).find((x) => x.name === 'moteur.json');
    const info = asset ? await (await fetch(asset.browser_download_url)).json() : null;
    const mine = chrome.runtime.getManifest().version;
    if (info && newer(info.version, mine)) Object.assign(update, { status: 'available', version: info.version, url: rel.html_url });
    else Object.assign(update, { status: 'uptodate' });
  } catch (err) {
    Object.assign(update, { status: 'error', error: String(err && err.message || err) });
  }
  scheduleBroadcast();
  if (update.status === 'available') sendUi('toast', { text: `PouleyPwolu ${update.version} est disponible : Paramètres → À propos.` });
}
chrome.alarms.create('pouley-maj', { delayInMinutes: 1, periodInMinutes: 6 * 60 });
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === 'pouley-maj' && (await ready, S().autoUpdate !== false)) checkUpdate(); });

const setSettings = commands['settings.set'];

Object.assign(commands, {
  'settings.set': async (patch = {}) => {
    const r = await setSettings(patch);
    if ('clearOnExit' in patch) await applyClearOnExit();
    return r;
  },
  'memory.report': async () => {
    const tabs = [];
    for (const [id, rt] of runtime) {
      const f = rt.chromeId != null && findTab(id);
      if (f) tabs.push({ title: f.rec.title || f.rec.url, mb: null });
    }
    return { totalMb: null, gpuMb: null, freePct: await freePct(), tabs };
  },
  'memory.free': () => sleepAll(awakeBackground()),
  'data.clearAll': async () => {
    await chrome.browsingData.remove({}, ALL_DATA);
    sendUi('toast', { text: 'Cookies, caches et données des sites effacés.' });
  },
  'browser.default': () => openTab({ url: 'chrome://settings/defaultBrowser' }),
  'update.check': () => checkUpdate(),
  'update.install': () => { if (update.url) openTab({ url: update.url }); },
});

ready.then(applyClearOnExit);
