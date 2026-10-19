// Préchargé dans chaque onglet (monde isolé, sandbox). Il pose des sondes dans
// le monde de la page pour repérer les techniques d'empreinte numérique
// (canvas, WebGL, audio, polices…) et les signale au navigateur. Il ne
// modifie pas le comportement des fonctions : il observe seulement.
const { ipcRenderer, contextBridge, webFrame } = require('electron');

// Onglet réveillé (ou navigateur relancé) : on rend à la page le sessionStorage
// et le window.name qu'elle avait, pour qu'elle reste connectée.
try {
  const back = ipcRenderer.sendSync('page:session-restore');
  if (back) {
    for (const [k, v] of back.items) sessionStorage.setItem(k, v);
    if (back.name) window.name = back.name;
  }
} catch {}

const token = 'pouley-' + Math.random().toString(36).slice(2) + Date.now().toString(36);

function probes(token) {
  const seen = Object.create(null);
  const post = (kind) => {
    if (seen[kind]) return;
    seen[kind] = 1;
    emit(kind, false);
  };
  const count = (kind) => emit(kind, true);
  // Événement DOM au nom aléatoire : invisible pour la page, qui ne connaît pas le nom.
  function emit(kind, isCount) {
    try { document.dispatchEvent(new CustomEvent(token, { detail: (isCount ? '+' : '') + kind })); } catch {}
  }
  const disguise = (fn, orig) => {
    try {
      Object.defineProperty(fn, 'name', { value: orig.name });
      Object.defineProperty(fn, 'length', { value: orig.length });
      fn.toString = Function.prototype.toString.bind(orig);
    } catch {}
    return fn;
  };
  const wrap = (proto, prop, onCall) => {
    if (!proto) return;
    const orig = proto[prop];
    if (typeof orig !== 'function') return;
    proto[prop] = disguise(function (...args) {
      try { onCall.apply(this, args); } catch {}
      return orig.apply(this, args);
    }, orig);
  };
  const wrapCtor = (name, kind) => {
    const Orig = window[name];
    if (typeof Orig !== 'function') return;
    window[name] = new Proxy(Orig, {
      construct(target, args, newTarget) {
        post(kind);
        return Reflect.construct(target, args, newTarget);
      },
    });
  };

  // Lire les pixels d'un canvas qu'on vient de dessiner = empreinte classique.
  const canvasRead = function () {
    const c = this && (this.canvas || this);
    if (c && c.width > 16 && c.height > 16) post('canvas');
  };
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype, 'toDataURL', canvasRead);
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype, 'toBlob', canvasRead);
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'getImageData', function (x, y, w, h) {
    if (w > 16 && h > 16 && this.canvas && !this.canvas.isConnected) post('canvas');
  });

  // Demander le nom exact de la carte graphique.
  const glParam = function (p) {
    if (p === 37445 || p === 37446) post('webgl');
  };
  wrap(window.WebGLRenderingContext && WebGLRenderingContext.prototype, 'getParameter', glParam);
  wrap(window.WebGL2RenderingContext && WebGL2RenderingContext.prototype, 'getParameter', glParam);

  wrapCtor('OfflineAudioContext', 'audio');
  wrapCtor('webkitOfflineAudioContext', 'audio');
  wrapCtor('RTCPeerConnection', 'webrtc');

  // Énumération des polices : beaucoup de mesures de texte dans des polices différentes.
  const fontsTried = new Set();
  wrap(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'measureText', function () {
    fontsTried.add(this.font);
    if (fontsTried.size > 30) post('fonts');
  });
  if (document.fonts && document.fonts.check) {
    const checked = new Set();
    wrap(Object.getPrototypeOf(document.fonts), 'check', function (font) {
      checked.add(font);
      if (checked.size > 30) post('fonts');
    });
  }

  const Notif = window.Notification;
  if (typeof Notif === 'function') {
    window.Notification = new Proxy(Notif, {
      construct(target, args, newTarget) {
        const [title, opts] = args;
        count('notify');
        return Reflect.construct(target, [title, { ...(opts || {}), silent: true }], newTarget);
      },
    });
  }
  const SWR = window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype;
  if (SWR && typeof SWR.showNotification === 'function') {
    const orig = SWR.showNotification;
    SWR.showNotification = disguise(function (title, opts) {
      count('notify');
      return orig.call(this, title, { ...(opts || {}), silent: true });
    }, orig);
  }

  wrap(window.Navigator && Navigator.prototype, 'getBattery', () => post('battery'));
  wrap(window.Navigator && Navigator.prototype, 'sendBeacon', () => count('beacon'));
  wrap(window.Clipboard && Clipboard.prototype, 'readText', () => post('clipboard'));
  wrap(window.Clipboard && Clipboard.prototype, 'read', () => post('clipboard'));
}

