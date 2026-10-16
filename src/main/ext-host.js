// Extensions du Chrome Web Store installées par l'utilisateur (Proton Pass,
// Bitwarden, uBlock Origin Lite…). Ce module les télécharge, vérifie leur
// signature, les charge dans chaque poulailler et relie les API Chrome
// absentes d'Electron (onglets, fenêtres, menus, badges, fenêtre du bouton)
// aux vrais onglets de PouleyPwolu.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, net, BrowserWindow, Notification, ipcMain, screen } = require('electron');
const crx = require('./crx');

const COMPAT_PRELOAD = path.join(__dirname, '..', 'preload', 'ext-compat.js');
const WINDOW_ID = 1;

const PERMISSION_TEXT = {
  tabs: 'Voir l’adresse et le titre de tes onglets',
  activeTab: 'Agir sur l’onglet affiché quand tu cliques sur son bouton',
  webRequest: 'Observer les requêtes réseau des pages',
  webNavigation: 'Savoir quelles pages tu ouvres',
  cookies: 'Lire et modifier les cookies des sites',
  clipboardRead: 'Lire ton presse-papiers',
  clipboardWrite: 'Écrire dans ton presse-papiers',
  notifications: 'Afficher des notifications',
  history: 'Lire ton historique',
  bookmarks: 'Lire tes favoris',
  downloads: 'Gérer tes téléchargements',
  privacy: 'Modifier des réglages de confidentialité',
  nativeMessaging: 'Communiquer avec un programme de l’ordinateur',
  scripting: 'Ajouter du code dans les pages',
  proxy: 'Faire passer ta connexion par un autre serveur',
  management: 'Voir tes autres extensions',
  geolocation: 'Connaître ta position',
};

