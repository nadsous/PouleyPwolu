// PouleyPwolu — processus principal.
// Un navigateur Chromium (via Electron) léger, sans télémétrie, avec bouclier
// anti-traqueurs, rapport de confidentialité, détecteur de technos et
// « poulaillers » (espaces façon Arc).
const {
  app, BrowserWindow, WebContentsView, ipcMain, session, protocol, net, Menu,
  clipboard, shell, nativeImage, screen, dialog, powerMonitor,
} = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const { Store, makePoulailler } = require('./store');
const { classify, shouldBlock, siteOf } = require('./trackers');
const { newReport, summarize, addUnique } = require('./privacy');
const { detect, GLOBAL_PATHS } = require('./techdetect');
const analyzePage = require('./analyze-page');
const { SEARCH_ENGINES, AI_PROVIDERS, fill, keywordSearch } = require('../shared/config');
const { normalize } = require('../shared/icons');
const { Vault, generate: generatePassword, parseCsv } = require('./vault');
const { shred } = require('./seal');
const { SessionKeep } = require('./session-keep');
const focus = require('./focus');
const aiDetect = require('./ai-detect');
const { createExtHost } = require('./ext-host');

const ROOT = path.join(__dirname, '..', '..');
const PAGE_PRELOAD = path.join(__dirname, '..', 'preload', 'page.js');
const UI_PRELOAD = path.join(__dirname, '..', 'preload', 'ui.js');
const FLOAT_PRELOAD = path.join(__dirname, '..', 'preload', 'float.js');
const FLOAT_BAR = 36; // hauteur de la barre des fenêtres flottantes
const ICON = path.join(ROOT, 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png');

// ─────────────────────────────────────────────────────────────────────────────
// Durcissement Chromium : aucune connexion « maison », pas de rapport de crash.
// Electron n'embarque déjà ni services Google, ni Safe Browsing, ni métriques.
app.commandLine.appendSwitch('disable-features', [
  'MediaRouter', 'OptimizationHints', 'Translate', 'AutofillServerCommunication',
  'InterestFeedContentSuggestions', 'PrivacySandboxSettings4', 'FledgeInterestGroups',
  'BrowsingTopics', 'AttributionReportingCrossAppWeb', 'InterestGroupStorage',
  'SpareRendererForSitePerProcess', 'DialMediaRouteProvider',
].join(','));
app.commandLine.appendSwitch('disable-domain-reliability');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');
app.commandLine.appendSwitch('enable-features', 'PartitionedCookies,ThirdPartyStoragePartitioning');
app.setAppUserModelId('site.nads.pouleypwolu');
// Profil séparé (tests, ou plusieurs profils) : POULEY_PROFILE=<dossier>
if (process.env.POULEY_PROFILE) app.setPath('userData', path.resolve(process.env.POULEY_PROFILE));

// Le cache des pages (copies des sites visités) ne doit pas rester sur le
// disque : on le vide avant que Chromium ne démarre, ce qui couvre aussi les
// plantages. Le fichier témoin « garder-cache » désactive ce nettoyage.
function wipeDiskCaches() {
  const base = app.getPath('userData');
  if (fs.existsSync(path.join(base, 'garder-cache'))) return;
  let parts = [];
  try { parts = fs.readdirSync(path.join(base, 'Partitions')).map((d) => path.join(base, 'Partitions', d)); } catch {}
  for (const d of [base, ...parts]) {
    for (const sub of ['Cache', 'Code Cache']) {
      try { fs.rmSync(path.join(d, sub), { recursive: true, force: true }); } catch {}
    }
  }
}
wipeDiskCaches();

protocol.registerSchemesAsPrivileged([
  { scheme: 'pouley', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// ─────────────────────────────────────────────────────────────────────────────
let store;
let win = null;
let currentTabId = null;
let layout = { content: null, ai: null };
let viewsHidden = false;
let aiView = null;
let aiOpen = false;
let htmlFullscreenTab = null;
let broadcastTimer = null;
let peekTimer = null;
let peekInside = null;
let lastCapture = null; // image gardée pour découper une zone sélectionnée
const floats = new Map(); // tabId -> fenêtre flottante (superposition)
let split = null; // côte à côte : { a, b, ratio } (a = gauche, b = droite)

const runtime = new Map(); // tabId -> { view, loading, canGoBack, canGoForward, report, audible, … }
const wcToTab = new Map(); // webContents.id -> tabId
const httpExceptions = new Set(); // hôtes autorisés en HTTP (session seulement)
const grants = new Map(); // `${partition}|${origin}|${permission}` -> bool (session seulement)
const pendingPermissions = new Map();
const configuredSessions = new WeakSet();
const certInfo = new Map(); // hostname -> certificat vu
const closedTabs = [];
const downloads = new Map();

const S = () => store.state.settings;
const ui = () => (win && !win.isDestroyed() ? win.webContents : null);
const sendUi = (channel, payload) => { const w = ui(); if (w) w.send(channel, payload); };

// ─────────────────────────────────────────────────────────────────────────────
// Extensions Chrome préinstallées (dossier extensions/, décompressé hors de l'asar)

const EXT_ROOT = path.join(ROOT, 'extensions').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
const NADSPDF_APP = ['C:\\Program Files\\NadsPDF\\nadspdf.exe', path.join(process.env.LOCALAPPDATA || '', 'Programs', 'NADSPDF', 'nadspdf.exe')]
  .find((p) => p && fs.existsSync(p)) || null;
const EXTENSIONS = [
  {
    key: 'nadspdf', setting: 'extNadspdf', dir: path.join(EXT_ROOT, 'nadspdf'),
    status: 'Préinstallée · en cours de validation sur le Chrome Web Store',
    handlesPdf: true,
  },
].map((e) => {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(e.dir, 'manifest.json'), 'utf8'));
    const iconFile = path.join(e.dir, (m.icons && (m.icons['48'] || m.icons['128'])) || 'icons/48.png');
    const icon = fs.existsSync(iconFile) ? 'data:image/png;base64,' + fs.readFileSync(iconFile).toString('base64') : null;
    return { ...e, name: m.name, version: m.version, description: m.description, icon, available: true };
  } catch {
    return { ...e, name: e.key, available: false };
  }
});
const extIds = new Map(); // session -> { cléExtension: id Chrome }
const extLoading = new Map(); // session -> Promise
const allSessions = new Set();
let sessionKeep = null;
let extHost = null; // extensions du Chrome Web Store (ext-host.js)

function extEnabled(e) { return e.available && store && store.state.settings[e.setting] !== false; }

function loadExtensionsInto(ses) {
  const api = ses.extensions || ses;
  const jobs = EXTENSIONS.filter(extEnabled).map(async (e) => {
    const ids = extIds.get(ses) || {};
    if (ids[e.key]) return;
    try {
      const ext = await api.loadExtension(e.dir, { allowFileAccess: true });
      ids[e.key] = ext.id;
      extIds.set(ses, ids);
    } catch (err) {
      console.warn('[extension]', e.key, err.message);
    }
  });
  const p = Promise.all([...jobs, extHost ? extHost.loadInto(ses) : null]);
  extLoading.set(ses, p);
  return p;
}

function unloadExtension(e) {
  for (const ses of allSessions) {
    const ids = extIds.get(ses);
    if (!ids || !ids[e.key]) continue;
    try { (ses.extensions || ses).removeExtension(ids[e.key]); } catch {}
    delete ids[e.key];
  }
}

// Lecteur NadsPDF : mêmes règles que le rules.json de l'extension.
const PDF_URL = /^(https?|file):\/\/[^?#]*\.pdf([?#].*)?$/i;
function pdfViewerUrl(ses, url) {
  const e = EXTENSIONS.find((x) => x.handlesPdf && extEnabled(x));
  const id = e && (extIds.get(ses) || {})[e.key];
  return id ? `chrome-extension://${id}/index.html?lite=1&lang=fr#file=${url}` : null;
}
async function nadspdfUrl(file) {
  const p = activePoulailler();
  const ses = session.fromPartition(partitionFor(null, p));
  configureSession(ses, partitionFor(null, p));
  await (extLoading.get(ses) || loadExtensionsInto(ses));
  const id = (extIds.get(ses) || {}).nadspdf;
  if (!id) return null;
  return `chrome-extension://${id}/index.html?lite=1&lang=fr` + (file ? '#file=' + file : '');
}

const COMET_EXE = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, 'Perplexity', 'Comet', 'Application', 'comet.exe')
  : null;
const cometAvailable = () => !!COMET_EXE && fs.existsSync(COMET_EXE);

// ─────────────────────────────────────────────────────────────────────────────
// Modèle : onglets, favoris, poulaillers

const uid = (p) => p + Math.random().toString(36).slice(2, 10);

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

function partitionFor(rec, poulailler) {
  if (rec && rec.ephemeral) return 'pouley-ephemere-' + rec.id;
  if (!poulailler || !poulailler.isolated) return 'persist:pouley-commun';
  return 'persist:poulailler-' + poulailler.id;
}

function makeTab(url, extra = {}) {
  // Un onglet pas encore chargé porte le nom de son site plutôt que « Nouvel onglet ».
  let title = 'Nouvel onglet';
  try { if (/^https?:/.test(url || '')) title = new URL(url).hostname.replace(/^www./, ''); } catch {}
  return { id: uid('t'), url: url || 'pouley://newtab', title, favicon: null, pinned: false, lastActive: Date.now(), ...extra };
}

function isLocalHost(host) {
  return host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
    /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host) || host === '[::1]';
}

// Transforme ce que l'utilisateur tape en URL (adresse, recherche, ou question IA).
function resolveInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return 'pouley://newtab';
  if (text.startsWith('?')) return askUrl(text.slice(1).trim());
  const kw = keywordSearch(text);
  if (kw) return kw.target;
  if (/^(https?|pouley|file|view-source|chrome-extension):/i.test(text)) return text;
  if (/^(javascript|data|vbscript):/i.test(text)) return searchUrl(text);
  if (/^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?(\/.*)?$/i.test(text)) return 'http://' + text;
  if (!/\s/.test(text) && /^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9-]{1,62}(:\d+)?(\/.*)?$/i.test(text)) return 'https://' + text;
  return searchUrl(text);
}

function searchUrl(q) {
  const engine = SEARCH_ENGINES[S().searchEngine] || SEARCH_ENGINES.duckduckgo;
  return fill(engine.url, q);
}

// Second choix : un moteur classique, proposé quand Perplexity (Comet) est le
// moteur par défaut (une réponse d'IA n'est pas toujours ce qu'on cherche).
function secondEngine() {
  if (S().searchEngine !== 'comet') return null;
  const k = S().searchEngine2;
  return k && k !== 'comet' && SEARCH_ENGINES[k] ? k : 'duckduckgo';
}
function searchUrl2(q) {
  const k = secondEngine();
  return k ? fill(SEARCH_ENGINES[k].url, q) : searchUrl(q);
}