// Connexion Google : le vrai Google Chrome a chrome.app, chrome.csi et
// chrome.loadTimes, que les scripts anti-robots de Google vérifient. Electron
// ne les a pas : on les ajoute sur la page de connexion seulement, avec un
// code présenté comme natif. Voir CHROME_METADATA dans main.js.
function chromeObjects() {
  const natives = new WeakMap();
  const toString = Function.prototype.toString;
  const patched = new Proxy(toString, {
    apply(target, self, args) { return natives.has(self) ? natives.get(self) : Reflect.apply(target, self, args); },
  });
  natives.set(patched, 'function toString() { [native code] }');
  Function.prototype.toString = patched;
  const native = (name, fn) => { natives.set(fn, `function ${name}() { [native code] }`); Object.defineProperty(fn, 'name', { value: name }); return fn; };
  const t = () => performance.timeOrigin / 1000;
  const nav = () => performance.getEntriesByType('navigation')[0] || {};
  const c = window.chrome || {};
  if (!c.app) {
    c.app = {
      isInstalled: false,
      InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
      RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
      getDetails: native('getDetails', () => null),
      getIsInstalled: native('getIsInstalled', () => false),
      installState: native('installState', (cb) => { if (typeof cb === 'function') setTimeout(() => cb('not_installed'), 0); }),
      runningState: native('runningState', () => 'cannot_run'),
    };
  }
  if (!c.csi) {
    c.csi = native('csi', () => ({ startE: Math.round(performance.timeOrigin), onloadT: Math.round(performance.timeOrigin + (nav().domContentLoadedEventEnd || 0)), pageT: performance.now(), tran: 15 }));
  }
  if (!c.loadTimes) {
    c.loadTimes = native('loadTimes', () => {
      const n = nav();
      const proto = n.nextHopProtocol || 'h2';
      return {
        requestTime: t() + (n.requestStart || 0) / 1000, startLoadTime: t(), commitLoadTime: t() + (n.responseStart || 0) / 1000,
        finishDocumentLoadTime: t() + (n.domContentLoadedEventEnd || 0) / 1000, finishLoadTime: t() + (n.loadEventEnd || 0) / 1000,
        firstPaintTime: t() + ((performance.getEntriesByName('first-paint')[0] || {}).startTime || 0) / 1000, firstPaintAfterLoadTime: 0,
        navigationType: 'Other', wasFetchedViaSpdy: proto === 'h2' || proto === 'h3', wasNpnNegotiated: true,
        npnNegotiatedProtocol: proto, wasAlternateProtocolAvailable: false, connectionInfo: proto,
      };
    });
  }
  window.chrome = c;
}
if (location.hostname === 'accounts.google.com') {
  try { contextBridge.executeInMainWorld({ func: chromeObjects }); } catch {}
}

try {
  contextBridge.executeInMainWorld({ func: probes, args: [token] });
} catch {
  webFrame.executeJavaScript(`(${probes.toString()})(${JSON.stringify(token)})`).catch(() => {});
}

document.addEventListener(token, (event) => {
  const d = String(event.detail || '');
  ipcRenderer.send('page:probe', d.replace(/^[+]/, ''), d.startsWith('+'));
});

