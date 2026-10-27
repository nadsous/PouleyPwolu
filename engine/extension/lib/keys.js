// Raccourcis clavier de PouleyPwolu : touche pressée → nom du raccourci (core/shortcuts.js).
// Partagé par les pages (content/raccourcis.js) et la barre (sidebar/chromium.js).
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleyKeys = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function match(e) {
    const mod = e.ctrlKey || e.metaKey;
    const key = (e.key || '').toLowerCase();
    if (key === 'f6' && !mod && !e.altKey) return 'edit-url';
    if (e.altKey && !mod && !e.shiftKey) {
      if (key === 'd') return 'edit-url';
      if (key === 'arrowup') return 'poulailler-prev';
      if (key === 'arrowdown') return 'poulailler-next';
      return null;
    }
    if (!mod || e.altKey) return null;
    if (e.shiftKey) {
      if (key === 'k') return 'split';
      if (key === 'p') return 'float';
      return null;
    }
    if (key === 's') return 'toggle-bar';
    if (key === 'l') return 'edit-url';
    if (key === 'k') return 'new-tab';
    if (key === 'e') return 'ai';
    if (key === ',') return 'settings';
    if (key === 'd') return 'pin';
    if (/^[1-9]$/.test(key)) return 'poulailler:' + key;
    return null;
  }
  return { match };
});