function askUrl(q) {
  const ai = AI_PROVIDERS[S().ai] || AI_PROVIDERS.claude;
  return q ? fill(ai.ask, q) : ai.home;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sessions : bouclier, cookies, permissions, pages internes

function cleanUserAgent(ua) {
  return ua
    .replace(/\s?Electron\/[\d.]+/i, '')
    .replace(/\s?pouleypwolu\/[\d.]+/i, '')
    .replace(/Chrome\/(\d+)[\d.]*/, 'Chrome/$1.0.0.0');
}

// Connexion Google : Google refuse les navigateurs « intégrés » (Electron) avec
// « Ce navigateur ou cette application ne sont peut-être pas sécurisés ». Il les
// reconnaît à leur marque : Electron s'annonce « Chromium », pas « Google
// Chrome ». PouleyPwolu utilise le même moteur que Chrome 152 : sur la page de
// connexion seulement, il s'annonce donc comme Google Chrome 152, dans les
// en-têtes et dans le JavaScript (réglé par le moteur, invisible pour la page).
const GOOGLE_LOGIN = new Set(['accounts.google.com', 'accounts.youtube.com']);
const CHROME_MAJOR = process.versions.chrome.split('.')[0];
const CHROME_UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`;
const CHROME_BRANDS = [['Google Chrome', CHROME_MAJOR], ['Chromium', CHROME_MAJOR], ['Not?A_Brand', '24']];
const CHROME_SEC_CH_UA = CHROME_BRANDS.map(([b, v]) => `"${b}";v="${v}"`).join(', ');
const CHROME_METADATA = {
  brands: CHROME_BRANDS.map(([brand, version]) => ({ brand, version })),
  fullVersionList: CHROME_BRANDS.map(([brand, v]) => ({ brand, version: brand === 'Not?A_Brand' ? '24.0.0.0' : process.versions.chrome })),
  fullVersion: process.versions.chrome,
  platform: 'Windows', platformVersion: '19.0.0', architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false, formFactors: ['Desktop'],
};
const isGoogleLogin = (url) => { try { return GOOGLE_LOGIN.has(new URL(url).hostname); } catch { return false; } };
async function googleIdentity(wc, on) {
  const dbg = wc.debugger;
  try {
    if (on) {
      if (!dbg.isAttached()) { dbg.attach('1.3'); wc.__googleDbg = true; }
      await dbg.sendCommand('Emulation.setUserAgentOverride', { userAgent: CHROME_UA, platform: 'Win32', userAgentMetadata: CHROME_METADATA });
    } else if (wc.__googleDbg) {
      wc.__googleDbg = false;
      if (dbg.isAttached()) dbg.detach();
    }
  } catch (err) {
    console.warn('[google]', err.message);
  }
}

function tabForContents(id) {
  const tabId = wcToTab.get(id);
  return tabId ? runtime.get(tabId) : null;
}

function headerKeys(headers, name) {
  return Object.keys(headers).filter((k) => k.toLowerCase() === name);
}

function raiseAlert(tabId, rt, kind, text) {
  if (!rt || !rt.report || rt.report.alerted[kind]) return;
  rt.report.alerted[kind] = true;
  sendUi('privacy:alert', { tabId, kind, text });
}

const PERMISSION_LABELS = {
  media: 'caméra / micro',
  geolocation: 'position géographique',
  notifications: 'notifications',
  midi: 'appareils MIDI',
  midiSysex: 'appareils MIDI',
  'clipboard-read': 'lecture du presse-papiers',
  pointerLock: 'capture du pointeur',
  openExternal: 'ouvrir une application externe',
  'display-capture': 'capture de l’écran',
  'speaker-selection': 'choix des haut-parleurs',
  'keyboardLock': 'capture du clavier',
  hid: 'périphériques HID',
  serial: 'ports série',
  usb: 'périphériques USB',
};
const PERMISSION_AUTO = {
  fullscreen: true,
  'clipboard-sanitized-write': true,
  'window-management': false,
  'idle-detection': false,
  'storage-access': false,
  'top-level-storage-access': false,
  'persistent-storage': false,
};

function configureSession(ses, partition) {
  if (configuredSessions.has(ses)) return;
  configuredSessions.add(ses);

  allSessions.add(ses);
  if (extHost) extHost.registerSession(ses);
  loadExtensionsInto(ses);
  ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
  // Le correcteur orthographique télécharge des dictionnaires chez Google : coupé.
  ses.setSpellCheckerEnabled(false);
  ses.protocol.handle('pouley', handleInternal);

  ses.setCertificateVerifyProc((req, callback) => {
    const c = req.certificate;
    certInfo.set(req.hostname, {
      issuer: c.issuerName || (c.issuer && c.issuer.commonName) || '',
      subject: c.subjectName || '',
      validExpiry: c.validExpiry ? c.validExpiry * 1000 : null,
      ok: req.verificationResult === 'net::OK',
    });
    callback(-3); // garder la vérification de Chromium
  });

  ses.webRequest.onBeforeRequest((details, cb) => {
    const tabId = wcToTab.get(details.webContentsId);
    const rt = tabId ? runtime.get(tabId) : null;
    const url = details.url;

    if (details.resourceType === 'mainFrame') {
      let u = null;
      try { u = new URL(url); } catch {}
      if (u && u.protocol === 'http:' && S().httpsOnly && !isLocalHost(u.hostname) && !httpExceptions.has(u.hostname)) {
        if (rt) rt.upgradedFrom = url;
        return cb({ redirectURL: 'https:' + url.slice(5) });
      }
      if (rt && PDF_URL.test(url) && !rt.rawPdf) {
        const viewer = pdfViewerUrl(ses, url);
        if (viewer) return cb({ redirectURL: viewer });
      }
      if (rt) rt.rawPdf = false;
      if (rt && u && /^https?:$/.test(u.protocol)) {
        const upgraded = rt.upgradedFrom && rt.upgradedFrom.slice(5) === url.slice(6);
        rt.report = newReport(url, siteOf(u.hostname));
        rt.report.upgradedToHttps = !!upgraded;
      }
      return cb({});
    }
    if (!/^(https?|wss?):/.test(url)) return cb({});

    let reqSite = '';
    try { reqSite = siteOf(new URL(url).hostname); } catch {}
    const report = rt && rt.report;
    const thirdParty = !report || reqSite !== report.site;
    if (report && thirdParty && reqSite) report.thirdParties[reqSite] = (report.thirdParties[reqSite] || 0) + 1;

    const hit = thirdParty ? classify(url) : null;
    if (hit) {
      if (shouldBlock(hit, S().shieldLevel)) {
        if (report) {
          if (report.blocked.length < 300) report.blocked.push({ domain: hit.domain, category: hit.category, type: details.resourceType });
          report.blockedByCategory[hit.category] = (report.blockedByCategory[hit.category] || 0) + 1;
          if (hit.category === 'session') raiseAlert(tabId, rt, 'session', `Ce site voulait enregistrer tes clics et mouvements (${hit.domain}). Bloqué.`);
          if (hit.category === 'fingerprint') raiseAlert(tabId, rt, 'fp-tracker', `Service d’empreinte numérique bloqué (${hit.domain}).`);
          if (report.blocked.length === 15) raiseAlert(tabId, rt, 'many', 'Plus de 15 traqueurs bloqués sur cette page.');
          scheduleBroadcast();
        }
        return cb({ cancel: true });
      }
      if (report) addUnique(report.allowedTrackers, hit.domain, 40);
    }
    cb({});
  });

  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders;
    if (isGoogleLogin(details.url)) {
      for (const k of Object.keys(h)) if (/^user-agent$/i.test(k) || /^sec-ch-ua/i.test(k)) delete h[k];
      h['User-Agent'] = CHROME_UA;
      h['sec-ch-ua'] = CHROME_SEC_CH_UA;
      h['sec-ch-ua-mobile'] = '?0';
      h['sec-ch-ua-platform'] = '"Windows"';
    }
    if (S().sendGpc) {
      h['Sec-GPC'] = '1';
      h['DNT'] = '1';
    }
    if (details.resourceType !== 'mainFrame') {
      const rt = tabForContents(details.webContentsId);
      const report = rt && rt.report;
      let reqSite = '';
      try { reqSite = siteOf(new URL(details.url).hostname); } catch {}
      if (report && reqSite && reqSite !== report.site) {
        if (S().blockThirdPartyCookies) for (const k of headerKeys(h, 'cookie')) delete h[k];
        // Le site tiers ne voit que l'origine, pas la page exacte visitée.
        for (const k of headerKeys(h, 'referer')) {
          try { h[k] = new URL(h[k]).origin + '/'; } catch { delete h[k]; }
        }
      }
    }
    cb({ requestHeaders: h });
  });

  ses.webRequest.onHeadersReceived((details, cb) => {
    const rt = tabForContents(details.webContentsId);
    const report = rt && rt.report;
    if (!report) return cb({});
    const headers = details.responseHeaders || {};
    const cookieKeys = headerKeys(headers, 'set-cookie');
    const names = [];
    for (const k of cookieKeys) for (const c of headers[k] || []) names.push(String(c).split('=')[0].trim());

    if (details.resourceType === 'mainFrame') {
      const ctype = String(Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '');
      if (/application\/(x-)?pdf/i.test(ctype) && details.method === 'GET') {
        const viewer = pdfViewerUrl(ses, details.url);
        const tabWc = rt && rt.view && rt.view.webContents;
        if (viewer && tabWc) {
          setImmediate(() => tabWc.loadURL(viewer).catch(() => {}));
          return cb({ cancel: true });
        }
      }
      report.headers = {};
      for (const [k, v] of Object.entries(headers)) report.headers[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
      for (const n of names) addUnique(report.cookies.firstParty, n);
      return cb({});
    }
    let reqSite = '';
    try { reqSite = siteOf(new URL(details.url).hostname); } catch {}
    // Appels d'API du site (fetch / XHR) : on garde les en-têtes qui trahissent
    // le backend, et les chemins qui répondent en JSON.
    if (reqSite === report.site && (details.resourceType === 'xhr' || details.resourceType === 'other')) {
      const KEEP = ['server', 'x-powered-by', 'x-runtime', 'x-aspnet-version', 'x-generator', 'via', 'x-served-by', 'x-deno-ray', 'x-fastify', 'x-hono'];
      for (const [k, v] of Object.entries(headers)) {
        const key = k.toLowerCase();
        if (!KEEP.includes(key)) continue;
        const vals = report.apiHeaders[key] || (report.apiHeaders[key] = []);
        for (const one of [].concat(v)) if (!vals.includes(String(one)) && vals.length < 6) vals.push(String(one));
      }
      const ctype = String(Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-type')?.[1] || '');
      if (/json/i.test(ctype) && report.apiPaths.length < 12) {
        try { const p = new URL(details.url).pathname; if (!report.apiPaths.includes(p)) report.apiPaths.push(p); } catch {}
      }
    }
    if (names.length && reqSite && reqSite !== report.site) {
      if (S().blockThirdPartyCookies) {
        report.cookies.thirdPartyBlocked += names.length;
        for (const k of cookieKeys) delete headers[k];
        return cb({ responseHeaders: headers });
      }
      for (const n of names) addUnique(report.cookies.thirdPartyAllowed, `${reqSite} · ${n}`);
    } else {
      for (const n of names) addUnique(report.cookies.firstParty, n);
    }
    cb({});
  });

  ses.setPermissionRequestHandler((wc, permission, callback, details) => {
    if (permission in PERMISSION_AUTO) return callback(PERMISSION_AUTO[permission]);
    let origin = '';
    try { origin = new URL(details.requestingUrl || wc.getURL()).origin; } catch {}
    const key = `${partition}|${origin}|${permission}`;
    const tabId = wcToTab.get(wc.id) || null;
    const rt = tabId ? runtime.get(tabId) : null;
    let label = PERMISSION_LABELS[permission] || permission;
    if (permission === 'media' && details.mediaTypes) {
      const t = details.mediaTypes;
      label = t.includes('video') && t.includes('audio') ? 'caméra et micro' : t.includes('video') ? 'caméra' : 'micro';
    }
    const record = (granted) => {
      if (rt && rt.report) rt.report.permissions.push({ permission, label, granted });
    };
    if (grants.has(key)) {
      record(grants.get(key));
      return callback(grants.get(key));
    }
    if (!origin.startsWith('https:') && !origin.startsWith('http://localhost')) {
      record(false);
      return callback(false);
    }
    const reqId = uid('perm');
    const timeout = setTimeout(() => respondPermission({ reqId, allow: false }), 60000);
    pendingPermissions.set(reqId, { callback, key, record, timeout });
    sendUi('permission:ask', { reqId, origin, permission, label, tabId });
  });

  ses.setPermissionCheckHandler((wc, permission, origin) => {
    if (PERMISSION_AUTO[permission]) return true;
    return grants.get(`${partition}|${origin}|${permission}`) === true;
  });
  ses.setDevicePermissionHandler(() => false);

  ses.on('will-download', (event, item) => {
    const dir = app.getPath('downloads');
    const parsed = path.parse(item.getFilename() || 'telechargement');
    let target = path.join(dir, parsed.base);
    for (let i = 1; fs.existsSync(target) && i < 500; i++) target = path.join(dir, `${parsed.name} (${i})${parsed.ext}`);
    item.setSavePath(target);
    const id = uid('dl');
    const info = { id, name: path.basename(target), path: target, received: 0, total: item.getTotalBytes(), state: 'progressing', nadspdf: !!NADSPDF_APP && /\.pdf$/i.test(target) };
    downloads.set(id, info);
    sendUi('download', info);
    item.on('updated', (_e, state) => {
      info.received = item.getReceivedBytes();
      info.state = state;
      sendUi('download', info);
    });
    item.once('done', (_e, state) => {
      info.state = state;
      info.received = item.getReceivedBytes();
      sendUi('download', info);
    });
  });
}

function respondPermission({ reqId, allow, remember }) {
  const p = pendingPermissions.get(reqId);
  if (!p) return;
  pendingPermissions.delete(reqId);
  clearTimeout(p.timeout);
  if (remember !== false) grants.set(p.key, !!allow);
  p.record(!!allow);
  p.callback(!!allow);
  sendUi('permission:done', { reqId });
}

// ─────────────────────────────────────────────────────────────────────────────
// Pages internes pouley://

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.json': 'application/json', '.txt': 'text/plain; charset=utf-8',
};
const INTERNAL_CSP = "default-src 'self' pouley:; script-src 'self' pouley: 'unsafe-inline'; style-src 'self' pouley: 'unsafe-inline'; img-src pouley: data: https:; font-src pouley:; connect-src 'none'; form-action pouley:";
const STATIC_ROOTS = {
  shared: path.join(ROOT, 'src', 'shared'),
  pages: path.join(ROOT, 'src', 'pages'),
  fonts: path.join(ROOT, 'assets'),
  build: path.join(ROOT, 'build'),
  legal: path.join(ROOT, 'legal'),
};

async function serveFile(file, replacements) {
  try {
    let body = await fs.promises.readFile(file);
    if (replacements) {
      let text = body.toString('utf8');
      for (const [k, v] of Object.entries(replacements)) text = text.split(k).join(v);
      body = Buffer.from(text, 'utf8');
    }
    return new Response(body, {
      headers: {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'access-control-allow-origin': '*',
        'content-security-policy': INTERNAL_CSP,
        'cache-control': 'no-store',
      },
    });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function handleInternal(request) {
  const u = new URL(request.url);
  const page = (name) => path.join(ROOT, 'src', 'pages', name);
  switch (u.hostname) {
    case 'search':
      return Response.redirect(searchUrl(u.searchParams.get('q') || ''), 302);
    case 'search2':
      return Response.redirect(searchUrl2(u.searchParams.get('q') || ''), 302);
    case 'ask':
      return Response.redirect(askUrl(u.searchParams.get('q') || ''), 302);
    case 'allow-http': {
      const target = u.searchParams.get('url') || '';
      try {
        const t = new URL(target);
        if (t.protocol !== 'http:') throw new Error('protocole');
        httpExceptions.add(t.hostname);
        return Response.redirect(t.href, 302);
      } catch {
        return new Response('Adresse invalide', { status: 400 });
      }
    }
    case 'newtab': {
      const engine = SEARCH_ENGINES[S().searchEngine] || SEARCH_ENGINES.duckduckgo;
      const ai = AI_PROVIDERS[S().ai] || AI_PROVIDERS.claude;
      return serveFile(page('newtab.html'), {
        '{{ENGINE}}': escapeHtml(engine.label), '{{AI}}': escapeHtml(ai.label),
        '{{ENGINE_KEY}}': escapeHtml(S().searchEngine), '{{AI_KEY}}': escapeHtml(S().ai),
        '{{ENGINE2}}': escapeHtml(secondEngine() ? SEARCH_ENGINES[secondEngine()].label : ''),
        '{{ENGINE2_KEY}}': escapeHtml(secondEngine() || ''),
        '{{ENGINE2_HIDDEN}}': secondEngine() ? '' : 'hidden',
      });
    }
    case 'jeu':
    case 'offline':
      return serveFile(page('jeu.html'));
    case 'erreur':
      return serveFile(page('erreur.html'));
    case 'static': {
      const [, rootKey, ...rest] = u.pathname.split('/');
      const base = STATIC_ROOTS[rootKey];
      if (!base) break;
      const file = path.normalize(path.join(base, ...rest.map(decodeURIComponent)));
      if (!file.startsWith(base + path.sep)) break;
      return serveFile(file);
    }
    default:
      break;
  }
  return new Response('Page interne inconnue', { status: 404 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Vues des onglets

const isErrorPage = (url) => /^pouley:\/\/(erreur|offline)/.test(url || '');

// Icônes de site : on essaie les candidates de la meilleure à la moins bonne
// (SVG, grand PNG, apple-touch, ICO), via la session de l'onglet, et on garde
// la première qui répond vraiment par une image, en data: URL. Ainsi une icône
// en 404 ou protégée par Cross-Origin-Resource-Policy n'empêche plus l'affichage.
const iconCache = new Map();
function iconScore(c) {
  const href = typeof c === 'string' ? c : c.href;
  const type = (c.type || '').toLowerCase();
  const size = Math.max(0, ...String(c.sizes || '').split(/\s+/).map((s) => parseInt(s, 10) || 0));
  let score = 0;
  if (/svg/.test(type) || /\.svg([?#]|$)/i.test(href)) score = 100;
  else if (/png|webp/.test(type) || /\.(png|webp)([?#]|$)/i.test(href)) score = 60 + Math.min(size, 128) / 4;
  else if (/apple-touch/.test(c.rel || '')) score = 55;
  else if (/^data:image\//.test(href)) score = 50;
  else score = 20; // .ico
  return score;
}
function sniffImage(b) {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (/^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(b.slice(0, 300).toString())) return 'image/svg+xml';
  return null;
}

// Dernier recours : lire l'en-tête de la page pour y trouver les icônes déclarées.
async function iconsFromHtml(ses, pageUrl) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await ses.fetch(pageUrl, { signal: ctrl.signal, headers: { accept: 'text/html' } }).finally(() => clearTimeout(timer));
    if (!res.ok || !/html/i.test(res.headers.get('content-type') || '')) return [];
    const head = (await res.text()).slice(0, 400000).split(/<\/head>/i)[0];
    const attr = (tag, name) => (new RegExp('\\b' + name + '=["\']?([^"\'>]+)', 'i').exec(tag) || [])[1] || '';
    const out = [];
    for (const m of head.matchAll(/<link\b[^>]*>/gi)) {
      const tag = m[0];
      const rel = attr(tag, 'rel');
      const href = attr(tag, 'href').trim();
      if (!/icon/i.test(rel) || !href) continue;
      try { out.push({ href: new URL(href.replace(/&amp;/g, '&'), res.url || pageUrl).href, rel, sizes: attr(tag, 'sizes'), type: attr(tag, 'type') }); } catch {}
    }
    return out.slice(0, 10);
  } catch {
    return [];
  }
}

async function fetchIcon(ses, href) {
  if (!href) return null;
  if (/^data:image\//.test(href)) return href.length < 300000 ? href : null;
  if (iconCache.has(href)) return iconCache.get(href);
  try {
    // Délai maximal : une icône qui ne répond pas ne doit rien bloquer.
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await ses.fetch(href, { signal: ctrl.signal, headers: { accept: 'image/avif,image/webp,image/svg+xml,image/*;q=0.8' } }).finally(() => clearTimeout(timer));
    let type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!res.ok) { iconCache.set(href, null); return null; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > 200000) { iconCache.set(href, null); return null; }
    // Type annoncé absent ou générique (ex. Twitch) : on reconnaît l'image à son contenu.
    if (!/^image\//.test(type)) type = sniffImage(buf);
    if (!type) { iconCache.set(href, null); return null; }
    const data = 'data:' + type + ';base64,' + buf.toString('base64');
    iconCache.set(href, data);
    return data;
  } catch {
    return null;
  }
}
async function bestIcon(ses, candidates, pageUrl) {
  const list = [...candidates];
  try { if (/^https?:/.test(pageUrl)) list.push({ href: new URL('/favicon.ico', pageUrl).href }); } catch {}
  const seen = new Set();
  const ranked = list.map((c) => (typeof c === 'string' ? { href: c } : c))
    .filter((c) => c.href && !seen.has(c.href) && seen.add(c.href))
    .sort((a, b) => iconScore(b) - iconScore(a));
  for (const c of ranked.slice(0, 6)) {
    const data = await fetchIcon(ses, c.href);
    if (data) return data;
  }
  // Rien trouvé : on cherche les icônes déclarées dans la page elle-même.
  if (/^https?:/.test(pageUrl || '')) {
    const declared = (await iconsFromHtml(ses, pageUrl)).filter((c) => !seen.has(c.href)).sort((a, b) => iconScore(b) - iconScore(a));
    for (const c of declared.slice(0, 4)) {
      const data = await fetchIcon(ses, c.href);
      if (data) return data;
    }
  }
  return null;
}

function currentSession() {
  const rt = currentTabId && runtime.get(currentTabId);
  if (rt && rt.view) return rt.view.webContents.session;
  const partition = partitionFor(null, activePoulailler());
  const ses = session.fromPartition(partition);
  configureSession(ses, partition);
  return ses;
}

function ensureView(tabId) {
  const found = findTab(tabId);
  if (!found) return null;
  let rt = runtime.get(tabId);
  if (rt && rt.view) return rt;
  rt = rt || { loading: false, canGoBack: false, canGoForward: false, report: null, audible: false };
  runtime.set(tabId, rt);

  const partition = partitionFor(found.rec, found.poulailler);
  configureSession(session.fromPartition(partition), partition);
  const view = new WebContentsView({
    webPreferences: {
      partition,
      preload: PAGE_PRELOAD,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      safeDialogs: true,
      navigateOnDragDrop: false,
      autoplayPolicy: 'document-user-activation-required',
    },
  });
  view.setBorderRadius(12);
  view.setBackgroundColor('#ffffff');
  view.setVisible(false);
  rt.view = view;
  rt.partition = partition;
  win.contentView.addChildView(view);
  const wc = view.webContents;
  wcToTab.set(wc.id, tabId);
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wireContents(tabId, wc);
  // Une navigation lancée pendant le chargement d’une extension reste bloquée :
  // on attend que les extensions de cette session soient prêtes.
  const start = () => { if (!wc.isDestroyed()) wc.loadURL(found.rec.url || 'pouley://newtab').catch(() => {}); };
  const ready = extLoading.get(session.fromPartition(partition));
  if (ready) ready.then(start, start); else start();
  return rt;
}

// keep : l'onglet ne fait que dormir, on garde son sessionStorage pour le réveil.
function destroyView(tabId, keep = true) {
  const rt = runtime.get(tabId);
  if (!rt || !rt.view) return;
  const view = rt.view;
  const saved = keep ? sessionKeep.snapshot(tabId, view.webContents, rt.partition) : Promise.resolve(sessionKeep.drop(tabId));
  const fw = floats.get(tabId);
  if (fw) {
    floats.delete(tabId);
    rt.floating = null;
    try { fw.contentView.removeChildView(view); } catch {}
    if (!fw.isDestroyed()) fw.destroy();
  }
  rt.view = null;
  rt.loading = false;
  wcToTab.delete(view.webContents.id);
  try { win.contentView.removeChildView(view); } catch {}
  saved.finally(() => { try { view.webContents.close(); } catch {} });
  if (rt.partition && rt.partition.startsWith('pouley-ephemere-')) {
    session.fromPartition(rt.partition).clearStorageData().catch(() => {});
  }
}

function updateRec(tabId, patch) {
  const f = findTab(tabId);
  if (!f) return;
  Object.assign(f.rec, patch);
  if (!f.rec.ephemeral) store.save();
  if (floats.has(tabId)) sendFloatInfo(tabId);
  scheduleBroadcast();
}

function wireContents(tabId, wc) {
  const rt = () => runtime.get(tabId);
  const nav = () => {
    const r = rt();
    if (!r) return;
    r.canGoBack = wc.navigationHistory.canGoBack();
    r.canGoForward = wc.navigationHistory.canGoForward();
  };

  wc.on('focus', () => {
    if (split && (tabId === split.a || tabId === split.b) && currentTabId !== tabId) {
      currentTabId = tabId;
      const f = findTab(tabId);
      if (f && f.poulailler) f.poulailler.activeTab = tabId;
      scheduleBroadcast();
    }
  });
  wc.on('did-start-loading', () => { const r = rt(); if (r) r.loading = true; scheduleBroadcast(); });
  wc.on('did-stop-loading', () => { const r = rt(); if (r) r.loading = false; nav(); scheduleBroadcast(); setTimeout(() => pollBadges().catch(() => {}), 2500); });
  wc.on('did-navigate', (_e, url) => {
    nav();
    { const r = rt(); if (r) r.penOn = false; } // la page change : le dessin disparaît avec elle
    if (!isErrorPage(url)) { updateRec(tabId, { url }); autoGroupTab(tabId); }
    const r = rt();
    if (r && url.startsWith('http:') && !isLocalHost(new URL(url).hostname)) {
      raiseAlert(tabId, r, 'http', 'Connexion non chiffrée : ce que tu tapes sur ce site peut être lu en chemin.');
    }
    scheduleBroadcast();
  });
  wc.on('did-navigate-in-page', (_e, url, isMainFrame) => {
    if (!isMainFrame) return;
    nav();
    updateRec(tabId, { url });
  });
  wc.on('page-title-updated', (_e, title) => {
    if (!isErrorPage(wc.getURL())) updateRec(tabId, { title });
  });
  wc.on('page-favicon-updated', async (_e, favicons) => {
    const pageUrl = wc.getURL();
    const icon = await bestIcon(wc.session, (favicons || []).filter((f) => /^https?:|^data:image\//.test(f)), pageUrl);
    if (!wc.isDestroyed() && wc.getURL() === pageUrl) updateRec(tabId, { favicon: icon });
  });
  wc.on('audio-state-changed', (e) => {
    const r = rt();
    if (r) r.audible = e.audible;
    if (e.audible) { mediaTab = tabId; mediaIdle = 0; pollMedia().catch(() => {}); }
    scheduleBroadcast();
  });
  wc.on('found-in-page', (_e, result) => sendUi('find:result', { tabId, active: result.activeMatchOrdinal, matches: result.matches }));

  wc.on('did-fail-load', (_e, code, desc, validatedURL, isMainFrame) => {
    if (!isMainFrame || code === -3 || isErrorPage(validatedURL)) return;
    const r = rt();
    const q = (o) => new URLSearchParams(o).toString();
    if (code === -106 || !net.isOnline()) {
      wc.loadURL('pouley://offline/?' + q({ url: validatedURL })).catch(() => {});
      return;
    }
    if (r && r.upgradedFrom && validatedURL.startsWith('https:') && r.upgradedFrom.slice(5) === validatedURL.slice(6) && (code <= -100 && code > -300)) {
      wc.loadURL('pouley://erreur/?' + q({ type: 'nohttps', url: r.upgradedFrom, code })).catch(() => {});
      r.upgradedFrom = null;
      return;
    }
    const type = code <= -200 && code > -300 ? 'cert' : 'generic';
    wc.loadURL('pouley://erreur/?' + q({ type, url: validatedURL, code, desc })).catch(() => {});
  });

  wc.on('enter-html-full-screen', () => { htmlFullscreenTab = tabId; win.setFullScreen(true); sendUi('fullscreen', true); applyLayout(); });
  wc.on('leave-html-full-screen', () => { htmlFullscreenTab = null; win.setFullScreen(false); sendUi('fullscreen', false); applyLayout(); });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (!/^(https?|pouley):/.test(url)) return { action: 'deny' };
    // Les vraies fenêtres popup (connexion OAuth, paiement) gardent window.opener.
    if (disposition === 'new-window') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 520, height: 720, autoHideMenuBar: true, backgroundColor: '#111113', icon: ICON,
          webPreferences: { partition: runtime.get(tabId)?.partition, sandbox: true, contextIsolation: true, preload: PAGE_PRELOAD },
        },
      };
    }
    const f = findTab(tabId);
    openTab({ url, poulaillerId: f && f.poulailler ? f.poulailler.id : undefined, background: disposition === 'background-tab', ephemeral: f && f.rec.ephemeral, groupId: f && f.rec.groupId });
    return { action: 'deny' };
  });

  wc.on('context-menu', (_e, params) => showContextMenu(tabId, wc, params));
  wc.on('before-input-event', (event, input) => {
    if (handleShortcut(input, true)) event.preventDefault();
  });
  if (extHost) extHost.watch(tabId, wc);
  wc.on('render-process-gone', (_e, details) => {
    if (details.reason !== 'clean-exit') sendUi('toast', { text: 'L’onglet a planté — recharge-le pour réessayer.' });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur d'IA (tout est analysé sur la machine, voir ai-detect.js).

const AID_MAX_BYTES = 15 * 1024 * 1024;

// Télécharge l'image avec la session de l'onglet (même cache, mêmes cookies).
async function aidFetchImage(ses, url) {
  if (url.startsWith('data:')) {
    const m = /^data:[^,]*?(;base64)?,(.*)$/s.exec(url);
    return m ? Buffer.from(m[1] ? m[2] : decodeURIComponent(m[2]), m[1] ? 'base64' : 'utf8') : null;
  }
  if (!/^https?:/.test(url)) return null;
  const res = await ses.fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  const len = Number(res.headers.get('content-length') || 0);
  if (len > AID_MAX_BYTES) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.length > AID_MAX_BYTES ? null : buf;
}

async function aidImage(ses, url, alt) {
  let buf = null;
  try { buf = await aidFetchImage(ses, url); } catch {}
  if (!buf) {
    return { url, alt, verdict: 'erreur', tool: null, signals: [{ kind: 'info', text: 'Image impossible à lire (trop lourde, protégée ou locale à la page).' }] };
  }
  let thumb = null;
  try {
    const img = nativeImage.createFromBuffer(buf);
    if (!img.isEmpty()) thumb = img.resize({ width: 120, quality: 'good' }).toDataURL();
  } catch {}
  return { url, alt, thumb, ...aiDetect.analyzeImage(buf, url, { alt }) };
}

// Ce qu'on lit dans la page : le texte principal et les grandes images.
const AID_COLLECT = `(() => {
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  const text = (root ? root.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 30000);
  const seen = new Set();
  const images = [];
  for (const im of document.images) {
    const src = im.currentSrc || im.src;
    if (!src || seen.has(src) || im.naturalWidth < 200 || im.naturalHeight < 200) continue;
    seen.add(src);
    images.push({ src, w: im.naturalWidth, h: im.naturalHeight, alt: (im.alt || '').slice(0, 160) });
  }
  images.sort((a, b) => b.w * b.h - a.w * a.h);
  return { text, images: images.slice(0, 16) };
})()`;

async function aidPage(tabId) {
  const rt = runtime.get(tabId);
  const wc = rt && rt.view && rt.view.webContents;
  if (!wc || wc.isDestroyed()) return { error: 'Onglet endormi : ouvre-le pour l’analyser.' };
  if (!/^https?:/.test(wc.getURL())) return { error: 'Page interne : rien à analyser.' };
  let page;
  try { page = await wc.executeJavaScriptInIsolatedWorld(1998, [{ code: AID_COLLECT }]); } catch (err) { return { error: 'Lecture de la page impossible : ' + err.message }; }
  const text = page.text && page.text.trim().length > 200 ? aiDetect.analyzeText(page.text) : null;
  const images = [];
  // Quatre téléchargements à la fois, pour ne pas surcharger la connexion.
  const queue = [...page.images];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let im = queue.shift(); im; im = queue.shift()) images.push({ ...(await aidImage(wc.session, im.src, im.alt)), w: im.w, h: im.h });
  }));
  const order = { ia: 0, indice: 1, inconnu: 2, appareil: 3, erreur: 4 };
  images.sort((a, b) => order[a.verdict] - order[b.verdict]);
  return { url: wc.getURL(), text, sample: (page.text || '').slice(0, 3000), images };
}

function showContextMenu(tabId, wc, params) {
  const t = [];
  const ai = AI_PROVIDERS[S().ai] || AI_PROVIDERS.claude;
  if (params.linkURL) {
    t.push({ label: 'Ouvrir le lien dans un nouvel onglet', click: () => openTab({ url: params.linkURL, background: true }) });
    t.push({ label: 'Ouvrir dans un onglet éphémère', click: () => openTab({ url: params.linkURL, ephemeral: true }) });
    if (cometAvailable()) t.push({ label: 'Ouvrir le lien dans Comet', click: () => openInComet(params.linkURL) });
    if (/\.pdf([?#].*)?$/i.test(params.linkURL)) {
      const viewer = pdfViewerUrl(wc.session, params.linkURL);
      if (viewer) t.push({ label: 'Ouvrir le PDF dans NadsPDF', click: () => openTab({ url: viewer }) });
    }
    t.push({ label: 'Copier l’adresse du lien', click: () => clipboard.writeText(params.linkURL) });
    t.push({ type: 'separator' });
  }
  if (params.mediaType === 'image' && params.srcURL) {
    t.push({ label: 'Ouvrir l’image dans un nouvel onglet', click: () => openTab({ url: params.srcURL, background: true }) });
    t.push({ label: 'Enregistrer l’image', click: () => wc.downloadURL(params.srcURL) });
    t.push({ label: 'Copier l’image', click: () => wc.copyImageAt(params.x, params.y) });
    t.push({ label: 'Cette image vient-elle d’une IA ?', click: async () => {
      sendUi('toast', { text: 'Pouley examine l’image…' });
      sendUi('aidetect', { kind: 'image', result: await aidImage(wc.session, params.srcURL, params.altText || '') });
    } });
    t.push({ type: 'separator' });
  }
  if (params.selectionText) {
    const sel = params.selectionText.trim().slice(0, 2000);
    const short = sel.length > 28 ? sel.slice(0, 28) + '…' : sel;
    t.push({ label: `Rechercher « ${short} »`, click: () => openTab({ url: searchUrl(sel) }) });
    if (secondEngine()) t.push({ label: `Rechercher « ${short} » sur ${SEARCH_ENGINES[secondEngine()].label}`, click: () => openTab({ url: searchUrl2(sel) }) });
    t.push({ label: `Demander à ${ai.label}`, click: () => aiAsk(`Explique-moi : « ${sel} »`) });
    const full = params.selectionText.trim().slice(0, 40000);
    t.push({ label: 'Ce texte vient-il d’une IA ?', click: () => sendUi('aidetect', { kind: 'text', text: full.slice(0, 4000), result: aiDetect.analyzeText(full) }) });
    t.push({ label: 'Copier', role: 'copy' });
    t.push({ type: 'separator' });
  }
  if (params.isEditable) {
    t.push({ label: 'Annuler', role: 'undo' }, { label: 'Couper', role: 'cut' }, { label: 'Copier', role: 'copy' },
      { label: 'Coller', role: 'paste' }, { label: 'Tout sélectionner', role: 'selectAll' }, { type: 'separator' });
  }
  if (!params.linkURL && !params.selectionText && !params.isEditable) {
    t.push({ label: 'Précédent', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
    t.push({ label: 'Suivant', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
    t.push({ label: 'Recharger', click: () => reloadTab(tabId) });
    t.push({ type: 'separator' });
    t.push({ label: 'Inspecter le site (technos, couleurs, vie privée)', click: () => sendUi('shortcut', 'inspector') });
    t.push({ label: `Résumer la page avec ${ai.label}`, click: () => aiAskPage() });
    t.push({ label: 'Détecter l’IA dans cette page (textes et images)', click: () => sendUi('shortcut', 'aidetect') });
    t.push({ label: 'Écrire sur la page (stylo)', accelerator: 'CmdOrCtrl+Shift+D', click: () => penToggle() });
    if (cometAvailable()) t.push({ label: 'Ouvrir cette page dans Comet', click: () => openInComet(wc.getURL()) });
    t.push({ type: 'separator' });
  }
  const extItems = extHost ? extHost.contextItems(params, wc) : [];
  if (extItems.length) t.push(...extItems, { type: 'separator' });
  t.push({ label: 'Inspecter l’élément', click: () => wc.inspectElement(params.x, params.y) });
  Menu.buildFromTemplate(t).popup({ window: win });
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions sur les onglets

function openTab({ url, input, poulaillerId, background, ephemeral, index, groupId } = {}) {
  const p = store.state.poulaillers.find((x) => x.id === poulaillerId) || activePoulailler();
  const rec = makeTab(input != null ? resolveInput(input) : url, ephemeral ? { ephemeral: true, title: 'Onglet éphémère' } : {});
  const pinnedCount = p.tabs.filter((t) => t.pinned).length;
  const at = typeof index === 'number' ? index : pinnedCount; // les nouveaux onglets arrivent en haut, sous les épinglés
  p.tabs.splice(Math.max(pinnedCount, Math.min(at, p.tabs.length)), 0, rec);
  if (groupId && groupsOf(p).some((g) => g.id === groupId)) {
    rec.groupId = groupId;
    normalizeGroups(p);
  }
  store.save();
  // Les onglets en arrière-plan ne chargent qu’au clic : on les range d’après leur adresse.
  if (!rec.groupId && /^https?:/.test(rec.url)) autoGroupTab(rec.id);
  // Onglet en arrière-plan : on récupère juste son icône, sans charger la page.
  if (background && /^https?:/.test(rec.url) && !rec.favicon) {
    const ses = session.fromPartition(partitionFor(rec, p));
    configureSession(ses, partitionFor(rec, p));
    bestIcon(ses, [], rec.url).then((icon) => { if (icon && findTab(rec.id) && !findTab(rec.id).rec.favicon) updateRec(rec.id, { favicon: icon }); });
  }
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
  if (split && tabId !== split.a && tabId !== split.b) split = null;
  if (favPeek) { clearInterval(favPeek.timer); favPeek = null; sendUi('favpeek', null); }
  currentTabId = tabId;
  f.rec.lastActive = Date.now();
  if (f.poulailler) {
    f.poulailler.activeTab = tabId;
    store.state.activePoulailler = f.poulailler.id;
  }
  const rt = ensureView(tabId);
  if (extHost) extHost.tabActivated(tabId);
  store.save();
  setTimeout(enforceAwakeLimit, 1500);
  applyLayout();
  if (rt && rt.view && !viewsHidden) rt.view.webContents.focus();
  scheduleBroadcast();
}

function neighbourOf(f) {
  const list = f.list;
  return list[f.index + 1] || list[f.index - 1] || null;
}

function closeTab(tabId = currentTabId) {
  const f = findTab(tabId);
  if (!f) return;
  if (split && (tabId === split.a || tabId === split.b)) {
    const other = tabId === split.a ? split.b : split.a;
    split = null;
    if (tabId === currentTabId) currentTabId = other;
  }
  const wasCurrent = tabId === currentTabId;
  if (!f.rec.ephemeral && f.rec.url && !isErrorPage(f.rec.url)) {
    closedTabs.push({ url: f.rec.url, poulaillerId: f.poulailler && f.poulailler.id });
    if (closedTabs.length > 25) closedTabs.shift();
  }
  // Fermer un onglet épinglé (ou un favori) le met juste en veille, comme Arc.
  if (f.rec.pinned || !f.poulailler) {
    destroyView(tabId);
    runtime.delete(tabId);
    if (f.rec.homeUrl) f.rec.url = f.rec.homeUrl;
    if (wasCurrent) {
      const p = activePoulailler();
      const next = p.tabs.find((t) => !t.pinned) || null;
      currentTabId = null;
      if (next) return activateTab(next.id);
    }
    store.save();
    applyLayout();
    return scheduleBroadcast();
  }
  const next = wasCurrent ? neighbourOf(f) : null;
  destroyView(tabId, false);
  runtime.delete(tabId);
  f.list.splice(f.index, 1);
  normalizeGroups(f.poulailler);
  if (f.poulailler.activeTab === tabId) f.poulailler.activeTab = next ? next.id : null;
  store.save();
  if (wasCurrent) {
    currentTabId = null;
    if (next) return activateTab(next.id);
  }
  applyLayout();
  scheduleBroadcast();
}

function currentContents() {
  const rt = currentTabId && runtime.get(currentTabId);
  return rt && rt.view ? rt.view.webContents : null;
}

function reloadTab(tabId = currentTabId, hard = false) {
  const rt = runtime.get(tabId);
  const f = findTab(tabId);
  if (!rt || !rt.view || !f) return tabId && activateTab(tabId);
  const wc = rt.view.webContents;
  if (isErrorPage(wc.getURL())) return wc.loadURL(f.rec.url).catch(() => {});
  if (hard) wc.reloadIgnoringCache();
  else wc.reload();
}

function navigate(tabId, input) {
  if (!tabId) return openTab({ input });
  const url = resolveInput(input);
  const rt = ensureView(tabId);
  if (!rt) return;
  rt.upgradedFrom = null;
  updateRec(tabId, { url });
  rt.view.webContents.loadURL(url).catch(() => {});
  rt.view.webContents.focus();
}

function moveTab({ id, poulaillerId, pinned, index, favorite, groupId }) {
  const f = findTab(id);
  if (!f) return;
  const beforePartition = partitionFor(f.rec, f.poulailler);
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
  // Les épinglés restent groupés en haut de la liste.
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
  if (beforePartition !== partitionFor(f.rec, targetP)) destroyView(id, false);
  if (targetP && id === currentTabId) {
    targetP.activeTab = id;
    store.state.activePoulailler = targetP.id;
    ensureView(id);
  }
  store.save();
  applyLayout();
  scheduleBroadcast();
}

function switchPoulailler(id) {
  const p = store.state.poulaillers.find((x) => x.id === id);
  if (!p) return;
  store.state.activePoulailler = id;
  const target = p.tabs.find((t) => t.id === p.activeTab) || p.tabs.find((t) => !t.pinned) || null;
  currentTabId = null;
  if (target) activateTab(target.id);
  else {
    store.save();
    applyLayout();
    scheduleBroadcast();
  }
}

function cycleTab(dir) {
  const p = activePoulailler();
  const list = [...store.state.favorites, ...p.tabs];
  if (!list.length) return;
  const i = list.findIndex((t) => t.id === currentTabId);
  activateTab(list[(i + dir + list.length) % list.length].id);
}

function openInComet(url) {
  if (!cometAvailable() || !/^https?:/.test(url || '')) return;
  spawn(COMET_EXE, [url], { detached: true, stdio: 'ignore' }).unref();
}

// ─────────────────────────────────────────────────────────────────────────────
// Panneau IA (Claude / ChatGPT / Comet) dans une vue latérale

function ensureAiView() {
  if (aiView) return aiView;
  const partition = 'persist:pouley-ia';
  configureSession(session.fromPartition(partition), partition);
  aiView = new WebContentsView({
    webPreferences: { partition, sandbox: true, contextIsolation: true, spellcheck: false },
  });
  aiView.setBorderRadius(12);
  aiView.setVisible(false);
  win.contentView.addChildView(aiView);
  const wc = aiView.webContents;
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) openTab({ url });
    return { action: 'deny' };
  });
  wc.on('before-input-event', (event, input) => {
    if (handleShortcut(input, true)) event.preventDefault();
  });
  wc.on('context-menu', (_e, params) => {
    Menu.buildFromTemplate([
      { label: 'Couper', role: 'cut' }, { label: 'Copier', role: 'copy' }, { label: 'Coller', role: 'paste' },
      { type: 'separator' },
      { label: 'Recharger', click: () => wc.reload() },
      { label: 'Inspecter', click: () => wc.inspectElement(params.x, params.y) },
    ]).popup({ window: win });
  });
  wc.loadURL(askUrl('')).catch(() => {});
  return aiView;
}

function setAiOpen(open) {
  aiOpen = open;
  if (open) ensureAiView();
  applyLayout();
  scheduleBroadcast();
}

function aiAsk(prompt) {
  ensureAiView();
  aiView.webContents.loadURL(askUrl(prompt)).catch(() => {});
  setAiOpen(true);
}

function aiAskPage() {
  const f = currentTabId && findTab(currentTabId);
  if (!f || !/^https?:/.test(f.rec.url)) return setAiOpen(true);
  aiAsk(`Résume et analyse cette page en français : ${f.rec.url}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Mise en page des vues (l'interface envoie les rectangles disponibles)

function applyLayout() {
  if (!win || win.isDestroyed()) return;
  const [w, h] = win.getContentSize();
  const splitOn = split && layout.splitA && layout.splitB && runtime.get(split.a)?.view && runtime.get(split.b)?.view;
  for (const [id, rt] of runtime) {
    if (!rt.view || rt.floating) continue;
    if (splitOn && (id === split.a || id === split.b) && !htmlFullscreenTab) {
      const vis = !viewsHidden;
      if (vis) { rt.view.setBorderRadius(10); rt.view.setBounds(id === split.a ? layout.splitA : layout.splitB); }
      rt.view.setVisible(vis);
      continue;
    }
    if (favPeek && favPeek.id === id && id !== currentTabId) continue;
    const visible = id === currentTabId && !viewsHidden && !!layout.content && !splitOn;
    if (visible) {
      if (htmlFullscreenTab === id) {
        rt.view.setBorderRadius(0);
        rt.view.setBounds({ x: 0, y: 0, width: w, height: h });
      } else {
        rt.view.setBorderRadius(12);
        rt.view.setBounds(layout.content);
      }
    }
    rt.view.setVisible(visible);
  }
  if (aiView) {
    const visible = aiOpen && !viewsHidden && !!layout.ai && !htmlFullscreenTab;
    if (visible) aiView.setBounds(layout.ai);
    aiView.setVisible(visible);
  }
}

function normRect(r) {
  if (!r || typeof r !== 'object') return null;
  const n = (v) => Math.max(0, Math.round(Number(v) || 0));
  const rect = { x: n(r.x), y: n(r.y), width: n(r.width), height: n(r.height) };
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Diffusion de l'état vers l'interface

function snapshot() {
  const rt = {};
  for (const [id, r] of runtime) {
    rt[id] = {
      loading: r.loading,
      canGoBack: r.canGoBack,
      canGoForward: r.canGoForward,
      blocked: r.report ? r.report.blocked.length : 0,
      audible: r.audible,
      muted: r.view ? r.view.webContents.isAudioMuted() : false,
      awake: !!r.view,
      https: r.report ? r.report.url.startsWith('https:') : null,
      zoom: r.view ? r.view.webContents.getZoomFactor() : 1,
      floating: !!r.floating,
      badge: r.badge || 0,
      memMb: r.memMb || 0,
      pen: !!r.penOn,
    };
  }
  return {
    state: store.state,
    runtime: rt,
    currentTabId,
    // L'onglet affiché est-il un site qui distrait ? (compteur de productivité)
    focusSite: (() => { const f = currentTabId && findTab(currentTabId); return f && S().focusEnabled !== false ? focus.distractingSite(f.rec.url, S().focusSites) : null; })(),
    aiOpen,
    cometAvailable: cometAvailable(),
    extensions: EXTENSIONS.map((e) => ({ key: e.key, setting: e.setting, name: e.name, version: e.version, description: e.description, icon: e.icon, status: e.status, available: e.available, ids: [...new Set([...extIds.values()].map((x) => x[e.key]).filter(Boolean))] })),
    nadspdfApp: !!NADSPDF_APP,
    split,
    repo: (() => { const f = currentTabId && findTab(currentTabId); return f ? parseRepo(f.rec.url) : null; })(),
    maximized: win ? win.isMaximized() : false,
    platform: process.platform,
    version: app.getVersion(),
    versions: { chromium: process.versions.chrome, electron: process.versions.electron },
    update: updateState,
    vault: vaultStatus(),
    userExtensions: extHost ? extHost.snapshot() : [],
    security: { stateEncrypted: !!(store && store.key), cookies: app.isPackaged, bitlocker },
  };
}

function scheduleBroadcast() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    sendUi('state', snapshot());
  }, 30);
}

