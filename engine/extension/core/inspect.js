// Inspecteur (vie privée, technos, charte graphique) et détecteur d'IA, dans Chromium.
// Repris de src/main/main.js : le rapport de vie privée se remplit en observant les
// requêtes (chrome.webRequest, sans les modifier : le blocage est fait par le bouclier,
// lib/shield.js). L'inspecteur s'affiche dans un panneau à droite de la page.
import { classify, shouldBlock, siteOf } from '../lib/trackers.js';
import { newReport, summarize, addUnique } from './privacy.js';
import { detect, GLOBAL_PATHS } from './techdetect.js';
import { pouleyAnalyze } from './analyze-page.js';
import * as aiDetect from './ai-detect.js';
import { store, commands, runtime, byChrome, findTab, current, sendUi, scheduleBroadcast } from './main.js';

const S = () => store.state.settings;
const reports = new Map(); // id d'onglet Chromium -> rapport de la page affichée

const recOf = (chromeId) => byChrome.get(chromeId);
function rtOfChrome(chromeId) {
  const id = recOf(chromeId);
  return id ? runtime.get(id) : null;
}
function chromeIdOf(recId) {
  const rt = runtime.get(recId);
  return rt && rt.chromeId != null ? rt.chromeId : null;
}

function raiseAlert(chromeId, kind, text) {
  const report = reports.get(chromeId);
  if (!report || report.alerted[kind]) return;
  report.alerted[kind] = true;
  sendUi('privacy:alert', { tabId: recOf(chromeId), kind, text });
}

// Compteur du bouclier dans la barre.
function setBlocked(chromeId) {
  const rt = rtOfChrome(chromeId);
  const report = reports.get(chromeId);
  if (rt) { rt.blocked = report ? report.blocked.length : 0; scheduleBroadcast(); }
}

function recordBlocked(chromeId, report, hit, type) {
  if (report.blocked.length < 300) report.blocked.push({ domain: hit.domain, category: hit.category, type });
  report.blockedByCategory[hit.category] = (report.blockedByCategory[hit.category] || 0) + 1;
  if (hit.category === 'session') raiseAlert(chromeId, 'session', `Ce site voulait enregistrer tes clics et mouvements (${hit.domain}). Bloqué.`);
  if (hit.category === 'fingerprint') raiseAlert(chromeId, 'fp-tracker', `Service d’empreinte numérique bloqué (${hit.domain}).`);
  if (report.blocked.length === 15) raiseAlert(chromeId, 'many', 'Plus de 15 traqueurs bloqués sur cette page.');
  setBlocked(chromeId);
}

const FILTER = { urls: ['<all_urls>'] };
const seen = new Map(); // requestId -> id d'onglet (requête déjà comptée comme bloquée)

chrome.webRequest.onBeforeRequest.addListener((d) => {
  if (d.tabId < 0) return;
  if (d.type === 'main_frame') {
    let u = null;
    try { u = new URL(d.url); } catch {}
    if (u && /^https?:$/.test(u.protocol)) reports.set(d.tabId, newReport(d.url, siteOf(u.hostname)));
    else reports.delete(d.tabId);
    setBlocked(d.tabId);
    return;
  }
  if (!/^(https?|wss?):/.test(d.url)) return;
  const report = reports.get(d.tabId);
  if (!report) return;
  let reqSite = '';
  try { reqSite = siteOf(new URL(d.url).hostname); } catch {}
  const thirdParty = reqSite !== report.site;
  if (thirdParty && reqSite) report.thirdParties[reqSite] = (report.thirdParties[reqSite] || 0) + 1;
  const hit = thirdParty ? classify(d.url) : null;
  if (!hit) return;
  if (shouldBlock(hit, S().shieldLevel)) {
    seen.set(d.requestId, d.tabId);
    recordBlocked(d.tabId, report, hit, d.type);
  } else {
    addUnique(report.allowedTrackers, hit.domain, 40);
  }
}, FILTER);

