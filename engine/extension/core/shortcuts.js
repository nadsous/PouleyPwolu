// Raccourcis clavier de la version Electron, dans Chromium. Les pages les relaient
// (content/raccourcis.js), la barre aussi (sidebar/chromium.js) :
//   Ctrl+L, Alt+D, F6   modifier l'adresse          Ctrl+K        rechercher / ouvrir
//   Ctrl+Maj+K          côte à côte                 Ctrl+Maj+P    superposition
//   Ctrl+E              assistant IA                Ctrl+,        paramètres
//   Ctrl+D              épingler l'onglet           Ctrl+1…9      poulailler n
//   Alt+↑ / Alt+↓       poulailler précédent / suivant
// (Ctrl+S, Ctrl+I, Ctrl+Maj+S, Ctrl+Maj+X, Ctrl+Maj+D : core/layout.js et manifest.json.)
import { store, commands, current, runtime, openTab, snapshotExtra, ready } from './main.js';
import { showPanel } from './inspect.js';

// Palette (rechercher, adresse, côte à côte) : au centre de la fenêtre, par-dessus la page,
// comme dans la version Electron. Sans page web affichée : la page Nouvel onglet.
async function palette(mode) {
  const recId = current();
  const rt = recId && runtime.get(recId);
  if (rt && rt.chromeId != null && await showPanel(recId, 'palette', mode, 'modal', { quiet: true })) {
    // Ouverte depuis la barre : le clavier passe à la page, pour taper tout de suite.
    const tab = await chrome.tabs.get(rt.chromeId).catch(() => null);
    if (tab && chrome.pouleyPrivate && chrome.pouleyPrivate.focusPage) chrome.pouleyPrivate.focusPage(tab.windowId).catch(() => {});
    return;
  }
  if (mode !== 'split') openTab({ url: 'pouley://newtab' });
}

function cyclePoulailler(dir) {
  const list = store.state.poulaillers;
  const i = list.findIndex((p) => p.id === store.state.activePoulailler);
  const next = list[(i + dir + list.length) % list.length];
  if (next) commands['poulailler.switch'](next.id);
}

const ACTIONS = {
  'edit-url': () => palette('edit'),
  'new-tab': () => palette('new'),
  split: () => (snapshotExtra.split ? commands['split.end']() : palette('split')),
  float: () => commands['tab.float'](),
  ai: () => commands['ai.toggle'](),
  settings: () => commands['ui.page']({ name: 'settings' }),
  pin: () => commands['tab.pin'](),
  'poulailler-prev': () => cyclePoulailler(-1),
  'poulailler-next': () => cyclePoulailler(1),
};

export async function runShortcut(name) {
  await ready;
  const m = /^poulailler:(\d)$/.exec(name || '');
  if (m) {
    const p = store.state.poulaillers[Number(m[1]) - 1];
    if (p) commands['poulailler.switch'](p.id);
    return;
  }
  if (ACTIONS[name]) await ACTIONS[name]();
}

commands['shortcut.run'] = (name) => runShortcut(name);
commands['palette.open'] = (mode) => palette(mode === 'edit' || mode === 'split' ? mode : 'new');

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'shortcut' || sender.id !== chrome.runtime.id) return false;
  runShortcut(msg.name);
  return false;
});
