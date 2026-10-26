// Pont entre l'interface PouleyPwolu et le cœur (service worker de l'extension).
// Même API que src/preload/ui.js de la version Electron : app.js ne change pas.
(() => {
  // index.html?page=<écran> : page en pleine fenêtre (réglages, archive…), sans la barre.
  // index.html?panel=<panneau> : panneau posé sur une page web (inspecteur, détecteur d'IA).
  const query = new URLSearchParams(location.search);
  if (query.get('page')) document.body.classList.add('page-mode');
  if (query.get('panel')) document.body.classList.add('panel-mode', 'panel-' + query.get('panel'));
  // Les annonces (bulles, alertes) s'affichent dans la barre, pas une deuxième fois ici.
  const BAR_ONLY = (query.get('page') || query.get('panel')) ? new Set(['toast', 'privacy:alert', 'cluck', 'download', 'shot:done', 'clipboard-image', 'save-image']) : new Set();

  const listeners = new Map(); // canal -> Set(fn)
  const pending = new Map(); // id -> { resolve, reject }
  let port = null;
  let seq = 0;

  function connect() {
    port = chrome.runtime.connect({ name: 'ui' });
    port.onMessage.addListener((msg) => {
      if (msg.type === 'reply') {
        const p = pending.get(msg.id);
        if (!p) return;
        pending.delete(msg.id);
        if (msg.error) console.warn('[PouleyPwolu]', msg.error);
        p.resolve(msg.result);
      } else if (msg.type === 'event' && !BAR_ONLY.has(msg.channel)) {
        for (const fn of listeners.get(msg.channel) || []) {
          try { fn(msg.payload); } catch (err) { console.error('[PouleyPwolu]', msg.channel, err); }
        }
      }
    });
    // Le service worker a été relancé : on se reconnecte et on redemande l'état.
    port.onDisconnect.addListener(() => {
      for (const p of pending.values()) p.resolve(null);
      pending.clear();
      setTimeout(() => {
        connect();
        request({ type: 'state' }).then((s) => { for (const fn of listeners.get('state') || []) fn(s); });
      }, 200);
    });
  }

  function request(msg) {
    const id = ++seq;
    return new Promise((resolve) => {
      pending.set(id, { resolve });
      try { port.postMessage({ ...msg, id }); } catch { pending.delete(id); resolve(null); }
    });
  }

  connect();

  window.pouley = {
    getState: () => request({ type: 'state' }),
    cmd: (name, arg) => request({ type: 'cmd', name, arg }),
    // La page n'est plus posée par l'interface : Chromium l'affiche à côté de la barre.
    setLayout: () => {},
    on: (channel, fn) => {
      if (!listeners.has(channel)) listeners.set(channel, new Set());
      listeners.get(channel).add(fn);
      return () => listeners.get(channel).delete(fn);
    },
  };
})();
