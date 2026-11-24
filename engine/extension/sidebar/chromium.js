// PouleyPwolu dans Chromium : ce qu'Electron faisait hors de la page de l'interface.
// - Menus contextuels : le cœur envoie la liste (événement « menu »), la barre la dessine.
// - Presse-papiers : écrit depuis la barre (le service worker n'y a pas accès).
(() => {
  const api = window.pouley;
  let lastPointer = { x: 40, y: 40 };
  addEventListener('pointerdown', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);
  addEventListener('contextmenu', (e) => { lastPointer = { x: e.clientX, y: e.clientY }; }, true);

  let open = null;
  function close() {
    if (open) open.remove();
    open = null;
  }
  addEventListener('pointerdown', (e) => { if (open && !open.contains(e.target)) close(); });
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  addEventListener('blur', close);

  function build(menuId, items, x, y, level = 0) {
    const box = document.createElement('div');
    box.className = 'pw-menu';
    for (const it of items) {
      if (it.type === 'separator') { box.append(document.createElement('hr')); continue; }
      const b = document.createElement('button');
      b.disabled = !it.enabled;
      const check = document.createElement('span');
      check.className = 'check';
      check.textContent = it.type === 'checkbox' && it.checked ? '✓' : '';
      const label = document.createElement('span');
      label.textContent = it.label || '';
      b.append(check, label);
      if (it.sublabel || it.submenu) {
        const sub = document.createElement('span');
        sub.className = 'sub';
        sub.textContent = it.submenu ? '›' : it.sublabel;
        b.append(sub);
      }
      b.onclick = (e) => {
        e.stopPropagation();
        if (it.submenu) {
          const r = b.getBoundingClientRect();
          const child = build(menuId, it.submenu, r.right - 6, r.top, level + 1);
          box.querySelectorAll('.pw-menu').forEach((m) => m.remove());
          box.append(child);
          return;
        }
        close();
        api.cmd('menu.click', { menuId, itemId: it.id });
      };
      box.append(b);
    }
    document.body.append(box);
    // Le menu reste dans le panneau.
    const r = box.getBoundingClientRect();
    box.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
    box.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
    return box;
  }

  api.on('menu', ({ menuId, items }) => {
    close();
    open = build(menuId, items, lastPointer.x, lastPointer.y);
  });

  // Capture d'écran : la barre vient d'être cliquée, elle peut écrire l'image.
  api.on('clipboard-image', async ({ id, dataUrl }) => {
    let ok = false;
    try {
      const blob = await (await fetch(dataUrl)).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      ok = true;
    } catch {}
    api.cmd('clip.result', { id, ok });
  });

  // Grande capture d'écran : enregistrée depuis la barre (voir core/tools.js).
  api.on('save-image', async ({ id, dataUrl, filename }) => {
    let downloadId = null;
    try {
      const url = URL.createObjectURL(await (await fetch(dataUrl)).blob());
      downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch {}
    api.cmd('save.result', { id, downloadId });
  });

  // La barre elle-même (pas une page plein écran ni un panneau posé sur une page).
  const isBar = !/[?&](page|panel)=/.test(location.search);

  // Raccourcis clavier (lib/keys.js) : Ctrl+S masque / montre la barre (core/layout.js),
  // les autres passent par core/shortcuts.js.
  addEventListener('keydown', (e) => {
    const name = isBar && self.PouleyKeys && self.PouleyKeys.match(e);
    if (!name) return;
    e.preventDefault();
    api.cmd(name === 'toggle-bar' ? 'bar.toggle' : 'shortcut.run', name);
  });

  // Aperçu d'un favori : il se ferme quand la souris va ailleurs dans la barre ou clique.
  let favPeek = null;
  api.on('favpeek', (id) => { favPeek = id; });
  if (isBar) {
    document.addEventListener('mouseover', (e) => {
      if (favPeek && !(e.target.closest && e.target.closest('.fav'))) api.cmd('fav.unpeek');
    });
    document.addEventListener('pointerdown', () => { if (favPeek) api.cmd('fav.unpeek'); }, true);
  }

  // Barre ouverte au survol du bord : elle se referme quand la souris la quitte.
  if (isBar) {
    document.documentElement.addEventListener('mouseleave', () => api.cmd('bar.leave'));
    document.documentElement.addEventListener('mouseenter', () => api.cmd('bar.enter'));
  }

  // Bord de la barre : glisser pour l'élargir ou la rétrécir, jusqu'au bord pour la masquer.
  const resizer = document.getElementById('side-resizer');
  if (resizer && isBar) {
    resizer.addEventListener('pointerdown', async (e) => {
      if (e.button !== 0 || document.body.classList.contains('side-top')) return;
      e.preventDefault();
      resizer.setPointerCapture(e.pointerId);
      const right = document.body.classList.contains('side-right');
      const startX = e.screenX;
      const startW = innerWidth;
      let w = startW;
      let raf = 0;
      document.body.classList.add('resizing');
      const move = (ev) => {
        const raw = startW + (right ? startX - ev.screenX : ev.screenX - startX);
        w = Math.round(raw);
        document.body.classList.toggle('will-hide', raw < 150);
        if (raf) return;
        raf = requestAnimationFrame(() => { raf = 0; if (w >= 150) api.cmd('bar.width', w); });
      };
      const up = () => {
        resizer.removeEventListener('pointermove', move);
        resizer.removeEventListener('pointerup', up);
        resizer.removeEventListener('pointercancel', up);
        document.body.classList.remove('resizing', 'will-hide');
        if (w < 150) api.cmd('settings.set', { sidebarAutoHide: true });
        else api.cmd('settings.set', { sidebarWidth: Math.max(200, Math.min(440, w)) });
      };
      resizer.addEventListener('pointermove', move);
      resizer.addEventListener('pointerup', up);
      resizer.addEventListener('pointercancel', up);
    });
  }

  // Haut de la barre = barre de titre : on envoie au navigateur les zones vides du haut
  // (entre les boutons) ; il y pose de vraies zones de déplacement Windows (glisser vers
  // un autre écran, double-clic pour agrandir, ancrage). Recalculé quand la barre change.
  function dragRegions() {
    const head = document.querySelector('.side-head.drag');
    if (!head || document.body.classList.contains('page-mode') || document.body.classList.contains('panel-mode')) return [];
    const h = head.getBoundingClientRect();
    // Les boutons eux-mêmes (les conteneurs comme .nav s'étirent jusqu'aux boutons de fenêtre).
    const blocks = [...head.querySelectorAll('button, a, input, .brand, [role="button"]')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0).sort((a, b) => a.left - b.left);
    const out = [];
    let x = h.left;
    for (const r of blocks) {
      if (r.left - x > 6) out.push({ x, y: h.top, width: r.left - x, height: h.height });
      x = Math.max(x, r.right);
    }
    if (h.right - x > 6) out.push({ x, y: h.top, width: h.right - x, height: h.height });
    // Bande fine tout en haut de la barre, au-dessus des boutons.
    if (h.top > 4) out.push({ x: h.left, y: 0, width: h.width, height: h.top });
    return out.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }));
  }
  let lastRegions = '';
  function sendRegions() {
    const regions = dragRegions();
    const key = JSON.stringify(regions);
    if (key === lastRegions) return;
    lastRegions = key;
    // Pas de réponse (cœur pas encore prêt) : on réessaiera au prochain passage.
    api.cmd('window.dragRegions', regions).then((ok) => { if (!ok) lastRegions = ''; }, () => { lastRegions = ''; });
  }
  const head = document.querySelector('.side-head');
  if (head) new ResizeObserver(sendRegions).observe(head);
  addEventListener('resize', sendRegions);
  setInterval(sendRegions, 2000); // boutons qui apparaissent ou disparaissent

  api.on('clipboard', (text) => {
    navigator.clipboard.writeText(String(text || '')).catch(() => {});
  });

  // Page en pleine fenêtre : on ouvre l'écran demandé une fois l'état reçu.
  const q = new URLSearchParams(location.search);
  const page = q.get('page');
  const panel = q.get('panel');
  if (panel) {
    api.getState().then(() => setTimeout(() => {
      const open = window.pouleyOpen && window.pouleyOpen[panel];
      if (open) open(q.get('tab') || null);
    }, 30));
  }
  if (page) {
    document.title = { settings: 'Paramètres', archive: 'Archive', focus: 'Mon poulailler du jour', editor: 'Poulailler', group: 'Groupe d’œufs' }[page] || 'PouleyPwolu';
    api.getState().then(() => setTimeout(() => {
      const open = window.pouleyOpen && window.pouleyOpen[page];
      if (open) open(q.get('arg') || null);
    }, 60));
  }
})();