// Requêtes bloquées par une autre règle (extension anti-pub installée…) : comptées aussi.
chrome.webRequest.onErrorOccurred.addListener((d) => {
  const known = seen.delete(d.requestId);
  if (known || d.tabId < 0 || d.error !== 'net::ERR_BLOCKED_BY_CLIENT' || d.type === 'main_frame') return;
  const report = reports.get(d.tabId);
  if (!report) return;
  const hit = classify(d.url);
  let domain = '';
  try { domain = new URL(d.url).hostname; } catch {}
  recordBlocked(d.tabId, report, hit || { domain, category: 'ads' }, d.type);
}, FILTER);
chrome.webRequest.onCompleted.addListener((d) => {
  seen.delete(d.requestId);
  if (d.type === 'main_frame' && d.url.startsWith('http:') && !/^http:\/\/(localhost|127\.|\[::1\])/.test(d.url)) {
    raiseAlert(d.tabId, 'http', 'Connexion non chiffrée : ce que tu tapes sur ce site peut être lu en chemin.');
  }
}, FILTER);

const headerMap = (list) => {
  const out = {};
  for (const { name, value } of list || []) {
    const k = name.toLowerCase();
    out[k] = k in out ? out[k] + ', ' + value : value;
  }
  return out;
};
const KEEP_API = ['server', 'x-powered-by', 'x-runtime', 'x-aspnet-version', 'x-generator', 'via', 'x-served-by', 'x-deno-ray', 'x-fastify', 'x-hono'];

chrome.webRequest.onHeadersReceived.addListener((d) => {
  const report = reports.get(d.tabId);
  if (!report) return;
  const names = (d.responseHeaders || []).filter((x) => x.name.toLowerCase() === 'set-cookie').map((x) => String(x.value).split('=')[0].trim());
  if (d.type === 'main_frame') {
    report.headers = headerMap(d.responseHeaders);
    delete report.headers['set-cookie'];
    for (const n of names) addUnique(report.cookies.firstParty, n);
    return;
  }
  let reqSite = '';
  try { reqSite = siteOf(new URL(d.url).hostname); } catch {}
  // Appels d'API du site (fetch / XHR) : les en-têtes qui trahissent le backend.
  if (reqSite === report.site && (d.type === 'xmlhttprequest' || d.type === 'other')) {
    const headers = headerMap(d.responseHeaders);
    for (const key of KEEP_API) {
      if (!headers[key]) continue;
      const vals = report.apiHeaders[key] || (report.apiHeaders[key] = []);
      if (!vals.includes(headers[key]) && vals.length < 6) vals.push(headers[key]);
    }
    if (/json/i.test(headers['content-type'] || '') && report.apiPaths.length < 12) {
      try { const p = new URL(d.url).pathname; if (!report.apiPaths.includes(p)) report.apiPaths.push(p); } catch {}
    }
  }
  if (names.length && reqSite && reqSite !== report.site) {
    // Cookies tiers bloqués par Chromium (réglage « cookies tiers ») : ils ne sont pas enregistrés.
    if (S().blockThirdPartyCookies) report.cookies.thirdPartyBlocked += names.length;
    else for (const n of names) addUnique(report.cookies.thirdPartyAllowed, `${reqSite} · ${n}`);
  } else {
    for (const n of names) addUnique(report.cookies.firstParty, n);
  }
}, FILTER, ['responseHeaders', 'extraHeaders']);

chrome.tabs.onRemoved.addListener((chromeId) => reports.delete(chromeId));

// Sondes d'empreinte (content/probes.js) et permissions demandées par le site.
const PROBE_MESSAGES = {
  canvas: 'Ce site lit ton canvas pour calculer une empreinte de ta machine.',
  webgl: 'Ce site demande le modèle exact de ta carte graphique.',
  audio: 'Ce site calcule une empreinte audio de ton appareil.',
  fonts: 'Ce site liste les polices installées sur ton ordinateur.',
  battery: 'Ce site lit le niveau de ta batterie.',
  clipboard: 'Ce site lit ton presse-papiers.',
};
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'probe' || !sender.tab || sender.frameId !== 0) return false;
  const report = reports.get(sender.tab.id);
  if (!report) return false;
  if (msg.count) {
    if (msg.kind === 'beacon') report.beacons++;
    if (msg.kind === 'notify') sendUi('cluck', 'notif');
    return false;
  }
  report.fingerprint[msg.kind] = true;
  if (PROBE_MESSAGES[msg.kind]) raiseAlert(sender.tab.id, 'fp-' + msg.kind, PROBE_MESSAGES[msg.kind]);
  scheduleBroadcast();
  return false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Inspecteur : technos + charte graphique + vie privée

