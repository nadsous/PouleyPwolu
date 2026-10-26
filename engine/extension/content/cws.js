// Chrome Web Store : bandeau « Ajouter à PouleyPwolu » sur la page d'une extension.
// Le bouton « Ajouter à Chrome » du Store ne fonctionne pas dans ungoogled-chromium :
// PouleyPwolu télécharge l'extension chez Google, et Chromium demande confirmation avant
// de l'installer (sa fenêtre habituelle, avec les autorisations demandées).
(() => {
  const ID = /\/detail\/(?:[^/]+\/)?([a-p]{32})/;
  let shownFor = null;

  async function render() {
    const m = ID.exec(location.pathname);
    const id = m && m[1];
    if (id === shownFor) return;
    shownFor = id;
    document.getElementById('pouley-cws')?.remove();
    if (!id) return;
    const state = await chrome.runtime.sendMessage({ type: 'cws.state', id }).catch(() => null);
    const bar = document.createElement('div');
    bar.id = 'pouley-cws';
    const root = bar.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .bar { position: fixed; z-index: 2147483647; left: 50%; bottom: 22px; transform: translateX(-50%);
          display: flex; align-items: center; gap: 14px; padding: 10px 10px 10px 16px; border-radius: 16px;
          background: #111113; color: #f4f4f5; box-shadow: 0 14px 40px rgba(0,0,0,.35), 0 0 0 1px rgba(255,255,255,.08);
          font: 500 14px/1.3 'Segoe UI', system-ui, sans-serif; max-width: min(720px, 92vw); }
        .t { opacity: .9; }
        button { all: unset; cursor: pointer; padding: 9px 16px; border-radius: 11px; font-weight: 600;
          background: #ffe100; color: #17140a; white-space: nowrap; }
        button:disabled { opacity: .5; cursor: default; }
        .x { background: transparent; color: #8b8b95; padding: 6px 8px; }
      </style>
      <div class="bar">
        <span class="t"></span>
        <button class="go"></button>
        <button class="x" title="Masquer">✕</button>
      </div>`;
    const t = root.querySelector('.t');
    const go = root.querySelector('.go');
    const installed = state && state.installed;
    t.textContent = installed
      ? 'Cette extension est déjà dans PouleyPwolu.'
      : 'Le bouton « Ajouter à Chrome » ne marche pas ici : PouleyPwolu peut l’installer pour toi.';
    go.textContent = installed ? 'Mettre à jour' : 'Ajouter à PouleyPwolu';
    go.onclick = async () => {
      go.disabled = true;
      t.textContent = 'Téléchargement… Chromium va te demander de confirmer.';
      const r = await chrome.runtime.sendMessage({ type: 'cws.install', id }).catch((e) => ({ error: String(e) }));
      go.disabled = false;
      if (r && r.error) t.textContent = r.error;
    };
    root.querySelector('.x').onclick = () => bar.remove();
    document.documentElement.append(bar);
  }

  render();
  // Le Store change de page sans recharger.
  let last = location.href;
  setInterval(() => { if (location.href !== last) { last = location.href; render(); } }, 700);
})();
