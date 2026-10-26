// Cœur de PouleyPwolu dans Chromium : la logique de src/main/main.js (version Electron),
// avec les onglets Chromium à la place des vues Electron.
//
// Comme dans la version Electron, la barre PouleyPwolu est maîtresse : poulaillers,
// onglets, favoris et groupes vivent dans store.state. Un onglet Chromium n'est que la
// « vue » qui affiche un onglet éveillé ; un onglet en veille n'existe que dans l'état.
import '../lib/config.js';
import '../lib/icons.js';
import { Store, uid, makePoulailler } from './state.js';
import * as focus from './focus.js';
import { siteOf } from '../lib/trackers.js';
import { applyShield } from '../lib/shield.js';

const { SEARCH_ENGINES, AI_PROVIDERS, fill, keywordSearch } = self.PouleyConfig;
const { normalize } = self.PouleyIcons;

export const store = new Store();
const S = () => store.state.settings;

// Onglet PouleyPwolu -> sa vue Chromium.
// runtime : id d'onglet PouleyPwolu -> { chromeId, loading, canGoBack, canGoForward, audible, muted, zoom, blocked }
const runtime = new Map();
const byChrome = new Map(); // id d'onglet Chromium -> id d'onglet PouleyPwolu
const expectedRemovals = new Set(); // onglets Chromium que nous fermons nous-mêmes (veille)
let currentTabId = null;
let mainWindowId = null;
const closedTabs = [];

// ─────────────────────────────────────────────────────────────────────────────
// Adresses internes : pouley://newtab s'affiche avec la page Nouvel onglet de l'extension.

// Les pages de l'extension gardent leurs noms de la version Electron : pouley://newtab,
// pouley://onboarding… (pages/<nom>.html).
const EXT = chrome.runtime.getURL('');
const PAGES = EXT + 'pages/';
const NEWTAB = PAGES + 'newtab.html';
// Grands écrans de l'interface ouverts en pleine fenêtre : sidebar/index.html?page=<écran>.
const UI = EXT + 'sidebar/index.html';
const UI_PAGES = { settings: 'reglages', archive: 'archive', focus: 'plumes', editor: 'poulailler', group: 'groupe' };
const UI_NAMES = Object.fromEntries(Object.entries(UI_PAGES).map(([k, v]) => [v, k]));
const toChrome = (url) => {
  if (!url) return NEWTAB;
  const ui = /^pouley:\/\/([a-z-]+)\/?(?:\?(.*))?$/i.exec(url);
  if (ui && UI_NAMES[ui[1]]) return UI + '?page=' + UI_NAMES[ui[1]] + (ui[2] ? '&' + ui[2] : '');
  const m = /^pouley:\/\/([a-z0-9-]+)\/?(.*)$/i.exec(url);
  return m ? PAGES + m[1] + '.html' + (m[2] ? (m[2].startsWith('?') || m[2].startsWith('#') ? m[2] : '?' + m[2]) : '') : url;
};
const fromChrome = (url) => {
  if (!url || /^chrome:\/\/(newtab|new-tab-page)\//.test(url)) return 'pouley://newtab';
  if (url.startsWith(UI + '?')) {
    const q = new URLSearchParams(url.slice(UI.length + 1));
    const name = UI_PAGES[q.get('page')];
    if (name) return 'pouley://' + name + (q.get('arg') ? '?arg=' + encodeURIComponent(q.get('arg')) : '');
  }
  if (url.startsWith(PAGES)) {
    const m = /^([a-z0-9-]+)\.html(.*)$/i.exec(url.slice(PAGES.length));
    if (m) return 'pouley://' + m[1] + (m[2] || '');
  }
  return url;
};
// Ctrl+T et les autres « nouvel onglet » de Chromium affichent la page PouleyPwolu.
const isChromeNewTab = (url) => /^chrome:\/\/(newtab|new-tab-page)\//.test(url || '');

// ─────────────────────────────────────────────────────────────────────────────
// Modèle (repris de main.js)

function findTab(id) {
  const fi = store.state.favorites.findIndex((t) => t.id === id);
  if (fi >= 0) return { rec: store.state.favorites[fi], list: store.state.favorites, index: fi, poulailler: null };
  for (const p of store.state.poulaillers) {
    const i = p.tabs.findIndex((t) => t.id === id);
    if (i >= 0) return { rec: p.tabs[i], list: p.tabs, index: i, poulailler: p };
  }
  return null;
}

function activePoulailler() {
  return store.state.poulaillers.find((p) => p.id === store.state.activePoulailler) || store.state.poulaillers[0];
}

function makeTab(url, extra = {}) {
  let title = 'Nouvel onglet';
  try { if (/^https?:/.test(url || '')) title = new URL(url).hostname.replace(/^www./, ''); } catch {}
  return { id: uid('t'), url: url || 'pouley://newtab', title, favicon: null, pinned: false, lastActive: Date.now(), ...extra };
}

function resolveInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'pouley://newtab';
  if (text.startsWith('?')) return askUrl(text.slice(1).trim());
  const kw = keywordSearch(text);
  if (kw) return kw.target;
  if (/^(https?|pouley|file|view-source|chrome-extension|chrome):/i.test(text)) return text;
  if (/^(javascript|data|vbscript):/i.test(text)) return searchUrl(text);
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9-]{1,62}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
  return searchUrl(text);
}

function searchUrl(q) {
  const engine = SEARCH_ENGINES[S().searchEngine] || SEARCH_ENGINES.duckduckgo;
  return fill(engine.url, q);
}

function askUrl(q) {
  const ai = AI_PROVIDERS[S().ai] || AI_PROVIDERS.claude;
  return q ? fill(ai.ask, q) : ai.home;
}

function newTabIndex(p, pinnedCount) {
  const mode = S().newTabPosition;
  if (mode === 'end') return p.tabs.length;
  if (mode === 'next') {
    const i = p.tabs.findIndex((t) => t.id === currentTabId);
    return i >= 0 ? i + 1 : p.tabs.length;
  }
  return pinnedCount;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vues : onglets Chromium

async function mainWindow() {
  if (mainWindowId != null) {
    try { await chrome.windows.get(mainWindowId); return mainWindowId; } catch { mainWindowId = null; }
  }
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => null);
  if (w) return (mainWindowId = w.id);
  const created = await chrome.windows.create({ focused: true });
  return (mainWindowId = created.id);
}

function bind(recId, chromeId) {
  const rt = runtime.get(recId) || { loading: false, canGoBack: true, canGoForward: true, audible: false, muted: false, zoom: 1, blocked: 0 };
  rt.chromeId = chromeId;
  runtime.set(recId, rt);
  byChrome.set(chromeId, recId);
  persistBindings();
  return rt;
}

