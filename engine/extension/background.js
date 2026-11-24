// PouleyPwolu : extension intégrée au navigateur (module intégré de Firefox, installé
// avec lui dans browser/extensions/pouleypwolu). Elle ne peut pas être désinstallée.
// Le cœur (core/main.js) reprend la logique de la version Electron.
// core/gecko.js d'abord : il recrée les API de Chromium dont les autres modules se servent.
import './core/gecko.js';
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