// ─────────────────────────────────────────────────────────────────────────────
// Inspecteur : technos + charte graphique + vie privée

async function inspect(tabId = currentTabId) {
  const rt = runtime.get(tabId);
  const f = findTab(tabId);
  if (!rt || !rt.view || !f) return { error: 'Onglet en veille — ouvre-le d’abord.' };
  const wc = rt.view.webContents;
  const url = wc.getURL();
  if (!/^https?:/.test(url)) return { internal: true, url };
  let page = {};
  try {
    page = await Promise.race([
      wc.executeJavaScript(`(${analyzePage.source})(${JSON.stringify(GLOBAL_PATHS)})`, true),
      new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 8000)),
    ]);
  } catch (err) {
    page = { error: String(err && err.message || err) };
  }
  const report = rt.report || newReport(url, siteOf(new URL(url).hostname));
  let jarCookies = [];
  try { jarCookies = (await wc.session.cookies.get({ url })).map((c) => c.name); } catch {}
  const cookies = [...new Set([...report.cookies.firstParty, ...jarCookies, ...((page.storage && page.storage.jsCookies) || [])])];
  const tech = detect({ headers: report.headers, apiHeaders: report.apiHeaders, apiPaths: report.apiPaths, cookies, page });
  report.cert = certInfo.get(new URL(url).hostname) || null;
  const privacy = summarize(report, { techs: tech.techs, formFields: page.formFields, insecureForm: page.insecureForm, storage: page.storage });
  privacy.cookieNames = cookies.slice(0, 80);
  privacy.iframes = page.iframes || [];
  return {
    url,
    title: page.title || f.rec.title,
    tech,
    design: {
      colors: page.colors || [],
      cssVars: page.cssVars || [],
      fonts: page.fonts || [],
      headingFonts: page.headingFonts || [],
      themeColor: page.themeColor || null,
      icon: (f.rec.favicon && f.rec.favicon.startsWith('data:') ? f.rec.favicon : null) ||
        await bestIcon(wc.session, page.icons || (page.icon ? [page.icon] : []), url) || null,
    },
    privacy,
    pageError: page.error || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Raccourcis clavier (actifs dans l'interface ET dans les pages)

function handleShortcut(input, fromPage) {
  if (input.type !== 'keyDown') return false;
  const mod = process.platform === 'darwin' ? input.meta : input.control;
  const key = (input.key || '').toLowerCase();
  const shift = input.shift;
  const fire = (name) => { sendUi('shortcut', name); return true; };
  const wc = currentContents();

  if (key === 'f5') { reloadTab(currentTabId, input.control); return true; }
  if (key === 'f11') { win.setFullScreen(!win.isFullScreen()); return true; }
  if (key === 'f12' || (mod && shift && key === 'i')) { if (wc) wc.toggleDevTools(); return true; }
  if (input.alt && !mod && key === 'arrowleft') { if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return true; }
  if (input.alt && !mod && key === 'arrowright') { if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); return true; }
  if (key === 'escape' && fromPage) { if (wc && wc.isLoading()) wc.stop(); return false; }
  if (!mod) return false;

  if (key === 'tab') { cycleTab(shift ? -1 : 1); return true; }
  if (/^[1-9]$/.test(key) && !shift) {
    const p = store.state.poulaillers[Number(key) - 1];
    if (p) switchPoulailler(p.id);
    return true;
  }
  if (input.alt && (key === 'arrowdown' || key === 'arrowup')) {
    const list = store.state.poulaillers;
    const i = list.findIndex((p) => p.id === store.state.activePoulailler);
    const next = list[(i + (key === 'arrowdown' ? 1 : -1) + list.length) % list.length];
    switchPoulailler(next.id);
    return true;
  }
  switch (key) {
    case 't': if (shift) { reopenClosed(); return true; } return fire('new-tab');
    case 'n': if (shift) { openTab({ ephemeral: true }); return true; } return fire('new-tab');
    case 'l': return fire('edit-url');
    case 'w': closeTab(); return true;
    case 'r': reloadTab(currentTabId, shift); return true;
    case 's': if (shift) { takeShot('visible'); return true; } return fire('toggle-sidebar');
    case 'x': if (!shift) return false; return fire('shot-region');
    case 'p': if (!shift) return false; toggleFloat(currentTabId); return true;
    case 'k': if (!shift) return fire('new-tab'); if (split) commands['split.end'](); else fire('split'); return true;
    case 'f': return fire('find');
    case 'i': return fire('inspector');
    case 'e': setAiOpen(!aiOpen); return true;
    case 'd': if (shift) { penToggle(); return true; } if (currentTabId) togglePin(currentTabId); return true;
    case 'c':
      if (!shift) return false;
      if (currentTabId) { clipboard.writeText(findTab(currentTabId)?.rec.url || ''); sendUi('toast', { text: 'Adresse copiée' }); }
      return true;
    case '=': case '+': zoom(0.1); return true;
    case '-': zoom(-0.1); return true;
    case '0': zoom(0); return true;
    case ',': return fire('settings');
    default: return false;
  }
}

function zoom(delta) {
  const wc = currentContents();
  if (!wc) return;
  const z = delta === 0 ? 1 : Math.min(3, Math.max(0.3, wc.getZoomFactor() + delta));
  wc.setZoomFactor(Math.round(z * 100) / 100);
  sendUi('toast', { text: `Zoom ${Math.round(z * 100)} %` });
  scheduleBroadcast();
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

// ─────────────────────────────────────────────────────────────────────────────
// Veille des onglets et archivage automatique (comme Arc)

// Modes mémoire : délai de veille et nombre maximum de pages éveillées.
const MEMORY_MODES = {
  econome: { sleepMinutes: 5, maxAwake: 4 },
  equilibre: { sleepMinutes: 15, maxAwake: 8 },
  performance: { sleepMinutes: 60, maxAwake: 0 },
};
function memoryMode() { return MEMORY_MODES[S().memoryMode] || MEMORY_MODES.equilibre; }

// Un onglet peut-il être mis en veille maintenant ?
function canSleep(id, rt) {
  if (!rt.view || id === currentTabId || rt.audible || rt.floating) return false;
  if (split && (id === split.a || id === split.b)) return false;
  if (favPeek && favPeek.id === id) return false;
  return true;
}

// Garde au plus N pages éveillées : les moins récemment utilisées s'endorment.
function enforceAwakeLimit() {
  const max = memoryMode().maxAwake;
  if (!max) return;
  const awake = [...runtime.entries()].filter(([, rt]) => rt.view && !rt.floating);
  if (awake.length <= max) return;
  const sleepable = awake.filter(([id, rt]) => canSleep(id, rt))
    .map(([id]) => ({ id, last: (findTab(id) || { rec: {} }).rec.lastActive || 0 }))
    .sort((a, b) => a.last - b.last);
  for (const t of sleepable.slice(0, awake.length - max)) destroyView(t.id);
  scheduleBroadcast();
}

// Veille d'urgence : Windows manque de mémoire vive.
let lastPressure = 0;
function checkMemoryPressure() {
  const free = os.freemem() / os.totalmem();
  if (free > 0.1 || Date.now() - lastPressure < 60000) return;
  lastPressure = Date.now();
  let n = 0;
  for (const [id, rt] of runtime) if (canSleep(id, rt)) { destroyView(id); n++; }
  if (n) {
    sendUi('toast', { text: 'Mémoire de l’ordinateur presque pleine : ' + n + ' onglet' + (n > 1 ? 's mis' : ' mis') + ' en veille.' });
    scheduleBroadcast();
  }
}
setInterval(checkMemoryPressure, 15000);

// Mémoire réelle de chaque onglet (processus de rendu), via Chromium.
function memoryReport() {
  const byPid = new Map(app.getAppMetrics().map((m) => [m.pid, m]));
  let total = 0;
  for (const m of byPid.values()) total += (m.memory.privateBytes || m.memory.workingSetSize || 0);
  const tabs = [];
  for (const [id, rt] of runtime) {
    if (!rt.view) continue;
    const m = byPid.get(rt.view.webContents.getOSProcessId());
    const f = findTab(id);
    if (m && f) tabs.push({ id, title: f.rec.title || f.rec.url, mb: Math.round((m.memory.privateBytes || m.memory.workingSetSize) / 1024) });
  }
  const gpu = [...byPid.values()].filter((m) => m.type === 'GPU').reduce((s, m) => s + (m.memory.privateBytes || 0), 0);
  return { totalMb: Math.round(total / 1024), gpuMb: Math.round(gpu / 1024), tabs: tabs.sort((a, b) => b.mb - a.mb), freePct: Math.round((os.freemem() / os.totalmem()) * 100) };
}
// La mémoire de chaque onglet est rafraîchie pour les infobulles.
setInterval(() => {
  if (!win || !store) return;
  try {
    const rep = memoryReport();
    let changed = false;
    for (const t of rep.tabs) { const rt = runtime.get(t.id); if (rt && rt.memMb !== t.mb) { rt.memMb = t.mb; changed = true; } }
    if (changed) scheduleBroadcast();
  } catch {}
}, 10000);

// Productivité : toutes les 15 s, le site affiché rapporte une plume ou un tender
// (fenêtre au premier plan seulement, et pas quand tu es parti de l'ordinateur).
const FOCUS_TICK = 15;
setInterval(() => {
  if (!store || !win || S().focusEnabled === false) return;
  if (!win.isFocused() || win.isMinimized() || viewsHidden) return;
  const f = currentTabId && findTab(currentTabId);
  if (!f) return;
  const rt = runtime.get(currentTabId);
  const r = focus.tick(store.state, f.rec.url, FOCUS_TICK, {
    idle: powerMonitor.getSystemIdleTime(), audible: !!(rt && rt.audible), sites: S().focusSites,
  });
  if (!r) return;
  if (r.nudge && S().focusNudge !== false) {
    sendUi('toast', { text: `${r.nudge.tenders} tenders aujourd’hui, surtout sur ${r.nudge.site}. Pouley préférerait des plumes !` });
  }
  store.save();
  scheduleBroadcast();
}, FOCUS_TICK * 1000);

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
  // Cookies écrits sur le disque chaque minute : une connexion survit à un plantage.
  for (const ses of allSessions) ses.cookies.flushStore().catch(() => {});
  const archiveMs = (S().archiveAfterHours || 0) * 3600000;
  if (archiveMs > 0) {
    store.state.archive = store.state.archive || [];
    for (const p of store.state.poulaillers) {
      const keep = [];
      for (const t of p.tabs) {
        if (!t.pinned && t.id !== currentTabId && now - (t.lastActive || now) > archiveMs) {
          destroyView(t.id, false);
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
// Groupes d'œufs : onglets rassemblés côte à côte sous une couleur.
// Rangement automatique par thème (catégorie de site) ou par site.

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
// Pages qui ne se rangent jamais seules (recherche, pages internes).
const NO_GROUP = /^(duckduckgo\.com|www\.google\.[a-z.]+|google\.[a-z.]+|search\.brave\.com|www\.startpage\.com|www\.bing\.com)$/i;

function hostOfUrl(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

// Thème d'une adresse : la correspondance la plus précise l'emporte
// (music.youtube.com → Musique, youtube.com → Vidéos).
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

// Clé de rangement : le thème s'il est connu, sinon le site.
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

// Remet chaque groupe d'un seul tenant, à la place de son premier onglet,
// et supprime les groupes vides.
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

// Range un onglet qui vient d'arriver sur un site (rangement automatique).
function autoGroupTab(tabId) {
  if (!S().autoGroupTabs) return;
  const f = findTab(tabId);
  if (!f || !f.poulailler || f.rec.pinned || f.rec.groupId || f.rec.ephemeral) return;
  const p = f.poulailler;
  const k = groupKeyOf(f.rec.url);
  if (!k) return;
  const site = siteOf(hostOfUrl(f.rec.url));
  // 1) un groupe automatique qui connaît ce site ou ce thème
  const g = groupsOf(p).find((x) => x.auto && (x.sites.includes(site) || (x.key && x.key === k.key)));
  if (g) return setTabGroup(tabId, g.id);
  // 2) un autre onglet libre du même thème / site : on crée le groupe
  const mate = p.tabs.find((t) => t.id !== tabId && !t.pinned && !t.groupId && groupKeyOf(t.url)?.key === k.key);
  if (!mate) return;
  const created = createGroup(p, [mate.id, tabId], { name: k.label, key: k.key, sites: [site, siteOf(hostOfUrl(mate.url))] });
  sendUi('group:created', { id: created.id, name: created.name, color: created.color, auto: true });
}

// Bouton « Ranger en groupes d'œufs » : range tous les onglets libres.
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
    const sites = b.tabs.map((t) => siteOf(hostOfUrl(t.url)));
    createGroup(p, b.tabs.map((t) => t.id), { name: b.label, key, sites });
    created++;
  }
  normalizeGroups(p);
  store.save();
  scheduleBroadcast();
  return { created, joined };
}

// ─────────────────────────────────────────────────────────────────────────────
// Mini-lecteur : la musique d'un onglet (YouTube, YouTube Music, SoundCloud…)
// et celle des applications Windows (Spotify…) via les contrôles multimédia.

let mediaTab = null;
let mediaIdle = 0;
let tabMedia = null;
let sysMedia = null;
let sysProc = null;
let sysQueue = [];
let sysBuf = '';
let sysArt = { key: '', data: null };
let lastMediaJson = '';

const MEDIA_READ = `(() => {
  const ms = navigator.mediaSession;
  const m = ms && ms.metadata;
  const els = [...document.querySelectorAll('video, audio')];
  const el = els.find((e) => !e.paused) || els.find((e) => e.currentTime > 0) || els[0];
  let state = ms && ms.playbackState && ms.playbackState !== 'none' ? ms.playbackState : (el ? (el.paused ? 'paused' : 'playing') : 'none');
  const art = m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null;
  return { title: (m && m.title) || '', artist: (m && m.artist) || '', album: (m && m.album) || '', art,
    state, duration: el && isFinite(el.duration) ? el.duration : 0, time: el ? el.currentTime : 0, hasMedia: !!el || !!m };
})()`;

// Boutons du lecteur de chaque site, avec repli sur l'élément audio/vidéo.
const mediaAction = (a) => `(() => {
  const click = (...sels) => { for (const s of sels) { const b = document.querySelector(s); if (b) { b.click(); return true; } } return false; };
  const els = [...document.querySelectorAll('video, audio')];
  const el = els.find((e) => !e.paused) || els.find((e) => e.currentTime > 0) || els[0];
  const a = ${JSON.stringify(a)};
  if (a === 'toggle') {
    if (click('ytmusic-player-bar #play-pause-button', '[data-testid="control-button-playpause"]', '.playControl', 'button[data-testid="play_button_play"], button[data-testid="play_button_pause"]')) return;
    if (el) { if (el.paused) el.play(); else el.pause(); }
  } else if (a === 'next') {
    click('ytmusic-player-bar .next-button', '.ytp-next-button', '[data-testid="control-button-skip-forward"]', '.skipControl__next', 'button[data-testid="next_track_button"]');
  } else if (a === 'prev') {
    if (!click('ytmusic-player-bar .previous-button', '.ytp-prev-button', '[data-testid="control-button-skip-back"]', '.skipControl__previous', 'button[data-testid="previous_track_button"]') && el) el.currentTime = 0;
  }
})()`;

function startSysMedia() {
  if (sysProc || process.platform !== 'win32' || !S().mediaSystem) return;
  const script = path.join(__dirname, 'system-media.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
  try {
    sysProc = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, 'site.nads.pouleypwolu'], { windowsHide: true });
  } catch { sysProc = null; return; }
  sysProc.stdout.setEncoding('utf8');
  sysProc.stdout.on('data', (chunk) => {
    sysBuf += chunk;
    let i;
    while ((i = sysBuf.indexOf('\n')) >= 0) {
      const line = sysBuf.slice(0, i).trim();
      sysBuf = sysBuf.slice(i + 1);
      const resolve = sysQueue.shift();
      let data = null;
      try { data = JSON.parse(line); } catch {}
      if (resolve) resolve(data);
    }
  });
  sysProc.on('exit', () => { sysProc = null; for (const r of sysQueue) r(null); sysQueue = []; });
}
function stopSysMedia() {
  if (!sysProc) return;
  try { sysProc.stdin.write('quit\n'); } catch {}
  setTimeout(() => { try { sysProc && sysProc.kill(); } catch {} }, 500);
  sysMedia = null;
}
function sysCommand(cmd) {
  if (!sysProc) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => { const k = sysQueue.indexOf(done); if (k >= 0) sysQueue.splice(k, 1); resolve(null); }, 6000);
    const done = (d) => { clearTimeout(timer); resolve(d); };
    sysQueue.push(done);
    try { sysProc.stdin.write(cmd + '\n'); } catch { done(null); }
  });
}
function readSys(d) {
  if (!d || d.none || !d.title) return null;
  if (d.art) sysArt = { key: d.artKey, data: d.art };
  else if (sysArt.key !== d.artKey) sysArt = { key: d.artKey, data: null };
  const app = String(d.app || '');
  const name = /spotify/i.test(app) ? 'Spotify' : /zune|music/i.test(app) ? 'Musique' : app.split(/[\\!.]/).filter(Boolean).slice(-1)[0] || 'Application';
  return { source: 'system', app: name, title: d.title, artist: d.artist || '', album: d.album || '', state: d.state === 'playing' ? 'playing' : 'paused', duration: d.duration || 0, time: d.time || 0, art: sysArt.data };
}

async function pollMedia() {
  if (!S().mediaPlayer) {
    if (lastMediaJson !== 'null') { lastMediaJson = 'null'; sendUi('media', null); }
    return;
  }
  // 1) l'onglet qui joue (ou jouait) de la musique
  if (mediaTab) {
    const rt = runtime.get(mediaTab);
    const wc = rt && rt.view && rt.view.webContents;
    const f = findTab(mediaTab);
    if (!wc || wc.isDestroyed() || !f) { mediaTab = null; tabMedia = null; }
    else {
      try {
        const m = await wc.executeJavaScript(MEDIA_READ, true);
        if (!m.hasMedia || m.state === 'none') { if (++mediaIdle > 4) { mediaTab = null; tabMedia = null; } }
        else {
          mediaIdle = 0;
          const art = m.art ? await fetchIcon(wc.session, m.art).catch(() => null) : null;
          let host = '';
          try { host = new URL(f.rec.url).hostname.replace(/^www\./, ''); } catch {}
          tabMedia = { source: 'tab', tabId: mediaTab, app: host, title: m.title || f.rec.title || host, artist: m.artist, album: m.album, state: m.state, duration: m.duration, time: m.time, art: art || f.rec.favicon || null, muted: wc.isAudioMuted() };
        }
      } catch { /* page en cours de chargement */ }
    }
  }
  // 2) la musique des applications Windows (Spotify…)
  if (S().mediaSystem) { startSysMedia(); sysMedia = readSys(await sysCommand('state')); } else if (sysProc) stopSysMedia();
  // L'onglet qui joue a la priorité ; sinon l'application ; sinon l'onglet en pause.
  const pick = tabMedia && tabMedia.state === 'playing' ? tabMedia : sysMedia && sysMedia.state === 'playing' ? sysMedia : tabMedia || sysMedia;
  const json = JSON.stringify(pick);
  if (json !== lastMediaJson) { lastMediaJson = json; sendUi('media', pick); }
}
setInterval(() => { if (win && store) pollMedia().catch(() => {}); }, 1500);

// ─────────────────────────────────────────────────────────────────────────────
// Aperçu d'un favori au survol : la page s'ouvre dans une bulle à côté du
// favori, et se referme quand la souris quitte le favori et la bulle.

let favPeek = null;
function showFavPeek(id, anchor, edge) {
  if (!S().favHoverPreview || !anchor || id === currentTabId || viewsHidden) return;
  if (split && (id === split.a || id === split.b)) return;
  if (favPeek && favPeek.id !== id) hideFavPeek();
  const rt = ensureView(id);
  if (!rt || !rt.view || rt.floating) return;
  const [W, H] = win.getContentSize();
  const w = Math.min(480, W - 40);
  const h = Math.min(620, H - 40);
  const clampN = (v, a, b) => Math.max(a, Math.min(b, v));
  const pos = S().sidebarPosition;
  let x;
  let y;
  // La bulle se pose contre le bord de la barre (pas sur la barre elle-même).
  const side = edge || anchor;
  if (pos === 'top') { x = clampN(Math.round(anchor.x + anchor.width / 2 - w / 2), 8, W - w - 8); y = Math.round(side.y + side.height + 6); }
  else if (pos === 'right') { x = Math.round(side.x - w - 8); y = clampN(Math.round(anchor.y - 12), 8, H - h - 8); }
  else { x = Math.round(side.x + side.width + 8); y = clampN(Math.round(anchor.y - 12), 8, H - h - 8); }
  const rect = { x, y, width: w, height: Math.min(h, H - y - 8) };
  try { win.contentView.addChildView(rt.view); } catch {} // au premier plan
  rt.view.setBorderRadius(14);
  rt.view.setBounds(rect);
  rt.view.setVisible(true);
  clearInterval(favPeek && favPeek.timer);
  favPeek = { id, rect, anchor, leaveAt: 0, timer: null };
  favPeek.timer = setInterval(() => {
    if (!favPeek || !win || win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getContentBounds();
    const cx = p.x - b.x;
    const cy = p.y - b.y;
    const inR = (r, m) => cx >= r.x - m && cx <= r.x + r.width + m && cy >= r.y - m && cy <= r.y + r.height + m;
    // le couloir entre le favori et la bulle compte aussi
    const bridge = { x: Math.min(anchor.x, rect.x), y: Math.min(anchor.y, rect.y), width: Math.abs(rect.x - anchor.x) + Math.min(anchor.width, 40), height: Math.min(anchor.height, 40) };
    if (inR(anchor, 6) || inR(rect, 4) || inR(bridge, 4)) favPeek.leaveAt = 0;
    else if (!favPeek.leaveAt) favPeek.leaveAt = Date.now();
    else if (Date.now() - favPeek.leaveAt > 350) hideFavPeek();
  }, 80);
  sendUi('favpeek', id);
}
function hideFavPeek() {
  if (!favPeek) return;
  clearInterval(favPeek.timer);
  const id = favPeek.id;
  favPeek = null;
  const rt = runtime.get(id);
  if (rt && rt.view && id !== currentTabId) rt.view.setVisible(false);
  applyLayout();
  sendUi('favpeek', null);
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub / GitLab : actions sur le dépôt affiché, et pastilles de notifications.

const GH_RESERVED = new Set(['settings', 'notifications', 'orgs', 'organizations', 'marketplace', 'explore', 'topics', 'search', 'pulls', 'issues', 'login', 'logout', 'join', 'signup', 'features', 'sponsors', 'apps', 'new', 'codespaces', 'collections', 'trending', 'about', 'pricing', 'enterprise', 'dashboard', 'security', 'site', 'contact', 'readme', 'copilot', 'stars', 'watching']);

// Reconnaît un dépôt dans l'adresse de la page. GitLab : gitlab.com et toute
// instance dont le nom contient « gitlab » (auto-hébergée), ou repérée comme
// GitLab par l'inspecteur.
const gitlabHosts = new Set();
function parseRepo(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'github.com') {
    if (parts.length < 2 || GH_RESERVED.has(parts[0].toLowerCase())) return null;
    const [owner, repo] = parts;
    return { kind: 'github', host, owner, repo: repo.replace(/\.git$/, ''), path: owner + '/' + repo.replace(/\.git$/, ''), base: 'https://github.com/' + owner + '/' + repo.replace(/\.git$/, '') };
  }
  if (host === 'gitlab.com' || /(^|\.)gitlab\./.test(host) || gitlabHosts.has(host)) {
    const cut = parts.indexOf('-');
    const proj = (cut >= 0 ? parts.slice(0, cut) : parts).filter((p) => !['users', 'dashboard', 'explore', 'admin', 'help', 'search'].includes(p));
    if (proj.length < 2) return null;
    const path = proj.join('/').replace(/\.git$/, '');
    return { kind: 'gitlab', host, owner: proj.slice(0, -1).join('/'), repo: proj[proj.length - 1], path, base: u.origin + '/' + path };
  }
  return null;
}

function repoMenu(url) {
  const r = parseRepo(url);
  if (!r) return;
  const gh = r.kind === 'github';
  const https = r.base + '.git';
  const ssh = 'git@' + r.host + ':' + r.path + '.git';
  const copy = (t, label) => { clipboard.writeText(t); sendUi('toast', { text: label + ' copié' }); };
  const open = (u) => openTab({ url: u });
  const tpl = [
    { label: (gh ? 'GitHub' : 'GitLab') + ' · ' + r.path, enabled: false },
    { type: 'separator' },
    { label: 'Copier « git clone » (HTTPS)', click: () => copy('git clone ' + https, 'git clone') },
    { label: 'Copier « git clone » (SSH)', click: () => copy('git clone ' + ssh, 'git clone SSH') },
    { label: 'Copier « ' + r.path + ' »', click: () => copy(r.path, 'Nom du dépôt') },
    { type: 'separator' },
    { label: 'Cloner et ouvrir dans VS Code', click: () => shell.openExternal('vscode://vscode.git/clone?url=' + encodeURIComponent(https)) },
    { label: 'Cloner et ouvrir dans Cursor', click: () => shell.openExternal('cursor://vscode.git/clone?url=' + encodeURIComponent(https)) },
    { label: gh ? 'Éditeur web (github.dev)' : 'Web IDE GitLab', click: () => open(gh ? 'https://github.dev/' + r.path : r.base + '/-/ide/project/' + r.path + '/edit') },
    { type: 'separator' },
    { label: gh ? 'Pull requests' : 'Merge requests', click: () => open(r.base + (gh ? '/pulls' : '/-/merge_requests')) },
    { label: 'Issues', click: () => open(r.base + (gh ? '/issues' : '/-/issues')) },
    { label: gh ? 'Actions' : 'Pipelines', click: () => open(r.base + (gh ? '/actions' : '/-/pipelines')) },
    { label: gh ? 'Releases' : 'Versions (tags)', click: () => open(r.base + (gh ? '/releases' : '/-/tags')) },
    { type: 'separator' },
    { label: 'Télécharger le code (ZIP)', click: () => { const wc = currentContents(); const zip = gh ? r.base + '/archive/HEAD.zip' : r.base + '/-/archive/HEAD/' + r.repo + '-HEAD.zip'; if (wc) wc.downloadURL(zip); } },
  ];
  Menu.buildFromTemplate(tpl).popup({ window: win });
}

// Pastilles : nombre dans le titre « (3) … », point de notification GitHub,
// compteur « À faire » GitLab. Lu dans les pages déjà ouvertes, sans réseau.
const BADGE_READ = `(() => {
  const t = document.title || '';
  const m = /^\\((\\d+)\\+?\\)/.exec(t) || /\\((\\d+)\\)\\s*$/.exec(t) || /\\((\\d+)\\)/.exec(t.split(/[-–|·]/)[0] || '');
  let n = m ? parseInt(m[1], 10) : 0;
  const host = location.hostname;
  let gitlab = false;
  if (host === 'github.com' && document.querySelector('.AppHeader-button--hasIndicator, a.notification-indicator .mail-status.unread, notification-indicator [data-target$="badge"]:not([hidden]), [data-target="notification-indicator.badge"]:not([hidden])')) n = Math.max(n, -1);
  if (document.querySelector('meta[property="og:site_name"][content="GitLab"], meta[name="description"][content*="GitLab"], .gl-app, body[data-page]') && /gitlab/i.test(document.documentElement.innerHTML.slice(0, 20000))) {
    gitlab = true;
    const el = document.querySelector('.todos-count, .js-todos-count, [data-testid="todos-shortcut-button"] .gl-badge, a[href$="/dashboard/todos"] .gl-badge');
    const v = el ? parseInt((el.textContent || '').replace(/\\D/g, ''), 10) : 0;
    if (v > 0) n = Math.max(n, v);
  }
  return { n: n > 999 ? 999 : n, gitlab };
})()`;

async function pollBadges() {
  let changed = false;
  for (const [id, rt] of runtime) {
    const wc = rt.view && rt.view.webContents;
    if (!wc || wc.isDestroyed() || wc.isLoading()) continue;
    let res = null;
    try { res = await wc.executeJavaScript(BADGE_READ, false); } catch { continue; }
    if (!res) continue;
    if (res.gitlab) { try { gitlabHosts.add(new URL(wc.getURL()).hostname); } catch {} }
    if ((rt.badge || 0) !== res.n) { rt.badge = res.n; changed = true; }
  }
  if (changed) scheduleBroadcast();
}
setInterval(() => { if (win && store) pollBadges().catch(() => {}); }, 15000);

// ─────────────────────────────────────────────────────────────────────────────
// Coffre à mots de passe. Toute la cryptographie est dans vault.js ; ici on
// relie le coffre à l'interface et aux pages. Une page ne reçoit un
// identifiant que pour son propre site, et seulement après un clic.

let vault = null;
let vaultTimer = null;
const vaultOffers = new Map(); // offerId -> { tabId, origin, site, username, password }
let clipboardTimer = null;

const vaultStatus = () => (vault ? vault.status() : { exists: false, open: false });
function vaultChanged() {
  sendUi('vault', vaultStatus());
  for (const r of runtime.values()) if (r.view && !r.view.webContents.isDestroyed()) r.view.webContents.send('vault:changed');
  scheduleBroadcast();
}
function vaultTouch() {
  clearTimeout(vaultTimer);
  const min = Number(S().vaultAutoLockMinutes);
  if (vault && vault.isOpen() && min > 0) vaultTimer = setTimeout(() => vaultLock('inactif'), min * 60000);
}
function vaultLock(reason) {
  if (!vault || !vault.isOpen()) return;
  vault.lock();
  clearTimeout(vaultTimer);
  vaultChanged();
  if (reason === 'inactif') sendUi('toast', { text: 'Coffre verrouillé après ' + S().vaultAutoLockMinutes + ' min sans utilisation.' });
}
// Origine fiable : celle du cadre principal qui a envoyé le message, vue par Chromium.
function pageOrigin(event) {
  const tabId = wcToTab.get(event.sender.id);
  const frame = event.senderFrame;
  if (!tabId || !frame || frame !== event.sender.mainFrame) return null;
  let u;
  try { u = new URL(frame.url); } catch { return null; }
  const local = u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname);
  if (u.protocol !== 'https:' && !local) return null;
  return { tabId, origin: u.origin, site: siteOf(u.hostname) };
}
function vaultSave({ id, url, origin, username, password, note }) {
  const raw = String(url || origin || '').trim();
  let u;
  try { u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : 'https://' + raw); } catch { throw new Error('Adresse du site invalide.'); }
  if (!/^https?:$/.test(u.protocol) || !u.hostname) throw new Error('Adresse du site invalide.');
  if (!password) throw new Error('Le mot de passe est vide.');
  const item = vault.upsert({
    id, origin: u.origin, site: siteOf(u.hostname),
    username: String(username || '').slice(0, 300), password: String(password).slice(0, 1000), note: String(note || '').slice(0, 2000),
  });
  vaultTouch();
  vaultChanged();
  return item.id;
}

