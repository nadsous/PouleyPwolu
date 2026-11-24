/* PouleyPwolu : API privée chrome.pouleyPrivate de l'extension intégrée (moteur Gecko).
 *
 * Ce script tourne dans le processus principal du navigateur, avec les droits du
 * navigateur : seule une extension intégrée (privilégiée) peut le déclarer.
 * Il remplace les patches C++ de l'édition Chromium (barre latérale, barre du haut,
 * fenêtre, navigateur par défaut…) par du JavaScript sur l'interface de Firefox.
 */
"use strict";

/* global ExtensionAPI, ExtensionCommon, Services, ChromeUtils, Cc, Ci */

const lazy = {};
ChromeUtils.defineESModuleGetters(lazy, {
  ExtensionParent: "resource://gre/modules/ExtensionParent.sys.mjs",
  ExtensionPermissions: "resource://gre/modules/ExtensionPermissions.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PrivateBrowsingUtils: "resource://gre/modules/PrivateBrowsingUtils.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
});

// Feuille de l'interface PouleyPwolu : engine/chrome/pouleypwolu.css, liée dans
// browser.xhtml (scripts/prepare.py). On l'enregistre aussi ici, au cas où.
const SHEET_URL = "chrome://browser/content/pouleypwolu.css";

const ADDON_ID = "pouleypwolu@nads.site";
const SIDEBAR_ID = ExtensionCommon.makeWidgetId(ADDON_ID) + "-sidebar-action";
const BROWSER_WINDOW = "navigator:browser";

let sheetLoaded = false;
function loadSheet() {
  if (sheetLoaded) return;
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  const uri = Services.io.newURI(SHEET_URL);
  if (!sss.sheetRegistered(uri, sss.AGENT_SHEET)) sss.loadAndRegisterSheet(uri, sss.AGENT_SHEET);
  // Outils F12 aux couleurs de PouleyPwolu (feuille limitée à chrome://devtools/).
  try {
    const dev = Services.io.newURI("resource://builtin-addons/pouleypwolu/devtools/theme-pouleypwolu.css");
    if (!sss.sheetRegistered(dev, sss.USER_SHEET)) sss.loadAndRegisterSheet(dev, sss.USER_SHEET);
  } catch {}
  sheetLoaded = true;
}

function browserWindows() {
  return [...Services.wm.getEnumerator(BROWSER_WINDOW)].filter((w) => !w.closed);
}

// Fenêtre de navigateur d'après son id d'extension (ou toutes si windowId est nul).
function windowsFor(context, windowId) {
  if (windowId == null) return browserWindows();
  const w = context.extension.windowManager.get(windowId, context);
  return w ? [w.window] : [];
}

function oneWindow(context, windowId) {
  const [win] = windowsFor(context, windowId);
  if (!win) throw new context.cloneScope.Error(`Fenêtre ${windowId} introuvable`);
  return win;
}

function whenReady(win) {
  if (win.gBrowserInit && win.gBrowserInit.delayedStartupFinished) return Promise.resolve();
  return new Promise((resolve) => {
    const obs = (subject) => {
      if (subject !== win) return;
      Services.obs.removeObserver(obs, "browser-delayed-startup-finished");
      resolve();
    };
    Services.obs.addObserver(obs, "browser-delayed-startup-finished");
  });
}

// Prépare une fenêtre : barre PouleyPwolu à la place des onglets de Firefox.
function prepareWindow(win) {
  installPopupAnchor(win);
  installDock(win);
  watchExtensions();
  if (win.document.documentElement.hasAttribute("pouley-float")) return;
  // Fenêtres privées et fenêtres Tor : onglets de Firefox, pas de barre PouleyPwolu
  // (rien de ce qu'on y ouvre n'entre dans les poulaillers).
  if (lazy.PrivateBrowsingUtils.isWindowPrivate(win)) {
    win.document.documentElement.removeAttribute("pouley-bar");
    return;
  }
  win.document.documentElement.setAttribute("pouley-bar", "true");
  installPeek(win);
}

// Fenêtres de Firefox accrochées à la barre d'outils (« Ajouter Proton Pass ? », permissions
// d'un site, mots de passe…) : cette barre est masquée par PouleyPwolu, donc Firefox ne
// trouvait aucun point d'accroche visible et la fenêtre ne s'affichait pas (impossible
// d'installer une extension). On lui donne un point invisible en haut à droite de la page.
function installPopupAnchor(win) {
  const doc = win.document;
  if (doc.getElementById("pouley-popup-anchor")) return;
  const pn = win.PopupNotifications;
  if (!pn) return;
  const anchor = doc.createXULElement("box");
  anchor.id = "pouley-popup-anchor";
  anchor.setAttribute("style", "position: fixed; top: 10px; right: 40px; width: 1px; height: 1px; pointer-events: none;");
  doc.getElementById("browser").appendChild(anchor);
  // Firefox renvoie parfois l'élément demandé même masqué (bouton Extensions) : on vérifie.
  const visible = pn._getVisibleAnchorElement;
  pn._getVisibleAnchorElement = (el) => {
    const found = visible ? visible(el) : el;
    return found && found.checkVisibility(pn.CHECK_VISIBILITY_OPTIONS) ? found : anchor;
  };
  patchPanelAnchors();
}

const isShown = (el) => !!el && typeof el.checkVisibility === "function" && el.checkVisibility({ visibilityProperty: true });

// Panneaux de Firefox (fenêtre d'une extension, panneau des extensions, menus) : ils
// s'accrochent aux boutons de la barre d'outils masquée. On les accroche à la bulle des
// extensions, ou au point invisible en haut à droite de la page.
function patchPanelAnchors() {
  const { PanelMultiView } = ChromeUtils.importESModule("moz-src:///browser/components/customizableui/PanelMultiView.sys.mjs");
  if (PanelMultiView.openPopup.pouley) return;
  const original = PanelMultiView.openPopup;
  const patched = function (panelNode, anchor, ...rest) {
    if (anchor && anchor.ownerDocument && !isShown(anchor)) {
      const doc = anchor.ownerDocument;
      const bubble = doc.getElementById("pouley-ext-btn");
      anchor = isShown(bubble) ? bubble : doc.getElementById("pouley-popup-anchor") || anchor;
    }
    return original.call(this, panelNode, anchor, ...rest);
  };
  patched.pouley = true;
  PanelMultiView.openPopup = patched;
}

