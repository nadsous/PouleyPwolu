// PouleyPwolu sur le moteur Gecko (Firefox) : ce que l'extension attendait de Chromium.
// Importé en premier par background.js, avant tous les autres modules.
//
// - chrome.sidePanel, chrome.system.memory et chrome.contentSettings n'existent pas dans
//   Firefox : on les recrée par-dessus l'API privée chrome.pouleyPrivate
//   (experiments/parent.js), avec les seules fonctions dont l'extension se sert.
// - Les pages internes de Chromium (chrome://extensions…) ont leur équivalent Firefox
//   (about:addons…), qu'une extension ordinaire n'a pas le droit d'ouvrir : on passe
//   par l'API privée.

// Firefox ne donne les API privées (experiment_apis) qu'à l'espace « browser » :
// on les rend aussi visibles sous « chrome », où le reste du code les cherche.
const P = (globalThis.browser && browser.pouleyPrivate) || chrome.pouleyPrivate;
if (P && !chrome.pouleyPrivate) {
  try { chrome.pouleyPrivate = P; } catch {}
  if (!chrome.pouleyPrivate) Object.defineProperty(chrome, 'pouleyPrivate', { value: P, configurable: true });
}

// Pages internes de Chromium → pages de Firefox.
const INTERNAL = [
  [/^chrome:\/\/(newtab|new-tab-page)\/?/, 'about:newtab'],
  [/^chrome:\/\/extensions\/?.*/, 'about:addons'],
  [/^chrome:\/\/password-manager\/?.*/, 'about:logins'],
  [/^chrome:\/\/settings\/defaultBrowser/, 'about:preferences#general'],
  [/^chrome:\/\/settings\/?.*/, 'about:preferences'],
  [/^chrome:\/\/flags\/?.*/, 'about:config'],
  [/^chrome:\/\/inspect\/?.*/, 'about:debugging#/runtime/this-firefox'],
  [/^chrome:\/\/net-internals\/?.*/, 'about:networking#dns'],
  [/^chrome:\/\/(gpu|version)\/?.*/, 'about:support'],
  [/^chrome:\/\/downloads\/?.*/, 'about:downloads'],
];

export function geckoUrl(url) {
  if (typeof url !== 'string') return url;
  for (const [re, to] of INTERNAL) if (re.test(url)) return to;
  return url;
}

// Pages qu'une extension peut ouvrir elle-même avec chrome.tabs.
const OPEN_TO_ALL = /^(about:(blank|newtab|home)|https?:|moz-extension:|data:|file:|blob:)/i;
const needsPrivilege = (url) => typeof url === 'string' && /^(about|chrome):/i.test(url) && !OPEN_TO_ALL.test(url);

// chrome.tabs.create / update, avec les pages internes de Firefox.
export async function tabsCreate(props = {}) {
  const url = geckoUrl(props.url);
  if (needsPrivilege(url) && P) {
    const id = await P.openInternal({ url, windowId: props.windowId ?? null, active: props.active !== false, tabId: null });
    return chrome.tabs.get(id);
  }
  return chrome.tabs.create({ ...props, url });
}

export async function tabsUpdate(tabId, props = {}) {
  const url = geckoUrl(props.url);
  if (needsPrivilege(url) && P) {
    await P.openInternal({ url, windowId: null, active: props.active !== false, tabId });
    return chrome.tabs.get(tabId);
  }
  return chrome.tabs.update(tabId, url === undefined ? props : { ...props, url });
}

// Nouvel onglet de Firefox (Ctrl+T sans la page de l'extension, about:home…).
export const isNativeNewTab = (url) => /^(chrome:\/\/(newtab|new-tab-page)\/|about:(newtab|home)$)/.test(url || '');

if (P) {
  // Accès aux sites (Manifest V3) et barre PouleyPwolu dans chaque fenêtre.
  P.init().then(() => console.log('[PouleyPwolu] init ok'), (err) => console.error('[PouleyPwolu] init', err && err.message || err));

  // Panneau latéral de Chromium = barre latérale de Firefox (sidebar_action).
  if (!chrome.sidePanel) {
    chrome.sidePanel = {
      setPanelBehavior: async () => {},
      open: ({ windowId } = {}) => P.setSidebar(windowId ?? null, true),
      close: ({ windowId } = {}) => P.setSidebar(windowId ?? null, false),
    };
  }

  if (!chrome.system) chrome.system = {};
  if (!chrome.system.memory) chrome.system.memory = { getInfo: () => P.getMemoryInfo() };

  // Réglages par site de Chromium : Firefox n'a que ce qui sert à PouleyPwolu.
  if (!chrome.contentSettings) {
    chrome.contentSettings = {
      // « Effacer à la fermeture » : cookies et données des sites limités à la session.
      cookies: {
        set: ({ setting } = {}) => P.setClearOnExit(setting === 'session_only'),
        clear: () => P.setClearOnExit(false),
      },
      // JavaScript bloqué sur un site (outils de développement de la barre).
      javascript: {
        get: async ({ primaryUrl } = {}) => ({ setting: (await P.getJavascript(originOf(primaryUrl))) ? 'allow' : 'block' }),
        set: ({ primaryPattern, setting } = {}) => P.setJavascript(originOf(primaryPattern), setting !== 'block'),
      },
    };
  }
}

function originOf(url) {
  try { return new URL(String(url).replace(/\/\*$/, '/')).origin; } catch { return ''; }
}