ipcMain.handle('page:cred-query', (event) => {
  const o = pageOrigin(event);
  if (!o || !vault) return { state: 'off' };
  if (!vault.exists()) return { state: 'none' };
  if (!vault.isOpen()) return { state: 'locked' };
  return { state: 'open', items: vault.forSite(o.site).map((x) => ({ id: x.id, username: x.username })) };
});
ipcMain.handle('page:cred-fill', (event, id) => {
  const o = pageOrigin(event);
  if (!o || !vault || !vault.isOpen()) return null;
  const item = vault.get(id);
  if (!item || item.site !== o.site) return null;
  vault.touch(id);
  vaultTouch();
  return { username: item.username, password: item.password };
});
ipcMain.handle('page:cred-generate', (event) => (pageOrigin(event) ? generatePassword({ length: 20 }) : null));
ipcMain.on('page:cred-unlock', (event) => {
  if (!pageOrigin(event) || !win) return;
  win.webContents.focus();
  sendUi('vault:open', {});
});
ipcMain.on('page:cred-submit', (event, data) => {
  const o = pageOrigin(event);
  if (!o || !vault || !data || S().vaultOffer === false) return;
  const username = String(data.username || '').slice(0, 300);
  const password = String(data.password || '').slice(0, 1000);
  if (!password || (S().vaultNever || []).includes(o.site)) return;
  let update = false;
  if (vault.isOpen()) {
    const same = vault.forSite(o.site).find((x) => x.username === username);
    if (same && same.password === password) return;
    update = !!same;
  }
  for (const [k, v] of vaultOffers) {
    if (v.tabId !== o.tabId) continue;
    vaultOffers.delete(k);
    sendUi('vault:offer-done', { offerId: k });
  }
  const offerId = uid('offre');
  vaultOffers.set(offerId, { ...o, username, password });
  setTimeout(() => { if (vaultOffers.delete(offerId)) sendUi('vault:offer-done', { offerId }); }, 180000);
  sendUi('vault:offer', { offerId, tabId: o.tabId, site: o.site, username, update });
});

