// PouleyPwolu : extension intégrée au navigateur, chargée par Chromium comme composant
// (engine/patches/extension-integree.patch). Elle ne peut pas être désinstallée.
// Le cœur (core/main.js) reprend la logique de la version Electron.
import './core/main.js';
import './core/inspect.js';
import './core/system.js';
import './core/tools.js';
import './core/features.js';
import './core/dev.js';
import './core/shortcuts.js';
import './core/repo.js';

// La barre PouleyPwolu remplace la barre d'onglets : core/layout.js la place dans
// chaque fenêtre normale (à gauche, à droite ou en haut, masquée ou non).
import './core/layout.js';

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