async function inspect(recId = current()) {
  const f = findTab(recId);
  const chromeId = chromeIdOf(recId);
  if (!f || chromeId == null) return { error: 'Onglet en veille — ouvre-le d’abord.' };
  const tab = await chrome.tabs.get(chromeId).catch(() => null);
  const url = tab && tab.url || '';
  if (!/^https?:/.test(url)) return { internal: true, url: f.rec.url };
  let page = {};
  try {
    const [res] = await Promise.race([
      chrome.scripting.executeScript({ target: { tabId: chromeId }, world: 'MAIN', func: pouleyAnalyze, args: [GLOBAL_PATHS] }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé')), 8000)),
    ]);
    page = (res && res.result) || { error: 'page illisible' };
  } catch (err) {
    page = { error: String(err && err.message || err) };
  }
  const report = reports.get(chromeId) || newReport(url, siteOf(new URL(url).hostname));
  let jarCookies = [];
  try { jarCookies = (await chrome.cookies.getAll({ url })).map((c) => c.name); } catch {}
  const cookies = [...new Set([...report.cookies.firstParty, ...jarCookies, ...((page.storage && page.storage.jsCookies) || [])])];
  const tech = detect({ headers: report.headers, apiHeaders: report.apiHeaders, apiPaths: report.apiPaths, cookies, page });
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
      icon: chrome.runtime.getURL('_favicon/') + '?size=64&pageUrl=' + encodeURIComponent(url),
    },
    privacy,
    pageError: page.error || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Détecteur d'IA (tout est analysé sur la machine, voir ai-detect.js).

const AID_MAX_BYTES = 15 * 1024 * 1024;

async function aidFetchImage(url) {
  if (url.startsWith('data:')) return new Uint8Array(await (await fetch(url)).arrayBuffer());
  if (!/^https?:/.test(url)) return null;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) return null;
  if (Number(res.headers.get('content-length') || 0) > AID_MAX_BYTES) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  return buf.length > AID_MAX_BYTES ? null : buf;
}

async function thumbnail(buf) {
  const bmp = await createImageBitmap(new Blob([buf]));
  const w = 120;
  const h = Math.max(1, Math.round((bmp.height * w) / bmp.width));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close();
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/jpeg;base64,' + btoa(bin);
}

async function aidImage(url, alt) {
  let buf = null;
  try { buf = await aidFetchImage(url); } catch {}
  if (!buf) {
    return { url, alt, verdict: 'erreur', tool: null, signals: [{ kind: 'info', text: 'Image impossible à lire (trop lourde, protégée ou locale à la page).' }] };
  }
  let thumb = null;
  try { thumb = await thumbnail(buf); } catch {}
  return { url, alt, thumb, ...(await aiDetect.analyzeImage(buf, url, { alt })) };
}

// Ce qu'on lit dans la page : le texte principal et les grandes images.
function aidCollect() {
  const root = document.querySelector('article') || document.querySelector('main') || document.body;
  const text = (root ? root.innerText : '').replace(/\n{3,}/g, '\n\n').slice(0, 30000);
  const seenSrc = new Set();
  const images = [];
  for (const im of document.images) {
    const src = im.currentSrc || im.src;
    if (!src || seenSrc.has(src) || im.naturalWidth < 200 || im.naturalHeight < 200) continue;
    seenSrc.add(src);
    images.push({ src, w: im.naturalWidth, h: im.naturalHeight, alt: (im.alt || '').slice(0, 160) });
  }
  images.sort((a, b) => b.w * b.h - a.w * a.h);
  return { text, images: images.slice(0, 16) };
}

