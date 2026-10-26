// PouleyPwolu : extension intégrée au navigateur, chargée par Chromium comme composant
// (engine/patches/extension-integree.patch). Elle ne peut pas être désinstallée.
// Le cœur (core/main.js) reprend la logique de la version Electron.
import './core/main.js';

// La barre PouleyPwolu remplace la barre d'onglets : elle s'ouvre dans chaque fenêtre
// normale (le moteur l'autorise sans clic pour l'extension intégrée).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
const openBar = (windowId) => chrome.sidePanel.open({ windowId }).catch(() => {});
chrome.windows.onCreated.addListener((w) => { if (w.type === 'normal') openBar(w.id); }, { windowTypes: ['normal'] });
chrome.windows.getAll({ windowTypes: ['normal'] }).then((ws) => ws.forEach((w) => openBar(w.id)));
