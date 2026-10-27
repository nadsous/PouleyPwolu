// Fonctions de la barre qui demandent le moteur (chrome.pouleyPrivate) ou des API de
// Chromium : fenêtres et panneaux des extensions (bouton Claude), onglet flottant,
// écran partagé, mini-lecteur de musique, mémoire des onglets.
// Repris de src/main/main.js.
import {
  store, commands, runtime, byChrome, findTab, current, sendUi, scheduleBroadcast, popupMenu,
  snapshotExtra, ensureView, mainWindow, activateTab, activePoulailler, openTab, ready, floatWindows, extBadges,
} from './main.js';

const S = () => store.state.settings;
const P = chrome.pouleyPrivate; // absent si le moteur est plus ancien que l'extension
const NADSPDF = 'chrome-extension://hjbgmlcjbnphhblmmhbjdjmflejflnfh/index.html?lite=1&lang=fr';
const chromeIdOf = (recId) => { const rt = runtime.get(recId); return rt && rt.chromeId != null ? rt.chromeId : null; };

// ─────────────────────────────────────────────────────────────────────────────
// Extensions : leur bouton dans la barre ouvre leur fenêtre (à côté du bouton) ou
// leur panneau (à droite de la page, comme Claude).

const AI_EXTENSIONS = ['fcoeoabgfenejglbffodgkkbkcdhcgfn', 'hehggadaopoacecdllhhajmbjkdcmajg']; // Claude, ChatGPT

async function refreshPanel() {
  if (!P) return;
  const id = await P.getExtensionPanel(await mainWindow()).catch(() => '');
  const panel = id || null;
  if (snapshotExtra.sidePanel !== panel) {
    snapshotExtra.sidePanel = panel;
    snapshotExtra.aiOpen = !!panel && AI_EXTENSIONS.includes(panel);
    scheduleBroadcast();
  }
}

