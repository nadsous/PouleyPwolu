// Préchargé dans chaque onglet (monde isolé, sandbox). Il pose des sondes dans
// le monde de la page pour repérer les techniques d'empreinte numérique
// (canvas, WebGL, audio, polices…) et les signale au navigateur. Il ne
// modifie pas le comportement des fonctions : il observe seulement.
const { ipcRenderer, contextBridge, webFrame } = require('electron');

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
