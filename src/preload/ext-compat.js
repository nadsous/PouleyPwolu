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
    // Au tout premier démarrage du service worker, PouleyPwolu ne l'écoute pas
    // encore : les appels trop rapides sont réessayés un court instant.
    call: async (method, args) => {
      for (let i = 0; ; i++) {
        try { return await ipcRenderer.invoke('ext:api', method, args); } catch (err) {
          const msg = String((err && err.message) || err);
          // Le message tel que Chrome le donnerait, sans l'enrobage d'Electron.
          if (i >= 40 || !/No handler registered/.test(msg)) throw new Error(msg.replace(/^Error invoking remote method 'ext:api': (\w*Error: )?/, ''));
          await new Promise((r) => setTimeout(r, 50));
        }
      }
    },
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
          // Clic sur le bouton d'une extension sans fenêtre : envoyé par PouleyPwolu.
          c.action.onClicked = E('action.onClicked');
        }
        if (c.runtime && !c.runtime.openOptionsPage) c.runtime.openOptionsPage = call('runtime.openOptionsPage');
        if (c.runtime && c.runtime.openOptionsPage) c.runtime.openOptionsPage = call('runtime.openOptionsPage');
        if (c.action) c.action.getUserSettings = local(() => ({ isOnToolbar: true }));

        // ── Assistants IA (Claude, ChatGPT) : ils pilotent les onglets.
        for (const m of ['group', 'ungroup', 'captureVisibleTab', 'goBack', 'goForward', 'reload', 'move', 'discard', 'getZoom', 'setZoom']) c.tabs[m] = call('tabs.' + m);

        // Pilotage d'un onglet par le protocole des outils de développement.
        c.debugger = {
          attach: call('debugger.attach'), detach: call('debugger.detach'), sendCommand: call('debugger.sendCommand'),
          getTargets: call('debugger.getTargets'), onEvent: E('debugger.onEvent'), onDetach: E('debugger.onDetach'),
        };

        // Groupes d'onglets : ceux de PouleyPwolu.
        c.tabGroups = {
          TAB_GROUP_ID_NONE: -1,
          Color: { GREY: 'grey', BLUE: 'blue', RED: 'red', YELLOW: 'yellow', GREEN: 'green', PINK: 'pink', PURPLE: 'purple', CYAN: 'cyan', ORANGE: 'orange' },
          get: call('tabGroups.get'), query: call('tabGroups.query'), update: call('tabGroups.update'), move: call('tabGroups.move'),
          onCreated: E('tabGroups.onCreated'), onUpdated: E('tabGroups.onUpdated'), onRemoved: E('tabGroups.onRemoved'), onMoved: E('tabGroups.onMoved'),
        };

        // Panneau latéral : affiché à droite, à la place du panneau IA.
        c.sidePanel = {
          open: call('sidePanel.open'), close: call('sidePanel.close'), setOptions: call('sidePanel.setOptions'), getOptions: call('sidePanel.getOptions'),
          setPanelBehavior: call('sidePanel.setPanelBehavior'), getPanelBehavior: call('sidePanel.getPanelBehavior'),
          onOpened: E('sidePanel.onOpened'), onClosed: E('sidePanel.onClosed'),
        };

        // Page cachée de l'extension (son, presse-papiers, calculs).
        c.offscreen = {
          createDocument: call('offscreen.createDocument'), closeDocument: call('offscreen.closeDocument'), hasDocument: call('offscreen.hasDocument'),
          Reason: Object.fromEntries(['TESTING', 'AUDIO_PLAYBACK', 'IFRAME_SCRIPTING', 'DOM_SCRAPING', 'BLOBS', 'DOM_PARSER', 'USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC', 'CLIPBOARD', 'LOCAL_STORAGE', 'WORKERS', 'BATTERY_STATUS', 'MATCH_MEDIA', 'GEOLOCATION'].map((r) => [r, r])),
        };

        // Connexion au compte (fenêtre de connexion qui revient vers l'extension).
        const extId = c.runtime && c.runtime.id;
        c.identity = {
          launchWebAuthFlow: call('identity.launchWebAuthFlow'),
          getRedirectURL: (p) => `https://${extId}.chromiumapp.org/${String(p || '').replace(/^\//, '')}`,
          getAuthToken: local(() => { throw new Error('getAuthToken n’est pas disponible dans PouleyPwolu.'); }),
          clearAllCachedAuthTokens: local(() => undefined), removeCachedAuthToken: local(() => undefined),
          getProfileUserInfo: local(() => ({ email: '', id: '' })), onSignInChanged: makeEvent(),
        };

        if (c.runtime) {
          // Messages des sites reliés (claude.ai…) : la réponse repart vers la page.
          if (!events['runtime.onMessageExternal']) {
            const ls = new Set();
            // Remet le message à tous les écouteurs ; réponse unique, comme Chrome.
            const dispatch = (message, sender, respond) => {
              let done = false;
              const sendResponse = (value) => { if (!done) { done = true; respond(value); } };
              let waiting = false;
              for (const f of ls) {
                try {
                  const r = f(message, sender, sendResponse);
                  if (r === true) waiting = true;
                  else if (r && typeof r.then === 'function') { waiting = true; r.then(sendResponse, () => sendResponse()); }
                } catch (err) { console.error(err); }
              }
              if (!waiting) sendResponse(undefined);
            };
            // Les pages sans PouleyPwolu (claude.ai dans le panneau de l'extension)
            // passent par le canal du moteur. Il présente le panneau comme un
            // onglet : on retire « tab » si ce n'est pas un vrai onglet, comme Chrome.
            try {
              c.runtime.onMessageExternal.addListener((message, sender, respond) => {
                if (!ls.size) return false;
                const tabId = sender && sender.tab && sender.tab.id;
                (tabId != null ? B.call('tabs.get', [tabId]).then(() => sender, () => { const s = { ...sender }; delete s.tab; return s; }) : Promise.resolve(sender))
                  .then((s) => dispatch(message, s, respond));
                return true;
              });
            } catch {}
            events['runtime.onMessageExternal'] = {
              addListener: (f) => ls.add(f), removeListener: (f) => ls.delete(f), hasListener: (f) => ls.has(f), hasListeners: () => ls.size > 0,
              // Messages arrivés par PouleyPwolu (onglets) : réponse renvoyée à la page.
              _fire: (message, sender, n) => { if (ls.size) dispatch(message, sender, (value) => B.call('runtime.externalReply', [n, value]).catch(() => {})); },
            };
          }
          c.runtime.onMessageExternal = events['runtime.onMessageExternal'];
          c.runtime.getContexts = call('runtime.getContexts');
          c.runtime.ContextType = { TAB: 'TAB', POPUP: 'POPUP', BACKGROUND: 'BACKGROUND', OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT', SIDE_PANEL: 'SIDE_PANEL', DEVELOPER_TOOLS: 'DEVELOPER_TOOLS' };
          // Pas de programme de l'ordinateur relié (Claude Code, Codex) : le port se ferme tout de suite.
          c.runtime.connectNative = () => {
            const onDisconnect = makeEvent();
            setTimeout(() => onDisconnect._fire(), 0);
            return { name: '', postMessage: () => {}, disconnect: () => {}, onMessage: makeEvent(), onDisconnect };
          };
          c.runtime.sendNativeMessage = local(() => { throw new Error('Specified native messaging host not found.'); });
        }

        // Alarmes (minuteries qui réveillent l'extension).
        if (!c.alarms) {
          c.alarms = { create: call('alarms.create'), get: call('alarms.get'), getAll: call('alarms.getAll'), clear: call('alarms.clear'), clearAll: call('alarms.clearAll'), onAlarm: E('alarms.onAlarm') };
        }

        // Règles réseau : PouleyPwolu ne les applique pas, on les garde pour l'extension.
        if (!c.declarativeNetRequest) {
          const rules = [];
          c.declarativeNetRequest = {
            updateSessionRules: local((o = {}) => { const rm = new Set(o.removeRuleIds || []); rules.splice(0, rules.length, ...rules.filter((r) => !rm.has(r.id)), ...(o.addRules || [])); }),
            getSessionRules: local(() => rules.slice()), updateDynamicRules: local(() => undefined), getDynamicRules: local(() => []),
            HeaderOperation: { APPEND: 'append', SET: 'set', REMOVE: 'remove' },
            RuleActionType: { BLOCK: 'block', REDIRECT: 'redirect', ALLOW: 'allow', UPGRADE_SCHEME: 'upgradeScheme', MODIFY_HEADERS: 'modifyHeaders', ALLOW_ALL_REQUESTS: 'allowAllRequests' },
            ResourceType: Object.fromEntries(['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object', 'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'].map((r) => [r.toUpperCase(), r])),
          };
        }

        // Téléchargements, historique, favoris : le minimum pour que l'extension tourne.
        if (!c.downloads) {
          c.downloads = { download: call('downloads.download'), search: local(() => []), show: local(() => undefined), open: local(() => undefined), onCreated: E('downloads.onCreated'), onChanged: E('downloads.onChanged') };
        }
        if (!c.history) c.history = { search: local(() => []), getVisits: local(() => []), onVisited: makeEvent() };
        if (!c.bookmarks) c.bookmarks = { getTree: local(() => [{ id: '0', title: '', children: [] }]), get: local(() => []), search: local(() => []), getRecent: local(() => []), onCreated: makeEvent(), onRemoved: makeEvent(), onChanged: makeEvent() };
        if (!c.topSites) c.topSites = { get: local(() => []) };
        if (!c.commands) c.commands = { getAll: local(() => []), onCommand: E('commands.onCommand') };
        if (!c.sessions) c.sessions = { getRecentlyClosed: local(() => []), restore: local(() => undefined), onChanged: makeEvent() };
        if (c.storage && !c.storage.managed) c.storage.managed = { get: local(() => ({})), onChanged: makeEvent() };
      }
    },
  });
}