async function runAction(id, rect) {
  if (!P) {
    sendUi('toast', { text: 'Mets à jour PouleyPwolu pour ouvrir les extensions depuis la barre.' });
    return 'none';
  }
  const r = rect || {};
  const result = await P.runExtensionAction({
    extensionId: id, windowId: await mainWindow(),
    left: Math.round(r.x || 0), top: Math.round(r.y || 0), width: Math.round(r.width || 1), height: Math.round(r.height || 1),
  }).catch((err) => { console.warn('[extension]', err); return 'none'; });
  await refreshPanel();
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// Onglet flottant : l'onglet part dans une petite fenêtre toujours au premier plan
// (déplacé, pas rechargé : une vidéo continue de jouer).

async function floatTab(recId) {
  const rt = await ensureView(recId);
  if (!rt || rt.chromeId == null) return;
  if (rt.floating) return dockTab(recId, true);
  if (snapshotExtra.split && [snapshotExtra.split.a, snapshotExtra.split.b].includes(recId)) await endSplit();
  const main = await chrome.windows.get(await mainWindow()).catch(() => null);
  const w = 520;
  const h = 340;
  const left = main ? main.left + main.width - w - 24 : undefined;
  const top = main ? main.top + main.height - h - 24 : undefined;
  rt.floating = true;
  rt.floatOpacity = 1;
  // Une fenêtre PouleyPwolu sans barre latérale : juste la page, sous la petite barre
  // de la superposition (pages/flottant.html), comme dans la version Electron.
  floatWindows.pending += 1;
  const win = await chrome.windows.create({ tabId: rt.chromeId, type: 'normal', width: w, height: h, left, top, focused: true }).catch(() => null);
  floatWindows.pending = Math.max(0, floatWindows.pending - 1);
  if (!win) { rt.floating = false; return; }
  floatWindows.ids.add(win.id);
  rt.floatWindowId = win.id;
  await chrome.sidePanel.close({ windowId: win.id }).catch(() => {});
  // Chromium garde la taille de la fenêtre d'origine pour un onglet déplacé : on la réduit.
  await chrome.windows.update(win.id, { width: w, height: h, left, top }).catch(() => {});
  if (P) {
    await P.setTopBar(win.id, true, 36, 'pages/flottant.html').catch(() => {});
    await P.setAlwaysOnTop(win.id, true).catch(() => {});
  }
  // La barre affiche un autre onglet du poulailler.
  if (current() === recId) {
    const p = activePoulailler();
    const next = p.tabs.find((t) => t.id !== recId && !runtime.get(t.id)?.floating);
    if (next) activateTab(next.id);
  }
  scheduleBroadcast();
}

async function dockTab(recId, show) {
  const rt = runtime.get(recId);
  if (!rt || !rt.floating) return;
  const windowId = await mainWindow();
  rt.floating = false;
  rt.floatWindowId = null;
  await chrome.tabs.move(rt.chromeId, { windowId, index: -1 }).catch(() => {});
  if (show) activateTab(recId);
  scheduleBroadcast();
}

chrome.windows.onRemoved.addListener((windowId) => {
  floatWindows.ids.delete(windowId);
  for (const rt of runtime.values()) if (rt.floatWindowId === windowId) { rt.floating = false; rt.floatWindowId = null; scheduleBroadcast(); }
});

// Petite barre de la fenêtre flottante (pages/flottant.html).
async function floatCommand({ windowId, name, arg }) {
  const entry = [...runtime.entries()].find(([, rt]) => rt.floatWindowId === windowId);
  if (!entry) return null;
  const [recId, rt] = entry;
  const f = findTab(recId);
  switch (name) {
    case 'info': {
      const tab = rt.chromeId != null ? await chrome.tabs.get(rt.chromeId).catch(() => null) : null;
      return f && {
        title: f.rec.title || f.rec.url, url: f.rec.url, favicon: (tab && tab.favIconUrl) || f.rec.favicon || null,
        opacity: rt.floatOpacity ?? 1, canGoBack: rt.canGoBack !== false,
      };
    }
    case 'opacity':
      rt.floatOpacity = Math.max(0.25, Math.min(1, Number(arg) || 1));
      if (P) await P.setWindowOpacity(windowId, rt.floatOpacity).catch(() => {});
      return null;
    case 'back': if (rt.chromeId != null) await chrome.tabs.goBack(rt.chromeId).catch(() => {}); return null;
    case 'reload': if (rt.chromeId != null) await chrome.tabs.reload(rt.chromeId).catch(() => {}); return null;
    // Fermer la superposition : l'onglet revient dans le navigateur (comme Electron).
    case 'dock':
    case 'close': {
      await dockTab(recId, true);
      const main = await mainWindow();
      chrome.windows.update(main, { focused: true }).catch(() => {});
      return null;
    }
  }
  return null;
}
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.type !== 'float.cmd' || sender.id !== chrome.runtime.id) return false;
  ready.then(() => floatCommand(msg)).then(reply, () => reply(null));
  return true;
});

// ─────────────────────────────────────────────────────────────────────────────
// Écran partagé : la vue côte à côte de Chromium (chrome.tabs.createSplit).

snapshotExtra.split = null;

async function startSplit({ other, input } = {}) {
  const a = current();
  if (!a) return;
  let b = other;
  if (!b && input != null) {
    const f = findTab(a);
    b = openTab({ input, background: true, poulaillerId: f && f.poulailler ? f.poulailler.id : undefined });
  }
  if (!b || b === a || !findTab(b)) return;
  for (const id of [a, b]) if (runtime.get(id)?.floating) await dockTab(id, false);
  const ra = await ensureView(a, true);
  const rb = await ensureView(b);
  if (!ra || !rb) return;
  try {
    const ta = await chrome.tabs.get(ra.chromeId);
    const tb = await chrome.tabs.get(rb.chromeId);
    if (tb.splitViewId > 0) await chrome.tabs.unsplit(tb.splitViewId).catch(() => {});
    if (ta.splitViewId > 0) await chrome.tabs.unsplit(ta.splitViewId).catch(() => {});
    if (tb.pinned !== ta.pinned) await chrome.tabs.update(tb.id, { pinned: ta.pinned });
    if (tb.groupId !== ta.groupId) await (ta.groupId > 0 ? chrome.tabs.group({ groupId: ta.groupId, tabIds: [tb.id] }) : chrome.tabs.ungroup([tb.id]));
    const now = await chrome.tabs.get(ta.id);
    await chrome.tabs.move(tb.id, { windowId: now.windowId, index: now.index + 1 });
    const splitViewId = await chrome.tabs.createSplit([ta.id, tb.id]);
    snapshotExtra.split = { a, b, ratio: 0.5, id: splitViewId };
  } catch (err) {
    sendUi('toast', { text: 'Côte à côte impossible : ' + (err && err.message || err) });
  }
  scheduleBroadcast();
}