// ── Bulle des extensions ────────────────────────────────────────────────────
// Une petite bulle transparente au bord de la page. Un clic la déplie : la liste des
// extensions installées, avec leur nom et leur badge, sur un fond en verre. Un clic sur
// une extension ouvre sa fenêtre, accrochée à la bulle. On la glisse à la souris : elle
// se colle au bord gauche ou droit le plus proche et garde sa place (préférence
// pouleypwolu.bulles.position, « right:0.38 »).
const HTML_NS = "http://www.w3.org/1999/xhtml";
const BUBBLE_CSS = "resource://builtin-addons/pouleypwolu/experiments/bulle.css";
const DOCK_PREF = "pouleypwolu.bulles.position";

function userExtensions(win) {
  const global = lazy.ExtensionParent.apiManager.global;
  const tab = win.gBrowser.selectedTab;
  const out = [];
  for (const policy of WebExtensionPolicy.getActiveExtensions()) {
    const ext = policy.extension;
    if (!ext || ext.id === ADDON_ID || ext.isAppProvided || policy.isPrivileged) continue;
    if (ext.type && ext.type !== "extension") continue;
    const action = global.browserActionFor && global.browserActionFor(ext);
    let badge = "";
    let color = "";
    try {
      if (action) {
        badge = action.action.getProperty(tab, "badgeText") || "";
        const c = action.action.getProperty(tab, "badgeBackgroundColor");
        if (Array.isArray(c)) color = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] ?? 255) / 255})`;
      }
    } catch {}
    let icon = "";
    try {
      icon = lazy.ExtensionParent.IconDetails.getPreferredIcon(ext.manifest.icons || {}, ext, 32).icon;
    } catch {}
    out.push({ id: ext.id, name: ext.name, icon, badge, color });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "fr"));
}

// Bouton de l'extension : son popup s'ouvre, ou son clic est transmis ; sinon son
// panneau latéral, à la place de la barre PouleyPwolu.
async function runAction(win, extensionId) {
  const policy = WebExtensionPolicy.getByID(extensionId);
  const ext = policy && policy.extension;
  if (!ext) return "none";
  const global = lazy.ExtensionParent.apiManager.global;
  const action = global.browserActionFor && global.browserActionFor(ext);
  if (action) {
    const popup = action.action.getPopupUrl(win.gBrowser.selectedTab);
    await action.triggerAction(win);
    return popup ? "popup" : "click";
  }
  const id = ExtensionCommon.makeWidgetId(extensionId) + "-sidebar-action";
  if (win.SidebarController.sidebars.has(id)) {
    await win.SidebarController.show(id);
    return "panel";
  }
  return "none";
}

function dockPosition() {
  const [side, y] = Services.prefs.getStringPref(DOCK_PREF, "right:0.38").split(":");
  return { side: side === "left" ? "left" : "right", y: Math.min(0.9, Math.max(0.03, parseFloat(y) || 0.38)) };
}

function applyDockPosition(dock) {
  const { side, y } = dockPosition();
  dock.setAttribute("side", side);
  // Près du bas de la page, les listes s'ouvrent vers le haut.
  dock.toggleAttribute("low", y > 0.55);
  dock.style.left = "";
  dock.style.top = `${(y * 100).toFixed(2)}%`;
}

function installDock(win) {
  const doc = win.document;
  if (doc.getElementById("pouley-dock")) return;
  const box = doc.getElementById("tabbrowser-tabbox");
  if (!box) return;
  try {
    win.windowUtils.loadSheetUsingURIString(BUBBLE_CSS, win.windowUtils.AUTHOR_SHEET);
  } catch (err) {
    dump(`[PouleyPwolu] bulles : ${err}\n`);
  }
  const el = (tag, cls, text) => {
    const e = doc.createElementNS(HTML_NS, tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    return e;
  };
  const dock = el("div");
  dock.id = "pouley-dock";
  const bubble = (id, title) => {
    const root = el("div", "peb");
    root.id = id;
    root.hidden = true;
    const btn = el("button", "peb-btn");
    btn.id = id + "-btn";
    btn.title = title;
    const panel = el("div", "peb-panel");
    root.append(panel, btn);
    dock.append(root);
    return { root, btn, panel };
  };
  const exts = bubble("pouley-ext-bubble", "Extensions");
  exts.btn.id = "pouley-ext-btn";
  exts.btn.append(el("span", "peb-ic"), el("span", "peb-dot"));
  box.appendChild(dock);
  applyDockPosition(dock);

  let closeTimer = 0;
  const close = () => exts.root.removeAttribute("open");
  const row = (icon, name, onClick) => {
    const r = el("button", "peb-row");
    r.title = name;
    const img = el("img", "peb-row-ic");
    if (icon) img.src = icon;
    r.append(img, el("span", "peb-name", name));
    r.addEventListener("click", () => { close(); onClick(); });
    return r;
  };
  const fill = (panel, title, rows, foot) => {
    const list = el("div", "peb-list");
    list.append(...rows);
    panel.replaceChildren(el("div", "peb-title", title), list, ...(foot ? [foot] : []));
  };

  const renderExts = () => {
    const list = userExtensions(win);
    // Toujours visible : sans extension, la liste propose d'en ajouter.
    exts.root.hidden = false;
    exts.root.toggleAttribute("badged", list.some((e) => e.badge));
    const rows = list.map((e) => {
      const r = row(e.icon, e.name, () => runAction(win, e.id).catch((err) => dump(`[PouleyPwolu] extension : ${err}\n`)));
      if (e.badge) {
        const b = el("span", "peb-badge", e.badge.slice(0, 4));
        if (e.color) b.style.background = e.color;
        r.append(b);
      }
      // Clic droit : sa page dans le gestionnaire d'extensions (options, permissions).
      r.addEventListener("contextmenu", (ev) => {
        ev.preventDefault();
        close();
        win.BrowserAddonUI.openAddonsMgr("addons://detail/" + encodeURIComponent(e.id));
      });
      return r;
    });
    const manage = el("button", "peb-link", "Gérer");
    manage.addEventListener("click", () => { close(); win.BrowserAddonUI.openAddonsMgr("addons://list/extension"); });
    const add = el("button", "peb-link", "Ajouter");
    add.addEventListener("click", () => { close(); win.openTrustedLinkIn("https://addons.mozilla.org/fr/firefox/extensions/", "tab"); });
    const foot = el("div", "peb-foot");
    foot.append(manage, add);
    if (!rows.length) rows.push(el("div", "peb-empty", "Aucune extension pour l’instant. Ajoutes-en depuis addons.mozilla.org (uBlock Origin, Proton Pass…)."));
    fill(exts.panel, "Extensions", rows, foot);
  };
  dock._pouleyExts = renderExts;

  // Glisser les bulles : au-delà de 5 px, c'est un déplacement, pas un clic.
  let drag = null;
  let dragged = false;
  for (const b of [exts]) {
    b.btn.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      const r = dock.getBoundingClientRect();
      drag = { id: ev.pointerId, btn: b.btn, x: ev.clientX, y: ev.clientY, dx: ev.clientX - r.left, dy: ev.clientY - r.top, moving: false };
      dragged = false;
      // La souris peut passer sur la page pendant le glissement : la bulle la garde.
      try { b.btn.setPointerCapture(ev.pointerId); } catch {}
    });
    b.btn.addEventListener("click", (ev) => {
      if (dragged) { dragged = false; ev.preventDefault(); return; }
      const open = b.root.hasAttribute("open");
      close();
      if (open) return;
      renderExts();
      b.root.setAttribute("open", "true");
    });
  }
  win.addEventListener("pointermove", (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    if (!drag.moving) {
      if (Math.hypot(ev.clientX - drag.x, ev.clientY - drag.y) < 5) return;
      drag.moving = true;
      close();
      dock.setAttribute("dragging", "true");
    }
    const area = box.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const left = Math.min(area.width - d.width, Math.max(0, ev.clientX - area.left - drag.dx));
    const top = Math.min(area.height - d.height, Math.max(0, ev.clientY - area.top - drag.dy));
    dock.setAttribute("side", "free");
    dock.style.left = `${left}px`;
    dock.style.top = `${top}px`;
  });
  const drop = (ev) => {
    if (!drag || ev.pointerId !== drag.id) return;
    const moved = drag.moving;
    drag = null;
    if (!moved) return;
    dragged = true;
    dock.removeAttribute("dragging");
    const area = box.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    const side = d.left + d.width / 2 - area.left < area.width / 2 ? "left" : "right";
    const y = (d.top - area.top) / Math.max(1, area.height);
    Services.prefs.setStringPref(DOCK_PREF, `${side}:${y.toFixed(3)}`);
    applyDockPosition(dock);
  };
  win.addEventListener("pointerup", drop, true);
  win.addEventListener("pointercancel", drop, true);

  // Les listes se replient quand la souris s'en va (ou Échap, ou un changement d'onglet).
  dock.addEventListener("mouseleave", () => {
    win.clearTimeout(closeTimer);
    closeTimer = win.setTimeout(close, 700);
  });
  dock.addEventListener("mouseenter", () => win.clearTimeout(closeTimer));
  dock.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
  win.gBrowser.tabContainer.addEventListener("TabSelect", () => { close(); renderExts(); });
  renderExts();
}

function eachDock(fn) {
  for (const win of browserWindows()) {
    const dock = win.document.getElementById("pouley-dock");
    if (dock) fn(dock);
  }
}
const refreshExtBubbles = () => eachDock((d) => d._pouleyExts && d._pouleyExts());

// Extension ajoutée, retirée, activée ou désactivée : la bulle se met à jour. Les
// bulles déplacées dans une fenêtre se déplacent aussi dans les autres.
let bubbleListener = null;
function watchExtensions() {
  if (bubbleListener) return;
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const later = () => Services.tm.dispatchToMainThread(() => {
    refreshExtBubbles();
    // Le démarrage d'une extension prend un instant.
    lazy.setTimeout(refreshExtBubbles, 1500);
  });
  bubbleListener = { onInstalled: later, onUninstalled: later, onEnabled: later, onDisabled: later };
  AddonManager.addAddonListener(bubbleListener);
  Services.prefs.addObserver(DOCK_PREF, () => eachDock(applyDockPosition));
}

// Barre masquée : une zone invisible de 6 px au bord de la fenêtre. La souris la touche →
// la barre s'affiche aussitôt par-dessus la page (tout se passe dans la fenêtre du
// navigateur, sans aller-retour avec l'extension) ; elle repart quand la souris la quitte.
function installPeek(win) {
  const doc = win.document;
  if (doc.getElementById("pouley-hotzone")) return;
  const root = doc.documentElement;
  const zone = doc.createXULElement("box");
  zone.id = "pouley-hotzone";
  doc.getElementById("browser").appendChild(zone);
  let leaveTimer = 0;
  zone.addEventListener("mouseenter", () => {
    win.clearTimeout(leaveTimer);
    root.setAttribute("pouley-peek", "true");
  });
  const box = doc.getElementById("sidebar-box");
  box.addEventListener("mouseenter", () => win.clearTimeout(leaveTimer));
  box.addEventListener("mouseleave", () => {
    if (!root.hasAttribute("pouley-peek")) return;
    win.clearTimeout(leaveTimer);
    leaveTimer = win.setTimeout(() => root.removeAttribute("pouley-peek"), 250);
  });
}

async function showSidebar(win, open) {
  await whenReady(win);
  const sc = win.SidebarController;
  if (!sc) return;
  const root = win.document.documentElement;
  root.removeAttribute("pouley-peek");
  if (open) {
    root.removeAttribute("pouley-hidden");
    if (!sc.isOpen || sc.currentID !== SIDEBAR_ID) await sc.show(SIDEBAR_ID);
  } else if (sc.isOpen && sc.currentID === SIDEBAR_ID) {
    // On masque au lieu de fermer : la barre garde son état et se rouvre aussitôt.
    root.setAttribute("pouley-hidden", "true");
  }
}

// Barre du haut (ou petite barre d'une fenêtre flottante) : une page de l'extension dans
// un <browser> au-dessus de la page web, préparé comme les panneaux d'extension de
// Firefox (browser/base/content/webext-panels.js) pour qu'elle ait accès aux API.
async function setTopBar(win, extension, on, height, pageUrl) {
  const doc = win.document;
  let bar = doc.getElementById("pouley-topbar");
  if (!on) {
    doc.documentElement.removeAttribute("pouley-top");
    if (bar) bar.remove();
    return;
  }
  doc.documentElement.setAttribute(pageUrl ? "pouley-float" : "pouley-top", "true");
  if (pageUrl) doc.documentElement.removeAttribute("pouley-bar");
  const url = extension.baseURI.resolve(pageUrl || "sidebar/index.html?top=1");
  if (bar && bar.getAttribute("pouley-url") === url) {
    bar.style.height = bar.style.minHeight = `${height}px`;
    return;
  }
  if (bar) bar.remove();
  bar = doc.createXULElement("browser");
  bar.id = "pouley-topbar";
  bar.setAttribute("pouley-url", url);
  bar.setAttribute("type", "content");
  bar.setAttribute("disableglobalhistory", "true");
  bar.setAttribute("messagemanagergroup", "webext-browsers");
  bar.setAttribute("webextension-view-type", "sidebar");
  bar.setAttribute("context", "contentAreaContextMenu");
  bar.setAttribute("initialBrowsingContextGroupId", extension.policy.browsingContextGroupId);
  let ready = Promise.resolve();
  if (extension.remote) {
    bar.setAttribute("remote", "true");
    bar.setAttribute("remoteType", ChromeUtils.predictRemoteTypeForURI(Services.io.newURI(url), { window: win }));
    bar.setAttribute("maychangeremoteness", "true");
    ready = new Promise((resolve) => bar.addEventListener("XULFrameLoaderCreated", resolve, { once: true }));
  }
  bar.style.height = bar.style.minHeight = `${height}px`;
  const anchor = doc.getElementById("browser");
  anchor.parentNode.insertBefore(bar, anchor);
  const init = () => {
    lazy.ExtensionParent.apiManager.emit("extension-browser-inserted", bar);
    bar.messageManager.loadFrameScript("chrome://extensions/content/ext-browser-content.js", false, true);
    bar.messageManager.sendAsyncMessage("Extension:InitBrowser", {});
  };
  bar.addEventListener("DidChangeBrowserRemoteness", init);
  await ready;
  init();
  bar.fixupAndLoadURIString(url, { triggeringPrincipal: extension.principal });
}

// Extension (autre que PouleyPwolu) dont le panneau latéral est ouvert, ou "".
function openExtensionPanel(win) {
  const sc = win.SidebarController;
  if (!sc || !sc.isOpen || !sc.currentID || sc.currentID === SIDEBAR_ID) return "";
  for (const policy of WebExtensionPolicy.getActiveExtensions()) {
    if (ExtensionCommon.makeWidgetId(policy.id) + "-sidebar-action" === sc.currentID) return policy.id;
  }
  return "";
}

// ── Passage depuis la version Electron (docs/migration-electron.md) ──────────
const MIGRATION_DIR = () => PathUtils.join(Services.dirsvc.get("LocalAppData", Ci.nsIFile).path, "PouleyPwolu", "Migration");
const MAGIC = [0x50, 0x4c, 0x59, 0x31]; // « PLY1 »
// Le bac à sable des API n'a ni TextEncoder ni URL : on prend ceux d'une fenêtre.
const anyWindow = () => Services.wm.getMostRecentWindow(BROWSER_WINDOW) || Services.appShell.hiddenDOMWindow;
const encode = (str) => new (anyWindow().TextEncoder)().encode(str);
const decode = (bytes) => new (anyWindow().TextDecoder)().decode(bytes);

// Clé de migration protégée par DPAPI (portée utilisateur, entropie « pouley-migration »).
function dpapiUnprotect(bytes) {
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const crypt = ctypes.open("crypt32.dll");
  const kernel = ctypes.open("kernel32.dll");
  try {
    const BLOB = new ctypes.StructType("DATA_BLOB", [{ cbData: ctypes.uint32_t }, { pbData: ctypes.uint8_t.ptr }]);
    const unprotect = crypt.declare("CryptUnprotectData", ctypes.winapi_abi, ctypes.bool,
      BLOB.ptr, ctypes.voidptr_t, BLOB.ptr, ctypes.voidptr_t, ctypes.voidptr_t, ctypes.uint32_t, BLOB.ptr);
    const localFree = kernel.declare("LocalFree", ctypes.winapi_abi, ctypes.voidptr_t, ctypes.voidptr_t);
    const inBuf = ctypes.uint8_t.array(bytes.length)([...bytes]);
    const ent = encode("pouley-migration");
    const entBuf = ctypes.uint8_t.array(ent.length)([...ent]);
    const input = new BLOB(bytes.length, inBuf.addressOfElement(0));
    const entropy = new BLOB(ent.length, entBuf.addressOfElement(0));
    const out = new BLOB();
    if (!unprotect(input.address(), null, entropy.address(), null, null, 0, out.address())) {
      throw new Error("DPAPI : clé de migration illisible");
    }
    const view = ctypes.cast(out.pbData, ctypes.uint8_t.array(out.cbData).ptr).contents;
    const key = new Uint8Array(out.cbData);
    for (let i = 0; i < out.cbData; i++) key[i] = view[i];
    localFree(out.pbData);
    return key;
  } finally {
    crypt.close();
    kernel.close();
  }
}

// AES-256-GCM : PLY1 | IV (12) | tag (16) | données.
async function unseal(bytes, key, aad) {
  if (bytes.length < 32 || MAGIC.some((b, i) => bytes[i] !== b)) throw new Error("format inconnu");
  const subtle = anyWindow().crypto.subtle;
  const k = await subtle.importKey("raw", key, "AES-GCM", false, ["decrypt"]);
  const data = new Uint8Array(bytes.length - 32);
  data.set(bytes.subarray(32));
  const withTag = new Uint8Array(data.length + 16);
  withTag.set(data);
  withTag.set(bytes.subarray(16, 32), data.length);
  const plain = await subtle.decrypt(
    { name: "AES-GCM", iv: bytes.subarray(4, 16), additionalData: encode(aad), tagLength: 128 },
    k, withTag);
  return new Uint8Array(plain);
}

// CSV de Chrome (name,url,username,password,note) → identifiants Firefox.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...rest] = rows;
  if (!head) return [];
  const col = (name) => head.indexOf(name);
  return rest.filter((r) => r.length >= head.length).map((r) => ({
    origin: r[col("url")], username: r[col("username")], password: r[col("password")],
  }));
}

// ── Fenêtre Tor ─────────────────────────────────────────────────────────────
// tor.exe (dossier tor\ de l'installation) est lancé à la première fenêtre Tor. Tant que
// le mode Tor est actif, tout ce que chargent les fenêtres privées passe par Tor (proxy
// SOCKS, noms de domaine résolus par Tor) ; si Tor s'arrête, ces connexions échouent au
// lieu de partir en direct.
const TOR_PORT = 9155;
const tor = { proc: null, progress: 0, state: "off", error: "", filter: null, starting: null, active: false };

function torExe() {
  const dir = Services.dirsvc.get("GreBinD", Ci.nsIFile).path;
  return PathUtils.join(dir, "tor", "tor.exe");
}

function isPrivateChannel(channel) {
  try {
    return channel.loadInfo.originAttributes.privateBrowsingId > 0;
  } catch {
    return false;
  }
}

function registerTorFilter() {
  if (tor.filter) return;
  const pps = Cc["@mozilla.org/network/protocol-proxy-service;1"].getService(Ci.nsIProtocolProxyService);
  const info = pps.newProxyInfo("socks", "127.0.0.1", TOR_PORT, "", "",
    Ci.nsIProxyInfo.TRANSPARENT_PROXY_RESOLVES_HOST, 0xffffffff, null);
  tor.filter = {
    QueryInterface: ChromeUtils.generateQI(["nsIProtocolProxyChannelFilter"]),
    applyFilter(channel, defaultProxy, callback) {
      callback.onProxyFilterResult(tor.active && isPrivateChannel(channel) ? info : defaultProxy);
    },
  };
  pps.registerChannelFilter(tor.filter, 0);
}

async function startTor() {
  if (tor.state === "ready") return;
  if (tor.starting) return tor.starting;
  tor.starting = (async () => {
    const exe = torExe();
    if (!(await IOUtils.exists(exe))) throw new Error("tor.exe absent de cette version de PouleyPwolu");
    const data = PathUtils.join(Services.dirsvc.get("LocalAppData", Ci.nsIFile).path, "PouleyPwolu", "Tor");
    await IOUtils.makeDirectory(data, { createAncestors: true });
    registerTorFilter();
    tor.state = "starting";
    tor.progress = 0;
    tor.error = "";
    const { Subprocess } = ChromeUtils.importESModule("resource://gre/modules/Subprocess.sys.mjs");
    tor.proc = await Subprocess.call({
      command: exe,
      arguments: [
        "--SocksPort", `127.0.0.1:${TOR_PORT}`,
        "--DataDirectory", data,
        "--ClientOnly", "1",
        "--AvoidDiskWrites", "1",
        "--DormantCanceledByStartup", "1",
        "--Log", "notice stdout",
        // Tor s'arrête tout seul si PouleyPwolu se ferme ou plante.
        "--__OwningControllerProcess", String(Services.appinfo.processID),
      ],
      stderr: "stdout",
    });
    const proc = tor.proc;
    let ready;
    const isReady = new Promise((resolve) => { ready = resolve; });
    (async () => {
      let buffer = "";
      for (;;) {
        const chunk = await proc.stdout.readString();
        if (!chunk) break;
        buffer += chunk;
        let nl;
        while ((nl = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          const m = /Bootstrapped (\d+)%/.exec(line);
          if (m) {
            tor.progress = Number(m[1]);
            if (tor.progress >= 100) { tor.state = "ready"; ready(); }
          }
          if (/\[err\]/.test(line)) tor.error = line.replace(/^.*\[err\]\s*/, "");
        }
      }
      if (tor.proc === proc) {
        tor.proc = null;
        tor.state = "off";
        tor.progress = 0;
        ready();
      }
    })();
    await isReady;
    if (tor.state !== "ready") throw new Error(tor.error || "Tor n'a pas pu se connecter");
  })().finally(() => { tor.starting = null; });
  return tor.starting;
}

async function stopTor() {
  tor.active = false;
  const proc = tor.proc;
  tor.proc = null;
  tor.state = "off";
  tor.progress = 0;
  if (proc) await proc.kill(2000).catch(() => {});
}

function torWindows() {
  return browserWindows().filter((w) => w.document.documentElement.hasAttribute("pouley-tor"));
}

function hwndOf(win) {
  return win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow).nativeHandle;
}

// DuckDuckGo par défaut, en fenêtre normale comme privée (une seule fois : si l'utilisateur
// change ensuite de moteur dans les réglages de Firefox, on n'y touche plus).
async function setDefaultSearch() {
  if (Services.prefs.getBoolPref("pouleypwolu.search.set", false)) return;
  const { SearchService } = ChromeUtils.importESModule("resource://gre/modules/SearchService.sys.mjs");
  await SearchService.init();
  const ddg = SearchService.getEngineByName("DuckDuckGo");
  if (!ddg) return;
  await SearchService.setDefault(ddg, SearchService.CHANGE_REASON.USER);
  await SearchService.setDefaultPrivate(ddg, SearchService.CHANGE_REASON.USER);
  Services.prefs.setBoolPref("pouleypwolu.search.set", true);
}

// ── Langue du navigateur ────────────────────────────────────────────────────
// Langue des menus (paquets de langue de Mozilla fournis dans distribution\extensions) et
// langue annoncée aux sites (Accept-Language : Google répond alors dans cette langue).
const ACCEPT_LANGUAGES = {
  fr: "fr-FR, fr, en-US, en",
  "en-US": "en-US, en",
  "es-ES": "es-ES, es, en-US, en",
  de: "de-DE, de, en-US, en",
  it: "it-IT, it, en-US, en",
  "pt-BR": "pt-BR, pt, en-US, en",
  nl: "nl-NL, nl, en-US, en",
  ar: "ar, en-US, en",
};

async function ensureLangpack(code) {
  if (code === "en-US" || Services.locale.availableLocales.includes(code)) return true;
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const file = Services.dirsvc.get("XREAppDist", Ci.nsIFile);
  file.append("extensions");
  file.append(`langpack-${code}@firefox.mozilla.org.xpi`);
  if (!file.exists()) return false;
  const install = await AddonManager.getInstallForFile(file);
  await install.install();
  return Services.locale.availableLocales.includes(code);
}

// Au démarrage : un paquet de langue fourni (distribution\extensions) plus récent que
// celui du profil est installé par-dessus. Firefox ne le fait que si son numéro de build
// change, pas quand seul le paquet de PouleyPwolu est mis à jour.
async function syncLangpacks() {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const dir = Services.dirsvc.get("XREAppDist", Ci.nsIFile);
  dir.append("extensions");
  if (!dir.exists()) return;
  let replaced = false;
  for (const file of dir.directoryEntries) {
    const m = /^(langpack-.+@firefox\.mozilla\.org)\.xpi$/.exec(file.leafName);
    if (!m) continue;
    const install = await AddonManager.getInstallForFile(file);
    if (!install || !install.addon) continue;
    const current = await AddonManager.getAddonByID(m[1]);
    if (current && Services.vc.compare(install.addon.version, current.version) <= 0) continue;
    await install.install();
    replaced = true;
  }
  // Le cache de démarrage garde les textes déjà traduits (titre « Mozilla Firefox ») :
  // on l'invalide pour que le prochain démarrage prenne la nouvelle marque.
  if (replaced) Services.obs.notifyObservers(null, "startupcache-invalidate");
}

async function setLanguage(code) {
  if (!ACCEPT_LANGUAGES[code]) throw new Error(`Langue inconnue : ${code}`);
  const ok = await ensureLangpack(code);
  if (ok) Services.locale.requestedLocales = code === "en-US" ? ["en-US"] : [code, "en-US"];
  Services.prefs.setStringPref("intl.accept_languages", ACCEPT_LANGUAGES[code]);
  return { menus: ok, appLocale: Services.locale.appLocaleAsBCP47 };
}

// Zones de déplacement de la fenêtre : la page de la barre indique où elle est vide (haut de
// la barre, entre les boutons) ; on y pose des zones invisibles de la fenêtre du navigateur
// qui se comportent comme une vraie barre de titre Windows (glisser vers un autre écran,
// double-clic pour agrandir, ancrage Aero Snap).
function setDragRegions(win, rects, where) {
  const doc = win.document;
  // Petite barre du haut (fenêtre en superposition, barre en haut) : zones posées
  // par-dessus, à la position de la barre dans la fenêtre.
  if (where === "top") {
    for (const old of doc.querySelectorAll(".pouley-drag-top")) old.remove();
    const bar = doc.getElementById("pouley-topbar");
    if (!bar) return;
    const base = bar.getBoundingClientRect();
    for (const r of rects) {
      if (!(r.width > 4 && r.height > 4)) continue;
      const zone = doc.createXULElement("box");
      zone.className = "pouley-drag-top";
      zone.style.left = `${Math.round(base.x + r.x)}px`;
      zone.style.top = `${Math.round(base.y + r.y)}px`;
      zone.style.width = `${Math.round(r.width)}px`;
      zone.style.height = `${Math.round(r.height)}px`;
      bar.parentNode.appendChild(zone);
    }
    return;
  }
  const box = doc.getElementById("sidebar-box");
  if (!box) return;
  for (const old of box.querySelectorAll(".pouley-drag")) old.remove();
  const browser = doc.getElementById("sidebar");
  const offset = browser ? browser.getBoundingClientRect() : { x: 0, y: 0 };
  const base = box.getBoundingClientRect();
  for (const r of rects) {
    if (!(r.width > 4 && r.height > 4)) continue;
    const zone = doc.createXULElement("box");
    zone.className = "pouley-drag";
    zone.style.left = `${Math.round(offset.x - base.x + r.x)}px`;
    zone.style.top = `${Math.round(offset.y - base.y + r.y)}px`;
    zone.style.width = `${Math.round(r.width)}px`;
    zone.style.height = `${Math.round(r.height)}px`;
    box.appendChild(zone);
  }
}

// Déplacer la fenêtre depuis la barre PouleyPwolu (une page web ne peut pas le faire) :
// Windows reçoit « clic sur la barre de titre », comme le ferait le cadre de la fenêtre.
function startWindowDrag(win) {
  const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
  const user32 = ctypes.open("user32.dll");
  try {
    const release = user32.declare("ReleaseCapture", ctypes.winapi_abi, ctypes.bool);
    const post = user32.declare("PostMessageW", ctypes.winapi_abi, ctypes.bool,
      ctypes.voidptr_t, ctypes.uint32_t, ctypes.uintptr_t, ctypes.intptr_t);
    const hwnd = ctypes.voidptr_t(ctypes.UInt64(hwndOf(win)));
    release();
    post(hwnd, 0x00a1 /* WM_NCLBUTTONDOWN */, 2 /* HTCAPTION */, 0);
  } finally {
    user32.close();
  }
}

this.pouleyPrivate = class extends ExtensionAPI {
  onShutdown() {}

  getAPI(context) {
    const { extension } = context;
    const tabManager = extension.tabManager;

    // Chaque nouvelle fenêtre reçoit la barre PouleyPwolu.
    const onWindow = {
      observe(subject, topic) {
        if (topic !== "browser-delayed-startup-finished") return;
        prepareWindow(subject);
      },
    };

    return {
      pouleyPrivate: {
        async init() {
          if (extension.id !== ADDON_ID) throw new context.cloneScope.Error("Réservé à PouleyPwolu");
          // Manifest V3 : Firefox n'accorde pas d'office l'accès aux sites ; l'extension
          // intégrée en a besoin pour son bouclier, son inspecteur et ses raccourcis.
          try {
            const origins = extension.manifest.host_permissions || [];
            const missing = origins.filter((o) => !extension.allowedOrigins.subsumes(new MatchPattern(o === "<all_urls>" ? "*://*/*" : o)));
            if (missing.length) {
              await lazy.ExtensionPermissions.add(extension.id, { permissions: [], origins }, extension);
            }
            loadSheet();
            // addons.mozilla.org ne propose « Ajouter » qu'à un navigateur dont l'identité
            // contient « Firefox/ » (sinon : « Télécharger Firefox »). Réglage par défaut
            // (engine/prefs) appliqué aussi ici, pour les moteurs compilés avant lui.
            Services.prefs.getDefaultBranch("").setBoolPref("general.useragent.compatMode.firefox", true);
            for (const win of browserWindows()) prepareWindow(win);
            setDefaultSearch().catch(() => {});
            syncLangpacks().catch((err) => dump(`[PouleyPwolu] langues : ${err}\n`));
            Services.obs.addObserver(onWindow, "browser-delayed-startup-finished");
            context.callOnClose({ close: () => Services.obs.removeObserver(onWindow, "browser-delayed-startup-finished") });
            return true;
          } catch (err) {
            // Message lisible côté extension (sinon Firefox le remplace par « unexpected error »).
            dump(`[PouleyPwolu] init : ${err}\n${err && err.stack}\n`);
            throw new ExtensionUtils.ExtensionError(String(err && err.message || err));
          }
        },

        async setSidebar(windowId, open) {
          loadSheet();
          for (const win of windowsFor(context, windowId)) await showSidebar(win, open);
        },

        async setSidebarLayout(windowId, right, width) {
          // La barre latérale de Firefox est du même côté dans toutes les fenêtres.
          Services.prefs.setBoolPref("sidebar.position_start", !right);
          const win = oneWindow(context, windowId);
          const box = win.document.getElementById("sidebar-box");
          if (box) {
            box.setAttribute("pouley-width", "true");
            box.style.setProperty("--pouley-sidebar-width", `${width}px`);
            box.style.width = `${width}px`;
          }
        },

        async setTopBar(windowId, on, height, page) {
          loadSheet();
          const win = oneWindow(context, windowId);
          await whenReady(win);
          await setTopBar(win, extension, on, height, page);
        },

        async setLanguage(code) {
          try {
            return await setLanguage(code);
          } catch (err) {
            throw new ExtensionUtils.ExtensionError(String(err && err.message || err));
          }
        },

        async setDragRegions(windowId, rects, where) {
          setDragRegions(oneWindow(context, windowId), rects || [], where || "sidebar");
        },

        async startWindowDrag(windowId) {
          startWindowDrag(oneWindow(context, windowId));
        },

        async focusPage(windowId) {
          const win = oneWindow(context, windowId);
          win.gBrowser.selectedBrowser.focus();
        },

        async setAlwaysOnTop(windowId, on) {
          const win = oneWindow(context, windowId);
          win.document.documentElement.setAttribute("zlevel", on ? "top" : "normal");
          const xulWin = win.docShell.treeOwner.QueryInterface(Ci.nsIInterfaceRequestor).getInterface(Ci.nsIAppWindow);
          xulWin.zLevel = on ? Ci.nsIAppWindow.highestZ : Ci.nsIAppWindow.normalZ;
        },

        async setWindowOpacity(windowId, opacity) {
          const win = oneWindow(context, windowId);
          win.document.documentElement.style.opacity = String(Math.max(0.25, Math.min(1, opacity)));
        },

        async setWindowMaterial(material) {
          // Mica (Windows 11) : le fond de la fenêtre laisse voir le bureau, teinté.
          Services.prefs.setBoolPref("widget.windows.mica", material !== "none");
          Services.prefs.setIntPref("widget.windows.mica.toplevel-backdrop", material === "acrylic" ? 3 : 2);
        },

        async getDefaultBrowser() {
          try {
            const shell = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIShellService);
            return shell.isDefaultBrowser(false, false) ? "default" : "available";
          } catch {
            return null;
          }
        },

        async setDefaultBrowser() {
          try {
            const shell = Cc["@mozilla.org/browser/shell-service;1"].getService(Ci.nsIShellService);
            shell.setDefaultBrowser(false);
            return shell.isDefaultBrowser(false, false) ? "default" : "available";
          } catch {
            return null;
          }
        },

        async getMemoryInfo() {
          const sys = Services.sysinfo;
          const capacity = sys.getProperty("memsize");
          let available = capacity;
          try {
            // Windows : mémoire physique disponible, comme chrome.system.memory.
            const { ctypes } = ChromeUtils.importESModule("resource://gre/modules/ctypes.sys.mjs");
            const kernel = ctypes.open("kernel32.dll");
            const MEMORYSTATUSEX = new ctypes.StructType("MEMORYSTATUSEX", [
              { dwLength: ctypes.uint32_t }, { dwMemoryLoad: ctypes.uint32_t },
              { ullTotalPhys: ctypes.uint64_t }, { ullAvailPhys: ctypes.uint64_t },
              { ullTotalPageFile: ctypes.uint64_t }, { ullAvailPageFile: ctypes.uint64_t },
              { ullTotalVirtual: ctypes.uint64_t }, { ullAvailVirtual: ctypes.uint64_t },
              { ullAvailExtendedVirtual: ctypes.uint64_t },
            ]);
            const fn = kernel.declare("GlobalMemoryStatusEx", ctypes.winapi_abi, ctypes.bool, MEMORYSTATUSEX.ptr);
            const st = new MEMORYSTATUSEX();
            st.dwLength = MEMORYSTATUSEX.size;
            if (fn(st.address())) available = Number(st.ullAvailPhys.toString());
            kernel.close();
          } catch {}
          return { capacity, availableCapacity: available };
        },

        async setClearOnExit(on) {
          Services.prefs.setBoolPref("privacy.sanitize.sanitizeOnShutdown", on);
          Services.prefs.setBoolPref("privacy.clearOnShutdown_v2.cookiesAndStorage", on);
        },

        async getJavascript(origin) {
          if (!origin) return true;
          const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
          return Services.perms.testExactPermissionFromPrincipal(principal, "pouley-javascript") !== Services.perms.DENY_ACTION;
        },

        async setJavascript(origin, allow) {
          if (!origin) return;
          const principal = Services.scriptSecurityManager.createContentPrincipalFromOrigin(origin);
          if (allow) Services.perms.removeFromPrincipal(principal, "pouley-javascript");
          else Services.perms.addFromPrincipal(principal, "pouley-javascript", Services.perms.DENY_ACTION);
          // Firefox n'a pas de réglage JavaScript par site : on l'applique aux onglets
          // de ce site (et à ceux qui y naviguent, voir content/raccourcis.js).
          for (const win of browserWindows()) {
            for (const tab of win.gBrowser.tabs) {
              const b = tab.linkedBrowser;
              let o = "";
              try { o = b.currentURI.prePath; } catch {}
              if (o === origin && b.browsingContext) {
                b.browsingContext.allowJavascript = allow;
                b.reload();
              }
            }
          }
        },

        async openInternal({ url, windowId, tabId, active }) {
          const principal = Services.scriptSecurityManager.getSystemPrincipal();
          if (tabId != null) {
            const tab = tabManager.get(tabId).nativeTab;
            tab.linkedBrowser.fixupAndLoadURIString(url, { triggeringPrincipal: principal });
            if (active !== false) tab.ownerGlobal.gBrowser.selectedTab = tab;
            return tabId;
          }
          const win = windowId != null ? oneWindow(context, windowId) : Services.wm.getMostRecentWindow(BROWSER_WINDOW);
          const tab = win.gBrowser.addTab(url, { triggeringPrincipal: principal, inBackground: active === false });
          if (active !== false) win.gBrowser.selectedTab = tab;
          return tabManager.getWrapper(tab).id;
        },

        async getFavicon(pageUrl, size) {
          try {
            const favicon = await lazy.PlacesUtils.favicons.getFaviconForPage(Services.io.newURI(pageUrl), size || 32);
            return favicon ? favicon.dataURI.spec : "";
          } catch {
            return "";
          }
        },

        async getExtensionPanel(windowId) {
          return openExtensionPanel(oneWindow(context, windowId));
        },

        async closeExtensionPanel(windowId) {
          const win = oneWindow(context, windowId);
          if (openExtensionPanel(win)) await win.SidebarController.show(SIDEBAR_ID);
        },

        async runExtensionAction({ extensionId, windowId }) {
          return runAction(oneWindow(context, windowId), extensionId);
        },

        async createSplit(tabIds) {
          const tabs = tabIds.map((id) => tabManager.get(id).nativeTab);
          const gBrowser = tabs[0].ownerGlobal.gBrowser;
          const view = gBrowser.addTabSplitView(tabs, { insertBefore: tabs[0] });
          if (!view) throw new context.cloneScope.Error("Vue côte à côte impossible");
          gBrowser.selectedTab = tabs[0];
          return view.splitViewId;
        },

        async unsplit(splitViewId) {
          for (const win of browserWindows()) {
            for (const view of win.document.querySelectorAll("tab-split-view-wrapper")) {
              if (view.splitViewId === splitViewId) view.unsplitTabs();
            }
          }
        },

        // ── Fenêtre Tor
        async torStatus() {
          return { state: tor.state, progress: tor.progress, error: tor.error, windows: torWindows().length };
        },

        async openTorWindow() {
          await startTor();
          tor.active = true;
          const opener = Services.wm.getMostRecentWindow(BROWSER_WINDOW);
          const win = opener.OpenBrowserWindow({ private: true });
          await new Promise((resolve) => win.addEventListener("load", resolve, { once: true }));
          win.document.documentElement.setAttribute("pouley-tor", "true");
          // Page d'accueil Tor de PouleyPwolu à la place de celle de Firefox.
          await whenReady(win);
          win.gBrowser.selectedBrowser.fixupAndLoadURIString(extension.baseURI.resolve("pages/tor-accueil.html"), {
            triggeringPrincipal: extension.principal,
          });
          // Dernière fenêtre Tor fermée : Tor s'arrête et les fenêtres privées repassent en direct.
          win.addEventListener("unload", () => {
            Services.tm.dispatchToMainThread(() => { if (!torWindows().length) stopTor(); });
          }, { once: true });
          return context.extension.windowManager.getWrapper(win).id;
        },

        async stopTor() {
          for (const win of torWindows()) win.close();
          await stopTor();
        },

        async getMigrationState() {
          const dir = MIGRATION_DIR();
          const manifestPath = PathUtils.join(dir, "manifest.json");
          if (!(await IOUtils.exists(manifestPath))) return "";
          const manifest = await IOUtils.readJSON(manifestPath);
          if (manifest.importe) return "";
          const key = dpapiUnprotect(await IOUtils.read(PathUtils.join(dir, "cle.dpapi")));
          try {
            const state = await unseal(await IOUtils.read(PathUtils.join(dir, manifest.etat || "etat.bin")), key, "pouley-migration-etat");
            if (manifest.motsDePasse) {
              const file = PathUtils.join(dir, manifest.motsDePasse);
              const csv = decode(await unseal(await IOUtils.read(file), key, "pouley-migration-mdp"));
              const { LoginHelper } = ChromeUtils.importESModule("resource://gre/modules/LoginHelper.sys.mjs");
              const logins = parseCsv(csv).filter((l) => l.origin && l.password).map((l) => {
                let origin = l.origin;
                try { origin = new (anyWindow().URL)(l.origin).origin; } catch {}
                return { origin, formActionOrigin: origin, httpRealm: null, username: l.username || "", password: l.password, usernameElement: "", passwordElement: "" };
              });
              if (logins.length) await LoginHelper.maybeImportLogins(logins);
              // Les mots de passe déchiffrables ne restent pas sur le disque.
              await IOUtils.write(file, new Uint8Array((await IOUtils.stat(file)).size));
              await IOUtils.remove(file);
            }
            return decode(state);
          } finally {
            key.fill(0);
          }
        },

        async markMigrationImported() {
          const manifestPath = PathUtils.join(MIGRATION_DIR(), "manifest.json");
          if (!(await IOUtils.exists(manifestPath))) return;
          const manifest = await IOUtils.readJSON(manifestPath);
          manifest.importe = new Date().toISOString();
          await IOUtils.writeJSON(manifestPath, manifest);
        },

        async getExtensionBadges(windowId) {
          const win = oneWindow(context, windowId);
          const tab = win.gBrowser.selectedTab;
          const global = lazy.ExtensionParent.apiManager.global;
          const out = [];
          if (!global.browserActionFor) return out;
          for (const policy of WebExtensionPolicy.getActiveExtensions()) {
            const ext = policy.extension;
            if (!ext || ext.id === ADDON_ID) continue;
            const action = global.browserActionFor(ext);
            if (!action) continue;
            const text = action.action.getProperty(tab, "badgeText") || "";
            if (!text) continue;
            const c = action.action.getProperty(tab, "badgeBackgroundColor");
            const color = Array.isArray(c) ? `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${(c[3] ?? 255) / 255})` : "";
            out.push({ extensionId: ext.id, text, color });
          }
          return out;
        },

      },
    };
  }
};