async function aidPage(recId) {
  const chromeId = chromeIdOf(recId);
  if (chromeId == null) return { error: 'Onglet endormi : ouvre-le pour l’analyser.' };
  const tab = await chrome.tabs.get(chromeId).catch(() => null);
  if (!tab || !/^https?:/.test(tab.url || '')) return { error: 'Page interne : rien à analyser.' };
  let page;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: chromeId }, func: aidCollect });
    page = res.result;
  } catch (err) { return { error: 'Lecture de la page impossible : ' + (err && err.message || err) }; }
  const text = page.text && page.text.trim().length > 200 ? aiDetect.analyzeText(page.text) : null;
  const images = [];
  // Quatre téléchargements à la fois, pour ne pas surcharger la connexion.
  const queue = [...page.images];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let im = queue.shift(); im; im = queue.shift()) images.push({ ...(await aidImage(im.src, im.alt)), w: im.w, h: im.h });
  }));
  const order = { ia: 0, indice: 1, inconnu: 2, appareil: 3, erreur: 4 };
  images.sort((a, b) => order[a.verdict] - order[b.verdict]);
  return { url: tab.url, text, sample: (page.text || '').slice(0, 3000), images };
}

// ─────────────────────────────────────────────────────────────────────────────
// Panneau à droite de la page : l'interface PouleyPwolu dans un cadre posé par-dessus
// la page (index.html?panel=…). « modal » : un cadre transparent sur toute la page,
// pour les fenêtres du détecteur d'IA.

function framePanel(src, layout) {
  const ID = 'pouley-panneau';
  const old = document.getElementById(ID);
  if (old) old.remove();
  if (!src) return false;
  const host = document.createElement('div');
  host.id = ID;
  const root = host.attachShadow({ mode: 'closed' });
  const box = layout === 'modal'
    ? 'inset:0;'
    : 'top:8px;right:8px;bottom:8px;width:380px;max-width:calc(100vw - 16px);border-radius:12px;box-shadow:0 18px 50px -12px rgba(0,0,0,.55);';
  host.setAttribute('style', 'all:initial;position:fixed;z-index:2147483647;display:block;overflow:hidden;' + box);
  const frame = document.createElement('iframe');
  frame.src = src;
  frame.setAttribute('allowtransparency', 'true');
  frame.setAttribute('style', 'all:initial;display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:normal;');
  root.append(frame);
  document.documentElement.append(host);
  // Le clavier va au panneau (palette : on tape tout de suite).
  frame.addEventListener('load', () => frame.focus());
  return true;
}

const panels = new Map(); // id d'onglet Chromium -> { kind, tab }
const pendingAid = new Map(); // id d'onglet Chromium -> résultat à afficher dans la fenêtre IA
const PANEL_URL = chrome.runtime.getURL('sidebar/index.html');

export async function showPanel(recId, kind, tab, layout = 'panel', { quiet = false } = {}) {
  const chromeId = chromeIdOf(recId);
  if (chromeId == null) return false;
  const src = `${PANEL_URL}?panel=${kind}&rec=${encodeURIComponent(recId)}${tab ? '&tab=' + tab : ''}`;
  try {
    await chrome.scripting.executeScript({ target: { tabId: chromeId }, func: framePanel, args: [src, layout] });
    panels.set(chromeId, { kind, tab });
    return true;
  } catch {
    if (!quiet) sendUi('toast', { text: 'Rien à inspecter sur cette page : ouvre un site web.' });
    return false;
  }
}

async function closePanel(chromeId) {
  panels.delete(chromeId);
  await chrome.scripting.executeScript({ target: { tabId: chromeId }, func: framePanel, args: [null] }).catch(() => {});
}

// Navigation : le panneau disparaît avec l'ancienne page ; on le remet sur la nouvelle.
chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  const p = panels.get(d.tabId);
  if (!p || p.kind !== 'inspector') { panels.delete(d.tabId); return; }
  const recId = recOf(d.tabId);
  if (recId) setTimeout(() => showPanel(recId, 'inspector', p.tab), 300);
});