async function endSplit() {
  const sp = snapshotExtra.split;
  snapshotExtra.split = null;
  if (sp && sp.id > 0) await chrome.tabs.unsplit(sp.id).catch(() => {});
  scheduleBroadcast();
}

// Côte à côte quitté depuis Chromium (menu de la vue partagée, onglet fermé…).
chrome.tabs.onUpdated.addListener((tabId, change) => {
  const sp = snapshotExtra.split;
  if (!sp || change.splitViewId === undefined) return;
  const rec = byChrome.get(tabId);
  if ((rec === sp.a || rec === sp.b) && change.splitViewId !== sp.id) { snapshotExtra.split = null; scheduleBroadcast(); }
});
chrome.tabs.onRemoved.addListener((tabId) => {
  const sp = snapshotExtra.split;
  if (sp && [sp.a, sp.b].some((id) => chromeIdOf(id) === tabId || chromeIdOf(id) == null)) { snapshotExtra.split = null; scheduleBroadcast(); }
});

// ─────────────────────────────────────────────────────────────────────────────
// Mini-lecteur : le morceau de l'onglet qui joue (ou jouait) de la musique.

function mediaRead() {
  const ms = navigator.mediaSession;
  const m = ms && ms.metadata;
  const els = [...document.querySelectorAll('video, audio')];
  const el = els.find((e) => !e.paused) || els.find((e) => e.currentTime > 0) || els[0];
  const state = ms && ms.playbackState && ms.playbackState !== 'none' ? ms.playbackState : (el ? (el.paused ? 'paused' : 'playing') : 'none');
  const art = m && m.artwork && m.artwork.length ? m.artwork[m.artwork.length - 1].src : null;
  return { title: (m && m.title) || '', artist: (m && m.artist) || '', album: (m && m.album) || '', art,
    state, duration: el && isFinite(el.duration) ? el.duration : 0, time: el ? el.currentTime : 0, hasMedia: !!el || !!m };
}

// Boutons du lecteur de chaque site, avec repli sur l'élément audio/vidéo.
function mediaAction(a) {
  const click = (...sels) => { for (const s of sels) { const b = document.querySelector(s); if (b) { b.click(); return true; } } return false; };
  const els = [...document.querySelectorAll('video, audio')];
  const el = els.find((e) => !e.paused) || els.find((e) => e.currentTime > 0) || els[0];
  if (a === 'toggle') {
    if (click('ytmusic-player-bar #play-pause-button', '[data-testid="control-button-playpause"]', '.playControl', 'button[data-testid="play_button_play"], button[data-testid="play_button_pause"]')) return;
    if (el) { if (el.paused) el.play(); else el.pause(); }
  } else if (a === 'next') {
    click('ytmusic-player-bar .next-button', '.ytp-next-button', '[data-testid="control-button-skip-forward"]', '.skipControl__next', 'button[data-testid="next_track_button"]');
  } else if (a === 'prev') {
    if (!click('ytmusic-player-bar .previous-button', '.ytp-prev-button', '[data-testid="control-button-skip-back"]', '.skipControl__previous', 'button[data-testid="previous_track_button"]') && el) el.currentTime = 0;
  }
}

let mediaTab = null;
let mediaIdle = 0;
let lastMediaJson = '';

