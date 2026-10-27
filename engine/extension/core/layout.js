// Disposition de la barre PouleyPwolu dans Chromium (Paramètres › Barre des onglets) :
// - à gauche ou à droite : le panneau latéral de Chromium, de la largeur choisie ;
// - en haut : une barre au-dessus de la page (chrome.pouleyPrivate.setTopBar) ;
// - masquée (Ctrl+S) : elle s'ouvre quand la souris touche le bord de la fenêtre
//   (content/raccourcis.js) et se referme quand la souris la quitte.
import { store, commands, snapshotExtra, scheduleBroadcast, ready, floatWindows } from './main.js';

const S = () => store.state.settings;
const P = chrome.pouleyPrivate;
const TOP_HEIGHT = 84; // deux rangées, comme dans la version Electron (sidebar/styles.css)
const width = () => Math.max(200, Math.min(440, Number(S().sidebarWidth) || 264));
const position = () => (['left', 'right', 'top'].includes(S().sidebarPosition) ? S().sidebarPosition : 'left');
const autoHide = () => !!S().sidebarAutoHide && position() !== 'top';

let peeking = false;
let leaveTimer = 0;
snapshotExtra.peeking = false;

async function normalWindows() {
  return (await chrome.windows.getAll({ windowTypes: ['normal'] }).catch(() => [])).map((w) => w.id).filter((id) => !floatWindows.ids.has(id));
}

async function applyWindow(windowId) {
  const pos = position();
  if (pos === 'top') {
    await chrome.sidePanel.close({ windowId }).catch(() => {});
    if (P) await P.setTopBar(windowId, true, TOP_HEIGHT).catch(() => {});
    return;
  }
  if (P) {
    await P.setTopBar(windowId, false, 0).catch(() => {});
    await P.setSidebarLayout(windowId, pos === 'right', width()).catch(() => {});
  }
  if (autoHide() && !peeking) await chrome.sidePanel.close({ windowId }).catch(() => {});
  else {
    await chrome.sidePanel.open({ windowId }).catch(() => {});
    // À l'ouverture, Chromium reprend la dernière largeur enregistrée : on remet la nôtre.
    if (P) await P.setSidebarLayout(windowId, pos === 'right', width()).catch(() => {});
  }
}

export async function applyLayout() {
  for (const id of await normalWindows()) await applyWindow(id);
}

function setPeeking(on) {
  peeking = on;
  snapshotExtra.peeking = on;
  scheduleBroadcast();
}

// Barre masquée : la souris touche le bord (content/raccourcis.js) → elle s'ouvre.
async function peek(windowId) {
  if (!autoHide() || peeking || floatWindows.ids.has(windowId)) return;
  setPeeking(true);
  clearTimeout(leaveTimer);
  await chrome.sidePanel.open({ windowId }).catch(() => {});
  if (P) await P.setSidebarLayout(windowId, position() === 'right', width()).catch(() => {});
}

// La souris quitte la barre ouverte au survol → elle se referme.
function leave() {
  if (!peeking) return;
  clearTimeout(leaveTimer);
  leaveTimer = setTimeout(async () => {
    if (!peeking || !autoHide()) return;
    setPeeking(false);
    for (const id of await normalWindows()) await chrome.sidePanel.close({ windowId: id }).catch(() => {});
  }, 350);
}

async function toggleHidden() {
  if (position() === 'top') return;
  setPeeking(false);
  await commands['settings.set']({ sidebarAutoHide: !S().sidebarAutoHide });
}

const setSettings = commands['settings.set'];
commands['settings.set'] = async (patch = {}) => {
  const r = await setSettings(patch);
  if (['sidebarPosition', 'sidebarWidth', 'sidebarAutoHide'].some((k) => k in patch)) {
    if ('sidebarAutoHide' in patch && !patch.sidebarAutoHide) setPeeking(false);
    await applyLayout();
  }
  return r;
};

Object.assign(commands, {
  'bar.toggle': () => toggleHidden(),
  'bar.leave': () => leave(),
  'bar.enter': () => clearTimeout(leaveTimer),
  // Largeur pendant le glissé du bord de la barre (sans l'enregistrer à chaque pixel).
  'bar.width': async (w) => {
    const value = Math.max(200, Math.min(440, Math.round(Number(w) || 0)));
    if (!value || !P) return;
    const [win] = await normalWindows();
    if (win != null) await P.setSidebarLayout(win, position() === 'right', value).catch(() => {});
  },
});

// Raccourci et bord de la fenêtre, depuis les pages (content/raccourcis.js).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || !sender.tab) return false;
  if (msg.type === 'bar.toggle') ready.then(toggleHidden);
  if (msg.type === 'bar.edge' && msg.side === position()) ready.then(() => peek(sender.tab.windowId));
  return false;
});

// Chaque nouvelle fenêtre reçoit la barre à sa place.
chrome.windows.onCreated.addListener((w) => {
  if (w.type !== 'normal' || floatWindows.pending || floatWindows.ids.has(w.id)) return;
  ready.then(() => applyWindow(w.id));
}, { windowTypes: ['normal'] });
ready.then(applyLayout);