const vaultCommands = {
  'vault.status': async () => { if (vault) await vault.checkHello(); return vaultStatus(); },
  'vault.create': async ({ master, hello } = {}) => { await vault.create(master, { useHello: !!hello }); vaultTouch(); vaultChanged(); return vaultStatus(); },
  'vault.unlock': async ({ master } = {}) => { await vault.unlock(master); vaultTouch(); vaultChanged(); return vaultStatus(); },
  'vault.unlockHello': async () => {
    // La fenêtre Windows Hello se rattache à celle de PouleyPwolu.
    const handle = win ? win.getNativeWindowHandle() : null;
    const hwnd = handle ? (handle.length >= 8 ? handle.readBigUInt64LE(0) : BigInt(handle.readUInt32LE(0))).toString() : '0';
    await vault.unlockHello(hwnd);
    if (win) win.focus();
    vaultTouch();
    vaultChanged();
    return vaultStatus();
  },
  'vault.lock': () => { vaultLock('manuel'); return vaultStatus(); },
  'security.bitlocker': () => shell.openExternal('ms-settings:deviceencryption'),
  'vault.list': () => { vaultTouch(); return { items: vault.list(), audit: vault.audit() }; },
  'vault.reveal': (id) => { vaultTouch(); const x = vault.get(id); return x ? x.password : null; },
  'vault.copy': ({ id, field } = {}) => {
    const x = vault.get(id);
    if (!x) return false;
    const text = field === 'username' ? x.username : x.password;
    clipboard.writeText(text);
    vaultTouch();
    // Le mot de passe ne reste pas dans le presse-papiers.
    clearTimeout(clipboardTimer);
    if (field !== 'username') clipboardTimer = setTimeout(() => { if (clipboard.readText() === text) clipboard.writeText(''); }, 30000);
    return true;
  },
  'vault.save': (entry = {}) => vaultSave(entry),
  'vault.delete': (id) => { vault.remove(id); vaultTouch(); vaultChanged(); return true; },
  'vault.generate': (opts = {}) => generatePassword(opts),
  'vault.setHello': async (on) => {
    if (on && !(await vault.checkHello())) throw new Error('Windows Hello n’est pas configuré sur cet ordinateur.');
    vault.setHello(!!on);
    vaultChanged();
    return vaultStatus();
  },
  'vault.changeMaster': async ({ old, next } = {}) => { await vault.changeMaster(old, next); vaultTouch(); vaultChanged(); return true; },
  'vault.destroy': () => { vault.destroy(); vaultChanged(); return vaultStatus(); },
  'vault.import': async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Importer des mots de passe (CSV exporté par Chrome, Comet, Edge, Opera, Brave…)',
      filters: [{ name: 'Mots de passe', extensions: ['csv'] }], properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const rows = parseCsv(fs.readFileSync(file, 'utf8'));
    let n = 0;
    for (const row of rows) {
      try { vaultSave({ url: row.url, username: row.username, password: row.password, note: row.note }); n++; } catch {}
    }
    const ask = await dialog.showMessageBox(win, {
      type: 'warning', buttons: ['Effacer le fichier', 'Le garder'], defaultId: 0, cancelId: 1,
      title: 'Fichier en clair',
      message: n + ' mot' + (n > 1 ? 's' : '') + ' de passe importé' + (n > 1 ? 's' : '') + ' dans le coffre chiffré.',
      detail: 'Le fichier CSV contient tous tes mots de passe en clair : n’importe qui peut le lire. PouleyPwolu peut l’écraser puis le supprimer.',
    });
    if (ask.response === 0) shred(file);
    return { count: n, shredded: ask.response === 0 };
  },
  'vault.offer.respond': ({ offerId, action } = {}) => {
    const o = vaultOffers.get(offerId);
    if (!o) return { done: true };
    if (action === 'never') {
      S().vaultNever = [...new Set([...(S().vaultNever || []), o.site])];
      store.save();
    } else if (action === 'save') {
      if (!vault.exists()) return { need: 'create' };
      if (!vault.isOpen()) return { need: 'unlock' };
      vaultSave({ origin: o.origin, username: o.username, password: o.password });
      sendUi('toast', { text: 'Mot de passe de ' + o.site + ' rangé dans le coffre.' });
    }
    vaultOffers.delete(offerId);
    sendUi('vault:offer-done', { offerId });
    return { done: true };
  },
};