async function pollMedia() {
  if (!S().mediaPlayer) {
    if (lastMediaJson !== 'null') { lastMediaJson = 'null'; sendUi('media', null); }
    return;
  }
  // Un onglet qui se met à jouer devient l'onglet du lecteur.
  for (const [id, rt] of runtime) if (rt.audible && rt.chromeId != null && id !== mediaTab) { mediaTab = id; mediaIdle = 0; }
  let pick = null;
  const chromeId = mediaTab && chromeIdOf(mediaTab);
  const f = mediaTab && findTab(mediaTab);
  if (!chromeId || !f) mediaTab = null;
  else {
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: chromeId }, world: 'MAIN', func: mediaRead });
      const m = res.result;
      if (!m.hasMedia || m.state === 'none') { if (++mediaIdle > 4) mediaTab = null; }
      else {
        mediaIdle = 0;
        let host = '';
        try { host = new URL(f.rec.url).hostname.replace(/^www\./, ''); } catch {}
        const rt = runtime.get(mediaTab);
        pick = { source: 'tab', tabId: mediaTab, app: host, title: m.title || f.rec.title || host, artist: m.artist, album: m.album,
          state: m.state, duration: m.duration, time: m.time, art: (m.art && /^https?:|^data:/.test(m.art) ? m.art : null) || f.rec.favicon || null, muted: !!(rt && rt.muted) };
      }
    } catch { /* page en cours de chargement */ }
  }
  // La musique des applications de Windows (Spotify…), par le moteur (data/system-media.ps1).
  let sys = null;
  if (S().mediaSystem && P && P.systemMedia) sys = readSys(await P.systemMedia('state').catch(() => ''));
  // L'onglet qui joue a la priorité ; sinon l'application ; sinon l'onglet en pause.
  pick = pick && pick.state === 'playing' ? pick : sys && sys.state === 'playing' ? sys : pick || sys;
  const json = JSON.stringify(pick);
  if (json !== lastMediaJson) { lastMediaJson = json; sendUi('media', pick); }
}

let sysArt = { key: '', data: null };
function readSys(text) {
  let d = null;
  try { d = JSON.parse(text || 'null'); } catch {}
  if (!d || d.none || !d.title) return null;
  if (d.art) sysArt = { key: d.artKey, data: d.art };
  else if (sysArt.key !== d.artKey) sysArt = { key: d.artKey, data: null };
  const app = String(d.app || '');
  const name = /spotify/i.test(app) ? 'Spotify' : /zune|music/i.test(app) ? 'Musique' : app.split(/[\\!.]/).filter(Boolean).slice(-1)[0] || 'Application';
  return { source: 'system', app: name, title: d.title, artist: d.artist || '', album: d.album || '', state: d.state === 'playing' ? 'playing' : 'paused', duration: d.duration || 0, time: d.time || 0, art: sysArt.data };
}
setInterval(() => { ready.then(() => pollMedia()).catch(() => {}); }, 1500);

// ─────────────────────────────────────────────────────────────────────────────
// Mémoire de chaque onglet (chrome.processes, autorisée pour l'extension intégrée).

async function processMemory() {
  if (!chrome.processes) return null;
  const all = await new Promise((resolve) => chrome.processes.getProcessInfo([], true, resolve)).catch(() => null);
  if (!all) return null;
  const tabs = new Map(); // id d'onglet Chromium -> octets
  let total = 0;
  let gpu = 0;
  for (const p of Object.values(all)) {
    const bytes = p.privateMemory || 0;
    total += bytes;
    if (p.type === 'gpu') gpu += bytes;
    for (const t of p.tasks || []) if (t.tabId != null) tabs.set(t.tabId, (tabs.get(t.tabId) || 0) + bytes / Math.max(1, (p.tasks || []).filter((x) => x.tabId != null).length));
  }
  return { total, gpu, tabs };
}

const MB = (b) => Math.round(b / (1024 * 1024));

async function refreshMemory() {
  const mem = await processMemory();
  if (!mem) return;
  for (const rt of runtime.values()) rt.memMb = rt.chromeId != null ? MB(mem.tabs.get(rt.chromeId) || 0) : 0;
  scheduleBroadcast();
}
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'pouley-menage') refreshMemory(); });