function unbind(recId) {
  const rt = runtime.get(recId);
  if (!rt || rt.chromeId == null) return;
  byChrome.delete(rt.chromeId);
  rt.chromeId = null;
  rt.loading = false;
  persistBindings();
}

// Les liens onglet PouleyPwolu <-> onglet Chromium survivent à la mise en sommeil du
// service worker (chrome.storage.session), pas à un redémarrage du navigateur.
let bindTimer = null;
function persistBindings() {
  clearTimeout(bindTimer);
  bindTimer = setTimeout(() => chrome.storage.session.set({ bindings: [...byChrome.entries()], currentTabId, mainWindowId }).catch(() => {}), 100);
}

// Éveille un onglet : crée son onglet Chromium s'il dort.
const creating = new Map(); // recId -> Promise
async function ensureView(recId, active = false) {
  const f = findTab(recId);
  if (!f) return null;
  const rt = runtime.get(recId);
  if (rt && rt.chromeId != null) {
    if (active) await chrome.tabs.update(rt.chromeId, { active: true }).catch(() => unbind(recId));
    return runtime.get(recId);
  }
  if (creating.has(recId)) return creating.get(recId);
  const job = (async () => {
    const windowId = await mainWindow();
    const tab = await chrome.tabs.create({ windowId, url: toChrome(f.rec.url), active });
    return bind(recId, tab.id);
  })().finally(() => creating.delete(recId));
  creating.set(recId, job);
  return job;
}

// Met un onglet en veille : son onglet Chromium est fermé, l'onglet reste dans la barre.
function destroyView(recId) {
  const rt = runtime.get(recId);
  if (!rt || rt.chromeId == null) return;
  const chromeId = rt.chromeId;
  expectedRemovals.add(chromeId);
  unbind(recId);
  chrome.tabs.remove(chromeId).catch(() => expectedRemovals.delete(chromeId));
}

