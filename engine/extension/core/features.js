// Fonctions de la barre qui demandent le moteur (chrome.pouleyPrivate) ou des API de
// Chromium : fenêtres et panneaux des extensions (bouton Claude), onglet flottant,
// écran partagé, mini-lecteur de musique, mémoire des onglets.
// Repris de src/main/main.js.
import {
  store, commands, runtime, byChrome, findTab, current, sendUi, scheduleBroadcast, popupMenu,
  snapshotExtra, ensureView, mainWindow, activateTab, activePoulailler, openTab, ready,
} from './main.js';

const S = () => store.state.settings;
const P = chrome.pouleyPrivate; // absent si le moteur est plus ancien que l'extension
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
  const w = 480;
  const h = 300;
  const left = main ? main.left + main.width - w - 24 : undefined;
  const top = main ? main.top + main.height - h - 24 : undefined;
  rt.floating = true;
  const win = await chrome.windows.create({ tabId: rt.chromeId, type: 'popup', width: w, height: h, left, top, focused: true }).catch(() => null);
  if (!win) { rt.floating = false; return; }
  rt.floatWindowId = win.id;
  // Chromium garde la taille de la fenêtre d'origine pour un onglet déplacé : on la réduit.
  await chrome.windows.update(win.id, { width: w, height: h, left, top }).catch(() => {});
  if (P) await P.setAlwaysOnTop(win.id, true).catch(() => {});
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
  for (const rt of runtime.values()) if (rt.floatWindowId === windowId) { rt.floating = false; rt.floatWindowId = null; scheduleBroadcast(); }
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
  const json = JSON.stringify(pick);
  if (json !== lastMediaJson) { lastMediaJson = json; sendUi('media', pick); }
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
  // Aperçu des favoris au survol, barre masquée : sans objet dans Chromium.
  'fav.peek': () => null,
  'fav.unpeek': () => null,
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

ready.then(refreshPanel);