const baseReport = commands['memory.report'];

let previewOpen = null;
// Un clic dans une page ferme l'aperçu d'un favori (content/raccourcis.js).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'preview.close' && previewOpen) commands['fav.unpeek']();
  return false;
});

// Badges des boutons d'extensions (le nombre de pubs bloquées…), pour l'onglet affiché.
async function refreshBadges() {
  if (!P || !P.getExtensionBadges) return;
  const list = await P.getExtensionBadges(await mainWindow()).catch(() => null);
  if (!list) return;
  const next = new Map(list.map((b) => [b.extensionId, { text: b.text, color: b.color }]));
  const same = next.size === extBadges.size && [...next].every(([k, v]) => extBadges.get(k)?.text === v.text && extBadges.get(k)?.color === v.color);
  if (same) return;
  extBadges.clear();
  for (const [k, v] of next) extBadges.set(k, v);
  scheduleBroadcast();
}
setInterval(() => { ready.then(refreshBadges).catch(() => {}); }, 3000);
chrome.tabs.onActivated.addListener(() => ready.then(refreshBadges));

// ─────────────────────────────────────────────────────────────────────────────

Object.assign(commands, {
  'ext.popup': ({ id, rect } = {}) => id && runAction(id, rect),
  // Ctrl+E : le panneau de l'assistant IA installé (Claude, ChatGPT).
  'ai.toggle': async () => {
    if (snapshotExtra.sidePanel && P) {
      await P.closeExtensionPanel(await mainWindow()).catch(() => {});
      return refreshPanel();
    }
    const all = await chrome.management.getAll().catch(() => []);
    const ai = AI_EXTENSIONS.map((id) => all.find((e) => e.id === id && e.enabled)).find(Boolean);
    if (ai) return runAction(ai.id, null);
    sendUi('settings:open', 'ia');
  },
  'ext.panelClose': async () => { if (P) await P.closeExtensionPanel(await mainWindow()).catch(() => {}); return refreshPanel(); },
  'tab.float': (id) => floatTab(id || current()),
  'tab.dock': (id) => dockTab(id || current(), true),
  'tab.focusFloat': (id) => {
    const rt = runtime.get(id || current());
    if (rt && rt.floatWindowId != null) chrome.windows.update(rt.floatWindowId, { focused: true, state: 'normal' }).catch(() => {});
  },
  'split.start': (a) => startSplit(a),
  'split.end': () => endSplit(),
  'split.ratio': () => null,
  'split.swap': () => null,
  'split.menu': () => {
    if (!snapshotExtra.split) return;
    popupMenu([{ label: 'Quitter le côte à côte', click: () => endSplit() }]);
  },
  'media.cmd': async (action) => {
    if (lastMediaJson && JSON.parse(lastMediaJson)?.source === 'system') {
      if (P && P.systemMedia) await P.systemMedia(String(action)).catch(() => {});
      setTimeout(() => pollMedia().catch(() => {}), 250);
      return;
    }
    const chromeId = mediaTab && chromeIdOf(mediaTab);
    if (!chromeId) return;
    if (action === 'mute') {
      const t = await chrome.tabs.get(chromeId).catch(() => null);
      if (t) await chrome.tabs.update(chromeId, { muted: !t.mutedInfo.muted });
    } else {
      await chrome.scripting.executeScript({ target: { tabId: chromeId }, world: 'MAIN', func: mediaAction, args: [String(action)] }).catch(() => {});
    }
    setTimeout(() => pollMedia().catch(() => {}), 250);
  },
  'media.open': () => { if (mediaTab) activateTab(mediaTab); },
  // NadsPDF, préinstallé (engine/rebrand.py) : ouvrir le lecteur, ou un PDF de l'ordinateur
  // depuis son propre bouton « Ouvrir ».
  'ext.nadspdf.open': () => openTab({ url: NADSPDF }),
  'ext.nadspdf.openFile': () => openTab({ url: NADSPDF }),
  'tab.copyUrl': () => { const f = current() && findTab(current()); if (f) sendUi('clipboard', f.rec.url); },
  'tab.pinnedMenu': () => {
    const p = activePoulailler();
    const pinned = p.tabs.filter((t) => t.pinned);
    const tpl = pinned.length ? pinned.map((t) => ({
      label: (t.title || t.url || 'Page').slice(0, 70),
      type: t.id === current() ? 'checkbox' : 'normal', checked: t.id === current(),
      click: () => activateTab(t.id),
    })) : [{ label: 'Aucune page épinglée', enabled: false }];
    const cur = current() && findTab(current());
    tpl.push({ type: 'separator' });
    if (cur && cur.poulailler) tpl.push({ label: cur.rec.pinned ? 'Désépingler l’onglet actuel' : 'Épingler l’onglet actuel', click: () => commands['tab.pin'](cur.rec.id) });
    popupMenu(tpl);
  },
  // Outils de développement, recherche dans la page : ceux de Chromium (F12, Ctrl+F).
  'tab.devtools': () => sendUi('toast', { text: 'Appuie sur F12 pour ouvrir les outils de développement.' }),
  'tab.find': () => null,
  'tab.findStop': () => null,
  // Aperçu d'un favori au survol : la page dans une bulle à côté de la barre.
  'fav.peek': async ({ id, anchor } = {}) => {
    const f = id && findTab(id);
    if (!P || !P.showPreview || !S().favHoverPreview || !f || !/^https?:/.test(f.rec.url)) return;
    const a = anchor || {};
    const ok = await P.showPreview(await mainWindow(), f.rec.url, {
      left: Math.round(a.x || 0), top: Math.round(a.y || 0), width: Math.round(a.width || 1), height: Math.round(a.height || 1),
    }).catch(() => false);
    if (ok) { previewOpen = id; sendUi('favpeek', id); }
  },
  'fav.unpeek': async () => {
    if (!previewOpen || !P || !P.showPreview) return;
    previewOpen = null;
    sendUi('favpeek', null);
    await P.showPreview(await mainWindow(), '', { left: 0, top: 0, width: 1, height: 1 }).catch(() => {});
  },
  'peek.watch': () => null,
  'permission.respond': () => null,
  'memory.report': async () => {
    const r = await baseReport();
    const mem = await processMemory();
    if (!mem) return r;
    const tabs = [];
    for (const [id, rt] of runtime) {
      const f = rt.chromeId != null && findTab(id);
      if (f) tabs.push({ title: f.rec.title || f.rec.url, mb: MB(mem.tabs.get(rt.chromeId) || 0) });
    }
    tabs.sort((a, b) => b.mb - a.mb);
    return { ...r, totalMb: MB(mem.total), gpuMb: MB(mem.gpu), tabs };
  },
});