// ─────────────────────────────────────────────────────────────────────────────
// Coffre à mots de passe. Une petite clé apparaît dans les champs de
// connexion ; rien n'est rempli sans ton clic. Le navigateur vérifie lui-même
// le site qui demande : une page ne peut obtenir que ses propres identifiants.
(function vaultBridge() {
  if (!/^https?:$/.test(location.protocol)) return;
  const USERISH = /user|email|e-mail|login|mail|identifiant|account|compte|pseudo|phone|tel/i;
  const SUBMITISH = /connex|connect|log ?in|sign ?in|sign ?up|continu|suivant|next|valider|inscri|créer|creer|register|submit|envoyer|enregistrer|ok\b/i;
  let host = null;
  let root = null;
  let field = null;
  let lastUser = '';
  let lastSent = 0;

  const isPw = (el) => el instanceof HTMLInputElement && el.type === 'password' && !el.disabled && !el.readOnly;
  const isText = (el) => el instanceof HTMLInputElement && ['text', 'email', 'tel', ''].includes(el.type) && !el.disabled && !el.readOnly;
  const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 24 && r.height > 12; };
  const passwords = () => [...document.querySelectorAll('input[type=password]')].filter(shown);

  function userFieldFor(pw) {
    const scope = pw.form || document;
    const before = [...scope.querySelectorAll('input')].filter((i) => isText(i) && shown(i) && (i.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING));
    before.reverse();
    return before.find((i) => USERISH.test([i.name, i.id, i.autocomplete, i.placeholder, i.type].join(' '))) || before[0] || null;
  }
  const looksLikeUser = (el) => isText(el) && (USERISH.test([el.name, el.id, el.autocomplete, el.placeholder, el.type].join(' ')) || passwords().some((p) => userFieldFor(p) === el));

  // Le « setter » natif fait réagir les sites React / Vue comme une vraie saisie.
  function setValue(input, value) {
    input.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ── Petite clé dans le champ + menu (dans une ombre fermée : la page ne la lit pas)
  function ensureChip() {
    if (host && host.isConnected) return;
    host = document.createElement('pouley-cle');
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:0;left:0;display:none';
    root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = [
      '<style>',
      ':host{all:initial}',
      '*{box-sizing:border-box;font-family:Onest,"Segoe UI",system-ui,sans-serif}',
      '.chip{width:24px;height:24px;border-radius:7px;border:0;cursor:pointer;display:grid;place-items:center;background:#111113;color:#FFE100;box-shadow:0 1px 4px rgba(0,0,0,.35);padding:0}',
      '.chip:hover{background:#fe7146;color:#111113}',
      '.chip svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}',
      '.menu{position:absolute;top:30px;right:0;min-width:240px;max-width:320px;background:#18181b;color:#f4f4f5;border-radius:14px;border:1px solid rgba(255,255,255,.08);box-shadow:0 18px 40px rgba(0,0,0,.45);padding:6px;display:none}',
      '.menu.on{display:block}',
      '.head{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#a1a1aa;padding:6px 8px 4px}',
      '.head b{color:#FFE100;font-weight:700}',
      'button.it{all:unset;display:flex;flex-direction:column;gap:1px;width:100%;box-sizing:border-box;padding:8px 10px;border-radius:9px;cursor:pointer;font-size:13px}',
      'button.it:hover,button.it:focus{background:rgba(254,113,70,.16)}',
      'button.it small{color:#a1a1aa;font-size:11px}',
      'button.it.alt{color:#fe7146}',
      '.empty{padding:8px 10px;font-size:12px;line-height:1.4;color:#a1a1aa}',
      '</style>',
      '<button class="chip" title="Coffre PouleyPwolu"><svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/></svg></button>',
      '<div class="menu"></div>',
    ].join('');
    const chip = root.querySelector('.chip');
    chip.addEventListener('mousedown', (e) => e.preventDefault());
    chip.addEventListener('click', (e) => { if (e.isTrusted) toggleMenu(); });
    root.querySelector('.menu').addEventListener('mousedown', (e) => e.preventDefault());
    document.documentElement.appendChild(host);
  }

  function place() {
    if (!host || !field || !field.isConnected || !shown(field)) return hideChip();
    const r = field.getBoundingClientRect();
    host.style.display = 'block';
    host.style.left = Math.round(r.right - 30) + 'px';
    host.style.top = Math.round(r.top + (r.height - 24) / 2) + 'px';
  }
  function hideChip() {
    if (!host) return;
    host.style.display = 'none';
    root.querySelector('.menu').classList.remove('on');
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  async function toggleMenu() {
    const menu = root.querySelector('.menu');
    if (menu.classList.contains('on')) { menu.classList.remove('on'); return; }
    const res = await ipcRenderer.invoke('page:cred-query');
    const target = field;
    const pwField = isPw(target) ? target : passwords()[0] || null;
    const parts = ['<div class="head"><b>Coffre</b> PouleyPwolu</div>'];
    if (res.state === 'locked') parts.push('<button class="it" data-act="unlock">Déverrouiller le coffre<small>Mot de passe maître ou Windows Hello</small></button>');
    if (res.state === 'open') {
      if (res.items.length) for (const it of res.items) parts.push('<button class="it" data-id="' + esc(it.id) + '">' + esc(it.username || '(sans identifiant)') + '<small>Remplir</small></button>');
      else parts.push('<div class="empty">Aucun identifiant enregistré pour ce site.</div>');
    }
    if (res.state === 'none') parts.push('<div class="empty">Connecte-toi normalement : PouleyPwolu te proposera de ranger le mot de passe dans un coffre chiffré.</div>');
    if (pwField) parts.push('<button class="it alt" data-act="gen">Générer un mot de passe solide<small>20 caractères, impossible à deviner</small></button>');
    menu.innerHTML = parts.join('');
    menu.classList.add('on');
    menu.querySelectorAll('button.it').forEach((b) => b.addEventListener('click', async (e) => {
      if (!e.isTrusted) return;
      menu.classList.remove('on');
      if (b.dataset.act === 'unlock') return ipcRenderer.send('page:cred-unlock');
      if (b.dataset.act === 'gen') {
        const pw = await ipcRenderer.invoke('page:cred-generate');
        if (!pw) return;
        // Remplit aussi le champ de confirmation, pas l'ancien mot de passe.
        const scope = pwField.form || document;
        for (const p of [...scope.querySelectorAll('input[type=password]')].filter(shown)) {
          if (/current|actuel|old|ancien/i.test(p.autocomplete + p.name + p.id)) continue;
          setValue(p, pw);
        }
        return;
      }
      const cred = await ipcRenderer.invoke('page:cred-fill', b.dataset.id);
      if (!cred) return;
      const pw = isPw(target) ? target : passwords()[0];
      const user = isPw(target) ? (pw && userFieldFor(pw)) : (isText(target) ? target : null);
      if (user && cred.username) setValue(user, cred.username);
      if (pw) setValue(pw, cred.password);
      lastUser = cred.username;
    }));
  }

  document.addEventListener('focusin', (e) => {
    const el = e.target;
    if (!(isPw(el) || looksLikeUser(el))) return;
    field = el;
    ipcRenderer.invoke('page:cred-query').then((res) => {
      if (field !== el || !res || res.state === 'off') return;
      if (res.state === 'none' && !isPw(el)) return;
      ensureChip();
      place();
    });
  }, true);
  document.addEventListener('focusout', () => setTimeout(() => {
    if (!field || document.activeElement === field) return;
    if (root && root.querySelector('.menu.on')) return;
    hideChip();
  }, 150), true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  ipcRenderer.on('vault:changed', () => { if (root) root.querySelector('.menu').classList.remove('on'); });

  // ── Proposer d'enregistrer après une connexion
  document.addEventListener('input', (e) => { if (looksLikeUser(e.target)) lastUser = e.target.value; }, true);
  function capture() {
    const filled = passwords().filter((p) => p.value);
    if (!filled.length || Date.now() - lastSent < 800) return;
    lastSent = Date.now();
    const pw = filled[filled.length - 1]; // formulaire « ancien / nouveau » : le nouveau
    const user = userFieldFor(filled[0]);
    ipcRenderer.send('page:cred-submit', { username: (user && user.value) || lastUser || '', password: pw.value });
  }
  document.addEventListener('submit', capture, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target instanceof HTMLInputElement) capture(); }, true);
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element && e.target.closest('button, input[type=submit], [role=button]');
    if (!b) return;
    if (b.type === 'submit' || SUBMITISH.test((b.textContent || b.value || '') + ' ' + (b.getAttribute('aria-label') || ''))) capture();
  }, true);
})();