Object.assign(commands, {
  inspect: (id) => inspect(id || current()),
  'aidetect.page': (id) => aidPage(id || current()),
  'aidetect.text': (text) => aiDetect.analyzeText(text),
  'aidetect.pending': (recId) => {
    const chromeId = chromeIdOf(recId);
    const r = pendingAid.get(chromeId);
    pendingAid.delete(chromeId);
    return r || null;
  },
  // Bouton « Inspecter » de la barre : ouvre ou ferme le panneau de l'onglet affiché.
  'inspector.toggle': async ({ tab, open } = {}) => {
    const recId = current();
    const chromeId = chromeIdOf(recId);
    if (chromeId == null) return false;
    const p = panels.get(chromeId);
    const want = typeof open === 'boolean' ? open : !(p && p.kind === 'inspector');
    if (!want) { await closePanel(chromeId); return false; }
    return showPanel(recId, 'inspector', tab || 'privacy');
  },
  'inspector.state': () => {
    const chromeId = chromeIdOf(current());
    const p = chromeId != null && panels.get(chromeId);
    return p && p.kind === 'inspector' ? p.tab || 'privacy' : null;
  },
  'inspector.tab': ({ rec, tab } = {}) => {
    const p = panels.get(chromeIdOf(rec));
    if (p) p.tab = tab;
  },
  'panel.close': (rec) => {
    const chromeId = chromeIdOf(rec || current());
    if (chromeId != null) return closePanel(chromeId);
  },
});

// Résultat du détecteur pour une image ou une sélection : fenêtre par-dessus la page.
async function showAid(recId, payload) {
  const chromeId = chromeIdOf(recId);
  if (chromeId == null) return;
  pendingAid.set(chromeId, payload);
  await showPanel(recId, 'aid', null, 'modal');
}

// ─────────────────────────────────────────────────────────────────────────────
// Clic droit dans les pages (comme le menu de la version Electron)

const MENU = [
  { id: 'pw-aid-image', title: 'Cette image vient-elle d’une IA ?', contexts: ['image'] },
  { id: 'pw-aid-text', title: 'Ce texte vient-il d’une IA ?', contexts: ['selection'] },
  { id: 'pw-ask', title: 'Demander à l’IA : « %s »', contexts: ['selection'] },
  { id: 'pw-inspect', title: 'Inspecter le site (technos, couleurs, vie privée)', contexts: ['page'] },
  { id: 'pw-aid-page', title: 'Détecter l’IA dans cette page (textes et images)', contexts: ['page'] },
  { id: 'pw-ask-page', title: 'Résumer la page avec l’IA', contexts: ['page'] },
];
function createMenus() {
  chrome.contextMenus.removeAll(() => {
    for (const m of MENU) chrome.contextMenus.create({ ...m, documentUrlPatterns: ['http://*/*', 'https://*/*'] }, () => void chrome.runtime.lastError);
  });
}
createMenus();

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const recId = tab && recOf(tab.id);
  if (!recId) return;
  switch (info.menuItemId) {
    case 'pw-aid-image': {
      sendUi('toast', { text: 'Pouley examine l’image…' });
      // Le texte alternatif n'est pas transmis par le menu : on le lit dans la page.
      let alt = '';
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId || 0] }, args: [info.srcUrl], func: (src) => { const im = [...document.images].find((i) => (i.currentSrc || i.src) === src); return im ? im.alt.slice(0, 160) : ''; } });
        alt = r.result || '';
      } catch {}
      return showAid(recId, { kind: 'image', result: await aidImage(info.srcUrl, alt) });
    }
    case 'pw-aid-text': {
      // La sélection du menu est raccourcie par Chromium : on relit la vraie sélection.
      let full = info.selectionText || '';
      try {
        const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [info.frameId || 0] }, func: () => String(getSelection()) });
        if (r.result && r.result.length > full.length) full = r.result;
      } catch {}
      full = full.trim().slice(0, 40000);
      return showAid(recId, { kind: 'text', text: full.slice(0, 4000), result: aiDetect.analyzeText(full) });
    }
    case 'pw-ask': return commands['ai.ask'](`Explique-moi : « ${String(info.selectionText || '').trim().slice(0, 2000)} »`);
    case 'pw-inspect': return showPanel(recId, 'inspector', 'privacy');
    case 'pw-aid-page': return showPanel(recId, 'inspector', 'ai');
    case 'pw-ask-page': return commands['ai.askPage']();
  }
});
