// Dans chaque page : les raccourcis clavier de PouleyPwolu (lib/keys.js, core/shortcuts.js),
// dont Ctrl+S (Cmd+S sur Mac) qui masque ou montre la barre. Quand la barre est masquée,
// toucher le bord de la fenêtre avec la souris l'ouvre (core/layout.js).
(() => {
  if (window.top !== window || window.__pouleyRaccourcis) return;
  window.__pouleyRaccourcis = true;
  let side = 'left';
  let hidden = false;
  const read = (state) => {
    const s = (state && state.settings) || {};
    side = s.sidebarPosition || 'left';
    hidden = !!s.sidebarAutoHide && side !== 'top';
  };
  chrome.storage.local.get('state').then(({ state }) => read(state)).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.state) read(changes.state.newValue); });

  const send = (msg) => { try { chrome.runtime.sendMessage(msg); } catch {} };
  addEventListener('keydown', (e) => {
    const name = self.PouleyKeys && self.PouleyKeys.match(e);
    if (!name) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    send(name === 'toggle-bar' ? { type: 'bar.toggle' } : { type: 'shortcut', name });
  }, true);

  addEventListener('pointerdown', () => send({ type: 'preview.close' }), true);

  let last = 0;
  addEventListener('mousemove', (e) => {
    if (!hidden) return;
    const atEdge = side === 'right' ? e.clientX >= innerWidth - 3 : e.clientX <= 2;
    if (!atEdge || Date.now() - last < 600) return;
    last = Date.now();
    send({ type: 'bar.edge', side });
  }, { passive: true });
})();