// ─────────────────────────────────────────────────────────────────────────────
// Stylo : écrire et dessiner sur toute la page (elle défile avec le dessin),
// puis enregistrer une capture d'écran. Le dessin est un SVG posé sur la page,
// dans une ombre fermée : la page ne peut ni le lire ni le modifier.
(() => {
  if (window.top !== window) return;
  const NS = 'http://www.w3.org/2000/svg';
  const COLORS = ['#EF3E36', '#FE7146', '#FFE100', '#3BB273', '#1565D8', '#A66CFF', '#FF5FA2', '#0E0E10', '#FFFFFF'];
  const TOOLS = {
    main: { label: 'Main : utiliser la page', key: 'v', icon: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V12M14 11.5V6.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.3 15a1.5 1.5 0 0 1 2.4-1.8L8 15.5"/>' },
    pen: { label: 'Stylo', key: 'p', icon: '<path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/>' },
    marker: { label: 'Surligneur', key: 'h', icon: '<path d="M9 11l-5 5v4h4l5-5"/><path d="M9 11l6-6 4 4-6 6z"/><path d="M14 20h7"/>' },
    arrow: { label: 'Flèche', key: 'a', icon: '<path d="M5 19L19 5M10 5h9v9"/>' },
    eraser: { label: 'Gomme', key: 'e', icon: '<path d="M16 3l5 5-11 11H5l-3-3z"/><path d="M9 10l5 5M10 19h11"/>' },
  };
  const ICON = {
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
    clear: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    shot: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    grip: '<circle cx="9" cy="6" r="1.3"/><circle cx="15" cy="6" r="1.3"/><circle cx="9" cy="12" r="1.3"/><circle cx="15" cy="12" r="1.3"/><circle cx="9" cy="18" r="1.3"/><circle cx="15" cy="18" r="1.3"/>',
  };
  const svgIcon = (inner) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
  const CSS = `
    :host { all: initial; }
    .board { position: absolute; left: 0; top: 0; overflow: visible; pointer-events: none; }
    .board.live { pointer-events: auto; cursor: crosshair; touch-action: none; }
    .board.live.eraser { cursor: cell; }
    .board path { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .bar {
      position: fixed; top: 14px; left: 0; right: 0; margin: 0 auto; width: max-content; display: flex; flex-wrap: wrap; align-items: center; gap: 2px;
      max-width: calc(100vw - 24px); padding: 5px 6px; border-radius: 14px; box-sizing: border-box;
      background: rgba(18, 18, 22, 0.94); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 18px 50px -12px rgba(0, 0, 0, 0.7);
      font: 500 12px/1 system-ui, 'Segoe UI', sans-serif; color: #e8e8ea; user-select: none; pointer-events: auto;
      animation: pop 0.22s cubic-bezier(0.34, 1.56, 0.64, 1);
    }
    .bar.moved { right: auto; margin: 0; }
    .bar.hidden { display: none; }
    @keyframes pop { from { opacity: 0; translate: 0 -8px; } }
    .grp { display: flex; align-items: center; gap: 2px; padding: 0 5px; border-left: 1px solid rgba(255, 255, 255, 0.1); }
    .grp:first-of-type { border-left: 0; }
    button { all: unset; box-sizing: border-box; width: 28px; height: 28px; border-radius: 8px; display: grid; place-items: center; color: #cfd0d4; cursor: pointer; }
    button:hover { background: rgba(255, 255, 255, 0.1); color: #fff; }
    button svg { width: 16px; height: 16px; }
    button.on { background: #ffe100; color: #17140a; }
    button[disabled] { opacity: 0.35; pointer-events: none; }
    .grip { width: 18px; cursor: grab; color: #77787e; }
    .grip:hover { background: none; color: #cfd0d4; }
    .sw { width: 18px; height: 18px; margin: 0 1px; border-radius: 50%; box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, 0.25); }
    .sw.on { box-shadow: 0 0 0 2px #18181c, 0 0 0 4px #fff; background-clip: padding-box; }
    .custom { position: relative; overflow: hidden; background: conic-gradient(#ef3e36, #ffe100, #3bb273, #1565d8, #a66cff, #ef3e36); }
    .custom input { position: absolute; inset: -6px; opacity: 0; cursor: pointer; }
    .size { gap: 8px; }
    .dot { width: 22px; height: 22px; display: grid; place-items: center; }
    .dot i { display: block; border-radius: 50%; }
    input[type=range] { width: 70px; accent-color: #ffe100; }
    .pen { width: 24px; height: 24px; border: 1.5px solid rgba(255, 255, 255, 0.14); }
    .pen i { display: block; border-radius: 50%; }
    .pen.marker i { border-radius: 2px; opacity: 0.6; }
    .label { color: #8b8c92; font-size: 11px; padding-right: 2px; }
    .shot { width: auto; padding: 0 10px; gap: 6px; display: flex; background: #ffe100; color: #17140a; font-weight: 600; }
    .shot:hover { background: #fff04d; color: #17140a; }
    .menu { position: absolute; top: calc(100% + 6px); right: 40px; display: flex; flex-direction: column; padding: 5px; border-radius: 11px;
      background: rgba(18, 18, 22, 0.97); border: 1px solid rgba(255, 255, 255, 0.12); box-shadow: 0 14px 40px -10px rgba(0, 0, 0, 0.7); }
    .menu.hidden { display: none; }
    .menu button { width: auto; height: 30px; padding: 0 12px; justify-content: start; display: flex; }
  `;

  let prefs = { tool: 'pen', color: '#EF3E36', size: 4, pens: [] };
  let ui = null;
  let active = false;
  let stroke = null;
  const undoStack = [];
  const redoStack = [];
  let saveTimer = 0;

  const savePrefs = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { ipcRenderer.send('pen:prefs', prefs); } catch {} }, 300);
  };
  const el = (tag, attrs = {}, html) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (html != null) e.innerHTML = html;
    return e;
  };

  function build() {
    const host = document.createElement('pouley-stylo');
    host.style.cssText = 'all: initial; display: block; position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483647;';
    const root = host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = CSS;
    const board = document.createElementNS(NS, 'svg');
    board.setAttribute('class', 'board');
    const bar = el('div', { class: 'bar hidden' });
    root.append(style, board, bar);
    (document.documentElement || document).appendChild(host);
    ui = { host, root, board, bar, menu: null, sizer: 0 };
    fit();
    ui.sizer = setInterval(fit, 1000);
    addEventListener('resize', fit);
    board.addEventListener('pointerdown', down);
    board.addEventListener('pointermove', move);
    board.addEventListener('pointerup', up);
    board.addEventListener('pointercancel', up);
    renderBar();
  }

  // Le calque couvre toute la page, même la partie hors de l'écran.
  function fit() {
    if (!ui) return;
    if (!ui.host.isConnected) (document.documentElement || document).appendChild(ui.host);
    const d = document.documentElement;
    const b = document.body;
    // On mesure la page sans le calque (sinon il s'agrandirait lui-même),
    // et sans la barre de défilement (sinon il en ferait apparaître une).
    ui.board.style.width = '0px';
    ui.board.style.height = '0px';
    // 1 px de moins : avec un zoom d'écran à 150 %, les arrondis feraient déborder d'un rien.
    const w = Math.max(d.scrollWidth, b ? b.scrollWidth : 0, d.clientWidth) - 1;
    const h = Math.max(d.scrollHeight, b ? b.scrollHeight : 0, d.clientHeight) - 1;
    ui.board.setAttribute('width', w);
    ui.board.setAttribute('height', h);
    ui.board.style.width = w + 'px';
    ui.board.style.height = h + 'px';
  }

  function renderBar() {
    const { bar } = ui;
    bar.innerHTML = '';
    const grp = (...kids) => { const g = el('div', { class: 'grp' }); g.append(...kids); return g; };
    const btn = (html, title, onClick, cls = '') => {
      const b = el('button', { title, class: cls }, html);
      b.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
      return b;
    };

    const grip = el('button', { class: 'grip', title: 'Déplacer la barre' }, svgIcon(ICON.grip));
    grip.addEventListener('pointerdown', dragBar);

    const tools = Object.entries(TOOLS).map(([k, t]) => btn(svgIcon(t.icon), `${t.label} (${t.key.toUpperCase()})`, () => setTool(k), prefs.tool === k ? 'on' : ''));

    const swatches = COLORS.map((c) => {
      const b = btn('', c, () => { prefs.color = c; if (prefs.tool === 'main' || prefs.tool === 'eraser') prefs.tool = 'pen'; changed(); }, 'sw' + (prefs.color.toLowerCase() === c.toLowerCase() ? ' on' : ''));
      b.style.background = c;
      return b;
    });
    const custom = el('button', { class: 'sw custom' + (COLORS.some((c) => c.toLowerCase() === prefs.color.toLowerCase()) ? '' : ' on'), title: 'Couleur personnalisée' });
    const picker = el('input', { type: 'color', value: prefs.color });
    picker.addEventListener('input', () => { prefs.color = picker.value; if (prefs.tool === 'main' || prefs.tool === 'eraser') prefs.tool = 'pen'; changed(false); });
    picker.addEventListener('change', () => changed());
    custom.append(picker);

    const dot = el('span', { class: 'dot' });
    const paintDot = () => {
      const s = Math.max(3, Math.min(22, prefs.size * (prefs.tool === 'marker' ? 3 : 1)));
      dot.innerHTML = `<i style="width:${s}px;height:${s}px;background:${prefs.color};${prefs.tool === 'marker' ? 'opacity:.45;border-radius:3px' : ''}"></i>`;
    };
    paintDot();
    const range = el('input', { type: 'range', min: '1', max: '40', value: String(prefs.size), title: 'Épaisseur' });
    range.addEventListener('input', () => { prefs.size = Number(range.value); paintDot(); savePrefs(); });

    // Mes stylos : clic pour reprendre, clic droit pour retirer.
    const pens = prefs.pens.map((p, i) => {
      const s = Math.max(4, Math.min(16, p.size * (p.tool === 'marker' ? 2 : 1)));
      const b = btn(`<i style="width:${s}px;height:${s}px;background:${p.color}"></i>`, `Mon stylo ${i + 1} (${TOOLS[p.tool].label.toLowerCase()}, ${p.size} px) — clic droit pour le retirer`, () => { prefs.tool = p.tool; prefs.color = p.color; prefs.size = p.size; changed(); }, 'pen ' + p.tool);
      b.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); prefs.pens.splice(i, 1); changed(); });
      return b;
    });
    const add = btn(svgIcon(ICON.plus), 'Mes stylos : enregistrer ce stylo (couleur, épaisseur, outil) pour le retrouver en un clic', () => {
      if (prefs.tool !== 'pen' && prefs.tool !== 'marker' && prefs.tool !== 'arrow') prefs.tool = 'pen';
      const p = { tool: prefs.tool, color: prefs.color, size: prefs.size };
      prefs.pens = [p, ...prefs.pens.filter((x) => !(x.tool === p.tool && x.color === p.color && x.size === p.size))].slice(0, 6);
      changed();
    });

    const undo = btn(svgIcon(ICON.undo), 'Annuler (Ctrl+Z)', doUndo);
    const redo = btn(svgIcon(ICON.redo), 'Rétablir (Ctrl+Y)', doRedo);
    const clear = btn(svgIcon(ICON.clear), 'Tout effacer', clearAll);
    undo.disabled = !undoStack.length;
    redo.disabled = !redoStack.length;
    clear.disabled = !ui.board.childNodes.length;

    const shot = btn(svgIcon(ICON.shot) + '<span>Capturer</span>', 'Enregistrer une capture d’écran avec le dessin', () => ui.menu.classList.toggle('hidden'), 'shot');
    const close = btn(svgIcon(ICON.close), 'Fermer le stylo (Échap) — le dessin reste sur la page', () => setActive(false));
    const menu = el('div', { class: 'menu hidden' });
    menu.append(
      btn('Zone visible', 'Capturer ce qui est à l’écran', () => capture('visible')),
      btn('Page entière', 'Capturer toute la page, de haut en bas', () => capture('full')));
    ui.menu = menu;

    bar.append(grip,
      grp(...tools),
      grp(...swatches, custom),
      grp(dot, range),
      grp(...pens, add),
      grp(undo, redo, clear),
      grp(shot, close),
      menu);
    ui.board.classList.toggle('live', active && prefs.tool !== 'main');
    ui.board.classList.toggle('eraser', prefs.tool === 'eraser');
  }

  const toolByKey = (k) => Object.keys(TOOLS).find((name) => TOOLS[name].key === k);
  function changed(save = true) { renderBar(); if (save) savePrefs(); }
  function setTool(t) { prefs.tool = t; changed(); }

  function dragBar(e) {
    e.preventDefault();
    const bar = ui.bar;
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    bar.classList.add('moved');
    const mv = (ev) => {
      bar.style.left = Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx)) + 'px';
      bar.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)) + 'px';
    };
    const stop = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', stop); };
    addEventListener('pointermove', mv);
    addEventListener('pointerup', stop);
  }

  // ── Dessin
  const pt = (e) => {
    const r = ui.board.getBoundingClientRect();
    return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10];
  };
  function smooth(pts) {
    if (pts.length < 3) return `M${pts[0][0]} ${pts[0][1]} L${pts[pts.length - 1][0] + 0.01} ${pts[pts.length - 1][1]}`;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      d += ` Q${x0} ${y0} ${((x0 + x1) / 2).toFixed(1)} ${((y0 + y1) / 2).toFixed(1)}`;
    }
    const [lx, ly] = pts[pts.length - 1];
    return d + ` L${lx} ${ly}`;
  }
  function arrowD([sx, sy], [ex, ey], w) {
    const a = Math.atan2(ey - sy, ex - sx);
    const head = Math.max(12, w * 4);
    const p = (da) => `${(ex - head * Math.cos(a + da)).toFixed(1)} ${(ey - head * Math.sin(a + da)).toFixed(1)}`;
    return `M${sx} ${sy} L${ex} ${ey} M${p(0.5)} L${ex} ${ey} L${p(-0.5)}`;
  }

  function down(e) {
    if (!active || prefs.tool === 'main' || e.button > 0) return;
    e.preventDefault();
    ui.board.setPointerCapture(e.pointerId);
    if (ui.menu) ui.menu.classList.add('hidden');
    if (prefs.tool === 'eraser') { stroke = { erase: [] }; eraseAt(e); return; }
    const path = document.createElementNS(NS, 'path');
    // Stylet sensible à la pression : la première pression règle l'épaisseur.
    const pressure = e.pointerType === 'pen' && e.pressure > 0 ? 0.5 + e.pressure : 1;
    const w = prefs.tool === 'marker' ? prefs.size * 3 : Math.max(1, prefs.size * pressure);
    path.setAttribute('stroke', prefs.color);
    path.setAttribute('stroke-width', String(w));
    if (prefs.tool === 'marker') { path.setAttribute('stroke-opacity', '0.38'); path.setAttribute('stroke-linecap', 'butt'); }
    ui.board.appendChild(path);
    stroke = { path, pts: [pt(e)], tool: prefs.tool, w };
    path.setAttribute('d', smooth(stroke.pts));
  }
  function move(e) {
    if (!stroke) return;
    if (stroke.erase) { eraseAt(e); return; }
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    if (stroke.tool === 'arrow') {
      stroke.end = pt(e);
      stroke.path.setAttribute('d', arrowD(stroke.pts[0], stroke.end, stroke.w));
      return;
    }
    for (const ev of events.length ? events : [e]) {
      const p = pt(ev);
      const last = stroke.pts[stroke.pts.length - 1];
      if (Math.abs(p[0] - last[0]) + Math.abs(p[1] - last[1]) < 1.5) continue;
      // Maj enfoncée : trait droit.
      if (e.shiftKey) stroke.pts = [stroke.pts[0], p];
      else stroke.pts.push(p);
    }
    stroke.path.setAttribute('d', smooth(stroke.pts));
  }
  function up() {
    if (!stroke) return;
    if (stroke.erase) {
      if (stroke.erase.length) record({ remove: stroke.erase });
    } else if (stroke.tool === 'arrow' && !stroke.end) {
      stroke.path.remove();
    } else record({ add: stroke.path });
    stroke = null;
    renderBar();
  }
  function eraseAt(e) {
    for (const [ox, oy] of [[0, 0], [6, 0], [-6, 0], [0, 6], [0, -6]]) {
      for (const hit of ui.root.elementsFromPoint(e.clientX + ox, e.clientY + oy)) {
        if (hit.parentNode === ui.board && hit.tagName === 'path') { stroke.erase.push(hit); hit.remove(); }
      }
    }
  }

  // ── Annuler / rétablir
  function record(action) { undoStack.push(action); if (undoStack.length > 200) undoStack.shift(); redoStack.length = 0; }
  function apply(action, reverse) {
    if (action.add) { if (reverse) action.add.remove(); else ui.board.appendChild(action.add); }
    for (const p of action.remove || []) { if (reverse) ui.board.appendChild(p); else p.remove(); }
  }
  function doUndo() { const a = undoStack.pop(); if (!a) return; apply(a, true); redoStack.push(a); renderBar(); }
  function doRedo() { const a = redoStack.pop(); if (!a) return; apply(a, false); undoStack.push(a); renderBar(); }
  function clearAll() {
    const all = [...ui.board.childNodes];
    if (!all.length) return;
    all.forEach((p) => p.remove());
    record({ remove: all });
    renderBar();
  }

  // ── Capture : la barre se cache, le dessin reste.
  async function capture(mode) {
    ui.menu.classList.add('hidden');
    ui.bar.classList.add('hidden');
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    try { await ipcRenderer.invoke('pen:shot', mode); } catch {}
    if (active) ui.bar.classList.remove('hidden');
  }

  function setActive(on) {
    if (on && !ui) build();
    if (!ui) return;
    active = on;
    ui.bar.classList.toggle('hidden', !on);
    renderBar();
    // Rien de dessiné : on retire tout, la page redevient intacte.
    if (!on && !ui.board.childNodes.length) {
      clearInterval(ui.sizer);
      removeEventListener('resize', fit);
      ui.host.remove();
      ui = null;
      undoStack.length = 0;
      redoStack.length = 0;
    }
    try { ipcRenderer.send('pen:state', on); } catch {}
  }

  addEventListener('keydown', (e) => {
    if (!active) return;
    const t = e.composedPath()[0];
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.type !== 'range' && t.type !== 'color') return;
    const k = e.key.toLowerCase();
    let handled = true;
    if (e.key === 'Escape') setActive(false);
    else if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) doUndo();
    else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) doRedo();
    else if (!e.ctrlKey && !e.metaKey && !e.altKey && toolByKey(k)) setTool(toolByKey(k));
    else if (!e.ctrlKey && (k === '[' || k === ']')) { prefs.size = Math.max(1, Math.min(40, prefs.size + (k === ']' ? 2 : -2))); changed(); }
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  ipcRenderer.on('pen:toggle', (_e, saved) => {
    if (saved && typeof saved === 'object') prefs = { ...prefs, ...saved, pens: Array.isArray(saved.pens) ? saved.pens : prefs.pens };
    if (!TOOLS[prefs.tool]) prefs.tool = 'pen';
    setActive(!active);
  });
})();