// État de BitLocker (chiffrement du disque par Windows), lu une fois au démarrage.
let bitlocker = null;
function checkBitlocker() {
  if (process.platform !== 'win32') return;
  const drive = (process.env.SystemDrive || 'C:').replace(/[^A-Za-z:]/g, '');
  const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    "(New-Object -ComObject Shell.Application).NameSpace('" + drive + "').Self.ExtendedProperty('System.Volume.BitLockerProtection')"], { windowsHide: true });
  let out = '';
  ps.stdout.on('data', (d) => { out += d; });
  ps.on('error', () => {});
  ps.on('close', () => {
    bitlocker = { 1: 'on', 3: 'on', 5: 'on', 2: 'off', 4: 'off', 6: 'paused' }[Number(out.trim())] || 'unknown';
    scheduleBroadcast();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Mises à jour automatiques : PouleyPwolu interroge les releases GitHub (seule connexion
// faite par l'appli elle-même, sans identifiant), télécharge en arrière-plan
// uniquement les morceaux modifiés, vérifie l'empreinte SHA-512, puis propose
// de redémarrer. L'installation se fait aussi toute seule à la fermeture.

let updater = null;
let updateState = { status: 'idle' };
function setUpdate(patch) {
  updateState = { ...updateState, ...patch };
  sendUi('update', updateState);
}
function setupUpdater() {
  const devTest = !!process.env.POULEY_UPDATE_TEST;
  if (!app.isPackaged && !devTest) { updateState = { status: 'dev' }; return; }
  try { updater = require('electron-updater').autoUpdater; } catch { updateState = { status: 'unavailable' }; return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.allowPrerelease = false;
  updater.logger = null;
  if (devTest) {
    updater.forceDevUpdateConfig = true;
    updater.updateConfigPath = path.join(ROOT, 'dev-app-update.yml');
  }
  updater.on('checking-for-update', () => setUpdate({ status: 'checking', error: null }));
  updater.on('update-not-available', () => setUpdate({ status: 'uptodate', checkedAt: Date.now() }));
  updater.on('update-available', (info) => setUpdate({ status: 'downloading', version: info.version, progress: 0 }));
  updater.on('download-progress', (p) => setUpdate({ status: 'downloading', progress: Math.round(p.percent || 0) }));
  updater.on('update-downloaded', (info) => setUpdate({ status: 'ready', version: info.version, progress: 100 }));
  updater.on('error', (err) => setUpdate({ status: 'error', error: String((err && err.message) || err).split('\n')[0].slice(0, 160) }));
}
function checkUpdates(manual) {
  if (!updater) return updateState;
  if (!manual && S().autoUpdate === false) return updateState;
  if (updateState.status === 'downloading' || updateState.status === 'ready') return updateState;
  updater.checkForUpdates().catch((err) => setUpdate({ status: 'error', error: String((err && err.message) || err).split('\n')[0].slice(0, 160) }));
  return updateState;
}

// ─────────────────────────────────────────────────────────────────────────────
// Captures d'écran : zone visible, page entière, ou zone sélectionnée

const shotDir = () => path.join(app.getPath('pictures'), 'PouleyPwolu');

// Electron 44 : presse-papiers façon W3C (ClipboardItem), avec repli sur l'ancienne API.
async function copyImage(img) {
  try {
    const { ClipboardItem } = require('electron');
    if (ClipboardItem && typeof clipboard.write === 'function') {
      await clipboard.write([new ClipboardItem({ 'image/png': new Blob([img.toPNG()], { type: 'image/png' }) })]);
      return true;
    }
    if (typeof clipboard.writeImage === 'function') { clipboard.writeImage(img); return true; }
  } catch (err) {
    console.warn('[presse-papiers]', err.message);
  }
  return false;
}

async function captureFullPage(wc) {
  const dbg = wc.debugger;
  let attached = false;
  try {
    if (!dbg.isAttached()) { dbg.attach('1.3'); attached = true; }
    const m = await dbg.sendCommand('Page.getLayoutMetrics');
    const size = m.cssContentSize || m.contentSize;
    const width = Math.max(1, Math.ceil(size.width));
    const height = Math.max(1, Math.min(Math.ceil(size.height), 16000)); // garde-fou mémoire
    const r = await dbg.sendCommand('Page.captureScreenshot', {
      format: 'png', captureBeyondViewport: true, fromSurface: true,
      clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    return nativeImage.createFromBuffer(Buffer.from(r.data, 'base64'));
  } finally {
    if (attached) { try { dbg.detach(); } catch {} }
  }
}

async function takeShot(mode, rect, size) {
  const f = currentTabId && findTab(currentTabId);
  const rt = currentTabId && runtime.get(currentTabId);
  if (!f || !rt || !rt.view) return null;
  const wc = rt.view.webContents;
  let img = null;
  try {
    if (mode === 'full') img = await captureFullPage(wc);
    else if (mode === 'region' && lastCapture && rect && size && size.width > 0) {
      const s = lastCapture.getSize();
      const k = s.width / size.width;
      const x = Math.max(0, Math.round(rect.x * k));
      const y = Math.max(0, Math.round(rect.y * k));
      const crop = {
        x, y,
        width: Math.max(1, Math.min(s.width - x, Math.round(rect.width * k))),
        height: Math.max(1, Math.min(s.height - y, Math.round(rect.height * k))),
      };
      img = lastCapture.crop(crop);
    }
  } catch (err) {
    console.warn('[capture]', err.message);
  }
  lastCapture = null;
  if (!img || img.isEmpty()) {
    if (viewsHidden && !rt.floating) return sendUi('toast', { text: 'Capture impossible pendant une superposition.' });
    img = await wc.capturePage().catch(() => null);
  }
  if (!img || img.isEmpty()) return sendUi('toast', { text: 'Capture impossible sur cette page.' });

  const dir = shotDir();
  fs.mkdirSync(dir, { recursive: true });
  let host = 'page';
  try { host = new URL(f.rec.url).hostname.replace(/^www\./, '') || 'pouley'; } catch {}
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const file = path.join(dir, `${host.replace(/[^a-z0-9.-]/gi, '_')}_${stamp}.png`);
  await fs.promises.writeFile(file, img.toPNG());
  const copied = await copyImage(img);
  const { width, height } = img.getSize();
  const id = uid('shot');
  downloads.set(id, { id, name: path.basename(file), path: file, state: 'completed' });
  sendUi('shot:done', { id, name: path.basename(file), width, height, mode, copied });
  return { id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Superposition : un onglet détaché dans une mini-fenêtre toujours au-dessus.
// La vue web est déplacée (pas rechargée) : une vidéo continue de jouer.

function sendFloatInfo(tabId) {
  const fw = floats.get(tabId);
  const f = findTab(tabId);
  if (!fw || fw.isDestroyed() || !f) return;
  const rt = runtime.get(tabId);
  fw.setTitle(f.rec.title || 'PouleyPwolu');
  fw.webContents.send('info', {
    title: f.rec.title || f.rec.url, url: f.rec.url, favicon: f.rec.favicon || null,
    opacity: fw.getOpacity(), canGoBack: !!(rt && rt.canGoBack),
  });
}

function floatTab(tabId) {
  const f = findTab(tabId);
  if (!f) return;
  if (split && (tabId === split.a || tabId === split.b)) split = null;
  if (floats.has(tabId)) { const w = floats.get(tabId); w.show(); w.focus(); return; }
  const rt = ensureView(tabId);
  if (!rt || !rt.view) return;
  const view = rt.view;
  const wa = screen.getDisplayMatching(win.getBounds()).workArea;
  const width = 520;
  const height = 340;
  const fw = new BrowserWindow({
    width, height, x: wa.x + wa.width - width - 24, y: wa.y + wa.height - height - 24,
    minWidth: 260, minHeight: 170, frame: false, alwaysOnTop: true, backgroundColor: '#111113',
    icon: ICON, title: f.rec.title || 'PouleyPwolu', show: false,
    webPreferences: { preload: FLOAT_PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false },
  });
  fw.setAlwaysOnTop(true, 'floating');
  fw.setVisibleOnAllWorkspaces(true);
  fw.loadFile(path.join(ROOT, 'src', 'renderer', 'float.html'));
  try { win.contentView.removeChildView(view); } catch {}
  fw.contentView.addChildView(view);
  view.setBorderRadius(0);
  view.setVisible(true);
  const place = () => {
    if (fw.isDestroyed()) return;
    const [w, h] = fw.getContentSize();
    view.setBounds({ x: 0, y: FLOAT_BAR, width: w, height: Math.max(0, h - FLOAT_BAR) });
  };
  place();
  fw.on('resize', place);
  fw.webContents.on('before-input-event', (event, input) => { if (handleShortcut(input, false)) event.preventDefault(); });
  fw.webContents.once('did-finish-load', () => { sendFloatInfo(tabId); fw.showInactive(); });
  // Fermer la fenêtre flottante ramène l'onglet dans le navigateur.
  fw.on('close', () => dockTab(tabId, false));
  rt.floating = fw;
  floats.set(tabId, fw);
  // L'onglet reste dans la barre ; on montre un autre onglet à sa place.
  if (currentTabId === tabId) {
    const p = activePoulailler();
    const next = p.tabs.find((t) => t.id !== tabId && !t.pinned && !(runtime.get(t.id) || {}).floating);
    if (next) activateTab(next.id);
  }
  applyLayout();
  scheduleBroadcast();
}

function dockTab(tabId, activate) {
  const fw = floats.get(tabId);
  const rt = runtime.get(tabId);
  if (!fw) return;
  floats.delete(tabId);
  if (rt && rt.view) {
    try { fw.contentView.removeChildView(rt.view); } catch {}
    rt.floating = null;
    rt.view.setVisible(false);
    rt.view.setBorderRadius(12);
    win.contentView.addChildView(rt.view);
  }
  if (!fw.isDestroyed()) fw.destroy();
  if (activate) activateTab(tabId);
  else applyLayout();
  scheduleBroadcast();
}

// Rattrapage : les onglets sans icône (jamais chargés) la récupèrent, un par un.
async function backfillIcons() {
  const jobs = [];
  for (const t of store.state.favorites) jobs.push({ t, p: null });
  for (const p of store.state.poulaillers) for (const t of p.tabs) jobs.push({ t, p });
  const todo = jobs.filter(({ t }) => !t.favicon && /^https?:/.test(t.url));
  const worker = async () => {
    while (todo.length) {
      const { t, p } = todo.shift();
      const part = partitionFor(t, p);
      const ses = session.fromPartition(part);
      configureSession(ses, part);
      const icon = await bestIcon(ses, [], t.url).catch(() => null);
      if (icon && findTab(t.id) && !findTab(t.id).rec.favicon) updateRec(t.id, { favicon: icon });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
}

function toggleFloat(tabId) {
  if (!tabId) return;
  if (floats.has(tabId)) dockTab(tabId, true);
  else floatTab(tabId);
}

ipcMain.handle('float:cmd', (event, name, arg) => {
  const entry = [...floats.entries()].find(([, w]) => !w.isDestroyed() && w.webContents === event.sender);
  if (!entry) return null;
  const [tabId, fw] = entry;
  const rt = runtime.get(tabId);
  const wc = rt && rt.view ? rt.view.webContents : null;
  switch (name) {
    case 'info': return sendFloatInfo(tabId);
    case 'opacity': fw.setOpacity(Math.max(0.25, Math.min(1, Number(arg) || 1))); return null;
    case 'dock': dockTab(tabId, true); win.show(); win.focus(); return null;
    case 'close': fw.close(); return null;
    case 'close-tab': closeTab(tabId); return null;
    case 'back': if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); return null;
    case 'reload': if (wc) wc.reload(); return null;
    case 'shot': return null;
    default: return null;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Commandes envoyées par l'interface

// Apparence d'un poulailler : 2e couleur du dégradé, intensité (transparence) et grain.
const validColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : null);
const clamp01 = (v, d) => (Number.isFinite(Number(v)) ? Math.max(0, Math.min(1, Number(v))) : d);
function applyLook(p, { color2, gradient, grain } = {}) {
  if (validColor(color2)) p.color2 = validColor(color2);
  if (gradient != null) p.gradient = clamp01(gradient, 0.6);
  if (grain != null) p.grain = clamp01(grain, 0.24);
}

const commands = {
  'tab.new': (a = {}) => openTab(a),
  'tab.activate': (id) => activateTab(id),
  'tab.close': (id) => closeTab(id || currentTabId),
  'tab.navigate': ({ id, input }) => navigate(id || currentTabId, input),
  'tab.back': () => { const wc = currentContents(); if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); },
  'tab.forward': () => { const wc = currentContents(); if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); },
  'tab.reload': () => reloadTab(),
  'tab.stop': () => { const wc = currentContents(); if (wc) wc.stop(); },
  'tab.pin': (id) => togglePin(id || currentTabId),
  'tab.favorite': (id) => {
    const f = findTab(id || currentTabId);
    if (!f) return;
    if (!f.poulailler) moveTab({ id: f.rec.id, poulaillerId: store.state.activePoulailler, pinned: true, index: 0 });
    else if (store.state.favorites.length < 12) moveTab({ id: f.rec.id, favorite: true });
  },
  'tab.move': (a) => moveTab(a),
  'tab.mute': (id) => { const rt = runtime.get(id || currentTabId); if (rt && rt.view) rt.view.webContents.setAudioMuted(!rt.view.webContents.isAudioMuted()); scheduleBroadcast(); },
  'tab.duplicate': (id) => { const f = findTab(id || currentTabId); if (f) openTab({ url: f.rec.url, poulaillerId: f.poulailler && f.poulailler.id }); },
  'tab.reopen': () => reopenClosed(),
  'tab.devtools': () => { const wc = currentContents(); if (wc) wc.toggleDevTools(); },
  'tab.zoom': (d) => zoom(Number(d) || 0),
  'tab.copyUrl': () => { const f = currentTabId && findTab(currentTabId); if (f) clipboard.writeText(f.rec.url); },
  'tab.openInComet': () => { const f = currentTabId && findTab(currentTabId); if (f) openInComet(f.rec.url); },
  'tab.find': ({ text, forward = true, findNext = false }) => { const wc = currentContents(); if (wc && text) wc.findInPage(String(text), { forward, findNext }); },
  'tab.findStop': () => { const wc = currentContents(); if (wc) wc.stopFindInPage('clearSelection'); },
  'tab.sleep': (id) => { if (id !== currentTabId) { destroyView(id); scheduleBroadcast(); } },
  'tab.menu': (id) => {
    const f = findTab(id);
    if (!f) return;
    const rt = runtime.get(id);
    const others = store.state.poulaillers.filter((p) => !f.poulailler || p.id !== f.poulailler.id);
    const t = [
      f.poulailler
        ? { label: f.rec.pinned ? 'Désépingler' : 'Épingler', click: () => togglePin(id) }
        : { label: 'Retirer des favoris', click: () => commands['tab.favorite'](id) },
      f.poulailler && store.state.favorites.length < 12 ? { label: 'Ajouter aux favoris', click: () => moveTab({ id, favorite: true }) } : null,
      f.poulailler && !f.rec.pinned ? { label: 'Groupe d’œufs', submenu: [
        { label: 'Nouveau groupe avec cet onglet', click: () => { const g = createGroup(f.poulailler, [id], { name: groupKeyOf(f.rec.url)?.label || 'Groupe d’œufs', sites: [siteOf(hostOfUrl(f.rec.url))].filter(Boolean) }); sendUi('shortcut', 'edit-group:' + g.id); } },
        ...(groupsOf(f.poulailler).length ? [{ type: 'separator' }, ...groupsOf(f.poulailler).map((g) => ({ label: '🥚  ' + g.name, type: 'checkbox', checked: f.rec.groupId === g.id, click: () => setTabGroup(id, g.id) }))] : []),
        ...(f.rec.groupId ? [{ type: 'separator' }, { label: 'Retirer du groupe', click: () => setTabGroup(id, null) }] : []),
      ] } : null,
      id !== currentTabId ? { label: 'Ouvrir côte à côte', click: () => commands['split.start']({ other: id }) } : null,
      { label: 'Dupliquer', click: () => commands['tab.duplicate'](id) },
      { label: 'Copier l’adresse', click: () => clipboard.writeText(f.rec.url) },
      rt && rt.view ? { label: rt.view.webContents.isAudioMuted() ? 'Réactiver le son' : 'Couper le son', click: () => commands['tab.mute'](id) } : null,
      rt && rt.view && id !== currentTabId ? { label: 'Mettre en veille', click: () => commands['tab.sleep'](id) } : null,
      others.length ? { label: 'Déplacer vers', submenu: others.map((p) => ({ label: p.name, click: () => moveTab({ id, poulaillerId: p.id, pinned: false, index: 0 }) })) } : null,
      cometAvailable() && /^https?:/.test(f.rec.url) ? { label: 'Ouvrir dans Comet', click: () => openInComet(f.rec.url) } : null,
      { type: 'separator' },
      { label: f.rec.pinned || !f.poulailler ? 'Mettre en veille / réinitialiser' : 'Fermer', click: () => closeTab(id) },
    ].filter(Boolean);
    Menu.buildFromTemplate(t).popup({ window: win });
  },
  'poulailler.menu': (id) => {
    const p = store.state.poulaillers.find((x) => x.id === id);
    if (!p) return;
    Menu.buildFromTemplate([
      { label: 'Modifier…', click: () => sendUi('shortcut', 'edit-poulailler:' + id) },
      { label: 'Mettre tous les onglets en veille', click: () => { for (const t of p.tabs) if (t.id !== currentTabId) destroyView(t.id); scheduleBroadcast(); } },
      { label: 'Fermer les onglets non épinglés', click: () => { for (const t of p.tabs.filter((x) => !x.pinned)) closeTab(t.id); } },
      { type: 'separator' },
      { label: 'Supprimer le poulailler', enabled: store.state.poulaillers.length > 1, click: () => sendUi('shortcut', 'edit-poulailler:' + id) },
    ]).popup({ window: win });
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
    if (isolated != null && !!isolated !== p.isolated) {
      p.isolated = !!isolated;
      for (const t of p.tabs) destroyView(t.id, false);
      if (p.id === store.state.activePoulailler && currentTabId) activateTab(currentTabId);
    }
    store.save();
    scheduleBroadcast();
  },
  'poulailler.delete': async (id) => {
    const list = store.state.poulaillers;
    if (list.length <= 1) return false;
    const i = list.findIndex((p) => p.id === id);
    if (i < 0) return false;
    const [p] = list.splice(i, 1);
    for (const t of p.tabs) { destroyView(t.id, false); runtime.delete(t.id); }
    if (p.isolated) session.fromPartition('persist:poulailler-' + p.id).clearStorageData().catch(() => {});
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
    const prevAi = s.ai;
    const prevMaterial = s.windowMaterial;
    for (const [k, v] of Object.entries(patch)) if (k in s) s[k] = v;
    if ('wipeCacheOnExit' in patch) {
      const marker = path.join(app.getPath('userData'), 'garder-cache');
      try { if (s.wipeCacheOnExit) fs.rmSync(marker, { force: true }); else fs.writeFileSync(marker, ''); } catch {}
    }
    if ('vaultAutoLockMinutes' in patch) vaultTouch();
    if (aiView && s.ai !== prevAi) aiView.webContents.loadURL(askUrl('')).catch(() => {});
    if (s.windowMaterial !== prevMaterial && win && process.platform === 'win32') {
      try { win.setBackgroundMaterial(materialOf(s.windowMaterial)); } catch (err) { console.warn('[matériau]', err.message); }
    }
    store.save();
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
  'aidetect.page': (tabId) => aidPage(tabId || currentTabId),
  'pen.toggle': () => penToggle(),
  'aidetect.text': (text) => aiDetect.analyzeText(text),
  'focus.addSite': (input) => {
    const site = focus.cleanSite(input);
    if (!site) return false;
    const s = store.state.settings;
    if (!s.focusSites.includes(site)) s.focusSites = [...s.focusSites, site].sort();
    store.save();
    scheduleBroadcast();
    return site;
  },
  'focus.removeSite': (site) => {
    const s = store.state.settings;
    s.focusSites = s.focusSites.filter((x) => x !== site);
    store.save();
    scheduleBroadcast();
  },
  'focus.resetSites': () => { store.state.settings.focusSites = [...focus.DEFAULT_SITES]; store.save(); scheduleBroadcast(); },
  'focus.clear': () => { store.state.focus = { days: {} }; store.save(); scheduleBroadcast(); },
  'onboarding.replay': () => { store.state.onboarded = false; store.save(); scheduleBroadcast(); },

  inspect: (id) => inspect(id),
  capture: async (opts = {}) => {
    const wc = currentContents();
    const rt = currentTabId && runtime.get(currentTabId);
    if (!wc || viewsHidden || (rt && rt.floating) || split) return null;
    try {
      const img = await wc.capturePage();
      if (opts && opts.keep) lastCapture = img;
      return 'data:image/jpeg;base64,' + img.toJPEG(60).toString('base64');
    } catch {
      return null;
    }
  },
  'views.hidden': (hidden) => { viewsHidden = !!hidden; applyLayout(); if (!hidden) { const wc = currentContents(); if (wc) wc.focus(); } },

  'ai.toggle': () => setAiOpen(!aiOpen),
  'ai.ask': (prompt) => aiAsk(String(prompt || '')),
  'ai.askPage': () => aiAskPage(),
  'ai.home': () => { ensureAiView(); aiView.webContents.loadURL(askUrl('')).catch(() => {}); },

  'permission.respond': (a) => respondPermission(a || {}),

  // Liste de tous les onglets du poulailler (barre du haut trop pleine)
  // Barre du haut : liste des pages épinglées du poulailler, avec leurs icônes.
  'tab.pinnedMenu': () => {
    const p = activePoulailler();
    const pinned = p.tabs.filter((t) => t.pinned);
    const iconOf = (t) => {
      try {
        if (t.favicon && t.favicon.startsWith('data:image/') && !t.favicon.startsWith('data:image/svg')) {
          const img = nativeImage.createFromDataURL(t.favicon);
          if (!img.isEmpty()) return img.resize({ width: 16, height: 16, quality: 'best' });
        }
      } catch {}
      return undefined;
    };
    const tpl = pinned.length ? pinned.map((t) => ({
      label: (t.title || t.url || 'Page').slice(0, 70),
      sublabel: (() => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      icon: iconOf(t), type: t.id === currentTabId ? 'checkbox' : 'normal', checked: t.id === currentTabId,
      click: () => activateTab(t.id),
    })) : [{ label: 'Aucune page épinglée', enabled: false }];
    tpl.push({ type: 'separator' }, { label: 'Épingler l’onglet actuel', enabled: !!currentTabId && !findTab(currentTabId)?.rec.pinned && !!findTab(currentTabId)?.poulailler, click: () => togglePin(currentTabId) });
    if (currentTabId && findTab(currentTabId)?.rec.pinned) tpl.push({ label: 'Désépingler l’onglet actuel', click: () => togglePin(currentTabId) });
    Menu.buildFromTemplate(tpl).popup({ window: win });
  },
  'tab.listMenu': () => {
    const p = activePoulailler();
    const groups = new Map(groupsOf(p).map((g) => [g.id, g]));
    const item = (t) => ({
      label: (t.title || t.url || 'Onglet').slice(0, 70), type: 'checkbox', checked: t.id === currentTabId,
      sublabel: (() => { try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
      click: () => activateTab(t.id),
    });
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
    Menu.buildFromTemplate(tpl).popup({ window: win });
  },
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
  'group.closeTabs': (id) => {
    const p = activePoulailler();
    for (const t of p.tabs.filter((x) => x.groupId === id)) closeTab(t.id);
  },
  'group.newTab': (id) => openTab({ url: 'pouley://newtab', groupId: id }),
  'group.menu': (id) => {
    const p = activePoulailler();
    const g = groupsOf(p).find((x) => x.id === id);
    if (!g) return;
    Menu.buildFromTemplate([
      { label: 'Modifier le groupe…', click: () => sendUi('shortcut', 'edit-group:' + id) },
      { label: g.collapsed ? 'Déplier' : 'Replier', click: () => commands['group.update']({ id, collapsed: !g.collapsed }) },
      { label: 'Nouvel onglet dans ce groupe', click: () => commands['group.newTab'](id) },
      { label: 'Ranger automatiquement ses sites', type: 'checkbox', checked: g.auto, click: () => commands['group.update']({ id, auto: !g.auto }) },
      { type: 'separator' },
      { label: 'Dégrouper', click: () => commands['group.ungroup'](id) },
      { label: 'Fermer les onglets du groupe', click: () => commands['group.closeTabs'](id) },
    ]).popup({ window: win });
  },

  'ext.toggle': async (key) => {
    const e = EXTENSIONS.find((x) => x.key === key);
    if (!e || !e.available) return;
    const s = store.state.settings;
    s[e.setting] = s[e.setting] === false;
    store.save();
    if (s[e.setting]) await Promise.all([...allSessions].map((ses) => loadExtensionsInto(ses)));
    else unloadExtension(e);
    scheduleBroadcast();
  },
  'ext.prepare': (input) => extHost.prepare(input),
  'ext.install': async (token) => {
    const info = await extHost.install(token);
    sendUi('toast', { text: info.name + ' est installée. Son bouton est à côté de « Inspecter ».' });
    return info;
  },
  'ext.cancel': (token) => extHost.cancel(token),
  'ext.remove': (id) => extHost.remove(id),
  'ext.enable': ({ id, on } = {}) => extHost.setEnabled(id, on),
  'ext.pin': ({ id, on } = {}) => extHost.setPinned(id, on),
  'ext.popup': ({ id, rect } = {}) => {
    const b = win.getContentBounds();
    const anchor = rect ? { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height } : null;
    return extHost.showPopup(id, anchor);
  },
  'ext.options': (id) => extHost.callApi({ ses: currentSession(), extId: id }, 'runtime.openOptionsPage', []),
  'ext.nadspdf.open': async () => {
    const url = await nadspdfUrl(null);
    if (url) openTab({ url });
    else sendUi('toast', { text: 'L’extension NadsPDF est désactivée.' });
  },
  'ext.nadspdf.openFile': async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Ouvrir un PDF dans NadsPDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePaths[0]) return;
    const url = await nadspdfUrl(require('url').pathToFileURL(r.filePaths[0]).href);
    if (url) openTab({ url });
  },
  'ext.nadspdf.current': async () => {
    const f = currentTabId && findTab(currentTabId);
    if (!f || !PDF_URL.test(f.rec.url)) return;
    const url = await nadspdfUrl(f.rec.url);
    if (url) navigate(currentTabId, url);
  },
  'download.nadspdf': (id) => {
    const d = downloads.get(id);
    if (d && NADSPDF_APP) spawn(NADSPDF_APP, [d.path], { detached: true, stdio: 'ignore' }).unref();
  },

  'shot.menu': () => {
    if (!currentContents()) return;
    Menu.buildFromTemplate([
      { label: 'Capturer la zone visible', accelerator: 'CmdOrCtrl+Shift+S', click: () => takeShot('visible') },
      { label: 'Capturer la page entière', click: () => takeShot('full') },
      { label: 'Sélectionner une zone…', accelerator: 'CmdOrCtrl+Shift+X', click: () => sendUi('shortcut', 'shot-region') },
      { label: 'Écrire sur la page, puis capturer…', accelerator: 'CmdOrCtrl+Shift+D', click: () => penToggle() },
      { type: 'separator' },
      { label: 'Ouvrir le dossier des captures', click: () => { fs.mkdirSync(shotDir(), { recursive: true }); shell.openPath(shotDir()); } },
    ]).popup({ window: win });
  },
  'shot.capture': (a = {}) => takeShot(a.mode || 'visible', a.rect, a.size),
  'shot.cancel': () => { lastCapture = null; },

  'tab.float': (id) => toggleFloat(id || currentTabId),
  'update.check': () => checkUpdates(true),
  'update.install': () => { if (updater && updateState.status === 'ready') { store.flush(); updater.quitAndInstall(true, true); } },
  'memory.report': () => memoryReport(),
  'memory.free': () => {
    let n = 0;
    for (const [id, rt] of runtime) if (canSleep(id, rt)) { destroyView(id); n++; }
    scheduleBroadcast();
    return n;
  },
  'repo.menu': () => { const f = currentTabId && findTab(currentTabId); if (f) repoMenu(f.rec.url); },

  'media.cmd': async (action) => {
    const cur = JSON.parse(lastMediaJson || 'null');
    if (!cur) return;
    if (cur.source === 'system') { sysMedia = readSys(await sysCommand(action)); }
    else {
      const rt = runtime.get(cur.tabId);
      const wc = rt && rt.view && rt.view.webContents;
      if (!wc) return;
      if (action === 'mute') wc.setAudioMuted(!wc.isAudioMuted());
      else await wc.executeJavaScript(mediaAction(action), true).catch(() => {});
    }
    setTimeout(() => pollMedia().catch(() => {}), 250);
  },
  'media.open': () => { const cur = JSON.parse(lastMediaJson || 'null'); if (cur && cur.tabId) activateTab(cur.tabId); },
  'fav.peek': ({ id, anchor, edge } = {}) => showFavPeek(id, anchor && normRect(anchor), edge && normRect(edge)),
  'fav.unpeek': () => hideFavPeek(),

  // Côte à côte : l'onglet courant à gauche, l'autre à droite.
  'split.start': ({ other, input } = {}) => {
    if (!currentTabId) return;
    const cur = currentTabId;
    if (floats.has(cur)) dockTab(cur, false);
    let b = other;
    if (!b && input != null) {
      const f = findTab(cur);
      b = openTab({ input, background: true, poulaillerId: f && f.poulailler ? f.poulailler.id : undefined });
    }
    if (!b || b === cur || !findTab(b)) return;
    if (floats.has(b)) dockTab(b, false);
    split = { a: cur, b, ratio: split && split.ratio ? split.ratio : 0.5 };
    ensureView(cur);
    ensureView(b);
    applyLayout();
    scheduleBroadcast();
  },
  'split.end': () => { split = null; applyLayout(); scheduleBroadcast(); const wc = currentContents(); if (wc) wc.focus(); },
  'split.swap': () => { if (!split) return; split = { ...split, a: split.b, b: split.a, ratio: 1 - split.ratio }; scheduleBroadcast(); },
  'split.ratio': (r) => { if (!split) return; split.ratio = Math.max(0.2, Math.min(0.8, Number(r) || 0.5)); scheduleBroadcast(); },
  'split.menu': () => {
    if (!split) return;
    Menu.buildFromTemplate([
      { label: 'Inverser les côtés', click: () => commands['split.swap']() },
      { label: 'Moitié / moitié', click: () => commands['split.ratio'](0.5) },
      { type: 'separator' },
      { label: 'Quitter le côte à côte', click: () => commands['split.end']() },
    ]).popup({ window: win });
  },
  'tab.dock': (id) => dockTab(id || currentTabId, true),
  'tab.focusFloat': (id) => { const fw = floats.get(id || currentTabId); if (fw) { fw.show(); fw.focus(); } },

  // Barre masquée ouverte au survol : on suit la souris depuis ici, car la page
  // web (vue native) ne transmet pas les sorties de souris à l'interface.
  'peek.watch': ({ on, width = 264, side = 'left' } = {}) => {
    clearInterval(peekTimer);
    peekTimer = null;
    peekInside = null;
    if (!on || !win) return;
    peekTimer = setInterval(() => {
      if (!win || win.isDestroyed()) return clearInterval(peekTimer);
      const p = screen.getCursorScreenPoint();
      const b = win.getContentBounds();
      const x = p.x - b.x;
      const y = p.y - b.y;
      const margin = 18;
      const inY = y >= -4 && y <= b.height + 4;
      const inside = inY && (side === 'right' ? x >= b.width - width - margin && x <= b.width + 4 : x >= -4 && x <= width + margin);
      if (inside !== peekInside) {
        peekInside = inside;
        sendUi('peek:inside', inside);
      }
    }, 80);
  },

  'window.minimize': () => win.minimize(),
  'window.maximize': () => (win.isMaximized() ? win.unmaximize() : win.maximize()),
  'window.close': () => win.close(),
  'window.fullscreen': () => win.setFullScreen(!win.isFullScreen()),

  'archive.restore': (i) => {
    const a = (store.state.archive || [])[i];
    if (!a) return;
    store.state.archive.splice(i, 1);
    openTab({ url: a.url });
  },
  'archive.clear': () => { store.state.archive = []; store.save(); scheduleBroadcast(); },
  'data.clearAll': async () => {
    const partitions = new Set(['persist:pouley-commun', 'persist:pouley-ia', ...store.state.poulaillers.map((p) => 'persist:poulailler-' + p.id)]);
    for (const part of partitions) await session.fromPartition(part).clearStorageData().catch(() => {});
    grants.clear();
    sendUi('toast', { text: 'Cookies, caches et stockages effacés.' });
  },
  'download.show': (id) => { const d = downloads.get(id); if (d) shell.showItemInFolder(d.path); },
  'download.open': (id) => { const d = downloads.get(id); if (d && d.state === 'completed') shell.openPath(d.path); },
};

Object.assign(commands, vaultCommands);

ipcMain.handle('cmd', async (event, name, arg) => {
  if (!win || event.sender !== win.webContents) return null;
  const fn = commands[name];
  if (!fn) return null;
  try {
    return await fn(arg);
  } catch (err) {
    console.error('[cmd]', name, err);
    return { error: String(err && err.message || err) };
  }
});
ipcMain.handle('ui:state', (event) => (win && event.sender === win.webContents ? snapshot() : null));
ipcMain.on('layout', (event, l) => {
  if (!win || event.sender !== win.webContents) return;
  layout = { content: normRect(l && l.content), ai: normRect(l && l.ai), splitA: normRect(l && l.splitA), splitB: normRect(l && l.splitB) };
  applyLayout();
});
// Premier chargement d'un onglet réveillé : rend son sessionStorage (même site, même espace).
// ─────────────────────────────────────────────────────────────────────────────
// Barre masquée : on surveille le bord de la fenêtre depuis ici. La bande de
// 8 px de l'interface ne suffit pas : fenêtre agrandie, Windows la pousse de
// quelques pixels hors de l'écran et il n'en reste presque rien ; avec un
// écran à gauche, la souris passe sans s'arrêter. On prend donc le bord
// visible (fenêtre ou écran) et une bande de 10 px.
setInterval(() => {
  if (!win || win.isDestroyed() || !store || peekTimer) return;
  const s = S();
  if (!s.sidebarAutoHide || s.sidebarPosition === 'top' || viewsHidden) return;
  if (!win.isFocused() || win.isMinimized()) return;
  const p = screen.getCursorScreenPoint();
  const b = win.getContentBounds();
  if (p.y < b.y || p.y > b.y + b.height) return;
  const d = screen.getDisplayMatching(b).bounds;
  const band = 10;
  const hit = s.sidebarPosition === 'right'
    ? p.x <= Math.min(b.x + b.width, d.x + d.width) && p.x >= Math.min(b.x + b.width, d.x + d.width) - band
    : p.x >= Math.max(b.x, d.x) && p.x <= Math.max(b.x, d.x) + band;
  if (hit) sendUi('shortcut', 'peek');
}, 90);

// ─────────────────────────────────────────────────────────────────────────────
// Stylo : le dessin vit dans la page (preload/page.js) ; ici on garde les
// réglages du stylo et on fait la capture d'écran.

function penToggle() {
  const wc = currentContents();
  if (!wc || !/^https?:|^file:/.test(wc.getURL())) return sendUi('toast', { text: 'Le stylo fonctionne sur les pages web.' });
  wc.send('pen:toggle', S().pen);
}

const penColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#EF3E36');
const PEN_TOOLS = new Set(['main', 'pen', 'marker', 'arrow', 'eraser']);
ipcMain.on('pen:prefs', (event, p) => {
  if (!store || !wcToTab.has(event.sender.id) || !p || typeof p !== 'object') return;
  const size = (n) => Math.max(1, Math.min(40, Math.round(Number(n) || 4)));
  store.state.settings.pen = {
    tool: PEN_TOOLS.has(p.tool) ? p.tool : 'pen',
    color: penColor(p.color),
    size: size(p.size),
    pens: (Array.isArray(p.pens) ? p.pens : []).slice(0, 6).map((x) => ({
      tool: ['pen', 'marker', 'arrow'].includes(x && x.tool) ? x.tool : 'pen', color: penColor(x && x.color), size: size(x && x.size),
    })),
  };
  store.save();
});
ipcMain.on('pen:state', (event, on) => {
  const r = runtime.get(wcToTab.get(event.sender.id));
  if (!r) return;
  r.penOn = !!on;
  scheduleBroadcast();
});
ipcMain.handle('pen:shot', async (event, mode) => {
  if (wcToTab.get(event.sender.id) !== currentTabId) return false;
  await takeShot(mode === 'full' ? 'full' : 'visible');
  return true;
});

ipcMain.on('page:session-restore', (event) => {
  const tabId = wcToTab.get(event.sender.id);
  const rt = tabId && runtime.get(tabId);
  const main = event.senderFrame && event.senderFrame === event.sender.mainFrame;
  // returnValue répond dès qu'on l'affecte : une seule affectation.
  event.returnValue = sessionKeep && rt && main ? sessionKeep.take(tabId, rt.partition, event.senderFrame.origin) : null;
});

ipcMain.on('page:probe', (event, kind, isCount) => {
  const tabId = wcToTab.get(event.sender.id);
  const rt = tabId && runtime.get(tabId);
  if (!rt || !rt.report) return;
  if (isCount) {
    if (kind === 'beacon') rt.report.beacons++;
    if (kind === 'notify') sendUi('cluck', 'notif');
    return;
  }
  rt.report.fingerprint[kind] = true;
  const msgs = {
    canvas: 'Ce site lit ton canvas pour calculer une empreinte de ta machine.',
    webgl: 'Ce site demande le modèle exact de ta carte graphique.',
    audio: 'Ce site calcule une empreinte audio de ton appareil.',
    fonts: 'Ce site liste les polices installées sur ton ordinateur.',
    battery: 'Ce site lit le niveau de ta batterie.',
    clipboard: 'Ce site lit ton presse-papiers.',
  };
  if (msgs[kind]) raiseAlert(tabId, rt, 'fp-' + kind, msgs[kind]);
  scheduleBroadcast();
});

// ─────────────────────────────────────────────────────────────────────────────
// Fenêtre

const materialOf = (m) => (['none', 'mica', 'acrylic'].includes(m) ? m : 'none');

function createWindow() {
  const b = store.state.window || {};
  win = new BrowserWindow({
    width: b.width || 1380,
    height: b.height || 880,
    x: b.x,
    y: b.y,
    minWidth: 760,
    minHeight: 480,
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : undefined,
    // Fond transparent : le matériau Windows 11 (acrylique / mica) apparaît derrière l'interface.
    backgroundColor: '#00000000',
    backgroundMaterial: process.platform === 'win32' ? materialOf(store.state.settings.windowMaterial) : undefined,
    show: false,
    icon: ICON,
    title: 'PouleyPwolu',
    // Le son de poule des notifications doit pouvoir jouer sans clic préalable.
    webPreferences: { preload: UI_PRELOAD, contextIsolation: true, sandbox: true, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' },
  });
  if (b.maximized) win.maximize();
  win.loadFile(path.join(ROOT, 'src', 'renderer', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (event, input) => {
    if (handleShortcut(input, false)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) openTab({ url });
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  for (const ev of ['maximize', 'unmaximize', 'enter-full-screen', 'leave-full-screen']) win.on(ev, scheduleBroadcast);
  win.on('close', () => {
    store.state.window = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    store.flush();
  });
  win.on('closed', () => {
    win = null;
    for (const fw of floats.values()) if (!fw.isDestroyed()) fw.destroy();
    floats.clear();
  });
}

function openFromArgv(argv) {
  const url = argv.slice(1).find((a) => /^https?:\/\//i.test(a));
  if (url && win) openTab({ url });
}

app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  openFromArgv(argv);
});

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  store = new Store();
  // Rien n'est gardé si l'utilisateur veut tout effacer en fermant.
  sessionKeep = new SessionKeep(app.getPath('userData'), S().clearOnExit ? null : store.key);
  vault = new Vault(app.getPath('userData'));
  extHost = createExtHost({
    state: () => store.state, save: () => store.save(), sendUi, broadcast: () => scheduleBroadcast(),
    win: () => win, currentTabId: () => currentTabId, currentSession,
    runtime, wcToTab, allSessions, openTab, activateTab, closeTab, ensureView,
  });
  // Verrouiller le coffre quand l'ordinateur se verrouille ou se met en veille.
  powerMonitor.on('lock-screen', () => vaultLock('ecran'));
  powerMonitor.on('suspend', () => vaultLock('veille'));
  checkBitlocker();
  // Les onglets éphémères ne survivent pas à un redémarrage.
  for (const p of store.state.poulaillers) { p.tabs = p.tabs.filter((t) => !t.ephemeral); normalizeGroups(p); }

  // Session de l'interface : aucune permission, pas de correcteur réseau.
  session.defaultSession.setSpellCheckerEnabled(false);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'clipboard-sanitized-write'));

  createWindow();
  win.webContents.once('did-finish-load', () => {
    housekeeping();
    const p = activePoulailler();
    const target = p.tabs.find((t) => t.id === p.activeTab) || p.tabs.find((t) => !t.pinned);
    if (target) activateTab(target.id);
    openFromArgv(process.argv);
    scheduleBroadcast();
    backfillIcons();
    setupUpdater();
    setTimeout(() => checkUpdates(false), 10000);
    // Extensions du Chrome Web Store : mises à jour une fois par jour.
    const extUpdates = () => { if (S().autoUpdate !== false && extHost.list().length) extHost.checkUpdates(); };
    setTimeout(extUpdates, 90000);
    setInterval(extUpdates, 24 * 3600000);
    setInterval(() => checkUpdates(false), 6 * 3600000);
  });
  setInterval(housekeeping, 60000);
  if (process.platform === 'darwin' && app.dock) app.dock.setIcon(nativeImage.createFromPath(path.join(ROOT, 'build', 'icon.png')));
});

app.on('before-quit', async (event) => {
  if (vault) vault.lock();
  if (!store || app.__cleared) return;
  event.preventDefault();
  app.__cleared = true;
  if (S().clearOnExit) await commands['data.clearAll']().catch(() => {});
  else {
    const live = [...runtime].filter(([, rt]) => rt.view).map(([id, rt]) => [id, rt.view.webContents, rt.partition]);
    await sessionKeep.save(live).catch(() => {});
  }
  for (const ses of allSessions) {
    if (S().wipeCacheOnExit !== false) {
      await ses.clearCache().catch(() => {});
      await ses.clearCodeCaches({}).catch(() => {});
    }
    // Écrit tout de suite les derniers cookies (Chromium attend sinon jusqu'à 30 s).
    await ses.cookies.flushStore().catch(() => {});
  }
  store.flush();
  app.quit();
});

app.on('will-quit', () => stopSysMedia());

app.on('window-all-closed', () => {
  if (store) store.flush();
  app.quit();
});

app.on('web-contents-created', (_e, contents) => {
  // Identité Google Chrome pour la page de connexion Google (voir CHROME_METADATA).
  contents.on('did-start-navigation', (details) => {
    if (!details.isMainFrame || details.isSameDocument) return;
    const google = isGoogleLogin(details.url);
    if (google || contents.__googleDbg) googleIdentity(contents, google);
  });
  // Aucune vue ne doit pouvoir embarquer de <webview> ni naviguer vers des schémas exotiques.
  contents.on('will-attach-webview', (e) => e.preventDefault());
});