function updateRec(tabId, patch) {
  const f = findTab(tabId);
  if (!f) return;
  Object.assign(f.rec, patch);
  if (!f.rec.ephemeral) store.save();
  scheduleBroadcast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions sur les onglets (reprises de main.js)

function openTab({ url, input, poulaillerId, background, ephemeral, index, groupId, adopt } = {}) {
  const p = store.state.poulaillers.find((x) => x.id === poulaillerId) || activePoulailler();
  const rec = makeTab(input != null ? resolveInput(input) : url, ephemeral ? { ephemeral: true, title: 'Onglet éphémère' } : {});
  const pinnedCount = p.tabs.filter((t) => t.pinned).length;
  const at = typeof index === 'number' ? index : newTabIndex(p, pinnedCount);
  p.tabs.splice(Math.max(pinnedCount, Math.min(at, p.tabs.length)), 0, rec);
  if (groupId && groupsOf(p).some((g) => g.id === groupId)) {
    rec.groupId = groupId;
    normalizeGroups(p);
  }
  // Onglet ouvert par Chromium lui-même (lien dans un nouvel onglet, popup…) : il a déjà sa vue.
  if (adopt != null) bind(rec.id, adopt);
  store.save();
  if (!rec.groupId && /^https?:/.test(rec.url)) autoGroupTab(rec.id);
  if (!background) {
    if (p.id !== store.state.activePoulailler) store.state.activePoulailler = p.id;
    activateTab(rec.id);
  } else {
    scheduleBroadcast();
  }
  return rec.id;
}

function activateTab(tabId) {
  const f = findTab(tabId);
  if (!f) return;
  currentTabId = tabId;
  f.rec.lastActive = Date.now();
  if (f.poulailler) {
    f.poulailler.activeTab = tabId;
    store.state.activePoulailler = f.poulailler.id;
  }
  ensureView(tabId, true).catch((err) => console.warn('[onglet]', err));
  store.save();
  persistBindings();
  setTimeout(enforceAwakeLimit, 1500);
  scheduleBroadcast();
}

function neighbourOf(f) {
  const list = f.list;
  return list[f.index + 1] || list[f.index - 1] || null;
}

function closeTab(tabId = currentTabId) {
  const f = findTab(tabId);
  if (!f) return;
  const wasCurrent = tabId === currentTabId;
  if (!f.rec.ephemeral && f.rec.url && f.rec.url !== 'pouley://newtab') {
    closedTabs.push({ url: f.rec.url, poulaillerId: f.poulailler && f.poulailler.id });
    if (closedTabs.length > 25) closedTabs.shift();
  }
  // Fermer un onglet épinglé (ou un favori) le met juste en veille, comme Arc.
  if (f.rec.pinned || !f.poulailler) {
    destroyView(tabId);
    runtime.delete(tabId);
    if (f.rec.homeUrl) f.rec.url = f.rec.homeUrl;
    if (wasCurrent) {
      const next = activePoulailler().tabs.find((t) => !t.pinned) || null;
      currentTabId = null;
      if (next) return activateTab(next.id);
    }
    store.save();
    return scheduleBroadcast();
  }
  const next = wasCurrent ? neighbourOf(f) : null;
  // L'onglet suivant s'affiche avant de fermer l'actuel : pas d'onglet Chromium vide entre les deux.
  if (next) activateTab(next.id);
  destroyView(tabId);
  runtime.delete(tabId);
  f.list.splice(f.list.indexOf(f.rec), 1);
  normalizeGroups(f.poulailler);
  if (f.poulailler.activeTab === tabId) f.poulailler.activeTab = next ? next.id : null;
  if (wasCurrent && !next) {
    currentTabId = null;
    openTab({ url: 'pouley://newtab' });
  }
  store.save();
  scheduleBroadcast();
}

async function withView(tabId, fn) {
  const rt = runtime.get(tabId || currentTabId);
  if (!rt || rt.chromeId == null) return null;
  try { return await fn(rt.chromeId, rt); } catch (err) { console.warn('[onglet]', err.message); return null; }
}

function reloadTab(tabId = currentTabId, hard = false) {
  const rt = runtime.get(tabId);
  if (!rt || rt.chromeId == null) return tabId && activateTab(tabId);
  chrome.tabs.reload(rt.chromeId, { bypassCache: !!hard }).catch(() => {});
}

function navigate(tabId, input) {
  if (!tabId) return openTab({ input });
  const url = resolveInput(input);
  updateRec(tabId, { url });
  const rt = runtime.get(tabId);
  if (rt && rt.chromeId != null) chrome.tabs.update(rt.chromeId, { url: toChrome(url) }).catch(() => {});
  else activateTab(tabId);
}

function moveTab({ id, poulaillerId, pinned, index, favorite, groupId }) {
  const f = findTab(id);
  if (!f) return;
  f.list.splice(f.index, 1);
  if (f.poulailler && f.poulailler.activeTab === id) f.poulailler.activeTab = null;
  let target;
  let targetP = null;
  if (favorite) {
    target = store.state.favorites;
    f.rec.pinned = false;
    f.rec.homeUrl = f.rec.homeUrl || f.rec.url;
  } else {
    targetP = store.state.poulaillers.find((p) => p.id === poulaillerId) || f.poulailler || activePoulailler();
    target = targetP.tabs;
    f.rec.pinned = !!pinned;
    if (pinned && !f.rec.homeUrl) f.rec.homeUrl = f.rec.url;
    if (!pinned) delete f.rec.homeUrl;
  }
  const pinnedCount = targetP ? target.filter((t) => t.pinned).length : target.length;
  let at = typeof index === 'number' ? index : target.length;
  if (targetP) at = f.rec.pinned ? Math.min(at, pinnedCount) : Math.max(at, pinnedCount);
  target.splice(Math.max(0, Math.min(at, target.length)), 0, f.rec);
  if (targetP) {
    if (f.rec.pinned) delete f.rec.groupId;
    else if (groupId !== undefined) {
      if (groupId && groupsOf(targetP).some((g) => g.id === groupId)) f.rec.groupId = groupId;
      else delete f.rec.groupId;
    } else if (f.poulailler !== targetP) delete f.rec.groupId;
    normalizeGroups(targetP);
  } else delete f.rec.groupId;
  if (f.poulailler && f.poulailler !== targetP) normalizeGroups(f.poulailler);
  if (targetP && id === currentTabId) {
    targetP.activeTab = id;
    store.state.activePoulailler = targetP.id;
  }
  store.save();
  scheduleBroadcast();
}

function switchPoulailler(id) {
  const p = store.state.poulaillers.find((x) => x.id === id);
  if (!p) return;
  store.state.activePoulailler = id;
  const target = p.tabs.find((t) => t.id === p.activeTab) || p.tabs.find((t) => !t.pinned) || null;
  currentTabId = null;
  if (target) activateTab(target.id);
  else openTab({ url: 'pouley://newtab', poulaillerId: id });
}

function cycleTab(dir) {
  const p = activePoulailler();
  const list = [...store.state.favorites, ...p.tabs];
  if (!list.length) return;
  const i = list.findIndex((t) => t.id === currentTabId);
  activateTab(list[(i + dir + list.length) % list.length].id);
}

function togglePin(tabId) {
  const f = findTab(tabId);
  if (!f || !f.poulailler) return;
  moveTab({ id: tabId, poulaillerId: f.poulailler.id, pinned: !f.rec.pinned, index: f.rec.pinned ? undefined : f.list.filter((t) => t.pinned).length });
}

function reopenClosed() {
  const last = closedTabs.pop();
  if (last) openTab({ url: last.url, poulaillerId: last.poulaillerId });
}

async function zoom(delta) {
  await withView(currentTabId, async (chromeId, rt) => {
    const cur = await chrome.tabs.getZoom(chromeId);
    const z = delta === 0 ? 1 : Math.min(3, Math.max(0.3, cur + delta));
    await chrome.tabs.setZoom(chromeId, Math.round(z * 100) / 100);
    rt.zoom = z;
    sendUi('toast', { text: `Zoom ${Math.round(z * 100)} %` });
  });
  scheduleBroadcast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Veille des onglets et archivage automatique (comme Arc)

const MEMORY_MODES = {
  econome: { sleepMinutes: 5, maxAwake: 4 },
  equilibre: { sleepMinutes: 15, maxAwake: 8 },
  performance: { sleepMinutes: 60, maxAwake: 0 },
};
const memoryMode = () => MEMORY_MODES[S().memoryMode] || MEMORY_MODES.equilibre;

function canSleep(id, rt) {
  return rt.chromeId != null && id !== currentTabId && !rt.audible;
}

function enforceAwakeLimit() {
  const max = memoryMode().maxAwake;
  if (!max) return;
  const awake = [...runtime.entries()].filter(([, rt]) => rt.chromeId != null);
  if (awake.length <= max) return;
  const sleepable = awake.filter(([id, rt]) => canSleep(id, rt))
    .map(([id]) => ({ id, last: (findTab(id) || { rec: {} }).rec.lastActive || 0 }))
    .sort((a, b) => a.last - b.last);
  for (const t of sleepable.slice(0, awake.length - max)) destroyView(t.id);
  scheduleBroadcast();
}

function housekeeping() {
  const now = Date.now();
  const custom = S().memoryMode === 'perso';
  const sleepMs = (custom ? S().sleepAfterMinutes || 0 : memoryMode().sleepMinutes) * 60000;
  if (sleepMs > 0) {
    for (const [id, rt] of runtime) {
      if (!canSleep(id, rt)) continue;
      const f = findTab(id);
      if (f && now - (f.rec.lastActive || 0) > sleepMs) destroyView(id);
    }
  }
  enforceAwakeLimit();
  const archiveMs = (S().archiveAfterHours || 0) * 3600000;
  if (archiveMs > 0) {
    store.state.archive = store.state.archive || [];
    for (const p of store.state.poulaillers) {
      const keep = [];
      for (const t of p.tabs) {
        if (!t.pinned && t.id !== currentTabId && now - (t.lastActive || now) > archiveMs) {
          destroyView(t.id);
          runtime.delete(t.id);
          if (!t.ephemeral && /^https?:/.test(t.url)) store.state.archive.unshift({ url: t.url, title: t.title, favicon: t.favicon, at: now, poulailler: p.name });
        } else keep.push(t);
      }
      p.tabs = keep;
    }
    store.state.archive = store.state.archive.slice(0, 100);
  }
  store.save();
  scheduleBroadcast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Groupes d'œufs (repris de main.js)

const GROUP_COLORS = ['#FFE100', '#3BB273', '#1565D8', '#FE7146', '#A66CFF', '#FF5FA2', '#2EC4B6', '#EF3E36', '#E8D9B5'];
const CATEGORIES = [
  { key: 'dev', label: 'Développement', sites: ['github.com', 'gitlab.com', 'bitbucket.org', 'stackoverflow.com', 'stackexchange.com', 'npmjs.com', 'developer.mozilla.org', 'vercel.com', 'netlify.com', 'codepen.io', 'codesandbox.io', 'jsfiddle.net', 'docker.com', 'electronjs.org', 'rust-lang.org', 'crates.io', 'pypi.org', 'nodejs.org', 'react.dev', 'nextjs.org', 'tailwindcss.com', 'supabase.com', 'railway.app', 'dev.to', 'w3schools.com'] },
  { key: 'ia', label: 'IA', sites: ['claude.ai', 'chatgpt.com', 'openai.com', 'perplexity.ai', 'anthropic.com', 'huggingface.co', 'mistral.ai', 'gemini.google.com', 'kimi.com', 'deepseek.com', 'openrouter.ai'] },
  { key: 'video', label: 'Vidéos', sites: ['youtube.com', 'youtu.be', 'twitch.tv', 'netflix.com', 'vimeo.com', 'dailymotion.com', 'primevideo.com', 'disneyplus.com', 'crunchyroll.com', 'canalplus.com'] },
  { key: 'social', label: 'Réseaux sociaux', sites: ['x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'reddit.com', 'tiktok.com', 'threads.net', 'bsky.app', 'mastodon.social', 'discord.com', 'pinterest.com', 'snapchat.com'] },
  { key: 'shop', label: 'Achats', sites: ['amazon.fr', 'amazon.com', 'leboncoin.fr', 'cdiscount.com', 'fnac.com', 'ebay.fr', 'ebay.com', 'aliexpress.com', 'vinted.fr', 'etsy.com', 'darty.com', 'boulanger.com', 'ldlc.com', 'temu.com', 'shein.com', 'decathlon.fr', 'ikea.com'] },
  { key: 'mail', label: 'Mails & agenda', sites: ['mail.google.com', 'calendar.google.com', 'outlook.com', 'outlook.live.com', 'proton.me', 'mail.yahoo.com'] },
  { key: 'docs', label: 'Docs & bureau', sites: ['notion.so', 'docs.google.com', 'drive.google.com', 'office.com', 'sharepoint.com', 'dropbox.com', 'figma.com', 'canva.com', 'miro.com', 'trello.com', 'linear.app', 'airtable.com', 'slack.com'] },
  { key: 'news', label: 'Actualités', sites: ['lemonde.fr', 'lefigaro.fr', 'liberation.fr', 'francetvinfo.fr', 'bfmtv.com', '20minutes.fr', 'ouest-france.fr', 'leparisien.fr', 'lesechos.fr', 'mediapart.fr', 'huffingtonpost.fr', 'bbc.com', 'nytimes.com', 'theguardian.com'] },
  { key: 'music', label: 'Musique', sites: ['spotify.com', 'deezer.com', 'soundcloud.com', 'music.apple.com', 'music.youtube.com'] },
];
const NO_GROUP = /^(duckduckgo\.com|www\.google\.[a-z.]+|google\.[a-z.]+|search\.brave\.com|www\.startpage\.com|www\.bing\.com)$/i;

function hostOfUrl(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

function categoryOf(url) {
  const host = hostOfUrl(url).replace(/^www\./, '');
  let best = null;
  for (const c of CATEGORIES) {
    for (const s of c.sites) {
      if ((host === s || host.endsWith('.' + s)) && (!best || s.length > best.len)) best = { cat: c, len: s.length };
    }
  }
  return best ? best.cat : null;
}

function groupKeyOf(url) {
  if (!/^https?:/.test(url || '')) return null;
  const host = hostOfUrl(url);
  if (!host || NO_GROUP.test(host) || url.includes('/search?')) return null;
  const cat = categoryOf(url);
  if (cat) return { key: 'cat:' + cat.key, label: cat.label };
  const site = siteOf(host);
  const name = site.split('.')[0];
  return { key: 'site:' + site, label: name.charAt(0).toUpperCase() + name.slice(1) };
}

function groupsOf(p) { if (!Array.isArray(p.groups)) p.groups = []; return p.groups; }

function normalizeGroups(p) {
  const groups = groupsOf(p);
  const ids = new Set(groups.map((g) => g.id));
  const pinned = p.tabs.filter((t) => t.pinned);
  const rest = p.tabs.filter((t) => !t.pinned);
  for (const t of pinned) delete t.groupId;
  for (const t of rest) if (t.groupId && !ids.has(t.groupId)) delete t.groupId;
  const out = [];
  const placed = new Set();
  for (const t of rest) {
    if (placed.has(t.id)) continue;
    if (t.groupId) {
      for (const m of rest) if (m.groupId === t.groupId && !placed.has(m.id)) { out.push(m); placed.add(m.id); }
    } else { out.push(t); placed.add(t.id); }
  }
  p.tabs = [...pinned, ...out];
  p.groups = groups.filter((g) => out.some((t) => t.groupId === g.id));
}

function nextGroupColor(p) {
  const used = new Set(groupsOf(p).map((g) => g.color));
  return GROUP_COLORS.find((c) => !used.has(c)) || GROUP_COLORS[groupsOf(p).length % GROUP_COLORS.length];
}

function createGroup(p, tabIds, { name, color, auto = true, key = null, sites = [] } = {}) {
  const g = { id: uid('g'), name: name || 'Groupe d’œufs', color: color || nextGroupColor(p), collapsed: false, auto, key, sites: [...new Set(sites)] };
  groupsOf(p).push(g);
  for (const id of tabIds) {
    const t = p.tabs.find((x) => x.id === id);
    if (t && !t.pinned) t.groupId = g.id;
  }
  normalizeGroups(p);
  store.save();
  scheduleBroadcast();
  return g;
}

function setTabGroup(tabId, groupId) {
  const f = findTab(tabId);
  if (!f || !f.poulailler || f.rec.pinned) return;
  const p = f.poulailler;
  const g = groupId && groupsOf(p).find((x) => x.id === groupId);
  if (g) {
    f.rec.groupId = g.id;
    const site = hostOfUrl(f.rec.url) && siteOf(hostOfUrl(f.rec.url));
    if (g.auto && site && /^https?:/.test(f.rec.url) && !g.sites.includes(site)) g.sites.push(site);
  } else delete f.rec.groupId;
  normalizeGroups(p);
  store.save();
  scheduleBroadcast();
}

function autoGroupTab(tabId) {
  if (!S().autoGroupTabs) return;
  const f = findTab(tabId);
  if (!f || !f.poulailler || f.rec.pinned || f.rec.groupId || f.rec.ephemeral) return;
  const p = f.poulailler;
  const k = groupKeyOf(f.rec.url);
  if (!k) return;
  const site = siteOf(hostOfUrl(f.rec.url));
  const g = groupsOf(p).find((x) => x.auto && (x.sites.includes(site) || (x.key && x.key === k.key)));
  if (g) return setTabGroup(tabId, g.id);
  const mate = p.tabs.find((t) => t.id !== tabId && !t.pinned && !t.groupId && groupKeyOf(t.url)?.key === k.key);
  if (!mate) return;
  const created = createGroup(p, [mate.id, tabId], { name: k.label, key: k.key, sites: [site, siteOf(hostOfUrl(mate.url))] });
  sendUi('group:created', { id: created.id, name: created.name, color: created.color, auto: true });
}

function autoGroupAll(p) {
  const buckets = new Map();
  let joined = 0;
  for (const t of p.tabs) {
    if (t.pinned || t.groupId || t.ephemeral) continue;
    const k = groupKeyOf(t.url);
    if (!k) continue;
    const site = siteOf(hostOfUrl(t.url));
    const g = groupsOf(p).find((x) => x.auto && (x.sites.includes(site) || x.key === k.key));
    if (g) { t.groupId = g.id; if (!g.sites.includes(site)) g.sites.push(site); joined++; continue; }
    if (!buckets.has(k.key)) buckets.set(k.key, { label: k.label, tabs: [] });
    buckets.get(k.key).tabs.push(t);
  }
  let created = 0;
  for (const [key, b] of buckets) {
    if (b.tabs.length < 2) continue;
    createGroup(p, b.tabs.map((t) => t.id), { name: b.label, key, sites: b.tabs.map((t) => siteOf(hostOfUrl(t.url))) });
    created++;
  }
  normalizeGroups(p);
  store.save();
  scheduleBroadcast();
  return { created, joined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Interface : barres PouleyPwolu ouvertes (une par fenêtre), état et événements

const ports = new Set();
let broadcastTimer = null;

export function sendUi(channel, payload) {
  for (const port of ports) {
    try { port.postMessage({ type: 'event', channel, payload }); } catch {}
  }
}

function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    sendUi('state', snapshot());
  }, 30);
}

function snapshot() {
  const rt = {};
  for (const [id, r] of runtime) {
    rt[id] = {
      loading: r.loading, canGoBack: r.canGoBack, canGoForward: r.canGoForward, blocked: r.blocked || 0,
      audible: r.audible, muted: r.muted, awake: r.chromeId != null, https: r.https ?? null,
      zoom: r.zoom || 1, floating: false, badge: 0, memMb: 0, pen: !!r.penOn, agent: null,
    };
  }
  const cur = currentTabId && findTab(currentTabId);
  return {
    state: store.state,
    runtime: rt,
    currentTabId,
    focusSite: cur && S().focusEnabled !== false ? focus.distractingSite(cur.rec.url, S().focusSites) : null,
    aiOpen: false,
    sidePanel: null,
    cometAvailable: false,
    defaultBrowser: null,
    extensions: [],
    nadspdfApp: false,
    split: null,
    repo: null,
    maximized: false,
    platform: 'win32',
    chromium: true,
    version: chrome.runtime.getManifest().version,
    versions: { chromium: (navigator.userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || '' },
    update: { status: 'idle' },
    vault: { exists: false, open: false },
    userExtensions: [],
    security: { stateEncrypted: false, cookies: true, bitlocker: null },
  };
}

// Menus contextuels : construits ici comme dans main.js, dessinés par la barre.
const menus = new Map();
function popupMenu(template) {
  const menuId = uid('m');
  const handlers = new Map();
  const serialize = (items) => items.filter(Boolean).map((it, i) => {
    if (it.type === 'separator') return { type: 'separator' };
    const id = menuId + '-' + handlers.size + '-' + i;
    if (it.click) handlers.set(id, it.click);
    return { id, label: it.label, sublabel: it.sublabel, type: it.type || 'normal', checked: !!it.checked, enabled: it.enabled !== false, submenu: it.submenu ? serialize(it.submenu) : undefined };
  });
  const items = serialize(template);
  menus.clear();
  menus.set(menuId, handlers);
  sendUi('menu', { menuId, items });
}

const validColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : null);

function applyLook(p, { color2, gradient, grain } = {}) {
  if (color2 !== undefined) p.color2 = validColor(color2);
  if (gradient !== undefined) p.gradient = !!gradient;
  if (grain !== undefined) p.grain = Math.max(0, Math.min(1, Number(grain) || 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Commandes de l'interface (mêmes noms que dans main.js)

export const commands = {
  'tab.new': (a = {}) => openTab(a),
  'tab.activate': (id) => activateTab(id),
  'tab.close': (id) => closeTab(id || currentTabId),
  'tab.navigate': ({ id, input }) => navigate(id || currentTabId, input),
  'tab.back': () => withView(currentTabId, (c) => chrome.tabs.goBack(c)),
  'tab.forward': () => withView(currentTabId, (c) => chrome.tabs.goForward(c)),
  'tab.reload': () => reloadTab(),
  'tab.stop': () => withView(currentTabId, (c) => chrome.scripting.executeScript({ target: { tabId: c }, func: () => window.stop() })),
  'tab.pin': (id) => togglePin(id || currentTabId),
  'tab.favorite': (id) => {
    const f = findTab(id || currentTabId);
    if (!f) return;
    if (!f.poulailler) moveTab({ id: f.rec.id, poulaillerId: store.state.activePoulailler, pinned: true, index: 0 });
    else if (store.state.favorites.length < 12) moveTab({ id: f.rec.id, favorite: true });
  },
  'tab.move': (a) => moveTab(a),
  'tab.mute': (id) => withView(id || currentTabId, async (c, rt) => {
    const t = await chrome.tabs.get(c);
    await chrome.tabs.update(c, { muted: !t.mutedInfo.muted });
    rt.muted = !t.mutedInfo.muted;
    scheduleBroadcast();
  }),
  'tab.duplicate': (id) => { const f = findTab(id || currentTabId); if (f) openTab({ url: f.rec.url, poulaillerId: f.poulailler && f.poulailler.id }); },
  'tab.reopen': () => reopenClosed(),
  'tab.zoom': (d) => zoom(Number(d) || 0),
  'tab.sleep': (id) => { if (id !== currentTabId) { destroyView(id); scheduleBroadcast(); } },
  'tab.menu': (id) => {
    const f = findTab(id);
    if (!f) return;
    const rt = runtime.get(id);
    const awake = rt && rt.chromeId != null;
    const others = store.state.poulaillers.filter((p) => !f.poulailler || p.id !== f.poulailler.id);
    popupMenu([
      f.poulailler
        ? { label: f.rec.pinned ? 'Désépingler' : 'Épingler', click: () => togglePin(id) }
        : { label: 'Retirer des favoris', click: () => commands['tab.favorite'](id) },
      f.poulailler && store.state.favorites.length < 12 ? { label: 'Ajouter aux favoris', click: () => moveTab({ id, favorite: true }) } : null,
      f.poulailler && !f.rec.pinned ? { label: 'Groupe d’œufs', submenu: [
        { label: 'Nouveau groupe avec cet onglet', click: () => { const g = createGroup(f.poulailler, [id], { name: groupKeyOf(f.rec.url)?.label || 'Groupe d’œufs', sites: [siteOf(hostOfUrl(f.rec.url))].filter(Boolean) }); sendUi('shortcut', 'edit-group:' + g.id); } },
        ...(groupsOf(f.poulailler).length ? [{ type: 'separator' }, ...groupsOf(f.poulailler).map((g) => ({ label: '🥚  ' + g.name, type: 'checkbox', checked: f.rec.groupId === g.id, click: () => setTabGroup(id, g.id) }))] : []),
        ...(f.rec.groupId ? [{ type: 'separator' }, { label: 'Retirer du groupe', click: () => setTabGroup(id, null) }] : []),
      ] } : null,
      { label: 'Dupliquer', click: () => commands['tab.duplicate'](id) },
      { label: 'Copier l’adresse', click: () => sendUi('clipboard', f.rec.url) },
      awake ? { label: rt.muted ? 'Réactiver le son' : 'Couper le son', click: () => commands['tab.mute'](id) } : null,
      awake && id !== currentTabId ? { label: 'Mettre en veille', click: () => commands['tab.sleep'](id) } : null,
      others.length ? { label: 'Déplacer vers', submenu: others.map((p) => ({ label: p.name, click: () => moveTab({ id, poulaillerId: p.id, pinned: false, index: 0 }) })) } : null,
      { type: 'separator' },
      { label: f.rec.pinned || !f.poulailler ? 'Mettre en veille / réinitialiser' : 'Fermer', click: () => closeTab(id) },
    ]);
  },
  'menu.click': ({ menuId, itemId } = {}) => {
    const h = menus.get(menuId);
    const fn = h && h.get(itemId);
    menus.delete(menuId);
    return fn ? fn() : null;
  },
  'poulailler.menu': (id) => {
    const p = store.state.poulaillers.find((x) => x.id === id);
    if (!p) return;
    popupMenu([
      { label: 'Modifier…', click: () => sendUi('shortcut', 'edit-poulailler:' + id) },
      { label: 'Mettre tous les onglets en veille', click: () => { for (const t of p.tabs) if (t.id !== currentTabId) destroyView(t.id); scheduleBroadcast(); } },
      { label: 'Fermer les onglets non épinglés', click: () => { for (const t of p.tabs.filter((x) => !x.pinned)) closeTab(t.id); } },
      { type: 'separator' },
      { label: 'Supprimer le poulailler', enabled: store.state.poulaillers.length > 1, click: () => sendUi('shortcut', 'edit-poulailler:' + id) },
    ]);
  },
  'poulailler.switch': (id) => switchPoulailler(id),
  'poulailler.create': ({ name, color, icon, isolated = false, ...look } = {}) => {
    const p = makePoulailler(String(name || 'Poulailler').slice(0, 40), validColor(color) || '#FFE100', normalize(icon));
    p.isolated = !!isolated;
    applyLook(p, look);
    store.state.poulaillers.push(p);
    switchPoulailler(p.id);
    return p.id;
  },
  'poulailler.update': ({ id, name, color, icon, isolated, ...look }) => {
    const p = store.state.poulaillers.find((x) => x.id === id);
    if (!p) return;
    if (name != null) p.name = String(name).slice(0, 40);
    if (validColor(color)) p.color = validColor(color);
    applyLook(p, look);
    if (icon) p.icon = normalize(icon);
    if (isolated != null) p.isolated = !!isolated;
    store.save();
    scheduleBroadcast();
  },
  'poulailler.delete': (id) => {
    const list = store.state.poulaillers;
    if (list.length <= 1) return false;
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [p] = list.splice(i, 1);
    for (const t of p.tabs) { destroyView(t.id); runtime.delete(t.id); }
    if (store.state.activePoulailler === id) switchPoulailler(list[Math.max(0, i - 1)].id);
    store.save();
    scheduleBroadcast();
    return true;
  },
  'poulailler.reorder': (ids) => {
    const map = new Map(store.state.poulaillers.map((p) => [p.id, p]));
    const next = (ids || []).map((id) => map.get(id)).filter(Boolean);
    if (next.length === store.state.poulaillers.length) store.state.poulaillers = next;
    store.save();
    scheduleBroadcast();
  },
  'settings.set': (patch = {}) => {
    const s = store.state.settings;
    for (const [k, v] of Object.entries(patch)) if (k in s) s[k] = v;
    store.save();
    if (['shieldLevel', 'sendGpc', 'blockThirdPartyCookies'].some((k) => k in patch)) applyPrivacy();
    scheduleBroadcast();
  },
  'onboarding.done': (choices = {}) => {
    commands['settings.set'](choices.settings || {});
    const p = store.state.poulaillers[0];
    if (choices.poulailler && p) {
      if (choices.poulailler.name) p.name = String(choices.poulailler.name).slice(0, 40);
      if (choices.poulailler.icon) p.icon = normalize(choices.poulailler.icon);
      if (choices.poulailler.color) p.color = choices.poulailler.color;
    }
    store.state.onboarded = true;
    store.save();
    if (!p.tabs.length) openTab({ url: 'pouley://newtab' });
    scheduleBroadcast();
  },
  'onboarding.replay': () => { store.state.onboarded = false; store.save(); scheduleBroadcast(); },
  'focus.addSite': (input) => {
    const site = focus.cleanSite(input);
    if (!site) return false;
    const s = store.state.settings;
    if (!s.focusSites.includes(site)) s.focusSites = [...s.focusSites, site].sort();
    store.save();
    scheduleBroadcast();
    return site;
  },
  'focus.removeSite': (site) => { const s = store.state.settings; s.focusSites = s.focusSites.filter((x) => x !== site); store.save(); scheduleBroadcast(); },
  'focus.resetSites': () => { store.state.settings.focusSites = [...focus.DEFAULT_SITES]; store.save(); scheduleBroadcast(); },
  'focus.clear': () => { store.state.focus = { days: {} }; store.save(); scheduleBroadcast(); },
  'group.auto': () => autoGroupAll(activePoulailler()),
  'group.create': ({ tabIds = [], name, color } = {}) => createGroup(activePoulailler(), tabIds, { name, color }).id,
  'group.set': ({ tabId, groupId }) => setTabGroup(tabId, groupId || null),
  'group.update': ({ id, name, color, collapsed, auto, sites }) => {
    const p = store.state.poulaillers.find((x) => groupsOf(x).some((g) => g.id === id));
    const g = p && groupsOf(p).find((x) => x.id === id);
    if (!g) return;
    if (name != null) g.name = String(name).slice(0, 40) || g.name;
    if (validColor(color)) g.color = validColor(color);
    if (collapsed != null) g.collapsed = !!collapsed;
    if (auto != null) g.auto = !!auto;
    if (Array.isArray(sites)) g.sites = sites.map(String).slice(0, 60);
    store.save();
    scheduleBroadcast();
  },
  'group.ungroup': (id) => {
    for (const p of store.state.poulaillers) {
      if (!groupsOf(p).some((g) => g.id === id)) continue;
      for (const t of p.tabs) if (t.groupId === id) delete t.groupId;
      normalizeGroups(p);
    }
    store.save();
    scheduleBroadcast();
  },
  'group.closeTabs': (id) => { for (const t of activePoulailler().tabs.filter((x) => x.groupId === id)) closeTab(t.id); },
  'group.newTab': (id) => openTab({ url: 'pouley://newtab', groupId: id }),
  'group.menu': (id) => {
    const g = groupsOf(activePoulailler()).find((x) => x.id === id);
    if (!g) return;
    popupMenu([
      { label: 'Modifier le groupe…', click: () => sendUi('shortcut', 'edit-group:' + id) },
      { label: g.collapsed ? 'Déplier' : 'Replier', click: () => commands['group.update']({ id, collapsed: !g.collapsed }) },
      { label: 'Nouvel onglet dans ce groupe', click: () => commands['group.newTab'](id) },
      { label: 'Ranger automatiquement ses sites', type: 'checkbox', checked: g.auto, click: () => commands['group.update']({ id, auto: !g.auto }) },
      { type: 'separator' },
      { label: 'Dégrouper', click: () => commands['group.ungroup'](id) },
      { label: 'Fermer les onglets du groupe', click: () => commands['group.closeTabs'](id) },
    ]);
  },
  'archive.restore': (i) => {
    const a = store.state.archive || [];
    const item = a[i];
    if (!item) return;
    a.splice(i, 1);
    openTab({ url: item.url });
  },
  'archive.clear': () => { store.state.archive = []; store.save(); scheduleBroadcast(); },
  'tab.listMenu': () => {
    const p = activePoulailler();
    const groups = new Map(groupsOf(p).map((g) => [g.id, g]));
    const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
    const item = (t) => ({ label: (t.title || t.url || 'Onglet').slice(0, 70), type: 'checkbox', checked: t.id === currentTabId, sublabel: host(t.url), click: () => activateTab(t.id) });
    const tpl = [];
    if (store.state.favorites.length) tpl.push({ label: 'Favoris', enabled: false }, ...store.state.favorites.map(item), { type: 'separator' });
    const pinned = p.tabs.filter((t) => t.pinned);
    if (pinned.length) tpl.push({ label: 'Épinglés', enabled: false }, ...pinned.map(item), { type: 'separator' });
    let lastGroup;
    for (const t of p.tabs.filter((x) => !x.pinned)) {
      const g = t.groupId && groups.get(t.groupId);
      if ((g ? g.id : null) !== lastGroup) {
        if (g) tpl.push({ type: 'separator' }, { label: '🥚 ' + g.name, enabled: false });
        else if (lastGroup) tpl.push({ type: 'separator' });
        lastGroup = g ? g.id : null;
      }
      tpl.push(item(t));
    }
    if (!tpl.length) tpl.push({ label: 'Aucun onglet', enabled: false });
    popupMenu(tpl);
  },
  // Fenêtre : Chromium dessine ses propres boutons réduire / agrandir / fermer.
  'window.minimize': async () => chrome.windows.update(await mainWindow(), { state: 'minimized' }),
  'window.maximize': async () => {
    const id = await mainWindow();
    const w = await chrome.windows.get(id);
    return chrome.windows.update(id, { state: w.state === 'maximized' ? 'normal' : 'maximized' });
  },
  'window.close': async () => chrome.windows.remove(await mainWindow()),
  'views.hidden': () => null,
  // Fond flouté derrière les écrans de l'interface : inutile dans Chromium (la page reste visible).
  capture: () => null,
  // Grand écran demandé par la barre : une page en pleine fenêtre, réutilisée si elle est
  // déjà ouverte.
  'ui.page': ({ name, arg } = {}) => {
    const page = UI_PAGES[name];
    if (!page) return;
    const url = 'pouley://' + page + (arg ? '?arg=' + encodeURIComponent(arg) : '');
    const p = activePoulailler();
    const open = p.tabs.find((t) => t.url.startsWith('pouley://' + page));
    if (open) { navigate(open.id, url); activateTab(open.id); } else openTab({ url });
  },
};

// Pages de PouleyPwolu ouvertes en pleine fenêtre (réglages, accueil…).
export function openPage(name, query = '') {
  openTab({ url: chrome.runtime.getURL('pages/' + name + '.html') + query });
}

// ─────────────────────────────────────────────────────────────────────────────
// Événements des onglets Chromium

// Onglet créé par Chromium (lien « nouvel onglet », popup, Ctrl+T natif…) : il rejoint la barre.
chrome.tabs.onCreated.addListener((tab) => {
  setTimeout(async () => {
    await ready;
    if (byChrome.has(tab.id) || tab.windowId === undefined) return;
    // Nos propres créations sont liées dès que chrome.tabs.create répond.
    if ([...creating.keys()].length) await Promise.allSettled([...creating.values()]);
    if (byChrome.has(tab.id)) return;
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!win || win.type !== 'normal') return;
    const opener = tab.openerTabId != null ? byChrome.get(tab.openerTabId) : null;
    const of = opener && findTab(opener);
    const url = fromChrome(tab.pendingUrl || tab.url);
    if (isChromeNewTab(tab.pendingUrl || tab.url)) chrome.tabs.update(tab.id, { url: NEWTAB }).catch(() => {});
    openTab({
      url, adopt: tab.id, background: !tab.active,
      poulaillerId: of && of.poulailler ? of.poulailler.id : undefined,
      groupId: of && of.rec.groupId, ephemeral: of && of.rec.ephemeral,
    });
  }, 50);
});

chrome.tabs.onRemoved.addListener(async (chromeId, info) => {
  await ready;
  if (expectedRemovals.delete(chromeId)) return;
  const recId = byChrome.get(chromeId);
  if (!recId) return;
  unbind(recId);
  // Fenêtre fermée : les onglets s'endorment mais restent dans la barre.
  if (info.isWindowClosing) return scheduleBroadcast();
  closeTab(recId);
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  await ready;
  const recId = byChrome.get(tabId);
  if (!recId || recId === currentTabId) return;
  const f = findTab(recId);
  if (!f) return;
  currentTabId = recId;
  f.rec.lastActive = Date.now();
  if (f.poulailler) { f.poulailler.activeTab = recId; store.state.activePoulailler = f.poulailler.id; }
  store.save();
  persistBindings();
  scheduleBroadcast();
});

chrome.tabs.onUpdated.addListener(async (chromeId, change, tab) => {
  await ready;
  const recId = byChrome.get(chromeId);
  if (!recId) return;
  const rt = runtime.get(recId);
  const patch = {};
  if (change.status) rt.loading = change.status === 'loading';
  if (change.url) {
    patch.url = fromChrome(change.url);
    rt.https = change.url.startsWith('https:');
    rt.penOn = false;
  }
  if (change.url && isChromeNewTab(change.url)) chrome.tabs.update(chromeId, { url: NEWTAB }).catch(() => {});
  if (change.title && !/^chrome-extension:\/\/[a-p]{32}\/?$/.test(change.title)) patch.title = change.title;
  if (change.favIconUrl !== undefined) patch.favicon = change.favIconUrl || null;
  if (change.audible !== undefined) rt.audible = change.audible;
  if (change.mutedInfo) rt.muted = change.mutedInfo.muted;
  if (Object.keys(patch).length) updateRec(recId, patch);
  if (change.url) autoGroupTab(recId);
  scheduleBroadcast();
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const w = await chrome.windows.get(windowId).catch(() => null);
  if (w && w.type === 'normal') { mainWindowId = windowId; persistBindings(); }
});

// Bouclier et cookies tiers, d'après les réglages.
export async function applyPrivacy() {
  const s = S();
  await applyShield(s);
  await chrome.privacy.websites.thirdPartyCookiesAllowed.set({ value: !s.blockThirdPartyCookies }).catch(() => {});
}

// Traqueurs bloqués par onglet (compteur du bouclier).
chrome.declarativeNetRequest.onRuleMatchedDebug?.addListener((m) => {
  const recId = byChrome.get(m.request.tabId);
  const rt = recId && runtime.get(recId);
  if (rt && m.rule.ruleId >= 1000) { rt.blocked = (rt.blocked || 0) + 1; scheduleBroadcast(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Démarrage : état, liens avec les onglets Chromium déjà ouverts

async function start() {
  await store.load();
  const sess = await chrome.storage.session.get(['bindings', 'currentTabId', 'mainWindowId']);
  const open = new Map((await chrome.tabs.query({})).map((t) => [t.id, t]));
  // Le service worker a été mis en sommeil : on retrouve les liens.
  for (const [chromeId, recId] of sess.bindings || []) {
    if (open.has(chromeId) && findTab(recId)) bind(recId, chromeId);
  }
  if (sess.mainWindowId != null) mainWindowId = sess.mainWindowId;
  if (sess.currentTabId && findTab(sess.currentTabId)) currentTabId = sess.currentTabId;
  // Démarrage du navigateur : les onglets Chromium restaurés ou ouverts sans nous
  // (page de démarrage) sont rattachés à la barre, par adresse si possible.
  const free = [...open.values()].filter((t) => !byChrome.has(t.id) && t.windowId != null);
  for (const tab of free) {
    const win = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!win || win.type !== 'normal') continue;
    const url = fromChrome(tab.pendingUrl || tab.url);
    const known = store.state.poulaillers.flatMap((p) => p.tabs).concat(store.state.favorites)
      .find((r) => r.url === url && !runtime.get(r.id)?.chromeId);
    if (known) bind(known.id, tab.id);
    else openTab({ url, adopt: tab.id, background: !tab.active });
    if (tab.active) currentTabId = byChrome.get(tab.id);
  }
  // Premier lancement : l'histoire d'installation, en pleine fenêtre.
  if (!store.state.onboarded && !store.state.poulaillers.some((p) => p.tabs.some((t) => t.url === 'pouley://onboarding'))) {
    openTab({ url: 'pouley://onboarding' });
  }
  if (!currentTabId) {
    const p = activePoulailler();
    const target = p.tabs.find((t) => t.id === p.activeTab) || p.tabs.find((t) => !t.pinned);
    if (target) activateTab(target.id);
  }
  await applyPrivacy();
  chrome.alarms.create('pouley-menage', { periodInMinutes: 1 });
  chrome.alarms.create('pouley-focus', { periodInMinutes: 0.25 });
  scheduleBroadcast();
}

export const ready = start();

chrome.alarms.onAlarm.addListener(async (a) => {
  await ready;
  if (a.name === 'pouley-menage') housekeeping();
  if (a.name === 'pouley-focus') focusTick();
});

// Productivité : toutes les 15 s, le site affiché rapporte une plume ou un tender.
async function focusTick() {
  if (S().focusEnabled === false) return;
  const f = currentTabId && findTab(currentTabId);
  if (!f) return;
  const w = await chrome.windows.getLastFocused().catch(() => null);
  if (!w || !w.focused || w.state === 'minimized') return;
  const idle = await new Promise((r) => chrome.idle ? chrome.idle.queryState(90, r) : r('active'));
  const rt = runtime.get(currentTabId);
  const r = focus.tick(store.state, f.rec.url, 15, { idle: idle === 'active' ? 0 : 600, audible: !!(rt && rt.audible), sites: S().focusSites });
  if (!r) return;
  if (r.nudge && S().focusNudge !== false) sendUi('toast', { text: `${r.nudge.tenders} tenders aujourd’hui, surtout sur ${r.nudge.site}. Pouley préférerait des plumes !` });
  store.save();
  scheduleBroadcast();
}

// ─────────────────────────────────────────────────────────────────────────────
// Lien avec les barres PouleyPwolu (ports « ui »)

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'ui' || !port.sender.url.startsWith(EXT)) return;
  ports.add(port);
  port.onDisconnect.addListener(() => ports.delete(port));
  port.onMessage.addListener(async (msg) => {
    await ready;
    if (msg.type === 'state') return port.postMessage({ type: 'reply', id: msg.id, result: snapshot() });
    if (msg.type !== 'cmd') return;
    const fn = commands[msg.name];
    let result = null;
    let error = null;
    if (!fn) console.warn('[commande inconnue]', msg.name);
    else {
      try { result = await fn(msg.arg); } catch (err) { error = String(err && err.message || err); console.error('[commande]', msg.name, err); }
    }
    try { port.postMessage({ type: 'reply', id: msg.id, result: result ?? null, error }); } catch {}
  });
});

export { openTab, activateTab, closeTab, findTab, activePoulailler, scheduleBroadcast, popupMenu, runtime, byChrome };
export const current = () => currentTabId;
