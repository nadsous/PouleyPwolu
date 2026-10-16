// Préchargé dans les extensions Chrome (service worker et pages de
// l'extension). Electron ne fournit qu'une partie des API de Chrome : on
// ajoute celles qui manquent (onglets, fenêtres, permissions, menus…) en les
// reliant aux vrais onglets de PouleyPwolu. Ne fait rien sur les sites web.
const { contextBridge, ipcRenderer } = require('electron');

// Dans un service worker, le préchargement ne voit pas « location » : on demande
// au contexte de la page lui-même.
const protocol = (() => {
  try { return contextBridge.executeInMainWorld({ func: () => (globalThis.location ? globalThis.location.protocol : '') }); } catch { return ''; }
})();

if (protocol === 'chrome-extension:') {
  const listeners = new Set();
  ipcRenderer.on('ext:event', (_e, name, args) => { for (const fn of listeners) fn(name, args); });
  contextBridge.exposeInMainWorld('__pouleyExt', {
    call: (method, args) => ipcRenderer.invoke('ext:api', method, args),
    listen: (fn) => { listeners.add(fn); },
  });

  contextBridge.executeInMainWorld({
    func: () => {
      const B = globalThis.__pouleyExt;
      if (!B) return;
      const events = Object.create(null);
      const makeEvent = () => {
        const ls = new Set();
        return {
          addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f), hasListener: (f) => ls.has(f), hasListeners: () => ls.size > 0,
          _fire: (...a) => ls.forEach((f) => { try { f(...a); } catch (err) { console.error(err); } }),
        };
      };
      const E = (name) => events[name] || (events[name] = makeEvent());
      B.listen((name, args) => { if (events[name]) events[name]._fire(...(args || [])); });
      // Les API Chrome acceptent une promesse ou un rappel (callback).
      const call = (method) => (...args) => {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const p = B.call(method, args);
        if (!callback) return p;
        p.then((r) => callback(r), () => callback());
        return undefined;
      };
      const local = (fn) => (...args) => {
        const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const p = Promise.resolve(fn(...args));
        if (!callback) return p;
        p.then((r) => callback(r));
        return undefined;
      };

      for (const c of [globalThis.chrome, globalThis.browser].filter(Boolean)) {
        // Onglets : ceux de PouleyPwolu (l'identifiant est celui de la page).
        c.tabs = c.tabs || {};
        for (const m of ['query', 'get', 'getCurrent', 'create', 'update', 'remove', 'duplicate', 'highlight']) c.tabs[m] = call('tabs.' + m);
        for (const ev of ['onActivated', 'onUpdated', 'onRemoved', 'onCreated', 'onHighlighted', 'onReplaced', 'onMoved', 'onAttached', 'onDetached']) c.tabs[ev] = E('tabs.' + ev);
        c.tabs.TAB_ID_NONE = -1;

        // Une seule fenêtre : celle du navigateur.
        const winApi = c.windows || {};
        for (const m of ['get', 'getCurrent', 'getLastFocused', 'getAll', 'create', 'update', 'remove']) winApi[m] = call('windows.' + m);
        for (const ev of ['onCreated', 'onRemoved', 'onFocusChanged', 'onBoundsChanged']) winApi[ev] = E('windows.' + ev);
        winApi.WINDOW_ID_NONE = -1;
        winApi.WINDOW_ID_CURRENT = -2;
        c.windows = winApi;

        // Permissions : celles du manifeste, accordées à l'installation.
        if (!c.permissions || !c.permissions.onAdded) {
          const P = c.permissions || {};
          P.contains = local(() => true);
          P.getAll = call('permissions.getAll');
          P.request = local(() => true);
          P.remove = local(() => false);
          P.onAdded = E('permissions.onAdded');
          P.onRemoved = E('permissions.onRemoved');
          c.permissions = P;
        }

        // Navigation dans les onglets.
        if (!c.webNavigation) {
          c.webNavigation = { getFrame: call('webNavigation.getFrame'), getAllFrames: call('webNavigation.getAllFrames') };
          for (const ev of ['onBeforeNavigate', 'onCommitted', 'onDOMContentLoaded', 'onCompleted', 'onErrorOccurred', 'onHistoryStateUpdated', 'onReferenceFragmentUpdated', 'onCreatedNavigationTarget', 'onTabReplaced']) c.webNavigation[ev] = E('webNavigation.' + ev);
        }

        // Menus contextuels : ajoutés au clic droit de PouleyPwolu.
        if (!c.contextMenus) {
          let n = 0;
          c.contextMenus = {
            create: (props, cb) => { const id = props.id || 'm' + (++n); B.call('contextMenus.create', [{ ...props, id, onclick: undefined }]).then(() => cb && cb()); return id; },
            update: call('contextMenus.update'), remove: call('contextMenus.remove'), removeAll: call('contextMenus.removeAll'),
            onClicked: E('contextMenus.onClicked'),
            ContextType: { ALL: 'all', PAGE: 'page', SELECTION: 'selection', LINK: 'link', EDITABLE: 'editable', IMAGE: 'image', ACTION: 'action' },
          };
        }
        if (!c.menus) c.menus = c.contextMenus;

        // Réglages de Chrome que PouleyPwolu n'a pas (gestionnaire de mots de passe intégré…).
        if (!c.privacy) {
          const setting = () => ({ get: local(() => ({ value: false, levelOfControl: 'controllable_by_this_extension' })), set: local(() => undefined), clear: local(() => undefined), onChange: makeEvent() });
          c.privacy = { services: { passwordSavingEnabled: setting(), autofillAddressEnabled: setting(), autofillCreditCardEnabled: setting(), autofillEnabled: setting() }, network: { webRTCIPHandlingPolicy: setting() }, websites: {} };
        }

        // Notifications : affichées par Windows.
        if (!c.notifications) {
          c.notifications = { create: call('notifications.create'), clear: local(() => true), getAll: local(() => ({})), onClicked: E('notifications.onClicked'), onClosed: E('notifications.onClosed'), onButtonClicked: E('notifications.onButtonClicked') };
        }

        // Bouton de l'extension : PouleyPwolu affiche le badge et la fenêtre.
        if (c.action) {
          for (const m of ['setBadgeText', 'setBadgeBackgroundColor', 'setTitle', 'setIcon', 'setPopup', 'enable', 'disable']) {
            const native = c.action[m] && c.action[m].bind(c.action);
            c.action[m] = (...args) => {
              const callback = typeof args[args.length - 1] === 'function' ? args.pop() : null;
              const detail = m === 'setIcon' ? [{ ...(args[0] || {}), imageData: undefined }] : args;
              B.call('action.' + m, detail).catch(() => {});
              const p = native ? Promise.resolve(native(...args)).catch(() => {}) : Promise.resolve();
              if (callback) { p.then(() => callback()); return undefined; }
              return p;
            };
          }
          c.action.openPopup = call('action.openPopup');
        }
        if (c.runtime && !c.runtime.openOptionsPage) c.runtime.openOptionsPage = call('runtime.openOptionsPage');
        if (c.runtime && c.runtime.openOptionsPage) c.runtime.openOptionsPage = call('runtime.openOptionsPage');
      }
    },
  });
}
