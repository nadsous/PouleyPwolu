// Sondes d'empreinte numérique, dans le monde de la page (repris de src/preload/page.js).
// Elles observent sans changer le comportement des fonctions, et préviennent
// content/probes.js par un événement DOM ; le cœur les ajoute au rapport de vie privée.
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
        count('notify');
        return Reflect.construct(target, args, newTarget);
      },
    });
  }
  const SWR = window.ServiceWorkerRegistration && ServiceWorkerRegistration.prototype;
  wrap(SWR, 'showNotification', () => count('notify'));

  wrap(window.Navigator && Navigator.prototype, 'getBattery', () => post('battery'));
  wrap(window.Navigator && Navigator.prototype, 'sendBeacon', () => count('beacon'));
  wrap(window.Clipboard && Clipboard.prototype, 'readText', () => post('clipboard'));
  wrap(window.Clipboard && Clipboard.prototype, 'read', () => post('clipboard'));
}

probes('pouley-sonde-7c1e');
