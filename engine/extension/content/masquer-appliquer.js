// Éléments masqués par l'utilisateur (outil « Masquer », content/masquer.js) : réappliqués
// sur chaque page du site, dès le début du chargement, avant qu'ils s'affichent.
// Stockage : chrome.storage.local « hidden » = { "site.fr": ["sélecteur CSS", …] }.
(() => {
  if (window.__pouleyHideApply) return;
  window.__pouleyHideApply = true;
  const host = location.hostname.replace(/^www\./, '');
  if (!host) return;
  let style = null;

  function apply(list) {
    const css = (list || []).map((sel) => `${sel} { display: none !important; }`).join('\n');
    if (!css) { if (style) style.textContent = ''; return; }
    if (!style) {
      style = document.createElement('style');
      style.id = 'pouley-masquer';
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = css;
  }

  chrome.storage.local.get('hidden').then(({ hidden }) => apply(hidden && hidden[host])).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.hidden) apply((changes.hidden.newValue || {})[host]);
  });
})();