function createExtHost(d) {
  // d : { state(), save(), sendUi(), broadcast(), win(), currentTabId(), currentSession(),
  //       runtime, wcToTab, allSessions, openTab(), activateTab(), closeTab(), ensureView() }
  const DIR = path.join(app.getPath('userData'), 'extensions');
  const list = () => (d.state().userExtensions = d.state().userExtensions || []);
  const loaded = new Map(); // session -> Map(id -> Extension)
  const badges = new Map(); // id -> { text, color, title }
  const menus = new Map(); // id -> Map(menuId -> props)
  const workers = new Set(); // { ses, sw, extId }
  const pending = new Map(); // jeton d'installation -> { id, tmp }
  const dirOf = (id) => path.join(DIR, id);
  const manifestOf = (id) => { try { return JSON.parse(fs.readFileSync(path.join(dirOf(id), 'manifest.json'), 'utf8')); } catch { return null; } };
  const loadedIn = (ses) => { if (!loaded.has(ses)) loaded.set(ses, new Map()); return loaded.get(ses); };
  const extIdOf = (url) => (/^chrome-extension:\/\/([a-p]{32})/.exec(url || '') || [])[1] || null;

  function iconData(dir, m) {
    const icons = m.icons || (m.action && m.action.default_icon) || {};
    const pick = typeof icons === 'string' ? icons : icons['48'] || icons['32'] || icons['128'] || Object.values(icons)[0];
    if (!pick) return null;
    try {
      const ext = path.extname(pick).toLowerCase() === '.svg' ? 'svg+xml' : 'png';
      return `data:image/${ext};base64,` + fs.readFileSync(path.join(dir, pick)).toString('base64');
    } catch { return null; }
  }

  function describe(id, dir, m) {
    const perms = [...(m.permissions || []), ...(m.optional_permissions || [])].filter((p) => typeof p === 'string');
    const hosts = [...(m.host_permissions || []), ...(m.permissions || []).filter((p) => /[:/*]/.test(p)), ...(m.content_scripts || []).flatMap((c) => c.matches || [])];
    const all = hosts.some((h) => /^(<all_urls>|\*:\/\/\*\/\*|https?:\/\/\*\/\*)$/.test(h));
    const texts = [];
    if (all) texts.push('Lire et modifier toutes les pages que tu visites');
    else if (hosts.length) texts.push('Lire et modifier certaines pages : ' + [...new Set(hosts.map((h) => h.replace(/^\*?:?\/\/|\/\*$/g, '')))].slice(0, 4).join(', '));
    for (const p of perms) if (PERMISSION_TEXT[p] && !texts.includes(PERMISSION_TEXT[p])) texts.push(PERMISSION_TEXT[p]);
    return {
      id, version: m.version, manifestVersion: m.manifest_version,
      name: crx.localized(dir, m, m.name), description: crx.localized(dir, m, m.description),
      icon: iconData(dir, m), permissions: texts,
      popup: !!((m.action && m.action.default_popup) || (m.browser_action && m.browser_action.default_popup)),
      options: !!(m.options_page || (m.options_ui && m.options_ui.page)),
    };
  }

  // ── Installation
  async function download(id) {
    const res = await net.fetch(crx.crxUrl(id, process.versions.chrome));
    if (!res.ok) throw new Error(res.status === 404 || res.status === 204 ? 'Extension introuvable sur le Chrome Web Store.' : 'Téléchargement impossible (erreur ' + res.status + ').');
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 64) throw new Error('Extension introuvable sur le Chrome Web Store.');
    return buf;
  }

  async function prepare(input) {
    const id = crx.idFromInput(input);
    if (!id) throw new Error('Colle l’adresse de l’extension sur le Chrome Web Store (chromewebstore.google.com/detail/…) ou son identifiant.');
    const tmp = path.join(DIR, '.nouveau-' + id);
    const { manifest } = crx.unpack(await download(id), id, tmp);
    const token = crypto.randomBytes(8).toString('hex');
    pending.set(token, { id, tmp });
    setTimeout(() => { if (pending.delete(token)) fs.rmSync(tmp, { recursive: true, force: true }); }, 15 * 60000);
    return { token, already: list().some((x) => x.id === id), ...describe(id, tmp, manifest) };
  }

  async function install(token) {
    const p = pending.get(token);
    if (!p) throw new Error('Installation expirée : recommence.');
    pending.delete(token);
    await unloadEverywhere(p.id);
    fs.rmSync(dirOf(p.id), { recursive: true, force: true });
    fs.renameSync(p.tmp, dirOf(p.id));
    const m = manifestOf(p.id);
    const info = describe(p.id, dirOf(p.id), m);
    const items = list();
    const old = items.find((x) => x.id === p.id);
    const rec = { id: p.id, name: info.name, version: m.version, enabled: true, pinned: old ? old.pinned : true, installedAt: Date.now(), checkedAt: Date.now() };
    if (old) Object.assign(old, rec); else items.push(rec);
    d.save();
    await Promise.all([...d.allSessions].map((ses) => loadInto(ses)));
    d.broadcast();
    return info;
  }

  function cancel(token) {
    const p = pending.get(token);
    if (!p) return;
    pending.delete(token);
    fs.rmSync(p.tmp, { recursive: true, force: true });
  }

  async function remove(id) {
    await unloadEverywhere(id);
    // Les données de l'extension (comptes, réglages) partent avec elle.
    for (const ses of d.allSessions) await ses.clearStorageData({ origin: 'chrome-extension://' + id }).catch(() => {});
    fs.rmSync(dirOf(id), { recursive: true, force: true });
    d.state().userExtensions = list().filter((x) => x.id !== id);
    badges.delete(id);
    menus.delete(id);
    d.save();
    d.broadcast();
  }

  async function setEnabled(id, on) {
    const e = list().find((x) => x.id === id);
    if (!e) return;
    e.enabled = !!on;
    d.save();
    if (on) await Promise.all([...d.allSessions].map((ses) => loadInto(ses)));
    else await unloadEverywhere(id);
    d.broadcast();
  }

  function setPinned(id, on) {
    const e = list().find((x) => x.id === id);
    if (e) { e.pinned = !!on; d.save(); d.broadcast(); }
  }

  // ── Chargement dans les sessions (une par poulailler)
  function registerSession(ses) {
    try {
      ses.registerPreloadScript({ type: 'service-worker', id: 'pouley-ext-sw', filePath: COMPAT_PRELOAD });
      ses.registerPreloadScript({ type: 'frame', id: 'pouley-ext-frame', filePath: COMPAT_PRELOAD });
    } catch (err) {
      console.warn('[extensions] préchargement', err.message);
    }
    ses.serviceWorkers.on('running-status-changed', ({ versionId }) => {
      const sw = ses.serviceWorkers.getWorkerFromVersionID(versionId);
      if (!sw || sw._pouley) return;
      const extId = extIdOf(sw.scope);
      if (!extId) return;
      sw._pouley = true;
      const rec = { ses, sw, extId };
      workers.add(rec);
      try {
        sw.ipc.handle('ext:api', (_e, method, args) => callApi({ ses, extId }, method, args));
      } catch {}
    });
  }

  async function loadInto(ses) {
    const map = loadedIn(ses);
    for (const e of list()) {
      if (e.enabled === false || map.has(e.id) || !fs.existsSync(dirOf(e.id))) continue;
      try {
        const ext = await ses.extensions.loadExtension(dirOf(e.id), { allowFileAccess: false });
        map.set(e.id, ext);
      } catch (err) {
        console.warn('[extensions]', e.name, err.message);
      }
    }
  }

  async function unloadEverywhere(id) {
    for (const [ses, map] of loaded) {
      if (!map.has(id)) continue;
      try { ses.extensions.removeExtension(id); } catch {}
      map.delete(id);
    }
    for (const w of [...workers]) if (w.extId === id) workers.delete(w);
  }

  // ── Onglets vus par les extensions (identifiant = celui de la page)
  function tabsIn(ses) {
    const out = [];
    let index = 0;
    for (const [tabId, r] of d.runtime) {
      const wc = r.view && r.view.webContents;
      if (!wc || wc.isDestroyed() || (ses && wc.session !== ses)) continue;
      out.push(tabInfo(tabId, wc, index++));
    }
    return out;
  }
  function tabInfo(tabId, wc, index = 0) {
    const active = tabId === d.currentTabId();
    const url = wc.getURL();
    return {
      id: wc.id, index, windowId: WINDOW_ID, openerTabId: undefined, active, highlighted: active, selected: active,
      pinned: false, audible: wc.isCurrentlyAudible(), discarded: false, autoDiscardable: true, incognito: false,
      mutedInfo: { muted: wc.isAudioMuted() }, url, pendingUrl: undefined, title: wc.getTitle() || url,
      status: wc.isLoading() ? 'loading' : 'complete', groupId: -1, width: 0, height: 0,
    };
  }
  const tabIdOfWc = (wcId) => d.wcToTab.get(wcId);
  const wcOf = (tabWcId) => { const t = tabIdOfWc(tabWcId); const r = t && d.runtime.get(t); return r && r.view ? r.view.webContents : null; };

  const matchPattern = (pattern, url) => {
    if (pattern === '<all_urls>') return /^(https?|file|ftp):/.test(url);
    const m = /^(\*|https?|file|ftp|wss?):\/\/([^/]*)(\/.*)$/.exec(pattern);
    if (!m) return false;
    const esc = (s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const scheme = m[1] === '*' ? 'https?' : m[1];
    const host = m[2] === '*' ? '[^/]*' : m[2].startsWith('*.') ? '(?:[^/]*\\.)?' + esc(m[2].slice(2)) : esc(m[2]);
    return new RegExp('^' + scheme + '://' + host + esc(m[3]) + '$').test(url);
  };

  function winInfo(ses, populate) {
    const w = d.win();
    const b = w ? w.getBounds() : { x: 0, y: 0, width: 0, height: 0 };
    return {
      id: WINDOW_ID, focused: !!(w && w.isFocused()), top: b.y, left: b.x, width: b.width, height: b.height,
      incognito: false, type: 'normal', state: w && w.isMaximized() ? 'maximized' : w && w.isMinimized() ? 'minimized' : 'normal', alwaysOnTop: false,
      tabs: populate ? tabsIn(ses) : undefined,
    };
  }

  const absUrl = (extId, url) => (!url ? 'pouley://newtab' : /^[a-z][\w+.-]*:/i.test(url) ? url : `chrome-extension://${extId}/${String(url).replace(/^\//, '')}`);

  function openAndGet(url, background) {
    const tabId = d.openTab({ url, background });
    const r = d.ensureView(tabId);
    const wc = r && r.view && r.view.webContents;
    return wc ? tabInfo(tabId, wc) : null;
  }

  async function callApi(ctx, method, args = []) {
    const { ses, extId } = ctx;
    const a0 = args[0];
    switch (method) {
      case 'tabs.query': {
        const q = a0 || {};
        const urls = q.url ? [].concat(q.url) : null;
        return tabsIn(ses).filter((t) => (q.active == null || t.active === q.active)
          && (q.highlighted == null || t.highlighted === q.highlighted)
          && (q.audible == null || t.audible === q.audible)
          && (q.status == null || t.status === q.status)
          && (q.pinned == null || t.pinned === q.pinned)
          && (q.windowId == null || q.windowId === WINDOW_ID || q.windowId === -2)
          && (!urls || urls.some((p) => matchPattern(p, t.url)))
          && (q.title == null || new RegExp('^' + q.title.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$').test(t.title)));
      }
      case 'tabs.get': {
        const wc = wcOf(a0);
        if (!wc) throw new Error('No tab with id: ' + a0 + '.');
        return tabInfo(tabIdOfWc(a0), wc);
      }
      case 'tabs.getCurrent': return undefined;
      case 'tabs.create': {
        const props = a0 || {};
        return openAndGet(absUrl(extId, props.url), props.active === false);
      }
      case 'tabs.duplicate': {
        const wc = wcOf(a0);
        return wc ? openAndGet(wc.getURL(), false) : null;
      }
      case 'tabs.update': {
        const [id, props] = typeof a0 === 'number' ? [a0, args[1] || {}] : [null, a0 || {}];
        const tabId = id != null ? tabIdOfWc(id) : d.currentTabId();
        const r = tabId && d.runtime.get(tabId);
        const wc = r && r.view && r.view.webContents;
        if (!wc) throw new Error('No tab with id: ' + id + '.');
        if (props.url) wc.loadURL(absUrl(extId, props.url)).catch(() => {});
        if (props.muted != null) wc.setAudioMuted(!!props.muted);
        if (props.active || props.highlighted) d.activateTab(tabId);
        return tabInfo(tabId, wc);
      }
      case 'tabs.remove': {
        for (const id of [].concat(a0)) { const t = tabIdOfWc(id); if (t) d.closeTab(t); }
        return undefined;
      }
      case 'tabs.highlight': {
        const first = [].concat((a0 && a0.tabs) || [])[0];
        const tabs = tabsIn(ses);
        const t = tabs[first];
        if (t) d.activateTab(tabIdOfWc(t.id));
        return winInfo(ses, true);
      }
      case 'windows.get': case 'windows.getCurrent': case 'windows.getLastFocused':
        return winInfo(ses, !!((method === 'windows.get' ? args[1] : a0) || {}).populate);
      case 'windows.getAll': return [winInfo(ses, !!(a0 || {}).populate)];
      case 'windows.create': {
        const props = a0 || {};
        for (const u of [].concat(props.url || [])) openAndGet(absUrl(extId, u), props.focused === false);
        if (!props.url) openAndGet('pouley://newtab', false);
        return winInfo(ses, true);
      }
      case 'windows.update': {
        const w = d.win();
        if (w && (a0 === WINDOW_ID || a0 === -2) && args[1] && args[1].focused) { if (w.isMinimized()) w.restore(); w.focus(); }
        return winInfo(ses, false);
      }
      case 'windows.remove': return undefined;
      case 'permissions.getAll': {
        const m = manifestOf(extId) || {};
        return { permissions: (m.permissions || []).filter((p) => !/[:/*]/.test(p)), origins: [...(m.host_permissions || []), ...(m.permissions || []).filter((p) => /[:/*]/.test(p))] };
      }
      case 'webNavigation.getAllFrames': case 'webNavigation.getFrame': {
        const wc = wcOf((a0 || {}).tabId);
        if (!wc) return method.endsWith('AllFrames') ? [] : null;
        const frames = wc.mainFrame.framesInSubtree.map((f) => ({
          frameId: f === wc.mainFrame ? 0 : f.frameTreeNodeId, parentFrameId: f.parent ? (f.parent === wc.mainFrame ? 0 : f.parent.frameTreeNodeId) : -1,
          url: f.url, errorOccurred: false, documentLifecycle: 'active', frameType: f === wc.mainFrame ? 'outermost_frame' : 'sub_frame',
        }));
        return method.endsWith('AllFrames') ? frames : frames.find((f) => f.frameId === (a0.frameId || 0)) || null;
      }
      case 'contextMenus.create': case 'contextMenus.update': {
        if (!menus.has(extId)) menus.set(extId, new Map());
        const map = menus.get(extId);
        if (method.endsWith('create')) map.set(a0.id, a0);
        else if (map.has(a0)) Object.assign(map.get(a0), args[1] || {});
        return undefined;
      }
      case 'contextMenus.remove': if (menus.has(extId)) menus.get(extId).delete(a0); return undefined;
      case 'contextMenus.removeAll': menus.delete(extId); return undefined;
      case 'notifications.create': {
        const [id, opts] = typeof a0 === 'string' ? [a0, args[1] || {}] : ['n' + Date.now(), a0 || {}];
        if (Notification.isSupported()) new Notification({ title: opts.title || '', body: opts.message || '', silent: true }).show();
        d.sendUi('cluck', 'notif');
        return id;
      }
      case 'action.setBadgeText': case 'action.setBadgeBackgroundColor': case 'action.setTitle': {
        const det = a0 || {};
        if (det.tabId != null && det.tabId !== currentWcId()) return undefined; // badge propre à un autre onglet
        const b = badges.get(extId) || {};
        if (method.endsWith('Text')) b.text = String(det.text || '');
        if (method.endsWith('Color')) b.color = Array.isArray(det.color) ? `rgb(${det.color.slice(0, 3).join(',')})` : det.color;
        if (method.endsWith('Title')) b.title = det.title;
        badges.set(extId, b);
        d.broadcast();
        return undefined;
      }
      case 'action.setIcon': case 'action.setPopup': case 'action.enable': case 'action.disable': return undefined;
      case 'action.openPopup': return showPopup(extId, null);
      case 'runtime.openOptionsPage': {
        const m = manifestOf(extId) || {};
        const page = m.options_page || (m.options_ui && m.options_ui.page);
        if (page) openAndGet(absUrl(extId, page), false);
        return undefined;
      }
      default:
        throw new Error('API non prise en charge dans PouleyPwolu : ' + method);
    }
  }
  const currentWcId = () => { const r = d.runtime.get(d.currentTabId()); return r && r.view ? r.view.webContents.id : -1; };

  // Pages de l'extension (fenêtre du bouton, réglages…)
  ipcMain.handle('ext:api', (event, method, args) => {
    const extId = extIdOf(event.senderFrame && event.senderFrame.url);
    if (!extId) throw new Error('refusé');
    return callApi({ ses: event.sender.session, extId }, method, args);
  });

  // ── Événements envoyés aux extensions
  function emit(ses, name, args) {
    for (const w of workers) {
      if (ses && w.ses !== ses) continue;
      try { if (!w.sw.isDestroyed || !w.sw.isDestroyed()) w.sw.send('ext:event', name, args); } catch { workers.delete(w); }
    }
    if (popup && !popup.isDestroyed()) popup.webContents.send('ext:event', name, args);
    for (const r of d.runtime.values()) {
      const wc = r.view && r.view.webContents;
      if (wc && !wc.isDestroyed() && wc.getURL().startsWith('chrome-extension://')) wc.send('ext:event', name, args);
    }
  }
  const hasExtensions = () => list().some((x) => x.enabled !== false);

  // Appelé par main.js quand une page d'onglet est créée.
  function watch(tabId, wc) {
    const ses = wc.session;
    const info = () => (wc.isDestroyed() ? null : tabInfo(tabId, wc));
    const fire = (name, args) => { if (hasExtensions()) emit(ses, name, args); };
    setImmediate(() => { const t = info(); if (t) fire('tabs.onCreated', [t]); });
    const nav = (name, extra = {}) => (_e, url) => fire('webNavigation.' + name, [{ tabId: wc.id, frameId: 0, parentFrameId: -1, url: url || wc.getURL(), timeStamp: Date.now(), ...extra }]);
    wc.on('did-start-loading', () => { const t = info(); if (t) fire('tabs.onUpdated', [wc.id, { status: 'loading' }, t]); });
    wc.on('did-stop-loading', () => { const t = info(); if (t) fire('tabs.onUpdated', [wc.id, { status: 'complete' }, t]); });
    wc.on('page-title-updated', (_e, title) => { const t = info(); if (t) fire('tabs.onUpdated', [wc.id, { title }, t]); });
    wc.on('did-start-navigation', (details) => {
      if (!details.isMainFrame || details.isSameDocument) return;
      fire('webNavigation.onBeforeNavigate', [{ tabId: wc.id, frameId: 0, parentFrameId: -1, url: details.url, timeStamp: Date.now() }]);
    });
    wc.on('did-navigate', (_e, url) => {
      nav('onCommitted', { transitionType: 'link', transitionQualifiers: [] })(null, url);
      const t = info();
      if (t) fire('tabs.onUpdated', [wc.id, { url }, t]);
    });
    wc.on('dom-ready', nav('onDOMContentLoaded'));
    wc.on('did-finish-load', nav('onCompleted'));
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (!isMain) return;
      nav('onHistoryStateUpdated', { transitionType: 'link', transitionQualifiers: [] })(null, url);
      const t = info();
      if (t) fire('tabs.onUpdated', [wc.id, { url }, t]);
    });
    const id = wc.id;
    wc.once('destroyed', () => { if (hasExtensions()) emit(ses, 'tabs.onRemoved', [id, { windowId: WINDOW_ID, isWindowClosing: false }]); });
  }

  function tabActivated(tabId) {
    if (!hasExtensions()) return;
    const r = d.runtime.get(tabId);
    const wc = r && r.view && r.view.webContents;
    if (wc && !wc.isDestroyed()) emit(wc.session, 'tabs.onActivated', [{ tabId: wc.id, windowId: WINDOW_ID }]);
  }

  // ── Fenêtre du bouton de l'extension
  let popup = null;
  async function showPopup(extId, anchor) {
    const m = manifestOf(extId);
    const page = m && ((m.action && m.action.default_popup) || (m.browser_action && m.browser_action.default_popup));
    if (!page) {
      // Pas de fenêtre : l'extension réagit au clic sur son bouton.
      const r = d.runtime.get(d.currentTabId());
      if (r && r.view) emit(r.view.webContents.session, 'action.onClicked', [tabInfo(d.currentTabId(), r.view.webContents)]);
      return undefined;
    }
    const ses = d.currentSession();
    await loadInto(ses);
    if (popup && !popup.isDestroyed()) popup.destroy();
    const w = d.win();
    const a = anchor || (() => { const b = w.getBounds(); return { x: b.x + b.width - 380, y: b.y + 60, width: 0, height: 0 }; })();
    popup = new BrowserWindow({
      parent: w, show: false, frame: false, resizable: false, skipTaskbar: true, minimizable: false, maximizable: false,
      fullscreenable: false, width: 360, height: 480, x: Math.round(a.x), y: Math.round(a.y + a.height + 6), backgroundColor: '#ffffff',
      roundedCorners: true, webPreferences: { session: ses, sandbox: true, contextIsolation: true, spellcheck: false },
    });
    const me = popup;
    me.on('blur', () => setTimeout(() => { if (!me.isDestroyed() && !me.isFocused()) me.destroy(); }, 120));
    me.webContents.setWindowOpenHandler(({ url }) => { d.openTab({ url }); return { action: 'deny' }; });
    // Taille : celle que demande la page de l'extension (max 800 × 600, comme Chrome).
    const fit = async () => {
      if (me.isDestroyed()) return;
      const size = await me.webContents.executeJavaScript('[Math.ceil(document.documentElement.scrollWidth), Math.ceil(Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0))]').catch(() => null);
      if (!size || me.isDestroyed()) return;
      const wdt = Math.max(160, Math.min(800, size[0]));
      const hgt = Math.max(60, Math.min(600, size[1]));
      const area = screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) }).workArea;
      const x = Math.max(area.x + 8, Math.min(Math.round(a.x + a.width - wdt), area.x + area.width - wdt - 8));
      const y = Math.min(Math.round(a.y + a.height + 6), area.y + area.height - hgt - 8);
      me.setBounds({ x, y, width: wdt, height: hgt });
    };
    me.webContents.once('did-finish-load', async () => {
      await fit();
      if (!me.isDestroyed()) { me.show(); me.focus(); }
      setTimeout(fit, 250);
      setTimeout(fit, 800);
    });
    await me.loadURL(`chrome-extension://${extId}/${page.replace(/^\//, '')}`).catch(() => {});
    return undefined;
  }

  // ── Menus des extensions au clic droit d'une page
  function contextItems(params, tabWc) {
    const out = [];
    for (const [extId, map] of menus) {
      const e = list().find((x) => x.id === extId && x.enabled !== false);
      if (!e) continue;
      for (const item of map.values()) {
        if (item.visible === false || item.type === 'separator' || item.parentId) continue;
        const ctx = [].concat(item.contexts || ['page']);
        const kind = params.linkURL ? 'link' : params.isEditable ? 'editable' : params.selectionText ? 'selection' : params.mediaType === 'image' ? 'image' : 'page';
        if (!ctx.includes('all') && !ctx.includes(kind) && !(kind !== 'page' && ctx.includes('page') && kind === 'selection')) continue;
        out.push({
          label: String(item.title || '').replace('%s', (params.selectionText || '').slice(0, 30)),
          click: () => emit(tabWc.session, 'contextMenus.onClicked', [{
            menuItemId: item.id, editable: !!params.isEditable, pageUrl: params.pageURL, linkUrl: params.linkURL || undefined,
            selectionText: params.selectionText || undefined, srcUrl: params.srcURL || undefined, frameId: 0,
          }, tabInfo(tabIdOfWc(tabWc.id), tabWc)]),
        });
      }
    }
    return out;
  }

  // ── Mises à jour des extensions (une fois par jour)
  async function checkUpdates() {
    for (const e of list()) {
      try {
        const res = await net.fetch(crx.updateUrl(e.id, e.version, process.versions.chrome));
        const xml = await res.text();
        const m = /<updatecheck[^>]*\bversion="([\d.]+)"/.exec(xml);
        e.checkedAt = Date.now();
        if (!m || !newer(m[1], e.version)) continue;
        const tmp = path.join(DIR, '.maj-' + e.id);
        const { manifest } = crx.unpack(await download(e.id), e.id, tmp);
        await unloadEverywhere(e.id);
        fs.rmSync(dirOf(e.id), { recursive: true, force: true });
        fs.renameSync(tmp, dirOf(e.id));
        e.version = manifest.version;
        await Promise.all([...d.allSessions].map((ses) => loadInto(ses)));
      } catch (err) {
        console.warn('[extensions] mise à jour', e.name, err.message);
      }
    }
    d.save();
    d.broadcast();
  }
  const newer = (a, b) => {
    const x = a.split('.').map(Number);
    const y = String(b).split('.').map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
    return false;
  };

  function snapshot() {
    return list().map((e) => {
      const m = manifestOf(e.id);
      const info = m ? describe(e.id, dirOf(e.id), m) : { name: e.name, permissions: [] };
      return { ...e, name: info.name || e.name, description: info.description, icon: info.icon, popup: info.popup, options: info.options, permissions: info.permissions, badge: badges.get(e.id) || null, available: !!m };
    });
  }

  return { registerSession, loadInto, prepare, install, cancel, remove, setEnabled, setPinned, showPopup, watch, tabActivated, contextItems, checkUpdates, snapshot, callApi, extIdOf, list };
}

module.exports = { createExtHost };