// Transparence de la fenêtre (Windows 11) : verre de Windows derrière la barre.
function applyMaterial() {
  if (P && P.setWindowMaterial) P.setWindowMaterial(S().windowMaterial || 'none').catch(() => {});
}
const setSettings = commands['settings.set'];
commands['settings.set'] = async (patch = {}) => {
  const r = await setSettings(patch);
  if ('windowMaterial' in patch) applyMaterial();
  return r;
};
chrome.windows.onCreated.addListener(() => ready.then(applyMaterial));

ready.then(refreshPanel);
ready.then(applyMaterial);

// Plus d'internet : la page est remplacée par le jeu Pouley contre le Renard, qui propose
// d'y revenir quand la connexion revient (comme did-fail-load dans la version Electron).
const OFFLINE_ERRORS = new Set(['net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NETWORK_CHANGED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_ADDRESS_UNREACHABLE', 'net::ERR_PROXY_CONNECTION_FAILED']);
chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (d.frameId !== 0 || !/^https?:/.test(d.url) || !OFFLINE_ERRORS.has(d.error)) return;
  if (d.error !== 'net::ERR_INTERNET_DISCONNECTED' && navigator.onLine) return;
  const url = chrome.runtime.getURL('pages/jeu.html') + '?' + new URLSearchParams({ offline: '1', url: d.url });
  chrome.tabs.update(d.tabId, { url }).catch(() => {});
});
