// Interface de PouleyPwolu : barre latérale (gauche / droite / haut), poulaillers,
// palette de commandes, réglages, inspecteur, alertes de confidentialité.
(() => {
  const api = window.pouley;
  const { SEARCH_ENGINES, AI_PROVIDERS, POULAILLER_COLORS, KEYWORDS, REPO_SHORT, keywordSearch, fill } = window.PouleyConfig;
  const Sp = window.PouleySprites;
  const I = window.PouleyIcons;
  const B = window.PouleyBrands;
  // Logo officiel (assistant IA ou moteur de recherche) dans un <span>.
  const logo = (key, cls) => { const s = document.createElement('span'); s.className = 'logo-slot' + (cls ? ' ' + cls : ''); s.innerHTML = B.svg(key); return s; };
  const icon = (id, cls) => { const s = document.createElement('span'); s.className = 'icw' + (cls ? ' ' + cls : ''); s.innerHTML = I.svg(id); return s; };

  const $ = (s, r = document) => r.querySelector(s);
  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // Les variables CSS (--x) passent par setProperty, Object.assign les ignore.
        for (const [p, val] of Object.entries(v)) {
          if (p.startsWith('--')) e.style.setProperty(p, val);
          else e.style[p] = val;
        }
      }
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const svg = (inner, vb = '0 0 24 24') => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', vb);
    s.innerHTML = inner;
    return s;
  };
  const ICONS = {
    x: '<path d="M7 7l10 10M17 7L7 17"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9a4 4 0 0 1 0 6"/>',
    muted: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9l4 6M21 9l-4 6"/>',
    lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
    search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    spark: '<path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/>',
    tab: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18"/>',
    cmd: '<path d="M9 6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3z"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10h14V9M10 13h4"/>',
    home: '<path d="M4 11l8-7 8 7v9H4z"/>',
  };
  const pouleSvg = () => Sp.toSvg(Sp.POULE);
  const pouleMini = () => h('span', { class: 'poule-mini', html: pouleSvg() });

  let snap = null;
  let overlay = null; // nom de la superposition ouverte
  let dragging = null;
  let lastBlocked = 0;
  let lastScrolledTab = null;
  let inspector = { open: false, tab: 'privacy', data: null, key: null, loading: false };
  let onboardingShown = false;

  // ───────────────────────────────────────────── utilitaires d'état
  const S = () => snap.state.settings;
  const activeP = () => snap.state.poulaillers.find((p) => p.id === snap.state.activePoulailler) || snap.state.poulaillers[0];
  function findRec(id) {
    if (!snap || !id) return null;
    const f = snap.state.favorites.find((t) => t.id === id);
    if (f) return { rec: f, p: null };
    for (const p of snap.state.poulaillers) {
      const t = p.tabs.find((x) => x.id === id);
      if (t) return { rec: t, p };
    }
    return null;
  }
  const current = () => findRec(snap && snap.currentTabId);
  const rtOf = (id) => (snap && snap.runtime[id]) || { awake: false };
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const isInternal = (url) => /^pouley:/.test(url || '');
  // Page d'une extension préinstallée (ex. lecteur NadsPDF) : nom + fichier ouvert.
  function extPage(url) {
    const m = /^chrome-extension:\/\/([a-p]{32})\//.exec(url || '');
    if (!m || !snap || !snap.extensions) return null;
    const ext = snap.extensions.find((e) => e.ids.includes(m[1]));
    if (!ext) return null;
    const file = (url.split('#file=')[1] || '');
    let name = '';
    try { name = decodeURIComponent(file.split(/[?#]/)[0].split('/').pop() || ''); } catch { name = ''; }
    return { ext, file, name };
  }
  const internalTitle = (url) => {
    const host = (url || '').replace('pouley://', '').split(/[/?]/)[0];
    return { newtab: 'Nouvel onglet', jeu: 'Pouley contre le Renard', offline: 'Hors ligne', erreur: 'Erreur' }[host] || 'PouleyPwolu';
  };

  function favicon(rec, cls = 'fi') {
    if (isInternal(rec.url)) return h('span', { class: cls, html: pouleSvg() });
    const xp = extPage(rec.url);
    if (xp && xp.ext.icon) return h('img', { class: cls, src: xp.ext.icon, draggable: 'false' });
    const letter = () => h('span', { class: cls + ' letter' }, (hostOf(rec.url)[0] || '•').toUpperCase());
    if (!rec.favicon) return letter();
    const img = h('img', { class: cls, src: rec.favicon, draggable: 'false', referrerpolicy: 'no-referrer' });
    img.onerror = () => img.replaceWith(letter());
    return img;
  }

  // ───────────────────────────────────────────── rendu
  function render() {
    if (!snap) return;
    const s = S();
    const body = document.body;
    body.classList.toggle('side-left', s.sidebarPosition === 'left');
    body.classList.toggle('side-right', s.sidebarPosition === 'right');
    body.classList.toggle('side-top', s.sidebarPosition === 'top');
    body.classList.toggle('platform-darwin', snap.platform === 'darwin');
    body.classList.toggle('sidebar-collapsed', sidebarHidden());
    if (!resizing) document.documentElement.style.setProperty('--side-w', sideWidth() + 'px');
    const hideBtn = $('#btn-hide-sidebar');
    const docked = !sidebarHidden();
    hideBtn.innerHTML = I.svg(docked ? 'barre-masquer' : s.sidebarPosition === 'right' ? 'barre-droite' : 'barre-gauche');
    hideBtn.title = docked ? 'Masquer la barre (Ctrl+S) — elle s’ouvre au survol du bord' : 'Garder la barre ouverte (Ctrl+S)';
    if (peekState.open && snap.currentTabId !== peekState.tab) closePeek();
    document.documentElement.className = s.theme === 'light' ? 'theme-light' : 'theme-nads';
    // Fenêtre transparente : on voit le bureau (flouté) derrière la barre et les marges.
    const glass = snap.platform === 'win32' && s.windowMaterial && s.windowMaterial !== 'none';
    body.classList.toggle('glass', !!glass);
    document.documentElement.style.setProperty('--chrome-a', String(glass ? s.chromeOpacity ?? 0.55 : 1));
    const p = activeP();
    applyLook(lookOf(p));

    const cur = current();
    const rt = cur ? rtOf(cur.rec.id) : {};
    $('#btn-back').disabled = !rt.canGoBack;
    $('#btn-forward').disabled = !rt.canGoForward;
    $('#btn-reload').innerHTML = rt.loading
      ? '<svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>';
    $('#btn-reload').title = rt.loading ? 'Arrêter' : 'Recharger (Ctrl+R)';

    // Adresse
    const urlText = $('#url-text');
    const lock = $('#url-lock');
    if (cur) {
      const url = cur.rec.url;
      let u = null;
      try { u = new URL(url); } catch {}
      urlText.textContent = '';
      const xp = extPage(url);
      if (xp) {
        urlText.append(h('b', null, xp.ext.name), xp.name ? '  ' + xp.name : '');
        lock.className = 'lock internal';
        lock.replaceChildren(h('img', { src: xp.ext.icon || '', style: { width: '14px', height: '14px' } }));
        lock.title = 'Extension ' + xp.ext.name + ' — fonctionne entièrement sur ta machine';
      } else if (isInternal(url)) {
        urlText.append(h('b', null, internalTitle(url)));
        lock.className = 'lock internal';
        lock.replaceChildren(svg(ICONS.home));
      } else if (u) {
        urlText.append(h('b', null, u.hostname.replace(/^www\./, '')), (u.pathname + u.search).replace(/^\/$/, ''));
        const secure = u.protocol === 'https:';
        lock.className = 'lock ' + (secure ? 'secure' : 'insecure');
        lock.replaceChildren(svg(secure ? ICONS.lock : ICONS.unlock));
        lock.title = secure ? 'Connexion chiffrée (HTTPS)' : 'Connexion NON chiffrée';
      } else {
        urlText.textContent = url;
      }
    } else {
      urlText.textContent = 'Rechercher ou saisir une adresse';
      lock.className = 'lock';
      lock.replaceChildren(svg(ICONS.search));
    }

    // Capture & superposition (dans la barre d'adresse)
    const curFloating = !!(cur && rt.floating);
    $('#btn-shot').classList.toggle('hidden', !cur || curFloating);
    $('#btn-pen').classList.toggle('hidden', !cur || curFloating || !/^https?:|^file:/.test(cur.rec.url || ''));
    $('#btn-pen').classList.toggle('on', !!rt.pen);
    $('#btn-float').classList.toggle('hidden', !cur);
    const repo = snap.repo;
    $('#btn-repo').classList.toggle('hidden', !repo);
    if (repo) {
      const k = repo.kind === 'github' ? 'github' : 'gitlab';
      if ($('#btn-repo').dataset.k !== k) { $('#btn-repo').innerHTML = B.svg(k); $('#btn-repo').dataset.k = k; }
      $('#btn-repo').title = (repo.kind === 'github' ? 'GitHub' : 'GitLab') + ' · ' + repo.path + ' — cloner, ouvrir dans VS Code / Cursor, PR, issues…';
    }
    const inSplit = !!splitActive();
    $('#btn-split').classList.toggle('hidden', !cur || curFloating);
    $('#btn-split').classList.toggle('on', inSplit);
    $('#btn-split').title = inSplit ? 'Quitter le côte à côte (Ctrl+Maj+K)' : 'Mettre côte à côte : deux sites dans la même fenêtre (Ctrl+Maj+K)';
    $('#btn-float').classList.toggle('on', curFloating);
    $('#btn-float').title = curFloating ? 'Ramener le site dans le navigateur (Ctrl+Maj+P)' : 'Mettre en superposition : le site flotte au-dessus de tes fenêtres (Ctrl+Maj+P)';
    $('#floating-note').classList.toggle('hidden', !curFloating);
    if (curFloating) $('#floating-site').textContent = cur.rec.title || cur.rec.url;

    // Bouclier
    const blocked = cur ? rt.blocked || 0 : 0;
    const shield = $('#shield');
    $('#shield-count').textContent = s.shieldLevel === 'off' ? 'off' : blocked;
    shield.className = 'shield' + (s.shieldLevel === 'off' ? ' off' : blocked > 0 ? ' active' : '');
    if (blocked > lastBlocked) {
      shield.classList.remove('bump');
      void shield.offsetWidth;
      shield.classList.add('bump');
    }
    lastBlocked = blocked;

    const ai = AI_PROVIDERS[s.ai] || AI_PROVIDERS.claude;
    $('#ai-label').textContent = ai.label;
    if ($('#ai-logo').dataset.k !== s.ai) { $('#ai-logo').innerHTML = B.svg(s.ai); $('#ai-logo').dataset.k = s.ai; }
    $('#btn-ai').classList.toggle('on', !!snap.aiOpen);
    $('#btn-inspector').classList.toggle('on', inspector.open);
    renderFocusTool();

    // Poulailler actif
    const pIcon = $('#poulailler-icon');
    pIcon.innerHTML = I.svg(p.icon);
    pIcon.style.setProperty('--c', p.color);
    $('#poulailler-name').textContent = p.name;
    $('#poulailler-lock').classList.toggle('hidden', !p.isolated);

    $('#fav-label').classList.toggle('hidden', !snap.state.favorites.length && !dragging);
    if (!dragging) {
      renderFavorites();
      renderTabs(p);
      renderSpaces();
      if (body.classList.contains('side-top')) {
        sizeTopTabs();
        const act = document.querySelector('.lists .tab.active');
        if (act && act.dataset.id !== lastScrolledTab) { act.scrollIntoView({ inline: 'nearest', block: 'nearest' }); lastScrolledTab = act.dataset.id; }
      }
    }

    // Écran vide
    $('#empty').classList.toggle('hidden', !!snap.currentTabId);
    $('#float-ill').innerHTML = I.svg('superposition');
    $('#empty-title').textContent = `${p.name} — poulailler vide`;

    // Panneau IA
    $('#ai-panel').classList.toggle('hidden', !snap.aiOpen);
    const sw = $('#ai-switch');
    sw.replaceChildren(...Object.entries(AI_PROVIDERS).map(([k, v]) =>
      h('button', { class: s.ai === k ? 'on' : '', title: `${v.label} (${v.by})`, onclick: () => api.cmd('settings.set', { ai: k }) }, logo(k), v.label)));

    $('#inspector').classList.toggle('hidden', !inspector.open);
    if (overlay === 'settings') renderSettingsBody();
    if (overlay === 'focus') renderFocusBody();
    maybeRefreshInspector();
    scheduleLayout();

    if (!snap.state.onboarded && !onboardingShown) startOnboarding();
  }

  function tabEl(rec, opts = {}) {
    const rt = rtOf(rec.id);
    const active = snap.currentTabId === rec.id;
    const xpage = extPage(rec.url);
    const title = isInternal(rec.url) ? internalTitle(rec.url) : xpage ? (xpage.name || xpage.ext.name) + (xpage.name ? ' · ' + xpage.ext.name : '') : (rec.title && !(rec.title === 'Nouvel onglet' && /^https?:/.test(rec.url)) ? rec.title : hostOf(rec.url) || rec.url);
    const el = h('div', {
      class: `tab${active ? ' active' : ''}${rt.awake ? '' : ' asleep'}${rec.ephemeral ? ' ephemeral' : ''}`,
      draggable: 'true',
      'data-id': rec.id,
      title: `${title}\n${rec.url}${rt.awake ? (rt.memMb ? '\nMémoire : ' + rt.memMb + ' Mo' : '') : '\n🌙 En veille — se recharge au clic (libère de la mémoire)'}`,
    });
    const fic = rt.loading ? h('span', { class: 'spinner' }) : favicon(rec);
    // En veille : petite lune sur l'icône (le style fait le reste)
    el.append(!rt.loading && !rt.awake && /^https?:|^chrome-extension:/.test(rec.url || '') ? h('span', { class: 'fi-wrap' }, fic, h('span', { class: 'zz', html: I.svg('veille') })) : fic);
    if (rt.badge) el.append(h('span', { class: 'badge-n' + (rt.badge < 0 ? ' dot' : ''), title: rt.badge < 0 ? 'Nouvelles notifications' : rt.badge + ' non lu(s)' }, rt.badge > 0 ? (rt.badge > 99 ? '99+' : String(rt.badge)) : ''));
    if (rec.ephemeral) el.append(icon('fantome', 'eph'));
    if (rt.floating) el.append(icon('superposition', 'eph floatmark'));
    const sp = snap.split;
    if (sp && (sp.a === rec.id || sp.b === rec.id) && splitActive()) el.append(icon('cote', 'eph floatmark'));
    el.append(h('span', { class: 'title' }, title));
    if (rt.audible || rt.muted) {
      el.append(h('button', {
        class: 'audio', title: rt.muted ? 'Réactiver le son' : 'Couper le son',
        onclick: (e) => { e.stopPropagation(); api.cmd('tab.mute', rec.id); },
      }, svg(rt.muted ? ICONS.muted : ICONS.sound)));
    }
    if (!opts.pinned || active) {
      el.append(h('button', {
        class: 'x', title: opts.pinned ? 'Mettre en veille' : 'Fermer (Ctrl+W)',
        onclick: (e) => { e.stopPropagation(); api.cmd('tab.close', rec.id); },
      }, svg(ICONS.x)));
    }
    el.addEventListener('click', () => api.cmd('tab.activate', rec.id));
    el.addEventListener('auxclick', (e) => { if (e.button === 1) api.cmd('tab.close', rec.id); });
    el.addEventListener('contextmenu', (e) => { e.preventDefault(); api.cmd('tab.menu', rec.id); });
    wireDrag(el, rec.id);
    return el;
  }

  // Œuf pixel (sprite OEUF) recoloré à la couleur d'un groupe.
  const GROUP_COLORS = ['#FFE100', '#3BB273', '#1565D8', '#FE7146', '#A66CFF', '#FF5FA2', '#2EC4B6', '#EF3E36', '#E8D9B5'];
  function shade(hex, k) {
    const n = parseInt(String(hex).slice(1), 16);
    const f = (v) => Math.max(0, Math.min(255, Math.round(v * k)));
    return '#' + [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)].map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  function eggSvg(color) {
    const rows = Sp.OEUF;
    const dark = shade(color, 0.72);
    let rects = '';
    rows.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch === 'E') rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + color + '"/>';
      else if (ch === 'e') rects += '<rect x="' + x + '" y="' + y + '" width="1" height="1" fill="' + dark + '"/>';
    }));
    rects += '<rect x="3" y="2" width="1" height="2" fill="#fff" fill-opacity=".55"/>';
    return '<svg class="px egg-px" viewBox="0 0 10 10" shape-rendering="crispEdges">' + rects + '</svg>';
  }

  let eggClickTimer = 0;
  function groupEl(g, members) {
    const el = h('div', { class: 'egg-group' + (g.collapsed ? ' collapsed' : ''), 'data-group': g.id, style: { '--g': g.color } });
    const head = h('div', {
      class: 'egg-head', title: g.name + (g.auto ? ' — rangement automatique' : '') + '\nClic : replier / déplier · Double-clic : modifier · Clic droit : options',
      // Le repli attend un instant : un double-clic ouvre l’éditeur sans replier.
      onclick: () => { clearTimeout(eggClickTimer); eggClickTimer = setTimeout(() => api.cmd('group.update', { id: g.id, collapsed: !g.collapsed }), 230); },
      ondblclick: (e) => { e.preventDefault(); clearTimeout(eggClickTimer); openGroupEditor(g); },
      oncontextmenu: (e) => { e.preventDefault(); api.cmd('group.menu', g.id); },
    },
    h('span', { class: 'egg-ic', html: eggSvg(g.color) }),
    h('span', { class: 'egg-name' }, g.name),
    h('span', { class: 'egg-count' }, String(members.length)),
    g.auto ? icon('ia', 'egg-auto') : null,
    h('span', { class: 'egg-chev' }, '▾'));
    // Déposer un onglet sur l'en-tête = l'ajouter au groupe
    head.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); head.classList.add('drop-target'); } });
    head.addEventListener('dragleave', () => head.classList.remove('drop-target'));
    head.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      head.classList.remove('drop-target');
      if (dragging) api.cmd('tab.move', { id: dragging, poulaillerId: activeP().id, pinned: false, groupId: g.id });
      clearDrop();
    });
    const shown = g.collapsed ? members.filter((m) => m.id === snap.currentTabId) : members;
    el.append(head, h('div', { class: 'egg-tabs' }, ...shown.map((m) => tabEl(m))));
    return el;
  }

  // La liste n'est reconstruite que si quelque chose de visible a changé (l'état
  // arrive plusieurs fois par seconde pendant un chargement) ; les onglets qui
  // bougent glissent à leur nouvelle place au lieu de sauter (technique FLIP).
  let tabsSig = '';
  const calmMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function flipRender(container, build) {
    const before = new Map();
    for (const e of container.querySelectorAll('[data-id]')) before.set(e.dataset.id, e.getBoundingClientRect().top);
    build();
    if (calmMotion.matches || !before.size) return;
    const ease = 'cubic-bezier(0.22, 1, 0.36, 1)';
    for (const e of container.querySelectorAll('[data-id]')) {
      const top = before.get(e.dataset.id);
      if (top == null) {
        e.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 240, easing: ease });
        continue;
      }
      const dy = top - e.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) e.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: ease });
    }
  }

  function renderTabs(p) {
    const sig = JSON.stringify([p.id, snap.currentTabId, p.groups || [], snap.split && splitActive(), (snap.userExtensions || []).length,
      p.tabs.map((t) => { const r = rtOf(t.id); return [t.id, t.title, t.url, t.favicon, t.pinned, t.groupId, t.ephemeral, r.awake, r.loading, r.badge, r.audible, r.muted, r.floating]; })]);
    if (sig === tabsSig) return;
    tabsSig = sig;
    const pinned = p.tabs.filter((t) => t.pinned);
    // Barre du haut : les épinglés sont regroupés derrière une seule icône.
    const pb = $('#btn-pinned');
    const pinActive = pinned.some((t) => t.id === snap.currentTabId);
    pb.classList.toggle('hidden', !pinned.length);
    pb.classList.toggle('on', pinActive);
    pb.title = pinned.length + ' page' + (pinned.length > 1 ? 's' : '') + ' épinglée' + (pinned.length > 1 ? 's' : '') + ' — cliquer pour la liste';
    const activePin = pinned.find((t) => t.id === snap.currentTabId);
    pb.replaceChildren(icon('epingle', 'pb-ic'), activePin ? favicon(activePin, 'pb-fav') : null, h('span', { class: 'pb-count' }, String(pinned.length)));
    const tabs = p.tabs.filter((t) => !t.pinned);
    flipRender($('#pinned'), () => $('#pinned').replaceChildren(...pinned.map((t) => tabEl(t, { pinned: true }))));
    const groups = new Map((p.groups || []).map((g) => [g.id, g]));
    const nodes = [];
    const done = new Set();
    for (const t of tabs) {
      const g = t.groupId && groups.get(t.groupId);
      if (g) {
        if (done.has(g.id)) continue;
        done.add(g.id);
        nodes.push(groupEl(g, tabs.filter((x) => x.groupId === g.id)));
      } else nodes.push(tabEl(t));
    }
    flipRender($('#tabs'), () => $('#tabs').replaceChildren(...nodes));
  }

  function renderFavorites() {
    const grid = $('#favorites');
    grid.replaceChildren(...snap.state.favorites.map((rec) => {
      const rt = rtOf(rec.id);
      const el = h('button', {
        class: `fav${snap.currentTabId === rec.id ? ' active' : ''}${rt.awake ? '' : ' asleep'}`,
        title: rec.title || rec.url, draggable: 'true', 'data-id': rec.id,
        onclick: () => api.cmd('tab.activate', rec.id),
        oncontextmenu: (e) => { e.preventDefault(); api.cmd('tab.menu', rec.id); },
      }, favicon(rec, 'fi'), !rt.awake ? h('span', { class: 'zz fav-zz', html: I.svg('veille') }) : null, rt.badge ? h('span', { class: 'badge-n fav-badge' + (rt.badge < 0 ? ' dot' : '') }, rt.badge > 0 ? (rt.badge > 99 ? '99+' : String(rt.badge)) : '') : null);
      wireDrag(el, rec.id);
      return el;
    }));
  }

  function renderSpaces() {
    const wrap = $('#poulaillers');
    wrap.replaceChildren(...snap.state.poulaillers.map((p, i) => {
      const el = h('button', {
        class: 'space-dot' + (p.id === snap.state.activePoulailler ? ' active' : ''),
        style: { '--dot': p.color },
        title: `${p.name} (Ctrl+${i + 1})`,
        onclick: () => api.cmd('poulailler.switch', p.id),
        ondblclick: () => openPoulaillerEditor(p),
        oncontextmenu: (e) => { e.preventDefault(); api.cmd('poulailler.menu', p.id); },
      }, icon(p.icon));
      el.addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); el.classList.add('drop-target'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('drop-target');
        if (dragging) api.cmd('tab.move', { id: dragging, poulaillerId: p.id, pinned: false, index: 0 });
      });
      return el;
    }));
  }

  // ───────────────────────────────────────────── glisser-déposer des onglets
  let dropLine = null;
  function wireDrag(el, id) {
    el.addEventListener('dragstart', (e) => {
      dragging = id;
      document.body.classList.add('is-dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      requestAnimationFrame(() => el.classList.add('dragging'));
    });
    el.addEventListener('dragend', () => {
      dragging = null;
      document.body.classList.remove('is-dragging');
      clearDrop();
      render();
    });
  }
  function clearDrop() {
    if (dropLine) dropLine.remove();
    dropLine = null;
    document.querySelectorAll('.drop-target').forEach((x) => x.classList.remove('drop-target'));
  }
  function dropIndex(container, e) {
    const horizontal = document.body.classList.contains('side-top') || container.id === 'favorites';
    const items = [...container.querySelectorAll('[data-id]')].filter((c) => c.dataset.id !== dragging && c.offsetParent);
    let i = 0;
    for (; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      if ((horizontal ? e.clientX : e.clientY) < mid) break;
    }
    return { index: i, before: items[i] || null };
  }
  for (const zone of document.querySelectorAll('[data-drop]')) {
    zone.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      zone.classList.add('drop-target');
      if (zone.id === 'favorites') return;
      const { before } = dropIndex(zone, e);
      if (!dropLine) dropLine = h('div', { class: 'drop-line' });
      const inGroup = e.target.closest && e.target.closest('.egg-tabs');
      if (before) before.parentNode.insertBefore(dropLine, before);
      else (inGroup || zone).append(dropLine);
    });
    zone.addEventListener('dragleave', (e) => {
      if (!zone.contains(e.relatedTarget)) {
        zone.classList.remove('drop-target');
        if (dropLine && dropLine.parentNode === zone) dropLine.remove();
      }
    });
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragging) return;
      const kind = zone.dataset.drop;
      const { index, before } = dropIndex(zone, e);
      const p = activeP();
      const pinnedCount = p.tabs.filter((t) => t.pinned && t.id !== dragging).length;
      // Position réelle dans la liste (les groupes repliés cachent des onglets)
      const unpinned = p.tabs.filter((t) => !t.pinned && t.id !== dragging);
      const realIndex = before ? Math.max(0, unpinned.findIndex((t) => t.id === before.dataset.id)) : unpinned.length;
      const grp = e.target.closest && e.target.closest('.egg-group');
      const groupId = grp ? grp.dataset.group : null;
      if (kind === 'favorites') api.cmd('tab.move', { id: dragging, favorite: true, index });
      else if (kind === 'pinned') api.cmd('tab.move', { id: dragging, poulaillerId: p.id, pinned: true, index });
      else api.cmd('tab.move', { id: dragging, poulaillerId: p.id, pinned: false, index: pinnedCount + (zone.id === 'tabs' ? realIndex : index), groupId });
      clearDrop();
    });
  }

  // ───────────────────────────────────────────── placement des vues natives
  let layoutRaf = 0;
  function scheduleLayout() {
    cancelAnimationFrame(layoutRaf);
    layoutRaf = requestAnimationFrame(sendLayout);
  }
  function rectOf(el, inset = 0) {
    const r = el.getBoundingClientRect();
    return { x: r.left + inset, y: r.top + inset, width: r.width - inset * 2, height: r.height - inset * 2 };
  }
  // Côte à côte : la zone de contenu est coupée en deux panneaux séparés par
  // une barre de 12 px ; chaque vue est rentrée de 3 px pour laisser voir le
  // liseré du panneau actif.
  const SPLIT_GAP = 12;
  let splitDragRatio = null;
  function splitActive() {
    const sp = snap && snap.split;
    if (!sp) return null;
    const a = findRec(sp.a);
    const b = findRec(sp.b);
    if (!a || !b || rtOf(sp.a).floating || rtOf(sp.b).floating) return null;
    return sp;
  }
  function splitPanes(c) {
    const sp = splitActive();
    const ratio = splitDragRatio ?? sp.ratio ?? 0.5;
    const wA = Math.round((c.width - SPLIT_GAP) * ratio);
    return {
      a: { x: c.x, y: c.y, width: wA, height: c.height },
      b: { x: c.x + wA + SPLIT_GAP, y: c.y, width: c.width - wA - SPLIT_GAP, height: c.height },
    };
  }
  const inset = (r, n) => ({ x: r.x + n, y: r.y + n, width: r.width - n * 2, height: r.height - n * 2 });
  function sendLayout() {
    const aiVisible = !$('#ai-panel').classList.contains('hidden');
    const content = rectOf($('#content'), 1);
    const payload = { content, ai: aiVisible ? rectOf($('#ai-slot')) : null };
    const sp = splitActive();
    const ring = $('#split-ring');
    const divider = $('#split-divider');
    if (sp) {
      const panes = splitPanes(content);
      payload.splitA = inset(panes.a, 3);
      payload.splitB = inset(panes.b, 3);
      const box = $('#content').getBoundingClientRect();
      const focusPane = snap.currentTabId === sp.b ? panes.b : panes.a;
      Object.assign(ring.style, { left: (focusPane.x - box.left) + 'px', top: (focusPane.y - box.top) + 'px', width: focusPane.width + 'px', height: focusPane.height + 'px' });
      Object.assign(divider.style, { left: (panes.a.x + panes.a.width - box.left) + 'px', width: SPLIT_GAP + 'px' });
      const ghosts = $('#split-ghosts').children;
      Object.assign(ghosts[0].style, { left: (panes.a.x - box.left) + 'px', width: panes.a.width + 'px' });
      Object.assign(ghosts[1].style, { left: (panes.b.x - box.left) + 'px', width: panes.b.width + 'px' });
    }
    ring.classList.toggle('hidden', !sp);
    divider.classList.toggle('hidden', !sp);
    $('#content').classList.toggle('is-split', !!sp);
    api.setLayout(payload);
  }

  // Barre centrale : glisser pour régler la répartition. Pendant le glissé, les
  // pages sont masquées (sinon elles captent la souris) et remplacées par deux
  // aperçus avec l'icône et le titre de chaque site.
  $('#split-divider').addEventListener('pointerdown', async (e) => {
    if (e.button !== 0 || !splitActive()) return;
    e.preventDefault();
    const div = e.currentTarget;
    div.setPointerCapture(e.pointerId);
    const sp = splitActive();
    const ghosts = $('#split-ghosts');
    [sp.a, sp.b].forEach((id, i) => {
      const f = findRec(id);
      ghosts.children[i].replaceChildren(favicon(f.rec, 'gh-ic'), h('span', null, f.rec.title || hostOf(f.rec.url)));
    });
    ghosts.classList.remove('hidden');
    document.body.classList.add('resizing');
    await api.cmd('views.hidden', true);
    const box = $('#content').getBoundingClientRect();
    const move = (ev) => {
      splitDragRatio = Math.max(0.2, Math.min(0.8, (ev.clientX - box.left - SPLIT_GAP / 2) / (box.width - SPLIT_GAP)));
      sendLayout();
    };
    const up = async () => {
      div.removeEventListener('pointermove', move);
      div.removeEventListener('pointerup', up);
      div.removeEventListener('pointercancel', up);
      const r = splitDragRatio;
      document.body.classList.remove('resizing');
      ghosts.classList.add('hidden');
      if (r != null) await api.cmd('split.ratio', r);
      splitDragRatio = null;
      api.cmd('views.hidden', false);
    };
    div.addEventListener('pointermove', move);
    div.addEventListener('pointerup', up);
    div.addEventListener('pointercancel', up);
  });
  $('#split-divider').addEventListener('dblclick', () => api.cmd('split.ratio', 0.5));
  $('#split-divider').addEventListener('contextmenu', (e) => { e.preventDefault(); api.cmd('split.menu'); });
  const ro = new ResizeObserver(scheduleLayout);
  ro.observe($('#content'));
  ro.observe($('#ai-slot'));
  window.addEventListener('resize', scheduleLayout);
  // Les animations de la barre déplacent le contenu : on suit jusqu'à la fin.
  $('#sidebar').addEventListener('transitionend', scheduleLayout);

  // ───────────────────────────────────────────── superpositions
  const ov = $('#overlay');
  async function openOverlay(name, build) {
    if (peekState.open) closePeek(true);
    if (overlay) closeOverlay(true);
    overlay = name;
    const content = $('#content');
    const shot = snap && snap.currentTabId ? await api.cmd('capture') : null;
    if (overlay !== name) return;
    if (shot) {
      content.style.backgroundImage = `url("${shot}")`;
      content.classList.add('capturing');
    }
    await api.cmd('views.hidden', true);
    ov.replaceChildren(build());
    ov.classList.remove('hidden');
    const auto = ov.querySelector('[autofocus]');
    if (auto) auto.focus();
  }
  function closeOverlay(silent) {
    if (!overlay) return;
    overlay = null;
    if (snap) applyLook(lookOf(activeP()));
    ov.classList.add('hidden');
    ov.replaceChildren();
    if (!silent && !onboardingShown) api.cmd('views.hidden', false);
    setTimeout(() => {
      if (overlay || frozen) return;
      const content = $('#content');
      content.style.backgroundImage = '';
      content.classList.remove('capturing');
    }, 80);
  }
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) closeOverlay(); });

  // ───────────────────────────────────────────── palette de commandes (Ctrl+T / Ctrl+L)
  const looksLikeUrl = (t) => /^(https?|pouley|file):/i.test(t) || (!/\s/.test(t) && /^[\w-]+(\.[\w-]+)*\.[a-z][a-z0-9-]{1,62}(:\d+)?(\/.*)?$/i.test(t)) || /^localhost(:\d+)?/.test(t);

  function paletteCommands() {
    const s = S();
    const ai = AI_PROVIDERS[s.ai];
    const list = [
      { label: 'Nouveau poulailler', icon: 'plus', run: () => openPoulaillerEditor(null) },
      { label: 'Paramètres', icon: 'reglages', run: () => openSettings() },
      { label: 'Coffre à mots de passe', icon: 'cle', run: () => openVault() },
      { label: 'Inspecter le site (vie privée, technos, couleurs)', icon: 'inspecter', run: () => toggleInspector(true) },
      { label: `Ouvrir ${ai.label}`, logo: s.ai, run: () => api.cmd('ai.toggle') },
      { label: `Résumer la page avec ${ai.label}`, logo: s.ai, run: () => api.cmd('ai.askPage') },
      { label: 'Onglet éphémère (rien n’est gardé)', icon: 'fantome', run: () => api.cmd('tab.new', { ephemeral: true }) },
      { label: 'Rouvrir le dernier onglet fermé', icon: 'retour', run: () => api.cmd('tab.reopen') },
      { label: 'Épingler / désépingler l’onglet', icon: 'epingle', run: () => api.cmd('tab.pin') },
      { label: 'Ajouter / retirer des favoris', icon: 'etoile', run: () => api.cmd('tab.favorite') },
      { label: 'Copier l’adresse', icon: 'lien', run: () => api.cmd('tab.copyUrl') },
      { label: 'Capture d’écran : zone visible', icon: 'capture', run: () => api.cmd('shot.capture', { mode: 'visible' }) },
      { label: 'Capture d’écran : page entière', icon: 'page', run: () => api.cmd('shot.capture', { mode: 'full' }) },
      { label: 'Capture d’écran : sélectionner une zone', icon: 'selection', run: () => setTimeout(startRegionShot, 120) },
      { label: 'Mettre le site en superposition / le ramener', icon: 'superposition', run: () => api.cmd('tab.float') },
      { label: 'Mettre côte à côte avec un autre site', icon: 'cote', run: () => setTimeout(() => openPalette('split'), 120) },
      { label: 'Quitter le côte à côte', icon: 'cote', run: () => api.cmd('split.end') },
      { label: 'Ouvrir NadsPDF', icon: 'page', run: () => api.cmd('ext.nadspdf.open') },
      { label: 'Ouvrir un PDF de l’ordinateur dans NadsPDF', icon: 'page', run: () => api.cmd('ext.nadspdf.openFile') },
      { label: 'Extensions', icon: 'extension', run: () => openSettings('extensions') },
      { label: 'Ranger les onglets en groupes d’œufs', icon: 'oeuf', run: () => groupAuto() },
      { label: 'Nouveau groupe d’œufs avec cet onglet', icon: 'oeuf', run: async () => { if (!snap.currentTabId) return; const id = await api.cmd('group.create', { tabIds: [snap.currentTabId] }); setTimeout(() => { const g = (activeP().groups || []).find((x) => x.id === id); if (g) openGroupEditor(g); }, 150); } },
      { label: 'Jouer à Pouley contre le Renard', icon: 'renard', run: () => api.cmd('tab.new', { url: 'pouley://jeu' }) },
      { label: 'Archive des onglets', icon: 'archive', run: () => openArchive() },
      { label: 'Afficher / masquer la barre', icon: 'barre-masquer', run: () => toggleSidebar() },
      { label: 'Barre à gauche', icon: 'barre-gauche', run: () => api.cmd('settings.set', { sidebarPosition: 'left' }) },
      { label: 'Barre à droite', icon: 'barre-droite', run: () => api.cmd('settings.set', { sidebarPosition: 'right' }) },
      { label: 'Barre en haut', icon: 'barre-haut', run: () => api.cmd('settings.set', { sidebarPosition: 'top' }) },
      { label: 'Bouclier strict', icon: 'bouclier', run: () => api.cmd('settings.set', { shieldLevel: 'strict' }) },
      { label: 'Bouclier standard', icon: 'bouclier', run: () => api.cmd('settings.set', { shieldLevel: 'standard' }) },
      { label: 'Désactiver le bouclier pour l’instant', icon: 'bouclier-off', run: () => api.cmd('settings.set', { shieldLevel: 'off' }) },
      { label: 'Thème clair / sombre', icon: 'theme', run: () => api.cmd('settings.set', { theme: s.theme === 'light' ? 'nads' : 'light' }) },
      { label: 'Effacer cookies et données de navigation', icon: 'effacer', run: () => api.cmd('data.clearAll') },
      { label: 'Revoir l’histoire de Pouley', icon: 'livre', run: () => api.cmd('onboarding.replay') },
      { label: 'Outils de développement', icon: 'code', run: () => api.cmd('tab.devtools') },
    ];
    if (snap.cometAvailable) list.push({ label: 'Ouvrir cette page dans Comet', icon: 'comet', run: () => api.cmd('tab.openInComet') });
    for (const p of snap.state.poulaillers) list.push({ label: `Aller au poulailler ${p.name}`, icon: p.icon, color: p.color, run: () => api.cmd('poulailler.switch', p.id) });
    return list;
  }

  function openPalette(mode = 'new') {
    const cur = current();
    const initial = mode === 'edit' && cur && !isInternal(cur.rec.url) ? cur.rec.url : '';
    let sel = 0;
    let items = [];
    const input = h('input', { value: initial, placeholder: mode === 'edit' ? 'Modifier l’adresse…' : mode === 'split' ? 'Quel site mettre à côté ? Un onglet ouvert, une adresse ou une recherche…' : 'Rechercher, saisir une adresse, ou « ? » pour demander à l’IA…', spellcheck: 'false', autofocus: true });
    const list = h('div', { class: 'palette-list' });
    const s = S();
    const engine = SEARCH_ENGINES[s.searchEngine];
    const ai = AI_PROVIDERS[s.ai];
    // Perplexity par défaut : un moteur classique en second choix (Ctrl+Entrée).
    const k2 = s.searchEngine === 'comet' ? (SEARCH_ENGINES[s.searchEngine2] && s.searchEngine2 !== 'comet' ? s.searchEngine2 : 'duckduckgo') : null;
    const engine2 = k2 && SEARCH_ENGINES[k2];
    const search2 = (q) => go(fill(engine2.url, q));

    const go = (text) => {
      if (mode === 'split') return api.cmd('split.start', { input: text });
      if (mode === 'edit' && snap.currentTabId) api.cmd('tab.navigate', { input: text });
      else api.cmd('tab.new', { input: text });
    };

    function build() {
      const q = input.value.trim();
      const ql = q.toLowerCase();
      items = [];
      // Onglets, favoris et épinglés qui correspondent, classés par pertinence.
      // Une correspondance forte (le site ou le titre commence par le texte tapé)
      // passe AVANT la recherche web : « workyt » + Entrée ouvre ton favori.
      const all = [
        ...snap.state.favorites.map((t) => ({ t, p: null, fav: true })),
        ...snap.state.poulaillers.flatMap((p) => p.tabs.map((t) => ({ t, p, pin: !!t.pinned }))),
      ];
      const scoreOf = ({ t, fav, pin }) => {
        if (!q) return (fav ? 3 : pin ? 2 : 1);
        const host = hostOf(t.url).toLowerCase();
        const title = (t.title || '').toLowerCase();
        const url = (t.url || '').toLowerCase();
        let sc = 0;
        if (host === ql || host.split('.')[0] === ql) sc = 10;
        else if (host.startsWith(ql) || title.startsWith(ql)) sc = 8;
        else if (host.includes(ql)) sc = 5;
        else if (title.includes(ql) || url.includes(ql)) sc = 3;
        if (!sc) return 0;
        return sc + (fav ? 2 : 0) + (pin ? 1.5 : 0);
      };
      const ranked = all.map((x) => ({ ...x, sc: scoreOf(x) })).filter((x) => x.sc > 0 && !(x.t.id === snap.currentTabId && (mode === 'edit' || mode === 'split')))
        .sort((a, b) => b.sc - a.sc);
      const tabItem = ({ t, p, fav, pin }) => ({
        kind: fav ? 'Favori' : pin ? 'Épinglé · ' + p.name : p.name,
        badge: fav ? 'fav' : pin ? 'pin' : null,
        icon: favicon(t), label: isInternal(t.url) ? internalTitle(t.url) : t.title || t.url,
        sub: hostOf(t.url), run: () => (mode === 'split' ? api.cmd('split.start', { other: t.id }) : api.cmd('tab.activate', t.id)),
      });
      const strong = q && !q.startsWith('?') ? ranked.filter((x) => x.sc >= 8).slice(0, 3) : [];
      // Recherche par mot-clé (gh, gl, npm, mdn, so, yt, w) : proposée en premier
      const kw = keywordSearch(q);
      if (kw) items.push({ kind: kw.label, icon: B.LOGOS[kw.logo] ? logo(kw.logo, 'ico') : svg(ICONS.search), label: 'Rechercher « ' + kw.query + ' » sur ' + kw.label, run: () => go(q) });
      if (!kw && REPO_SHORT.test(q) && !looksLikeUrl(q)) items.push({ kind: 'GitHub', icon: logo('github', 'ico'), label: 'Ouvrir le dépôt github.com/' + q, run: () => go('https://github.com/' + q) });
      for (const x of strong) items.push(tabItem(x));
      if (q) {
        if (q.startsWith('?')) {
          items.push({ kind: ai.label, icon: logo(s.ai, 'ico'), label: `Demander à ${ai.label} : ${q.slice(1).trim()}`, run: () => api.cmd('ai.ask', q.slice(1).trim()) });
        } else if (looksLikeUrl(q)) {
          items.push({ kind: 'Aller', icon: svg(ICONS.globe), label: q, run: () => go(q) });
          items.push({ kind: engine.label, icon: logo(s.searchEngine, 'ico'), label: `Rechercher « ${q} »`, run: () => go(`${q} `) });
          if (engine2) items.push({ kind: engine2.label, icon: logo(k2, 'ico'), label: `Rechercher « ${q} » sur ${engine2.label}`, run: () => search2(q) });
        } else {
          items.push({ kind: engine.label, icon: logo(s.searchEngine, 'ico'), label: `Rechercher « ${q} »`, run: () => go(q) });
          if (engine2) items.push({ kind: engine2.label + ' · Ctrl ↵', icon: logo(k2, 'ico'), label: `Rechercher « ${q} » sur ${engine2.label}`, run: () => search2(q) });
          items.push({ kind: ai.label, icon: logo(s.ai, 'ico'), label: `Demander à ${ai.label}`, run: () => api.cmd('ai.ask', q) });
        }
      }
      for (const x of ranked.filter((r) => !strong.includes(r)).slice(0, q ? 6 : 8)) items.push(tabItem(x));
      if (q) {
        (snap.state.archive || []).forEach((a, i) => {
          if (items.length < 14 && ((a.title || '').toLowerCase().includes(ql) || a.url.toLowerCase().includes(ql))) {
            items.push({ kind: 'Archive', icon: svg(ICONS.archive), label: a.title || a.url, sub: hostOf(a.url), run: () => api.cmd('archive.restore', i) });
          }
        });
      }
      const cmds = mode === 'split' ? [] : paletteCommands().filter((c) => !q || c.label.toLowerCase().includes(ql));
      for (const c of cmds.slice(0, q ? 6 : 5)) { const ic = c.logo ? logo(c.logo, 'ico') : icon(c.icon, 'ico'); if (c.color) ic.style.color = c.color; items.push({ kind: 'Commande', icon: ic, label: c.label, run: c.run }); }
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((it, i) => h('div', {
        class: 'pl-item' + (i === sel ? ' sel' : ''),
        onmousemove: () => { if (sel !== i) { sel = i; mark(); } },
        onclick: () => run(i),
      }, it.icon, h('span', { class: 't' }, it.label, it.sub ? h('small', null, it.sub) : null),
        h('span', { class: 'pl-kind' + (it.badge ? ' pl-' + it.badge : '') }, it.badge ? icon(it.badge === 'fav' ? 'etoile' : 'epingle', 'pl-badge-ic') : null, it.kind))));
    }
    function mark() {
      [...list.children].forEach((c, i) => c.classList.toggle('sel', i === sel));
      const el = list.children[sel];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
    function run(i) {
      const it = items[i];
      closeOverlay();
      if (it) it.run();
      else if (input.value.trim()) go(input.value.trim());
    }
    input.addEventListener('input', () => { sel = 0; build(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); mark(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); mark(); e.preventDefault(); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        const q = input.value.trim();
        if (e.shiftKey && q) { closeOverlay(); api.cmd('ai.ask', q.replace(/^\?/, '')); }
        else if (e.altKey && q) { closeOverlay(); api.cmd('tab.new', { input: q, background: true }); }
        else if (e.ctrlKey && q && engine2) { closeOverlay(); search2(q); }
        else run(sel);
      } else if (e.key === 'Escape') closeOverlay();
    });
    build();
    openOverlay('palette', () => h('div', { class: 'modal' },
      h('div', { class: 'palette-input' }, svg(ICONS.search), input, h('span', { class: 'mode' }, mode === 'edit' ? 'onglet actuel' : mode === 'split' ? 'côte à côte' : 'nouvel onglet')),
      list,
      h('div', { class: 'palette-foot' },
        h('span', null, h('kbd', null, '↵'), ' ouvrir'),
        h('span', null, h('kbd', null, 'Maj ↵'), ` demander à ${ai.label}`),
        h('span', null, h('kbd', null, 'Alt ↵'), ' en arrière-plan'),
        engine2 ? h('span', null, h('kbd', null, 'Ctrl ↵'), ' ' + engine2.label) : null,
        h('span', { title: Object.entries(KEYWORDS).map(([k, v]) => k + ' → ' + v.label).join('\n') }, h('kbd', null, 'gh'), h('kbd', null, 'npm'), h('kbd', null, 'yt'), ' mots-clés'),
        h('span', null, h('kbd', null, 'Échap'), ' fermer'))));
    setTimeout(() => { input.focus(); input.select(); }, 30);
  }

  // ───────────────────────────────────────────── réglages
  function switchEl(on, onChange) {
    return h('button', { class: 'switch' + (on ? ' on' : ''), onclick: () => onChange(!on), role: 'switch', 'aria-checked': String(on) });
  }
  function toggleRow(label, sub, key) {
    return h('div', { class: 'toggle-row' }, h('div', { class: 'lbl' }, label, h('small', null, sub)),
      switchEl(!!S()[key], (v) => api.cmd('settings.set', { [key]: v })));
  }
  function choiceCards(options, value, onPick) {
    return h('div', { class: 'cards' }, ...Object.entries(options).map(([k, o]) =>
      h('button', { class: 'card' + (value === k ? ' on' : ''), onclick: () => onPick(k) },
        h('b', null, B.LOGOS[k] ? logo(k, 'card-logo') : null, o.label),
        h('small', null, o.note || o.by || ''))));
  }
  // ───────────────────────────────────────────── Paramètres, style Nads
  // Une seule description des réglages, affichée de deux façons :
  //  - « Simple » (par défaut) : titres en français, explications, interrupteurs ;
  //  - « Code » : chaque réglage est une ligne de code colorée (pour les devs).
  let settingsFile = 'ia';
  let settingsQuery = '';
  let settingsView = localStorage.getItem('pouley-settings-view') === 'code' ? 'code' : 'simple';

  const SETTINGS_FILES = [
    { id: 'ia', file: 'ia.config', icon: 'ia', tint: '#c678dd', label: 'Assistant IA', desc: 'L’IA qui t’aide à côté de tes pages.' },
    { id: 'recherche', file: 'recherche.config', icon: 'inspecter', tint: '#61afef', label: 'Recherche', desc: 'Le moteur utilisé quand tu tapes autre chose qu’une adresse.' },
    { id: 'barre', file: 'barre.layout', icon: 'barre-gauche', tint: '#e5c07b', label: 'Barre des onglets', desc: 'Où elle se place et comment elle se comporte.' },
    { id: 'apparence', file: 'fenetre.style', icon: 'theme', tint: '#56b6c2', label: 'Apparence', desc: 'Transparence de la fenêtre et thème.' },
    { id: 'coffre', file: 'coffre.lock', icon: 'cle', tint: '#ffe100', label: 'Mots de passe', desc: 'Ton coffre chiffré, qui ne quitte jamais ton ordinateur.' },
    { id: 'bouclier', file: 'bouclier.rules', icon: 'bouclier', tint: '#98c379', label: 'Vie privée', desc: 'Ce que le bouclier bloque pour te protéger.' },
    { id: 'son', file: 'son.notif', icon: 'musique', tint: '#fe7146', label: 'Sons', desc: 'Le cri de poule des notifications.' },
    { id: 'productivite', file: 'plumes.score', icon: 'travail', tint: '#e8b33c', label: 'Productivité', desc: 'Des plumes quand tu avances, des tenders quand tu traînes sur les sites qui distraient.' },
    { id: 'legerete', file: 'legerete.ts', icon: 'etoile', tint: '#d19a66', label: 'Performances', desc: 'Garder le navigateur léger et rapide.' },
    { id: 'extensions', file: 'extensions.json', icon: 'extension', tint: '#ef3e36', label: 'Extensions', desc: 'Les extensions préinstallées, qui fonctionnent sans connexion.' },
    { id: 'donnees', file: 'donnees.sh', icon: 'effacer', tint: '#e06c75', label: 'Données', desc: 'Tout reste sur ta machine. Tu peux tout effacer.' },
    { id: 'apropos', file: 'README.md', icon: 'livre', tint: '#abb2bf', label: 'À propos', desc: 'PouleyPwolu, le navigateur de Nads.' },
  ];

  const opt = (code, label, note, extra) => ({ code, label, note, ...extra });

  // Description déclarative des réglages de chaque section.
  function sectionItems(id) {
    const st = S();
    const glass = st.windowMaterial && st.windowMaterial !== 'none';
    switch (id) {
      case 'ia': return [
        { type: 'choice', set: 'ai', name: 'ia', label: 'Ton assistant', help: 'Il s’ouvre dans un panneau à droite (Ctrl+E). Tu peux aussi taper « ? » suivi de ta question dans la barre d’adresse.',
          options: Object.fromEntries(Object.entries(AI_PROVIDERS).map(([k, v]) => [k, opt(k, v.label, 'par ' + v.by, { logo: true })])) },
        { type: 'actions', items: [{ label: 'Ouvrir l’assistant', run: () => api.cmd('ai.toggle') }, { label: 'Résumer la page actuelle', run: () => api.cmd('ai.askPage') }] },
      ];
      case 'recherche': return [
        { type: 'choice', set: 'searchEngine', name: 'moteur', label: 'Moteur de recherche', help: 'Utilisé depuis la barre d’adresse et la page Nouvel onglet.',
          options: Object.fromEntries(Object.entries(SEARCH_ENGINES).map(([k, v]) => [k, opt(k, v.label, v.note, { logo: true })])) },
        st.searchEngine === 'comet' ? { type: 'choice', set: 'searchEngine2', name: 'second_choix', label: 'Second choix',
          help: 'Perplexity répond avec l’IA. Quand tu veux plutôt une liste de sites classique, ce moteur est proposé juste en dessous dans la barre d’adresse (Ctrl+Entrée), sur la page Nouvel onglet et au clic droit.',
          options: Object.fromEntries(Object.entries(SEARCH_ENGINES).filter(([k]) => k !== 'comet').map(([k, v]) => [k, opt(k, v.label, v.note, { logo: true })])) } : null,
        { type: 'info', name: 'comet', label: 'Application Comet', value: snap.cometAvailable ? 'Installée' : 'Non installée',
          help: snap.cometAvailable ? 'Clic droit sur une page ou un lien → « Ouvrir dans Comet ».' : 'Installe Comet pour pouvoir y ouvrir une page en un clic.' },
      ].filter(Boolean);
      case 'barre': return [
        { type: 'choice', set: 'sidebarPosition', name: 'position', label: 'Position', help: 'À gauche comme Arc, à droite, ou en haut comme un navigateur classique.',
          options: { left: opt('gauche', 'À gauche', 'Comme Arc'), right: opt('droite', 'À droite', 'Côté droit'), top: opt('haut', 'En haut', 'Onglets classiques') } },
        { type: 'bool', set: 'sidebarAutoHide', name: 'masquer', label: 'Masquer la barre', help: 'Elle s’ouvre quand la souris touche le bord de la fenêtre et se referme quand tu en sors. Raccourci : Ctrl+S.' },
        { type: 'number', set: 'sidebarWidth', name: 'largeur', label: 'Largeur', help: 'Tu peux aussi glisser le bord de la barre.', min: 200, max: 440, unit: 'px' },
        { type: 'bool', set: 'favHoverPreview', name: 'apercu_favoris', label: 'Aperçu des favoris au survol', help: 'Passe la souris sur un favori (Google Agenda, Gmail…) : la page s’affiche dans une bulle, sans quitter ce que tu fais.' },
        { type: 'bool', set: 'swipePoulaillers', name: 'glisser_poulaillers', label: 'Glisser pour changer de poulailler', help: 'Un glissement horizontal à deux doigts sur la barre latérale passe au poulailler suivant (comme Arc). Désactivé : glisser fait simplement défiler tes onglets.' },
        { type: 'bool', set: 'autoGroupTabs', name: 'groupes_auto', label: 'Ranger automatiquement en groupes d’œufs', help: 'Quand deux onglets vont ensemble (même site, ou même thème : développement, vidéos, achats…), ils sont réunis côte à côte dans un groupe coloré.' },
        { type: 'actions', items: [{ label: 'Ranger mes onglets maintenant', run: () => { closeOverlay(); groupAuto(); } }] },
      ];
      case 'apparence': return [
        { type: 'choice', set: 'windowMaterial', name: 'verre', label: 'Transparence de la fenêtre', help: 'Avec « Verre dépoli », on voit ce qu’il y a derrière le navigateur, flouté. Les pages web restent bien lisibles.',
          options: { acrylic: opt('acrylique', 'Verre dépoli', 'On voit derrière'), mica: opt('mica', 'Mica', 'Teinte légère'), none: opt('opaque', 'Opaque', 'Pas de transparence') } },
        glass ? { type: 'range', set: 'chromeOpacity', name: 'opacite', label: 'Opacité du fond', help: 'Plus c’est bas, plus on voit à travers.', def: 0.55,
          live: (v) => document.documentElement.style.setProperty('--chrome-a', String(v)) } : null,
        { type: 'choice', set: 'theme', name: 'theme', label: 'Thème', help: 'Couleurs de l’interface.',
          options: { nads: opt('nads', 'Sombre', 'Le thème Nads'), light: opt('clair', 'Clair', 'Pour le grand jour') } },
        { type: 'actions', help: 'Les couleurs, le dégradé et le grain se règlent pour chaque poulailler.',
          items: [{ label: 'Personnaliser le poulailler actuel', run: () => { closeOverlay(); setTimeout(() => openPoulaillerEditor(activeP()), 60); } }] },
      ].filter(Boolean);
      case 'coffre': {
        const v = snap.vault || {};
        const never = st.vaultNever || [];
        return [
          { type: 'info', name: 'etat', label: 'Coffre', value: !v.exists ? 'Pas encore créé' : v.open ? 'Ouvert · ' + v.count + ' identifiant' + (v.count > 1 ? 's' : '') : 'Verrouillé',
            help: 'Chiffré en AES-256 avec une clé tirée de ton mot de passe maître (scrypt, 128 Mo de mémoire par essai). Le mot de passe maître n’est enregistré nulle part.' },
          { type: 'actions', items: [
            { label: v.exists ? 'Ouvrir le coffre' : 'Créer mon coffre', cmd: 'coffre', run: () => { closeOverlay(); setTimeout(() => openVault(), 60); } },
            v.open ? { label: 'Verrouiller maintenant', cmd: 'coffre --verrouiller', run: () => api.cmd('vault.lock') } : null,
            v.open ? { label: 'Changer le mot de passe maître', cmd: 'coffre --maitre', run: () => { closeOverlay(); setTimeout(() => openVault({ mode: 'master' }), 60); } } : null,
          ].filter(Boolean) },
          { type: 'bool', set: 'vaultOffer', name: 'proposer', label: 'Proposer d’enregistrer les mots de passe', help: 'Après une connexion, un bandeau propose de ranger le mot de passe. Dans les champs de connexion, une petite clé jaune remplit ton identifiant en un clic.' },
          { type: 'number', set: 'vaultAutoLockMinutes', name: 'verrouillage_auto', label: 'Verrouiller après', min: 0, max: 240, unit: 'min',
            help: 'Sans utilisation. Le coffre se verrouille aussi quand tu verrouilles Windows, quand l’ordinateur se met en veille et à la fermeture. 0 = seulement dans ces cas-là.' },
          v.exists ? { type: 'info', name: 'windows_hello', label: 'Windows Hello', value: v.hello ? 'Activé' : 'Désactivé',
            help: 'Ouvre le coffre avec ton visage, ton empreinte ou ton code PIN Windows. La clé est alors aussi protégée par Windows, et ne sert qu’après confirmation de Windows Hello.' } : null,
          v.open ? { type: 'actions', items: [{ label: v.hello ? 'Désactiver Windows Hello' : 'Activer Windows Hello', run: async () => {
            const r = await api.cmd('vault.setHello', !v.hello);
            if (r && r.error) toast(r.error, { title: 'Windows Hello' });
          } }] } : null,
          never.length ? { type: 'info', name: 'jamais', label: 'Jamais proposé pour', value: never.length + ' site' + (never.length > 1 ? 's' : ''), help: never.join(', ') } : null,
          never.length ? { type: 'actions', items: [{ label: 'Proposer de nouveau partout', run: () => api.cmd('settings.set', { vaultNever: [] }) }] } : null,
        ].filter(Boolean);
      }
      case 'bouclier': return [
        { type: 'choice', set: 'shieldLevel', name: 'niveau', label: 'Niveau du bouclier', help: 'Le bouclier bloque les traqueurs publicitaires, les réseaux sociaux qui te suivent, la prise d’empreinte et l’enregistrement de tes clics.',
          options: { strict: opt('strict', 'Strict', 'Bloque tout (conseillé)'), standard: opt('standard', 'Standard', 'Laisse passer les statistiques'), off: opt('off', 'Désactivé', 'Déconseillé') } },
        { type: 'bool', set: 'httpsOnly', name: 'https_partout', label: 'Connexion sécurisée partout', help: 'Utilise toujours la version chiffrée des sites et te prévient si un site n’en a pas.' },
        { type: 'bool', set: 'blockThirdPartyCookies', name: 'cookies_tiers', label: 'Bloquer les cookies de pistage', help: 'Empêche les publicitaires de te suivre d’un site à l’autre.' },
        { type: 'bool', set: 'sendGpc', name: 'signal_gpc', label: 'Demander aux sites de ne pas vendre tes données', help: 'Envoie le signal « Global Privacy Control » à chaque site.' },
      ];
      case 'son': return [
        { type: 'bool', set: 'notifSound', name: 'cri_de_poule', label: 'Cri de poule', help: 'Joue un cri de poule pour les alertes, les téléchargements terminés et les notifications des sites.' },
        { type: 'range', set: 'notifVolume', name: 'volume', label: 'Volume', help: '', def: 0.6 },
        { type: 'bool', set: 'mediaPlayer', name: 'mini_lecteur', label: 'Mini-lecteur de musique', help: 'Affiche le morceau en cours (YouTube, YouTube Music, SoundCloud…) avec lecture / pause / suivant, dans la barre.' },
        { type: 'bool', set: 'mediaSystem', name: 'musique_windows', label: 'Piloter la musique des applications (Spotify…)', help: 'Affiche et contrôle aussi Spotify ou une autre application qui joue de la musique sur Windows. Spotify Web ne peut pas jouer dans PouleyPwolu (protection DRM) : utilise l’application Spotify.' },
        { type: 'actions', help: 'Écouter :', items: [['cot', 'Cot'], ['alerte', 'Alerte'], ['oeuf', 'Téléchargement'], ['notif', 'Notification']].map(([k, l]) => ({ label: '▶ ' + l, run: () => window.PouleySound.play(k, st.notifVolume ?? 0.6) })) },
      ];
      case 'productivite': return [
        { type: 'bool', set: 'focusEnabled', name: 'compteur', label: 'Compter les plumes et les tenders', help: 'Toutes les 5 minutes passées sur un site de la liste ci-dessous = un tender. 5 minutes actives ailleurs = une plume. Le compteur ne tourne que quand PouleyPwolu est au premier plan et que tu es devant l’écran. Il reste sur ta machine (chiffré), 14 jours maximum.' },
        { type: 'bool', set: 'focusNudge', name: 'petit_mot', label: 'Me prévenir quand les tenders s’accumulent', help: 'Un petit mot de Pouley tous les 3 tenders (15 minutes de distraction).' },
        { type: 'focussites', name: 'sites_qui_distraient', label: 'Sites qui distraient', help: 'Le temps passé sur ces sites compte en tenders. Ajoute ou retire ceux que tu veux.' },
        { type: 'actions', items: [
          { label: 'Voir mon poulailler du jour', cmd: 'plumes --aujourdhui', run: () => openFocus() },
          { label: 'Remettre la liste par défaut', cmd: 'plumes --liste-par-defaut', run: () => api.cmd('focus.resetSites') },
          { label: 'Effacer le compteur', cmd: 'plumes --effacer', danger: true, run: () => { if (confirm('Effacer toutes les plumes et tous les tenders ?')) api.cmd('focus.clear'); } },
        ] },
      ];
      case 'legerete': return [
        { type: 'memory' },
        { type: 'choice', set: 'memoryMode', name: 'mode_memoire', label: 'Mode mémoire', help: 'Chaque page ouverte coûte 100 à 200 Mo. Un onglet en veille ne coûte presque rien et se recharge au clic.',
          options: {
            econome: opt('econome', 'Économe', 'Veille après 5 min · 4 pages éveillées max'),
            equilibre: opt('equilibre', 'Équilibré', 'Veille après 15 min · 8 pages max'),
            performance: opt('performance', 'Performance', 'Veille après 1 h · sans limite'),
            perso: opt('perso', 'Personnalisé', 'Tu choisis le délai ci-dessous'),
          } },
        st.memoryMode === 'perso' ? { type: 'number', set: 'sleepAfterMinutes', name: 'veille_apres', label: 'Mettre en veille les onglets inutilisés après', help: 'Libère de la mémoire. L’onglet se recharge quand tu cliques dessus. 0 = jamais.', min: 0, max: 600, unit: 'min' } : null,
        { type: 'number', set: 'archiveAfterHours', name: 'archive_apres', label: 'Ranger les vieux onglets après', help: 'Les onglets non épinglés vont dans l’archive, comme dans Arc. 0 = jamais.', min: 0, max: 720, unit: 'h' },
        { type: 'info', name: 'veille_urgence', label: 'Veille d’urgence', value: 'Automatique', help: 'Si Windows n’a plus que 10 % de mémoire libre, les onglets en arrière-plan s’endorment tout de suite.' },
      ].filter(Boolean);
      case 'donnees': return [
        { type: 'info', name: 'chiffrement', label: 'Tes onglets, favoris et poulaillers', value: snap.security && snap.security.stateEncrypted ? 'Chiffrés' : 'Non chiffrés',
          help: 'Chiffrés en AES-256-GCM. La clé est protégée par Windows : elle ne s’ouvre que dans ta session, pas depuis un autre compte ni un autre ordinateur.' },
        { type: 'info', name: 'cookies', label: 'Cookies et connexions aux sites', value: snap.security && snap.security.cookies ? 'Chiffrés' : 'Version de développement',
          help: 'Dans la version installée, Chromium chiffre les cookies avec une clé protégée par Windows.' },
        { type: 'bool', set: 'wipeCacheOnExit', name: 'pas_de_cache_sur_le_disque', label: 'Effacer le cache des pages en fermant', help: 'Le cache contient des copies des pages visitées. Il est effacé à chaque fermeture (et au démarrage après un plantage). Les sites se chargent un peu moins vite la première fois.' },
        { type: 'info', name: 'bitlocker', label: 'Disque chiffré (BitLocker)', value: { on: 'Activé', off: 'Désactivé', paused: 'En pause' }[snap.security && snap.security.bitlocker] || 'Inconnu',
          help: 'BitLocker chiffre tout le disque : si l’ordinateur est volé, éteint, personne ne peut lire tes fichiers ni les données des sites (stockage local, historique de téléchargement…). C’est la protection la plus complète.' },
        snap.security && snap.security.bitlocker === 'off' ? { type: 'actions', items: [{ label: 'Activer le chiffrement de Windows', run: () => api.cmd('security.bitlocker') }] } : null,
        { type: 'bool', set: 'clearOnExit', name: 'effacer_a_la_fermeture', label: 'Tout effacer en fermant le navigateur', help: 'Supprime cookies, caches et données des sites à chaque fermeture.' },
        { type: 'actions', items: [
          { label: 'Effacer cookies et données maintenant', danger: true, cmd: 'effacer --tout', run: () => api.cmd('data.clearAll') },
          { label: 'Voir l’archive des onglets', cmd: 'archive', run: () => { closeOverlay(); openArchive(); } },
          { label: 'Revoir l’histoire de Pouley', cmd: 'histoire --rejouer', run: () => { closeOverlay(); api.cmd('onboarding.replay'); } },
        ] },
      ].filter(Boolean);
      case 'extensions': return [
        { type: 'extadd' },
        ...(snap.userExtensions || []).map((e) => ({ type: 'userext', ext: e, name: 'ext_' + e.id.slice(0, 6), label: e.name })),
        ...(snap.extensions || []).map((e) => ({ type: 'extcard', ext: e, set: e.setting, name: e.key, label: e.name })),
        { type: 'actions', help: 'NadsPDF ouvre automatiquement les PDF du web. Pour un fichier de ton ordinateur :', items: [
          { label: 'Ouvrir NadsPDF', cmd: 'nadspdf', run: () => { closeOverlay(); api.cmd('ext.nadspdf.open'); } },
          { label: 'Ouvrir un PDF de l’ordinateur', cmd: 'nadspdf --fichier', run: () => { closeOverlay(); api.cmd('ext.nadspdf.openFile'); } },
        ] },
        snap.nadspdfApp ? { type: 'info', name: 'application_nadspdf', label: 'Application NadsPDF', value: 'Installée',
          help: 'Les PDF téléchargés proposent « Ouvrir dans NadsPDF » pour les éditer dans l’application complète.' } : null,
      ].filter(Boolean);
      case 'apropos': {
        const u = snap.update || { status: 'idle' };
        const v = snap.versions || {};
        const statusText = {
          dev: 'Version de développement : pas de mise à jour automatique',
          unavailable: 'Module de mise à jour absent',
          idle: 'Pas encore vérifié',
          checking: 'Vérification…',
          uptodate: 'À jour',
          downloading: 'Téléchargement de la version ' + (u.version || '') + ' : ' + (u.progress || 0) + ' %',
          ready: 'Version ' + u.version + ' prête — redémarre pour l’installer',
          error: 'Serveur de mises à jour injoignable',
        }[u.status] || u.status;
        return [
          { type: 'about' },
          { type: 'info', name: 'version', label: 'Version', value: 'PouleyPwolu ' + snap.version, help: 'Moteur : Chromium ' + (v.chromium || '?') + ' (Electron ' + (v.electron || '?') + ').' },
          { type: 'bool', set: 'autoUpdate', name: 'mises_a_jour_auto', label: 'Mises à jour automatiques', help: 'Vérifie au démarrage puis toutes les 6 h sur la page GitHub de PouleyPwolu (aucun identifiant envoyé), télécharge en arrière-plan et installe au prochain redémarrage. C’est la seule connexion que PouleyPwolu fait de lui-même : garde-la active pour recevoir les correctifs de sécurité de Chromium.' },
          { type: 'info', name: 'etat', label: 'État', value: statusText, help: u.error ? u.error : '' },
          { type: 'actions', items: u.status === 'ready'
            ? [{ label: 'Redémarrer et installer ' + u.version, run: () => api.cmd('update.install') }]
            : [{ label: 'Vérifier maintenant', run: () => api.cmd('update.check') }] },
        ];
      }
      default: return [];
    }
  }

  // ── Rendu « Simple » : lisible par tout le monde
  function simpleItem(it) {
    const st = S();
    const set = (v) => api.cmd('settings.set', { [it.set]: v });
    const head = (control) => h('div', { class: 'set-row' },
      h('div', { class: 'set-txt' }, h('b', null, it.label), it.help ? h('p', null, it.help) : null), control);
    switch (it.type) {
      case 'choice':
        return h('div', { class: 'set-block' },
          h('div', { class: 'set-txt' }, h('b', null, it.label), it.help ? h('p', null, it.help) : null),
          h('div', { class: 'set-cards' }, ...Object.entries(it.options).map(([k, o]) => h('button', {
            class: 'set-card' + (st[it.set] === k ? ' on' : ''), onclick: () => set(k),
          }, o.logo && B.LOGOS[k] ? logo(k, 'set-logo') : null, h('span', null, h('b', null, o.label), o.note ? h('small', null, o.note) : null),
          h('i', { class: 'set-radio' })))));
      case 'bool':
        return head(h('button', { class: 'set-switch' + (st[it.set] ? ' on' : ''), role: 'switch', 'aria-checked': String(!!st[it.set]), onclick: () => set(!st[it.set]) }, h('i')));
      case 'number':
        return head(h('label', { class: 'set-num' },
          h('input', { type: 'number', min: it.min, max: it.max, value: st[it.set],
            onchange: (e) => set(Math.max(it.min, Math.min(it.max, Number(e.target.value) || 0))) }), h('span', null, it.unit)));
      case 'range': {
        const v = st[it.set] ?? it.def;
        const out = h('span', { class: 'set-val' }, Math.round(v * 100) + ' %');
        return head(h('div', { class: 'set-range' },
          h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: v,
            oninput: (e) => { out.textContent = Math.round(e.target.value * 100) + ' %'; if (it.live) it.live(Number(e.target.value)); },
            onchange: (e) => set(Number(e.target.value)) }), out));
      }
      case 'info':
        return head(h('span', { class: 'set-badge' }, it.value));
      case 'actions':
        return h('div', { class: 'set-block' }, it.help ? h('p', { class: 'set-help' }, it.help) : null,
          h('div', { class: 'set-actions' }, ...it.items.map((a) => h('button', { class: 'btn' + (a.danger ? ' danger' : ' nads'), onclick: a.run }, a.label))));
      case 'focussites': {
        const input = h('input', { class: 'v-input', placeholder: 'Ajouter un site, ex. tiktok.com', spellcheck: 'false' });
        const add = async () => {
          const v = input.value.trim();
          if (!v) return;
          const site = await api.cmd('focus.addSite', v);
          if (site) input.value = '';
          else toast('Ce n’est pas une adresse de site valide.');
        };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') add(); });
        return h('div', { class: 'set-block' },
          h('div', { class: 'set-txt' }, h('b', null, it.label), h('p', null, it.help)),
          h('div', { class: 'fc-sites' }, ...(st.focusSites || []).map((site) => h('span', { class: 'fc-site' }, site,
            h('button', { title: 'Retirer ' + site, onclick: () => api.cmd('focus.removeSite', site) }, '×')))),
          h('div', { class: 'v-pwrow' }, input, h('button', { class: 'btn nads', onclick: add }, 'Ajouter')));
      }
      case 'memory': {
        const box = h('div', { class: 'set-mem' }, h('p', { class: 'set-help' }, 'Mesure en cours…'));
        api.cmd('memory.report').then((r) => {
          if (!r) return;
          const awake = r.tabs.length;
          box.replaceChildren(
            h('div', { class: 'mem-top' },
              h('div', { class: 'mem-big' }, h('b', null, r.totalMb + ' Mo'), h('span', null, 'utilisés par PouleyPwolu')),
              h('div', { class: 'mem-big' }, h('b', null, String(awake)), h('span', null, 'page' + (awake > 1 ? 's' : '') + ' éveillée' + (awake > 1 ? 's' : ''))),
              h('div', { class: 'mem-big' }, h('b', null, r.freePct + ' %'), h('span', null, 'mémoire libre sur l’ordinateur'))),
            h('div', { class: 'mem-list' }, ...r.tabs.slice(0, 6).map((t) => h('div', { class: 'mem-row' },
              h('span', { class: 'mem-name' }, t.title), h('i', { style: { width: Math.min(100, t.mb / 4) + '%' } }), h('b', null, t.mb + ' Mo')))),
            h('div', { class: 'set-actions' },
              h('button', { class: 'btn nads', onclick: async () => {
                const n = await api.cmd('memory.free');
                toast(n ? n + ' onglet' + (n > 1 ? 's mis' : ' mis') + ' en veille.' : 'Rien à libérer : seul l’onglet affiché est éveillé.', { title: 'Mémoire' });
                setTimeout(renderSettingsBody, 1200);
              } }, 'Libérer la mémoire maintenant'),
              h('span', { class: 'set-help' }, 'Moteur graphique : ' + r.gpuMb + ' Mo (fixe)')));
        });
        return box;
      }
      case 'extadd': {
        const input = h('input', { class: 'v-input', placeholder: 'Adresse sur le Chrome Web Store, ex. chromewebstore.google.com/detail/proton-pass/…', spellcheck: 'false' });
        const go = () => { if (input.value.trim()) installExtension(input.value.trim()); };
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
        return h('div', { class: 'set-block ext-add' },
          h('div', { class: 'set-txt' }, h('b', null, 'Ajouter une extension Chrome'),
            h('p', null, 'Colle le lien d’une extension du Chrome Web Store (Proton Pass, Bitwarden, uBlock Origin Lite, Dark Reader…), ou ouvre sa page dans un onglet : un bandeau propose de l’ajouter. PouleyPwolu vérifie la signature du développeur avant d’installer.')),
          h('div', { class: 'v-pwrow' }, input,
            h('button', { class: 'btn nads', onclick: go }, 'Installer'),
            h('button', { class: 'btn', onclick: () => { closeOverlay(); api.cmd('tab.new', { url: 'https://chromewebstore.google.com/' }); } }, 'Parcourir le store')));
      }
      case 'userext': {
        const e = it.ext;
        const on = e.enabled !== false && e.available;
        return h('div', { class: 'set-ext' + (on ? ' on' : '') },
          e.icon ? h('img', { class: 'set-ext-ic', src: e.icon, alt: '' }) : h('span', { class: 'set-ext-ic', html: I.svg('extension') }),
          h('div', { class: 'set-txt' },
            h('div', { class: 'set-ext-title' }, h('b', null, e.name), e.version ? h('span', { class: 'set-ext-ver' }, 'v' + e.version) : null),
            h('p', null, e.description || ''),
            e.permissions && e.permissions.length ? h('span', { class: 'set-ext-status' }, 'Peut : ' + e.permissions.slice(0, 3).join(' · ').toLowerCase()) : null,
            h('div', { class: 'set-actions ext-card-actions' },
              e.options ? h('button', { class: 'btn', onclick: () => { closeOverlay(); api.cmd('ext.options', e.id); } }, 'Options') : null,
              h('button', { class: 'btn', onclick: () => api.cmd('ext.pin', { id: e.id, on: e.pinned === false }) }, e.pinned === false ? 'Afficher le bouton' : 'Masquer le bouton'),
              h('button', { class: 'btn danger', onclick: () => { if (confirm('Supprimer ' + e.name + ' et ses données ?')) api.cmd('ext.remove', e.id); } }, 'Supprimer'))),
          h('button', { class: 'set-switch' + (on ? ' on' : ''), disabled: !e.available, title: on ? 'Désactiver' : 'Activer', onclick: () => api.cmd('ext.enable', { id: e.id, on: !on }) }, h('i')));
      }
      case 'extcard': {
        const e = it.ext;
        const on = st[e.setting] !== false && e.available;
        return h('div', { class: 'set-ext' + (on ? ' on' : '') },
          e.icon ? h('img', { class: 'set-ext-ic', src: e.icon, alt: '' }) : h('span', { class: 'set-ext-ic', html: I.svg('extension') }),
          h('div', { class: 'set-txt' },
            h('div', { class: 'set-ext-title' }, h('b', null, e.name), e.version ? h('span', { class: 'set-ext-ver' }, 'v' + e.version) : null),
            h('p', null, e.description || ''),
            h('span', { class: 'set-ext-status' }, e.available ? e.status : 'Fichiers de l’extension introuvables')),
          h('button', { class: 'set-switch' + (on ? ' on' : ''), disabled: !e.available, title: on ? 'Désactiver' : 'Activer', onclick: () => api.cmd('ext.toggle', e.key) }, h('i')));
      }
      case 'about':
        return h('div', { class: 'set-about' },
          h('div', { class: 'set-about-head' }, h('span', { class: 'set-about-logo', html: pouleSvg() }),
            h('div', null, h('b', null, 'PouleyPwolu'), h('small', null, 'Version ' + snap.version + ' · par Nads'))),
          h('ul', null,
            h('li', null, 'Aucune donnée collectée : pas de compte, pas de statistiques, pas de rapport de plantage.'),
            h('li', null, 'Aucun historique enregistré. Tes réglages et tes poulaillers restent sur ta machine.'),
            h('li', null, 'Le bouclier, l’analyse des technos et des couleurs tournent sur ton ordinateur.')),
          h('p', { class: 'set-help' }, 'Logiciel propriétaire gratuit © 2026 Nadir Tounsi (Nads). Logos : Simple Icons (CC0) et LobeHub Icons (MIT).'),
          h('div', { class: 'set-actions' },
            h('button', { class: 'btn nads', onclick: () => { closeOverlay(); api.cmd('tab.new', { url: 'pouley://static/legal/LICENSE.txt' }); } }, 'Contrat de licence'),
            h('button', { class: 'btn', onclick: () => { closeOverlay(); api.cmd('tab.new', { url: 'pouley://static/legal/THIRD_PARTY_NOTICES.txt' }); } }, 'Licences des composants')));
      default: return null;
    }
  }

  // ── Rendu « Code » : une ligne de code par réglage (One Dark)
  const tk = (cls, text) => h('span', { class: 'tk ' + cls }, text);
  const cm = (text) => tk('cm', '# ' + text);
  function codeLines(items) {
    const st = S();
    const set = (k, v) => api.cmd('settings.set', { [k]: v });
    const lines = [];
    for (const it of items) {
      let value = null;
      if (it.type === 'choice') {
        value = h('span', { class: 'tk-choices' }, ...Object.entries(it.options).map(([k, o], i) => [
          i ? tk('pn', ' | ') : null,
          h('button', { class: 'tk-choice' + (st[it.set] === k ? ' on' : ''), title: o.label, onclick: () => set(it.set, k) },
            o.logo && B.LOGOS[k] ? logo(k, 'tk-logo') : null, tk('st', '"' + o.code + '"')),
        ]));
      } else if (it.type === 'bool') {
        const v = !!st[it.set];
        value = h('button', { class: 'tk-bool' + (v ? ' on' : ''), onclick: () => set(it.set, !v) }, h('i'), tk('kw', String(v)));
      } else if (it.type === 'number') {
        const input = h('input', { class: 'tk-num', type: 'number', min: it.min, max: it.max, value: st[it.set],
          onchange: (e) => set(it.set, Math.max(it.min, Math.min(it.max, Number(e.target.value) || 0))) });
        input.style.width = (String(st[it.set]).length + 2) + 'ch';
        value = h('span', null, input, tk('pn', ' ' + it.unit));
      } else if (it.type === 'range') {
        const v = st[it.set] ?? it.def;
        const out = tk('nb', String(Math.round(v * 100)));
        value = h('span', { class: 'tk-range' }, out, tk('pn', ' %'),
          h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: v,
            oninput: (e) => { out.textContent = Math.round(e.target.value * 100); if (it.live) it.live(Number(e.target.value)); },
            onchange: (e) => set(it.set, Number(e.target.value)) }));
      } else if (it.type === 'info') {
        value = tk('st', '"' + it.value + '"');
      } else if (it.type === 'focussites') {
        value = h('span', null, tk('pn', '['), ...(st.focusSites || []).map((x, i) => [i ? tk('pn', ', ') : null, tk('st', '"' + x + '"')]), tk('pn', ']'));
      } else if (it.type === 'extcard') {
        const v = st[it.set] !== false;
        value = h('button', { class: 'tk-bool' + (v ? ' on' : ''), onclick: () => api.cmd('ext.toggle', it.ext.key) }, h('i'), tk('kw', String(v)));
        lines.push({ name: it.name, value, comment: it.ext.name + ' ' + (it.ext.version || '') });
        continue;
      } else if (it.type === 'userext') {
        const v = it.ext.enabled !== false;
        value = h('button', { class: 'tk-bool' + (v ? ' on' : ''), onclick: () => api.cmd('ext.enable', { id: it.ext.id, on: !v }) }, h('i'), tk('kw', String(v)));
        lines.push({ name: it.name, value, comment: it.ext.name + ' ' + (it.ext.version || '') + ' (Chrome Web Store)' });
        continue;
      } else if (it.type === 'extadd') {
        lines.push({ raw: h('span', { class: 'tk-cmd' }, tk('pn', '$ '), tk('fn', 'pouley'), ' ', tk('st', 'extension --ajouter <lien du Chrome Web Store>'), '  ',
          h('button', { class: 'tk-lens', onclick: () => { settingsView = 'simple'; localStorage.setItem('pouley-settings-view', 'simple'); renderSettingsBody(); setTimeout(() => { const i = ov.querySelector('.ext-add input'); if (i) i.focus(); }, 50); } }, '▶ Exécuter')) });
        continue;
      }
      if (value) { lines.push({ name: it.name, value, comment: it.label }); continue; }
      if (it.type === 'actions') {
        lines.push({ blank: true });
        for (const a of it.items) {
          lines.push({ raw: h('span', { class: 'tk-cmd' }, tk('pn', '$ '), tk('fn', 'pouley'), ' ', tk('st', a.cmd || a.label.replace(/^▶ /, '').toLowerCase()), '  ',
            h('button', { class: 'tk-lens' + (a.danger ? ' danger' : ''), onclick: a.run }, '▶ Exécuter')) });
        }
      } else if (it.type === 'about') {
        lines.push({ raw: h('span', { class: 'md-h1' }, '# PouleyPwolu ', tk('nb', snap.version)) }, { blank: true },
          { raw: tk('cm', '> Zéro télémétrie · aucun historique · tout en local') });
      }
    }
    return lines;
  }

  function renderSettingsBody() {
    const ide = ov.querySelector('.nads-ide');
    if (!ide) return;
    const st = S();
    const code = settingsView === 'code';
    ide.classList.toggle('view-code', code);
    const q = settingsQuery.trim().toLowerCase();
    const textOf = (meta) => (meta.label + ' ' + meta.file + ' ' + meta.desc + ' ' + sectionItems(meta.id).map((it) => [it.label, it.help, it.name].filter(Boolean).join(' ')).join(' ')).toLowerCase();
    const matches = new Set(SETTINGS_FILES.filter((m) => !q || textOf(m).includes(q)).map((m) => m.id));
    if (q && !matches.has(settingsFile) && matches.size) settingsFile = [...matches][0];
    const meta = SETTINGS_FILES.find((m) => m.id === settingsFile) || SETTINGS_FILES[0];

    // Navigation à gauche : noms en français (ou fichiers en mode Code)
    ide.querySelector('.ide-panel-title').textContent = code ? 'EXPLORATEUR' : 'RÉGLAGES';
    ide.querySelector('.ide-tree').replaceChildren(...[
      code ? h('div', { class: 'tree-folder' }, h('span', { class: 'chev' }, '▾'), h('span', { class: 'tree-ic', html: I.svg('poule') }), 'pouley') : null,
      ...SETTINGS_FILES.map((m) => h('button', {
        class: 'tree-file' + (m.id === meta.id ? ' on' : '') + (q && !matches.has(m.id) ? ' dim' : '') + (code ? '' : ' human'),
        style: { '--t': m.tint }, title: m.desc,
        onclick: () => { settingsFile = m.id; renderSettingsBody(); },
      }, h('span', { class: 'tree-ic', html: I.svg(m.icon) }), code ? m.file : m.label)),
    ].filter(Boolean));

    // En-tête : onglet en pilule + bascule Simple / Code
    ide.querySelector('.ide-tabs').replaceChildren(...[
      h('span', { class: 'ide-tab on', style: { '--t': meta.tint } }, h('span', { class: 'tree-ic', html: I.svg(meta.icon) }), code ? meta.file : meta.label),
      code ? h('span', { class: 'ide-crumb' }, 'pouley', tk('pn', ' › '), meta.label) : null,
      h('span', { class: 'grow' }),
      h('div', { class: 'view-switch', title: 'Affichage des réglages' },
        h('button', { class: code ? '' : 'on', onclick: () => { settingsView = 'simple'; localStorage.setItem('pouley-settings-view', 'simple'); renderSettingsBody(); } }, 'Simple'),
        h('button', { class: code ? 'on' : '', onclick: () => { settingsView = 'code'; localStorage.setItem('pouley-settings-view', 'code'); renderSettingsBody(); } }, '</> Code')),
    ].filter(Boolean));

    const editor = ide.querySelector('.ide-code');
    const top = editor.scrollTop;
    const items = sectionItems(meta.id);
    if (code) {
      const lines = [{ note: meta.desc }, { blank: true }, ...codeLines(items)];
      editor.replaceChildren(...lines.map((l, i) => {
        let content;
        if (l.blank) content = h('span', null, '\u00a0');
        else if (l.note) content = cm(l.note);
        else if (l.raw) content = l.raw;
        else {
          const hit = q && (l.name + ' ' + (l.comment || '')).toLowerCase().includes(q);
          content = h('span', { class: 'kvl' + (hit ? ' hit' : '') }, tk('key', l.name), tk('pn', ' = '), l.value, l.comment ? h('span', { class: 'cmw' }, cm(l.comment)) : null);
        }
        return h('div', { class: 'ln' }, h('span', { class: 'gut' }, String(i + 1)), h('span', { class: 'src' }, content));
      }));
    } else {
      editor.replaceChildren(h('div', { class: 'set-page' },
        h('header', { class: 'set-head', style: { '--t': meta.tint } },
          h('span', { class: 'set-head-ic', html: I.svg(meta.icon) }),
          h('div', null, h('h2', null, meta.label), h('p', null, meta.desc))),
        ...items.map((it) => {
          const el = simpleItem(it);
          if (el && q && [it.label, it.help].filter(Boolean).join(' ').toLowerCase().includes(q)) el.classList.add('hit');
          return el;
        })));
    }
    editor.scrollTop = top;

    // Barre d'état
    const ai = AI_PROVIDERS[st.ai];
    const glass = st.windowMaterial && st.windowMaterial !== 'none';
    ide.querySelector('.ide-status').replaceChildren(
      h('span', { class: 'sb-branch' }, h('i'), 'Bouclier ' + ({ strict: 'strict', standard: 'standard', off: 'désactivé' }[st.shieldLevel] || st.shieldLevel)),
      h('span', { class: 'sb-logo' }, logo(st.ai), ai.label),
      h('span', { class: 'sb-logo' }, logo(st.searchEngine), SEARCH_ENGINES[st.searchEngine].label),
      h('span', null, glass ? (st.windowMaterial === 'mica' ? 'Mica ' : 'Verre dépoli ') + Math.round((st.chromeOpacity ?? 0.55) * 100) + ' %' : 'Fenêtre opaque'),
      h('span', { class: 'grow' }),
      h('span', null, 'Les changements sont enregistrés automatiquement'),
      h('span', null, 'v' + snap.version));
  }

  function openSettings(file) {
    if (file) settingsFile = file;
    settingsQuery = '';
    openOverlay('settings', () => {
      const search = h('input', { class: 'ide-search', placeholder: 'Rechercher un réglage… (ex. : cookies, transparence, son)', spellcheck: 'false',
        oninput: (e) => { settingsQuery = e.target.value; renderSettingsBody(); } });
      search.addEventListener('keydown', (e) => { if (e.key === 'Escape' && search.value) { search.value = ''; settingsQuery = ''; renderSettingsBody(); e.stopPropagation(); } });
      const m = h('div', { class: 'modal nads-ide' },
        h('div', { class: 'ide-top' },
          h('div', { class: 'pill-group' }, h('span', { class: 'ide-logo', html: pouleSvg() }), h('b', null, 'Paramètres')),
          h('label', { class: 'pill-group ide-search-wrap' }, svg(ICONS.search), search),
          h('button', { class: 'pill-group ide-close', title: 'Fermer (Échap)', onclick: () => closeOverlay() }, svg(ICONS.x))),
        h('div', { class: 'ide-body' },
          h('aside', { class: 'ide-panel ide-explorer' }, h('div', { class: 'ide-panel-title' }, 'RÉGLAGES'), h('div', { class: 'ide-tree' })),
          h('section', { class: 'ide-panel ide-editor' }, h('div', { class: 'ide-tabs' }), h('div', { class: 'ide-code' }))),
        h('div', { class: 'ide-status' }));
      setTimeout(() => { renderSettingsBody(); search.focus(); }, 0);
      return m;
    });
  }

  // Apparence d'un poulailler : deux couleurs pour le dégradé granuleux,
  // transparence (intensité) du dégradé et quantité de grain.
  const secondColor = (p) => p.color2 || (String(p.color).toUpperCase() === '#1565D8' ? '#FFE100' : '#1565D8');
  const lookOf = (p) => ({ color: p.color, color2: secondColor(p), gradient: p.gradient ?? 0.6, grain: p.grain ?? 0.24 });
  function applyLook(look) {
    const st = document.documentElement.style;
    const light = snap && S().theme === 'light';
    st.setProperty('--space', look.color);
    // Texte posé sur la couleur du poulailler : sombre sur une couleur claire, blanc sur une foncée.
    const n = parseInt(String(look.color).slice(1, 7), 16);
    const lum = Number.isFinite(n) ? (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255 : 1;
    st.setProperty('--on-space', lum > 0.55 ? '#141414' : '#ffffff');
    st.setProperty('--space2', look.color2);
    st.setProperty('--grad', String(look.gradient));
    st.setProperty('--grain-opacity', String(look.grain * (light ? 0.5 : 1)));
  }

  function openPoulaillerEditor(p) {
    const base = p || { color: POULAILLER_COLORS[snap.state.poulaillers.length % POULAILLER_COLORS.length] };
    const data = {
      name: p ? p.name : '', icon: p ? p.icon : 'oeuf', isolated: p ? p.isolated : false,
      ...lookOf(base),
    };
    // Aperçu en direct sur toute la fenêtre si on modifie le poulailler affiché.
    const live = !!p && p.id === snap.state.activePoulailler;
    let confirmDelete = false;
    openOverlay('editor', () => {
      const root = h('div', { class: 'modal editor' });
      let preview;
      let badge;
      const pct = (v) => Math.round(v * 100) + ' %';
      const paint = () => {
        root.style.setProperty('--c', data.color);
        if (preview) {
          preview.style.setProperty('--c1', data.color);
          preview.style.setProperty('--c2', data.color2);
          preview.style.setProperty('--g', String(data.gradient));
          preview.style.setProperty('--gr', String(data.grain));
        }
        if (badge) badge.style.setProperty('--c', data.color);
        if (live) applyLook(data);
      };
      const swatches = (key) => h('div', { class: 'color-row' },
        ...POULAILLER_COLORS.map((c) => h('button', {
          class: data[key].toUpperCase() === c.toUpperCase() ? 'on' : '', style: { background: c }, title: c,
          onclick: () => { data[key] = c; draw(); },
        })),
        h('label', { class: 'color-custom', title: 'Couleur libre' },
          h('input', { type: 'color', value: data[key].toLowerCase(),
            oninput: (e) => { data[key] = e.target.value.toUpperCase(); paint(); },
            onchange: () => draw() })));
      const slider = (key, label, hint) => {
        const val = h('span', { class: 'look-val' }, pct(data[key]));
        return h('div', { class: 'look-slider' },
          h('div', { class: 'lbl' }, label, h('small', null, hint)),
          h('input', { type: 'range', min: '0', max: '1', step: '0.01', value: data[key],
            oninput: (e) => { data[key] = Number(e.target.value); val.textContent = pct(data[key]); paint(); } }),
          val);
      };
      const draw = () => {
        const name = h('input', { type: 'text', value: data.name, placeholder: 'Nom du poulailler (Perso, Travail, Jeux…)', autofocus: true, oninput: (e) => { data.name = e.target.value; } });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') closeOverlay(); });
        badge = h('span', { class: 'p-badge big', html: I.svg(data.icon) });
        preview = h('div', { class: 'look-preview' }, badge, name);
        root.replaceChildren(
          h('h2', null, p ? 'Modifier le poulailler' : 'Nouveau poulailler'),
          preview,
          h('div', { class: 'editor-label' }, 'Icône'),
          h('div', { class: 'icon-grid' }, ...I.POULAILLER_ICONS.map((i) => h('button', { class: data.icon === i ? 'on' : '', title: i, onclick: () => { data.icon = i; draw(); } }, icon(i)))),
          h('div', { class: 'look-cols' },
            h('div', null, h('div', { class: 'editor-label' }, 'Couleur principale'), swatches('color')),
            h('div', null, h('div', { class: 'editor-label' }, 'Couleur du dégradé'), swatches('color2'))),
          slider('gradient', 'Transparence du dégradé', 'À gauche : presque invisible. À droite : couleurs franches.'),
          slider('grain', 'Grain', 'Texture de pellicule par-dessus le dégradé.'),
          h('div', { class: 'toggle-row' }, h('div', { class: 'lbl' }, 'Cookies isolés', h('small', null, 'Ce poulailler a ses propres cookies et sessions (ex. deux comptes Google).')),
            switchEl(data.isolated, (v) => { data.isolated = v; draw(); })),
          h('div', { class: 'actions' },
            p && snap.state.poulaillers.length > 1 ? h('button', { class: 'btn danger', onclick: async () => {
              if (!confirmDelete) { confirmDelete = true; draw(); return; }
              closeOverlay();
              await api.cmd('poulailler.delete', p.id);
            } }, confirmDelete ? 'Confirmer : tout supprimer' : 'Supprimer') : null,
            h('span', { class: 'grow' }),
            h('button', { class: 'btn', onclick: () => closeOverlay() }, 'Annuler'),
            h('button', { class: 'btn primary', onclick: save }, p ? 'Enregistrer' : 'Créer')));
        paint();
        setTimeout(() => name.focus(), 20);
      };
      const save = () => {
        const payload = { ...data, name: data.name.trim() || 'Poulailler' };
        closeOverlay();
        if (p) api.cmd('poulailler.update', { id: p.id, ...payload });
        else api.cmd('poulailler.create', payload);
      };
      draw();
      return root;
    });
  }

  function openArchive() {
    openOverlay('archive', () => {
      const arch = snap.state.archive || [];
      return h('div', { class: 'modal settings' },
        h('header', null, svg(ICONS.archive), h('h2', null, 'Archive des onglets'),
          arch.length ? h('button', { class: 'btn', onclick: () => { api.cmd('archive.clear'); closeOverlay(); } }, 'Vider') : null,
          h('button', { class: 'icon-btn', onclick: () => closeOverlay() }, svg(ICONS.x))),
        h('div', { class: 'archive-list' }, arch.length ? arch.map((a, i) => h('div', {
          class: 'pl-item', onclick: () => { closeOverlay(); api.cmd('archive.restore', i); },
        }, favicon(a), h('span', { class: 't' }, a.title || a.url, h('small', null, hostOf(a.url))),
          h('span', { class: 'pl-kind' }, `${a.poulailler || ''} · ${new Date(a.at).toLocaleDateString('fr-FR')}`)))
          : h('p', { class: 'about', style: { padding: '20px' } }, 'Rien d’archivé pour l’instant. Les onglets non épinglés inactifs depuis longtemps arrivent ici automatiquement.')));
    });
  }

  // ───────────────────────────────────────────── inspecteur
  function toggleInspector(force) {
    inspector.open = typeof force === 'boolean' ? force : !inspector.open;
    if (inspector.open) {
      inspector.key = null;
      maybeRefreshInspector(true);
    }
    render();
  }
  let inspTimer = 0;
  function maybeRefreshInspector(now) {
    if (!inspector.open || !snap) return;
    const cur = current();
    const key = cur ? cur.rec.id + '|' + cur.rec.url : 'none';
    const loading = cur && rtOf(cur.rec.id).loading;
    if (key === inspector.key || (loading && !now)) return;
    clearTimeout(inspTimer);
    inspTimer = setTimeout(() => runInspect(key), now ? 0 : 500);
  }
  // Détecteur d'IA : une analyse par page (les images sont téléchargées une fois).
  const aidCache = { key: null, promise: null };
  function detectPage() {
    const cur = current();
    const key = cur ? cur.rec.id + '|' + cur.rec.url : '';
    if (aidCache.key !== key || !aidCache.promise) {
      aidCache.key = key;
      aidCache.promise = api.cmd('aidetect.page', cur && cur.rec.id);
    }
    return aidCache.promise;
  }
  api.on('aidetect', (p) => {
    openOverlay('aidetect', () => h('div', { class: 'modal settings aid-modal' },
      h('header', null, h('h2', null, p.kind === 'image' ? 'Cette image vient-elle d’une IA ?' : 'Ce texte vient-il d’une IA ?'),
        h('button', { class: 'icon-btn', onclick: () => closeOverlay() }, svg(ICONS.x))),
      h('div', { class: 'body' }, p.kind === 'image'
        ? [window.PouleyInspector.aiImage(p.result, true), h('p', { class: 'aid-note' }, 'Analyse faite sur ton ordinateur, à partir des informations cachées dans le fichier. Une image sans signature peut quand même venir d’une IA.')]
        : window.PouleyInspector.aiText(p.result, { askAi: (prompt) => { closeOverlay(); api.cmd('ai.ask', prompt); }, ai: AI_PROVIDERS[S().ai], text: p.text }))));
  });

  async function runInspect(key) {
    inspector.key = key;
    const body = $('#insp-body');
    const cur = current();
    if (!cur) {
      body.replaceChildren(h('div', { class: 'insp-loading' }, pouleMini(), 'Aucun onglet ouvert.'));
      return;
    }
    body.replaceChildren(h('div', { class: 'insp-loading' }, pouleMini(), 'Pouley picore la page…'));
    const data = await api.cmd('inspect', cur.rec.id);
    if (inspector.key !== key) return;
    inspector.data = data;
    window.PouleyInspector.render(body, data, inspector.tab, {
      toast, ai: AI_PROVIDERS[S().ai], askAi: (prompt) => api.cmd('ai.ask', prompt), askPage: () => api.cmd('ai.askPage'), detectPage,
    });
  }
  $('#insp-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    inspector.tab = b.dataset.tab;
    for (const x of $('#insp-tabs').children) x.classList.toggle('on', x === b);
    if (inspector.data) window.PouleyInspector.render($('#insp-body'), inspector.data, inspector.tab, {
      toast, ai: AI_PROVIDERS[S().ai], askAi: (prompt) => api.cmd('ai.ask', prompt), askPage: () => api.cmd('ai.askPage'), detectPage,
    });
  });
  $('#insp-refresh').addEventListener('click', () => { inspector.key = null; maybeRefreshInspector(true); });
  $('#insp-close').addEventListener('click', () => toggleInspector(false));
  function openInspectorTab(tab) {
    inspector.tab = tab;
    for (const x of $('#insp-tabs').children) x.classList.toggle('on', x.dataset.tab === tab);
    toggleInspector(true);
  }

  // ───────────────────────────────────────────── productivité : plumes et tenders
  // Le processus principal compte les secondes ; ici on les convertit
  // (5 minutes = une plume ou un tender) et on les affiche.
  const FOCUS_UNIT = 300;
  const dayKeyOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const focusDay = (d = new Date()) => (((snap.state.focus || {}).days || {})[dayKeyOf(d)]) || { good: 0, bad: 0, sites: {} };
  const units = (secs) => Math.floor((secs || 0) / FOCUS_UNIT);
  const fmtDur = (secs) => {
    const m = Math.floor((secs || 0) / 60);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0');
  };
  $('#fc-plume').innerHTML = Sp.toSvg(Sp.PLUME);
  $('#fc-tender').innerHTML = Sp.toSvg(Sp.TENDER);
  let lastFocus = null;
  function renderFocusTool() {
    const btn = $('#btn-focus');
    const on = S().focusEnabled !== false;
    btn.classList.toggle('hidden', !on);
    if (!on) return;
    const d = focusDay();
    const pl = units(d.good);
    const te = units(d.bad);
    $('#fc-plumes').textContent = pl;
    $('#fc-tenders').textContent = te;
    btn.classList.toggle('tender-now', !!snap.focusSite);
    btn.classList.toggle('on', overlay === 'focus');
    btn.title = (snap.focusSite ? `${snap.focusSite} distrait : chaque 5 minutes ici = un tender.\n` : '') +
      `Aujourd’hui : ${pl} plume${pl > 1 ? 's' : ''} (${fmtDur(d.good)} utiles), ${te} tender${te > 1 ? 's' : ''} (${fmtDur(d.bad)} de distraction).`;
    if (lastFocus && (pl > lastFocus.pl || te > lastFocus.te)) {
      const el = pl > lastFocus.pl ? $('#fc-plume') : $('#fc-tender');
      el.classList.remove('gain'); void el.offsetWidth; el.classList.add('gain');
    }
    lastFocus = { pl, te };
  }
  $('#btn-focus').onclick = () => (overlay === 'focus' ? closeOverlay() : openFocus());

  function focusVerdict(pl, te) {
    if (!pl && !te) return 'La journée commence. 5 minutes utiles = une plume, 5 minutes sur un site qui distrait = un tender.';
    if (!te) return 'Zéro tender : Pouley est fière de toi !';
    if (pl >= te * 3) return 'Belle journée : bien plus de plumes que de tenders.';
    if (pl >= te) return 'Ça va, mais les tenders te guettent.';
    return 'Aïe, plus de tenders que de plumes… Pouley a faim de plumes.';
  }

  function openFocus() {
    openOverlay('focus', () => h('div', { class: 'modal settings focus-modal' },
      h('header', null, h('span', { class: 'fc-head-ic', html: Sp.toSvg(Sp.PLUME) }), h('h2', null, 'Mon poulailler du jour'),
        h('button', { class: 'btn', onclick: () => { closeOverlay(); openSettings('productivite'); } }, 'Réglages'),
        h('button', { class: 'icon-btn', onclick: () => closeOverlay() }, svg(ICONS.x))),
      h('div', { class: 'body', id: 'focus-body' }))).then(() => { renderFocusBody(); const b = ov.querySelector('#focus-body'); if (b) b.scrollTop = 0; });
  }

  function renderFocusBody() {
    const body = ov.querySelector('#focus-body');
    if (!body) return;
    // Le panneau se redessine à chaque mise à jour : on garde la position de lecture.
    const keepTop = body.scrollTop;
    requestAnimationFrame(() => { body.scrollTop = keepTop; });
    const d = focusDay();
    const pl = units(d.good);
    const te = units(d.bad);
    const total = pl + te;
    const cur = current();
    const curUrl = cur ? cur.rec.url : '';
    const curHost = /^https?:/.test(curUrl) ? hostOf(curUrl) : '';

    const big = (sprite, n, label, sub, cls) => h('div', { class: 'fc-big ' + cls },
      h('span', { class: 'fc-big-ic', html: Sp.toSvg(sprite) }),
      h('div', null, h('b', null, String(n)), h('span', null, label), h('small', null, sub)));

    // Les 7 derniers jours : plumes vers le haut, tenders vers le bas.
    const days = Array.from({ length: 7 }, (_, i) => { const x = new Date(); x.setDate(x.getDate() - (6 - i)); return x; });
    const stats = days.map((x) => { const v = focusDay(x); return { x, pl: units(v.good), te: units(v.bad) }; });
    const max = Math.max(4, ...stats.map((v) => Math.max(v.pl, v.te)));
    const week = h('div', { class: 'fc-week' }, ...stats.map((v, i) => h('div', { class: 'fc-day' + (i === 6 ? ' today' : ''), title: `${v.pl} plumes · ${v.te} tenders` },
      h('div', { class: 'fc-up' }, h('i', { style: { height: (v.pl / max) * 100 + '%' } })),
      h('div', { class: 'fc-down' }, h('i', { style: { height: (v.te / max) * 100 + '%' } })),
      h('small', null, i === 6 ? 'auj.' : v.x.toLocaleDateString('fr-FR', { weekday: 'short' })))));

    const sites = Object.entries(d.sites || {}).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const top = sites.length ? sites[0][1] : 1;

    body.replaceChildren(
      h('div', { class: 'fc-bigs' },
        big(Sp.PLUME, pl, pl > 1 ? 'plumes' : 'plume', fmtDur(d.good) + ' utiles', 'good'),
        big(Sp.TENDER, te, te > 1 ? 'tenders' : 'tender', fmtDur(d.bad) + ' de distraction', 'bad')),
      h('div', { class: 'fc-plumage', title: 'Part des plumes' }, h('i', { style: { width: (total ? (pl / total) * 100 : 50) + '%' } })),
      h('p', { class: 'fc-verdict' }, focusVerdict(pl, te)),
      snap.focusSite
        ? h('div', { class: 'fc-now bad' }, h('span', null, `Tu es sur ${snap.focusSite} : ça compte en tenders.`),
          h('button', { class: 'btn', onclick: () => api.cmd('focus.removeSite', snap.focusSite) }, 'Ce site ne me distrait pas'))
        : curHost ? h('div', { class: 'fc-now' }, h('span', null, `${curHost} compte en plumes.`),
          h('button', { class: 'btn', onclick: () => api.cmd('focus.addSite', curUrl) }, 'Ce site me distrait')) : null,
      h('h3', null, '7 derniers jours'),
      week,
      h('h3', null, 'Ce qui t’a distrait aujourd’hui'),
      sites.length
        ? h('div', { class: 'fc-sites-today' }, ...sites.map(([site, secs]) => h('div', { class: 'fc-row' },
          h('span', null, site), h('i', { style: { width: (secs / top) * 100 + '%' } }), h('b', null, fmtDur(secs)))))
        : h('p', { class: 'about' }, 'Rien pour l’instant. Continue comme ça !'),
      h('p', { class: 'about fc-foot' }, 'Le compteur tourne seulement quand PouleyPwolu est au premier plan et que tu es devant l’écran. Rien ne quitte ton ordinateur.'));
  }

  // ───────────────────────────────────────────── toasts, alertes, permissions
  function toast(text, opts = {}) {
    const box = $('#toasts');
    let el = opts.id ? box.querySelector(`[data-toast="${opts.id}"]`) : null;
    const content = h('div', { class: 't' }, opts.title ? h('b', null, opts.title) : null, text,
      opts.progress != null ? h('div', { class: 'progress' }, h('i', { style: { width: Math.round(opts.progress * 100) + '%' } })) : null);
    const children = [pouleMini(), content];
    if (opts.action) children.push(h('button', { class: 'btn', onclick: () => { opts.action.run(); dismiss(); } }, opts.action.label));
    if (el) el.replaceChildren(...children);
    else {
      el = h('div', { class: 'toast' + (opts.alert ? ' alert' : ''), 'data-toast': opts.id || '' }, ...children);
      box.append(el);
      while (box.children.length > 4) box.firstChild.remove();
    }
    clearTimeout(el._t);
    function dismiss() {
      el.classList.add('out');
      setTimeout(() => el.remove(), 260);
    }
    if (opts.timeout !== 0) el._t = setTimeout(dismiss, opts.timeout || 3600);
    return el;
  }

  // Cri de poule pour les vraies notifications (pas pour « zoom 110 % »).
  function cluck(kind) {
    const s = snap && S();
    if (s && s.notifSound !== false) window.PouleySound.play(kind, s.notifVolume ?? 0.6);
  }
  api.on('cluck', (kind) => cluck(kind));

  api.on('toast', (p) => toast(p.text));
  api.on('privacy:alert', (p) => {
    if (!snap || p.tabId !== snap.currentTabId) return;
    cluck('alerte');
    toast(p.text, { alert: true, title: 'Pouley te prévient', timeout: 6500, action: { label: 'Voir', run: () => openInspectorTab('privacy') } });
  });
  api.on('permission:ask', (p) => {
    const banner = h('div', { class: 'banner', 'data-req': p.reqId }, pouleMini(),
      h('div', { class: 'grow' }, h('b', null, hostOf(p.origin) || p.origin), ` veut accéder à : ${p.label}.`),
      h('button', { class: 'btn', onclick: () => api.cmd('permission.respond', { reqId: p.reqId, allow: false }) }, 'Refuser'),
      h('button', { class: 'btn blue', onclick: () => api.cmd('permission.respond', { reqId: p.reqId, allow: true }) }, 'Autoriser'));
    $('#banners').append(banner);
    cluck('cot');
    scheduleLayout();
  });
  api.on('permission:done', (p) => {
    const b = $(`#banners [data-req="${p.reqId}"]`);
    if (b) b.remove();
    scheduleLayout();
  });
  api.on('download', (d) => {
    const done = d.state === 'completed';
    const failed = d.state === 'cancelled' || d.state === 'interrupted';
    if (done) cluck('oeuf');
    toast(done ? `Téléchargé : ${d.name}` : failed ? `Échec : ${d.name}` : `Téléchargement : ${d.name}`, {
      id: d.id,
      title: done ? 'Œuf pondu 🥚' : null,
      progress: !done && !failed && d.total ? d.received / d.total : null,
      timeout: done || failed ? 6000 : 0,
      action: done ? (d.nadspdf ? { label: 'Ouvrir dans NadsPDF', run: () => api.cmd('download.nadspdf', d.id) } : { label: 'Afficher', run: () => api.cmd('download.show', d.id) }) : null,
    });
  });
  api.on('fullscreen', (on) => document.body.classList.toggle('fullscreen-html', on));
  let updateToastShown = null;
  api.on('update', (u) => {
    if (snap) snap.update = u;
    document.body.classList.toggle('update-ready', u && u.status === 'ready');
    if (u && u.status === 'ready' && updateToastShown !== u.version) {
      updateToastShown = u.version;
      cluck('oeuf');
      toast('PouleyPwolu ' + u.version + ' est prêt (dernières protections de Chromium incluses).', {
        id: 'update', title: 'Mise à jour', timeout: 0,
        action: { label: 'Redémarrer', run: () => api.cmd('update.install') },
      });
    }
    if (overlay === 'settings') renderSettingsBody();
  });


  // ───────────────────────────────────────────── coffre à mots de passe
  // L'interface ne garde aucun mot de passe : elle les demande au processus
  // principal au moment de les afficher ou de les copier.
  const vaultUi = { q: '', items: [], audit: {}, shown: {}, edit: null, then: null, mode: null, error: '' };
  const pwScore = (pw) => {
    pw = String(pw || '');
    let pool = 0;
    if (/[a-z]/.test(pw)) pool += 26;
    if (/[A-Z]/.test(pw)) pool += 26;
    if (/\d/.test(pw)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
    const bits = pw.length * Math.log2(pool || 1);
    return !pw ? 0 : bits < 36 ? 0 : bits < 50 ? 1 : bits < 64 ? 2 : bits < 90 ? 3 : 4;
  };
  const SCORE_TXT = ['Très faible', 'Faible', 'Correct', 'Solide', 'Très solide'];
  const meter = (score) => h('div', { class: 'v-meter', 'data-s': String(score) }, h('i'), h('i'), h('i'), h('i'), h('span', null, SCORE_TXT[score]));

  async function vaultRefresh() {
    const v = snap.vault || {};
    if (v.open) {
      const r = await api.cmd('vault.list');
      if (r && r.items) {
        vaultUi.items = r.items;
        vaultUi.audit = Object.fromEntries((r.audit || []).map((a) => [a.id, a]));
      }
    } else {
      vaultUi.items = [];
      vaultUi.shown = {};
      vaultUi.edit = null;
    }
  }

  async function openVault(opts = {}) {
    vaultUi.then = opts.then || null;
    vaultUi.mode = opts.mode || null;
    vaultUi.error = '';
    vaultUi.q = '';
    vaultUi.edit = null;
    const st = await api.cmd('vault.status');
    if (st) snap.vault = st;
    await vaultRefresh();
    await openOverlay('vault', () => h('div', { class: 'modal vault' }, h('div', { class: 'vault-body' })));
    renderVault();
  }

  function vaultHeader(title, sub) {
    return h('header', { class: 'v-head' },
      h('span', { class: 'v-head-ic', html: I.svg('cle') }),
      h('div', { class: 'grow' }, h('h2', null, title), sub ? h('p', null, sub) : null),
      h('button', { class: 'icon-btn', title: 'Fermer', onclick: () => closeOverlay() }, svg(ICONS.x)));
  }
  const vErr = () => (vaultUi.error ? h('p', { class: 'v-error' }, vaultUi.error) : null);
  async function vRun(fn) {
    vaultUi.error = '';
    const r = await fn();
    if (r && r.error) { vaultUi.error = r.error; renderVault(); return null; }
    return r;
  }
  async function vaultAfterOpen() {
    await vaultRefresh();
    const then = vaultUi.then;
    vaultUi.then = null;
    if (then) { await then(); closeOverlay(); return; }
    renderVault();
  }

  function renderVault() {
    const body = ov.querySelector('.vault-body');
    if (!body) return;
    const v = snap.vault || {};
    const view = !v.exists ? vaultCreateView(v)
      : !v.open ? vaultUnlockView(v)
        : vaultUi.mode === 'master' ? vaultMasterView()
          : vaultUi.edit ? vaultEditView(vaultUi.edit)
            : vaultListView(v);
    body.replaceChildren(...view.filter(Boolean));
    const auto = body.querySelector('[autofocus]');
    if (auto) auto.focus();
  }

  function vaultCreateView(v) {
    const pw = h('input', { type: 'password', class: 'v-input', placeholder: 'Mot de passe maître (12 caractères ou plus conseillés)', autofocus: true, autocomplete: 'new-password' });
    const pw2 = h('input', { type: 'password', class: 'v-input', placeholder: 'Le retaper', autocomplete: 'new-password' });
    const m = h('div', null, meter(0));
    pw.addEventListener('input', () => m.replaceChildren(meter(pwScore(pw.value))));
    let hello = !!v.helloAvailable;
    const helloBtn = v.helloAvailable ? h('button', { class: 'v-check' + (hello ? ' on' : ''), onclick: (e) => { hello = !hello; e.currentTarget.classList.toggle('on', hello); } },
      h('i'), h('span', null, h('b', null, 'Ouvrir aussi avec Windows Hello'), h('small', null, 'Visage, empreinte ou code PIN de Windows, sans retaper le mot de passe maître.'))) : null;
    const create = async () => {
      if (pw.value.length < 8) { vaultUi.error = 'Au moins 8 caractères.'; return renderVault(); }
      if (pw.value !== pw2.value) { vaultUi.error = 'Les deux mots de passe ne sont pas identiques.'; return renderVault(); }
      const r = await vRun(() => api.cmd('vault.create', { master: pw.value, hello }));
      pw.value = pw2.value = '';
      if (r) { snap.vault = r; vaultAfterOpen(); }
    };
    pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });
    return [
      vaultHeader('Crée ton coffre', 'Tes mots de passe, chiffrés sur ton ordinateur. Rien n’est envoyé sur Internet.'),
      h('div', { class: 'v-pad' },
        h('ul', { class: 'v-facts' },
          h('li', null, h('b', null, 'AES-256'), ' : chaque mot de passe est chiffré avant d’être écrit sur le disque.'),
          h('li', null, h('b', null, 'scrypt'), ' : chaque essai de mot de passe maître coûte 128 Mo de mémoire, ce qui rend les attaques par force brute très lentes.'),
          h('li', null, h('b', null, 'Verrouillage auto'), ' : après 15 min sans utilisation, et quand tu verrouilles Windows.')),
        pw, m, pw2, helloBtn,
        h('p', { class: 'v-warn' }, 'Retiens bien ce mot de passe : il n’est enregistré nulle part. Si tu l’oublies, personne ne pourra ouvrir le coffre, pas même Nads.'),
        vErr(),
        h('div', { class: 'v-actions' }, h('button', { class: 'btn', onclick: () => closeOverlay() }, 'Plus tard'), h('button', { class: 'btn primary', onclick: create }, 'Créer le coffre'))),
    ];
  }

  function vaultUnlockView(v) {
    const pw = h('input', { type: 'password', class: 'v-input', placeholder: 'Mot de passe maître', autofocus: true, autocomplete: 'current-password' });
    const go = async () => {
      const r = await vRun(() => api.cmd('vault.unlock', { master: pw.value }));
      pw.value = '';
      if (r) { snap.vault = r; vaultAfterOpen(); }
    };
    pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    const helloGo = async () => {
      const r = await vRun(() => api.cmd('vault.unlockHello'));
      if (r) { snap.vault = r; vaultAfterOpen(); }
    };
    return [
      vaultHeader('Coffre verrouillé', 'Déverrouille-le pour remplir ou voir tes mots de passe.'),
      h('div', { class: 'v-pad' },
        v.hello ? h('button', { class: 'btn primary v-hello', onclick: helloGo }, 'Déverrouiller avec Windows Hello') : null,
        v.hello ? h('div', { class: 'v-or' }, h('span', null, 'ou')) : null,
        pw, vErr(),
        h('div', { class: 'v-actions' },
          h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Sans le mot de passe maître, le coffre ne peut pas être ouvert. Le supprimer et en créer un nouveau ? Tous les mots de passe enregistrés seront perdus.')) return;
            snap.vault = await api.cmd('vault.destroy');
            renderVault();
          } }, 'Mot de passe oublié'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn' + (v.hello ? '' : ' primary'), onclick: go }, 'Déverrouiller'))),
    ];
  }

  function vaultMasterView() {
    const old = h('input', { type: 'password', class: 'v-input', placeholder: 'Mot de passe maître actuel', autofocus: true });
    const nw = h('input', { type: 'password', class: 'v-input', placeholder: 'Nouveau mot de passe maître' });
    const nw2 = h('input', { type: 'password', class: 'v-input', placeholder: 'Le retaper' });
    const m = h('div', null, meter(0));
    nw.addEventListener('input', () => m.replaceChildren(meter(pwScore(nw.value))));
    const go = async () => {
      if (nw.value !== nw2.value) { vaultUi.error = 'Les deux nouveaux mots de passe ne sont pas identiques.'; return renderVault(); }
      const r = await vRun(() => api.cmd('vault.changeMaster', { old: old.value, next: nw.value }));
      if (r) { vaultUi.mode = null; toast('Mot de passe maître changé.', { title: 'Coffre' }); renderVault(); }
    };
    return [
      vaultHeader('Changer le mot de passe maître'),
      h('div', { class: 'v-pad' }, old, nw, m, nw2, vErr(),
        h('div', { class: 'v-actions' }, h('button', { class: 'btn', onclick: () => { vaultUi.mode = null; renderVault(); } }, 'Annuler'), h('button', { class: 'btn primary', onclick: go }, 'Changer'))),
    ];
  }

  function siteBadge(site) {
    return h('span', { class: 'v-site-ic' }, (site || '?')[0].toUpperCase());
  }

  function vaultListView(v) {
    const q = vaultUi.q.trim().toLowerCase();
    const items = vaultUi.items
      .filter((x) => !q || (x.site + ' ' + x.username + ' ' + (x.note || '')).toLowerCase().includes(q))
      .sort((a, b) => a.site.localeCompare(b.site));
    const audit = Object.values(vaultUi.audit);
    const weak = audit.filter((a) => a.weak).length;
    const reused = audit.filter((a) => a.reused).length;
    const search = h('input', { class: 'v-search', placeholder: 'Rechercher un site ou un identifiant…', value: vaultUi.q, autofocus: true,
      oninput: (e) => { vaultUi.q = e.target.value; const pos = e.target.selectionStart; renderVault(); const s = ov.querySelector('.v-search'); s.setSelectionRange(pos, pos); } });
    const copy = async (id, field) => {
      await api.cmd('vault.copy', { id, field });
      toast(field === 'username' ? 'Identifiant copié.' : 'Mot de passe copié. Il sera effacé du presse-papiers dans 30 s.', { title: 'Coffre' });
    };
    const row = (x) => {
      const a = vaultUi.audit[x.id] || {};
      const shown = vaultUi.shown[x.id];
      return h('div', { class: 'v-row' },
        siteBadge(x.site),
        h('button', { class: 'v-row-main', title: 'Modifier', onclick: () => { vaultUi.edit = { ...x }; renderVault(); } },
          h('b', null, x.site),
          h('span', null, x.username || '(sans identifiant)'),
          shown != null ? h('code', { class: 'v-pw' }, shown) : null),
        a.weak ? h('span', { class: 'v-flag weak', title: 'Mot de passe facile à deviner' }, 'faible') : null,
        a.reused ? h('span', { class: 'v-flag', title: 'Le même mot de passe sert sur plusieurs sites' }, 'réutilisé') : null,
        h('div', { class: 'v-tools' },
          h('button', { class: 'icon-btn', title: 'Copier l’identifiant', onclick: () => copy(x.id, 'username') }, icon('profil')),
          h('button', { class: 'icon-btn', title: 'Copier le mot de passe', onclick: () => copy(x.id, 'password') }, icon('copier')),
          h('button', { class: 'icon-btn', title: shown != null ? 'Masquer' : 'Afficher', onclick: async () => {
            if (shown != null) delete vaultUi.shown[x.id];
            else vaultUi.shown[x.id] = await api.cmd('vault.reveal', x.id);
            renderVault();
          } }, icon('oeil')),
          h('button', { class: 'icon-btn', title: 'Ouvrir le site', onclick: () => { closeOverlay(); api.cmd('tab.new', { url: x.origin }); } }, icon('lien'))));
    };
    return [
      h('header', { class: 'v-head' },
        h('span', { class: 'v-head-ic open', html: I.svg('cle') }),
        h('div', { class: 'grow' }, h('h2', null, 'Coffre'), h('p', null, v.count + ' identifiant' + (v.count > 1 ? 's' : '') + ' · chiffré sur cet ordinateur')),
        h('button', { class: 'btn', title: 'Verrouiller maintenant', onclick: async () => { snap.vault = await api.cmd('vault.lock'); await vaultRefresh(); renderVault(); } }, svg(ICONS.lock), ' Verrouiller'),
        h('button', { class: 'icon-btn', title: 'Fermer', onclick: () => closeOverlay() }, svg(ICONS.x))),
      h('div', { class: 'v-bar' }, search,
        h('button', { class: 'btn primary', onclick: async () => { vaultUi.edit = { password: await api.cmd('vault.generate', { length: 20 }) }; renderVault(); } }, '+ Ajouter'),
        h('button', { class: 'btn', title: 'CSV exporté par Chrome, Comet, Edge, Opera, Brave…', onclick: async () => {
          const r = await vRun(() => api.cmd('vault.import'));
          if (r) { toast(r.count + ' mot' + (r.count > 1 ? 's' : '') + ' de passe importé' + (r.count > 1 ? 's' : '') + (r.shredded ? ', fichier CSV effacé.' : '.'), { title: 'Coffre' }); await vaultRefresh(); renderVault(); }
        } }, 'Importer')),
      weak || reused ? h('div', { class: 'v-audit' }, icon('bouclier'),
        h('span', null, [weak ? weak + ' mot' + (weak > 1 ? 's' : '') + ' de passe faible' + (weak > 1 ? 's' : '') : '', reused ? reused + ' réutilisé' + (reused > 1 ? 's' : '') + ' sur plusieurs sites' : ''].filter(Boolean).join(' · ') + '. Change-les depuis les sites concernés, avec le générateur.')) : null,
      vErr(),
      h('div', { class: 'v-list' }, items.length ? items.map(row)
        : h('div', { class: 'v-empty' }, h('span', { class: 'poule-mini', html: pouleSvg() }),
          h('p', null, q ? 'Rien ne correspond.' : 'Ton coffre est vide. Connecte-toi à un site : PouleyPwolu te proposera de ranger le mot de passe. Tu peux aussi importer ceux de Chrome ou de Comet (fichier CSV).'))),
    ];
  }

  function vaultEditView(e) {
    const isNew = !e.id;
    const url = h('input', { class: 'v-input', placeholder: 'Site (ex. github.com)', value: e.origin || '', autofocus: isNew });
    const user = h('input', { class: 'v-input', placeholder: 'Identifiant ou e-mail', value: e.username || '' });
    const pw = h('input', { class: 'v-input mono', type: 'text', placeholder: 'Mot de passe', value: e.password || '', spellcheck: 'false' });
    const note = h('textarea', { class: 'v-input', placeholder: 'Note (facultatif)', rows: '2' }, e.note || '');
    const m = h('div', null, meter(pwScore(e.password)));
    pw.addEventListener('input', () => m.replaceChildren(meter(pwScore(pw.value))));
    if (!isNew && e.password == null) api.cmd('vault.reveal', e.id).then((p) => { pw.value = p || ''; m.replaceChildren(meter(pwScore(pw.value))); });
    const save = async () => {
      const r = await vRun(() => api.cmd('vault.save', { id: e.id, url: url.value, username: user.value, password: pw.value, note: note.value }));
      if (r) { vaultUi.edit = null; await vaultRefresh(); renderVault(); }
    };
    return [
      vaultHeader(isNew ? 'Nouvel identifiant' : e.site, isNew ? null : 'Modifié le ' + new Date(e.updated).toLocaleDateString('fr-FR')),
      h('div', { class: 'v-pad' },
        h('label', { class: 'v-lab' }, 'Site'), url,
        h('label', { class: 'v-lab' }, 'Identifiant'), user,
        h('label', { class: 'v-lab' }, 'Mot de passe'),
        h('div', { class: 'v-pwrow' }, pw, h('button', { class: 'btn', title: 'Générer un mot de passe solide', onclick: async () => { pw.value = await api.cmd('vault.generate', { length: 20 }); m.replaceChildren(meter(pwScore(pw.value))); } }, icon('des'), ' Générer')),
        m,
        h('label', { class: 'v-lab' }, 'Note'), note,
        vErr(),
        h('div', { class: 'v-actions' },
          isNew ? null : h('button', { class: 'btn danger', onclick: async () => {
            if (!confirm('Supprimer l’identifiant de ' + e.site + ' ?')) return;
            await api.cmd('vault.delete', e.id);
            vaultUi.edit = null;
            await vaultRefresh();
            renderVault();
          } }, 'Supprimer'),
          h('span', { class: 'grow' }),
          h('button', { class: 'btn', onclick: () => { vaultUi.edit = null; renderVault(); } }, 'Annuler'),
          h('button', { class: 'btn primary', onclick: save }, 'Enregistrer'))),
    ];
  }

  api.on('vault', (v) => {
    if (!snap) return;
    snap.vault = v;
    if (overlay === 'vault') vaultRefresh().then(renderVault);
    if (overlay === 'settings') renderSettingsBody();
  });
  api.on('vault:open', () => openVault());
  api.on('vault:offer', (p) => {
    const old = $('#banners [data-offer="' + p.offerId + '"]');
    if (old) old.remove();
    const respond = async (action) => {
      const r = await api.cmd('vault.offer.respond', { offerId: p.offerId, action });
      if (r && r.need) openVault({ then: () => api.cmd('vault.offer.respond', { offerId: p.offerId, action: 'save' }) });
    };
    const banner = h('div', { class: 'banner vault-offer', 'data-offer': p.offerId },
      h('span', { class: 'v-banner-ic', html: I.svg('cle') }),
      h('div', { class: 'grow' },
        p.update ? 'Mettre à jour le mot de passe de ' : 'Ranger le mot de passe de ',
        h('b', null, p.site), p.username ? ' (' + p.username + ')' : '', ' dans ton coffre chiffré ?'),
      h('button', { class: 'btn', onclick: () => respond('never') }, 'Jamais pour ce site'),
      h('button', { class: 'btn', onclick: () => respond('dismiss') }, 'Non merci'),
      h('button', { class: 'btn primary', onclick: () => respond('save') }, p.update ? 'Mettre à jour' : 'Enregistrer'));
    $('#banners').append(banner);
    cluck('cot');
    scheduleLayout();
  });
  api.on('vault:offer-done', (p) => {
    const b = $('#banners [data-offer="' + p.offerId + '"]');
    if (b) b.remove();
    scheduleLayout();
  });


  // ───────────────────────────────────────────── extensions du Chrome Web Store
  function renderExtBar() {
    const bar = $('#ext-bar');
    if (!bar || !snap) return;
    const list = (snap.userExtensions || []).filter((e) => e.enabled !== false && e.available);
    const key = JSON.stringify(list.map((e) => [e.id, e.pinned, e.badge && e.badge.text, e.badge && e.badge.color]));
    if (bar.dataset.key === key) return;
    bar.dataset.key = key;
    const pinned = list.filter((e) => e.pinned !== false);
    const others = list.filter((e) => e.pinned === false);
    bar.replaceChildren(...[...pinned.map((e) => h('button', {
      class: 'ext-btn', title: (e.badge && e.badge.title) || e.name,
      onclick: (ev) => openExtPopup(e.id, ev.currentTarget),
      oncontextmenu: (ev) => { ev.preventDefault(); extMenu(e, ev.currentTarget); },
    }, e.icon ? h('img', { src: e.icon, alt: '' }) : icon('extension'),
    e.badge && e.badge.text ? h('i', { class: 'ext-badge', style: { background: e.badge.color || '#ef3e36' } }, e.badge.text.slice(0, 4)) : null)),
    others.length ? h('button', { class: 'ext-btn more', title: 'Autres extensions', onclick: (ev) => extMenu(null, ev.currentTarget) }, icon('extension')) : null].filter(Boolean));
  }
  function openExtPopup(id, el) {
    const r = el.getBoundingClientRect();
    api.cmd('ext.popup', { id, rect: { x: r.left, y: r.top, width: r.width, height: r.height } });
  }
  function extMenu(ext, el) {
    const list = ext ? [ext] : (snap.userExtensions || []).filter((e) => e.enabled !== false && e.pinned === false);
    const r = el.getBoundingClientRect();
    const menu = h('div', { class: 'ext-menu', style: { left: Math.round(r.left) + 'px', top: Math.round(r.bottom + 6) + 'px' } },
      ...list.map((e) => h('div', { class: 'ext-menu-group' },
        h('div', { class: 'ext-menu-head' }, e.icon ? h('img', { src: e.icon, alt: '' }) : null, h('b', null, e.name)),
        e.popup ? h('button', { onclick: () => { close(); openExtPopup(e.id, el); } }, 'Ouvrir') : null,
        e.options ? h('button', { onclick: () => { close(); api.cmd('ext.options', e.id); } }, 'Options de l’extension') : null,
        h('button', { onclick: () => { close(); api.cmd('ext.pin', { id: e.id, on: e.pinned === false }); } }, e.pinned === false ? 'Épingler dans la barre' : 'Retirer de la barre'),
        h('button', { onclick: () => { close(); openSettings('extensions'); } }, 'Gérer les extensions'))));
    const close = () => { menu.remove(); document.removeEventListener('mousedown', outside, true); };
    const outside = (e) => { if (!menu.contains(e.target)) close(); };
    document.addEventListener('mousedown', outside, true);
    document.body.append(menu);
    const mr = menu.getBoundingClientRect();
    if (mr.right > innerWidth - 8) menu.style.left = Math.max(8, innerWidth - mr.width - 8) + 'px';
  }

  // Fenêtre d'installation : on montre ce que l'extension pourra faire.
  async function installExtension(input) {
    toast('Téléchargement et vérification de la signature…', { id: 'ext-install', title: 'Extension', timeout: 0 });
    const info = await api.cmd('ext.prepare', input);
    $('#toasts [data-toast="ext-install"]')?.remove();
    if (!info || info.error) { toast(info ? info.error : 'Installation impossible.', { title: 'Extension', alert: true, timeout: 6000 }); return; }
    let done = false;
    await openOverlay('extinstall', () => h('div', { class: 'modal ext-install' },
      h('header', { class: 'v-head' },
        info.icon ? h('img', { class: 'ext-install-ic', src: info.icon, alt: '' }) : h('span', { class: 'v-head-ic', html: I.svg('extension') }),
        h('div', { class: 'grow' }, h('h2', null, (info.already ? 'Mettre à jour ' : 'Ajouter ') + info.name), h('p', null, 'Version ' + info.version + ' · signature du développeur vérifiée')),
        h('button', { class: 'icon-btn', title: 'Fermer', onclick: () => closeOverlay() }, svg(ICONS.x))),
      h('div', { class: 'v-pad' },
        info.description ? h('p', { class: 'ext-install-desc' }, info.description) : null,
        info.permissions.length ? h('div', { class: 'ext-perms' }, h('b', null, 'Cette extension pourra :'), h('ul', null, ...info.permissions.map((p) => h('li', null, p)))) : null,
        h('p', { class: 'set-help' }, 'Elle est ajoutée dans chaque poulailler. Ses données (compte, réglages) restent séparées d’un poulailler isolé à l’autre. PouleyPwolu n’a pas toutes les fonctions de Chrome : la plupart des extensions marchent, certaines en partie seulement.'),
        h('div', { class: 'v-actions' },
          h('button', { class: 'btn', onclick: () => closeOverlay() }, 'Annuler'),
          h('button', { class: 'btn primary', autofocus: true, onclick: async (ev) => {
            ev.currentTarget.disabled = true;
            const r = await api.cmd('ext.install', info.token);
            done = true;
            closeOverlay();
            if (r && r.error) toast(r.error, { title: 'Extension', alert: true });
            else cluck('oeuf');
          } }, info.already ? 'Mettre à jour' : 'Ajouter l’extension')))));
    const stop = setInterval(() => { if (overlay !== 'extinstall') { clearInterval(stop); if (!done) api.cmd('ext.cancel', info.token); } }, 400);
  }

  // Sur une page du Chrome Web Store : bandeau « Ajouter à PouleyPwolu ».
  function renderStoreBanner() {
    const cur = current();
    const m = cur && /^https:\/\/chromewebstore\.google\.com\/detail\/(?:[^/]+\/)?([a-p]{32})/.exec(cur.rec.url || '');
    const old = $('#banners .cws-banner');
    const id = m && m[1];
    if (old && old.dataset.id === id) return;
    if (old) { old.remove(); scheduleLayout(); }
    if (!id) return;
    const installed = (snap.userExtensions || []).some((e) => e.id === id);
    $('#banners').append(h('div', { class: 'banner cws-banner', 'data-id': id },
      h('span', { class: 'v-banner-ic', html: I.svg('extension') }),
      h('div', { class: 'grow' }, installed ? 'Cette extension est déjà dans PouleyPwolu.' : 'Le bouton « Ajouter à Chrome » ne marche pas ici : PouleyPwolu peut l’installer pour toi.'),
      h('button', { class: 'btn primary', onclick: () => installExtension(id) }, installed ? 'Mettre à jour' : 'Ajouter à PouleyPwolu')));
    scheduleLayout();
  }

  // ───────────────────────────────────────────── recherche dans la page
  const findbar = $('#findbar');
  const findInput = $('#find-input');
  function openFind() {
    findbar.classList.remove('hidden');
    findInput.focus();
    findInput.select();
    scheduleLayout();
  }
  function closeFind() {
    findbar.classList.add('hidden');
    $('#find-count').textContent = '';
    api.cmd('tab.findStop');
    scheduleLayout();
  }
  findInput.addEventListener('input', () => {
    if (findInput.value) api.cmd('tab.find', { text: findInput.value });
    else { api.cmd('tab.findStop'); $('#find-count').textContent = ''; }
  });
  findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') api.cmd('tab.find', { text: findInput.value, forward: !e.shiftKey, findNext: true });
    if (e.key === 'Escape') closeFind();
  });
  $('#find-next').onclick = () => api.cmd('tab.find', { text: findInput.value, forward: true, findNext: true });
  $('#find-prev').onclick = () => api.cmd('tab.find', { text: findInput.value, forward: false, findNext: true });
  $('#find-close').onclick = closeFind;
  api.on('find:result', (r) => { $('#find-count').textContent = r.matches ? `${r.active}/${r.matches}` : 'aucun'; });

  // ───────────────────────────────────────────── barre : masquage
  // La barre peut être masquée (bouton, Ctrl+S, ou glissée contre le bord).
  // Masquée, elle s'ouvre par-dessus la page quand la souris touche le bord et
  // se referme dès qu'on en sort. La page est figée en image pendant ce temps :
  // la vue web native passerait sinon au-dessus de la barre.
  const sidebarHidden = () => !!S().sidebarAutoHide && S().sidebarPosition !== 'top';
  const sideWidth = () => Math.max(200, Math.min(440, Number(S().sidebarWidth) || 264));
  const peekState = { open: false, tab: null, leaveTimer: 0, closeTimer: 0, blockedUntil: 0 };
  let resizing = null;
  let frozen = 0;

  async function freeze(opts) {
    frozen += 1;
    if (frozen > 1) return;
    const content = $('#content');
    const shot = snap && snap.currentTabId ? await api.cmd('capture', opts) : null;
    if (shot && frozen) content.style.backgroundImage = `url("${shot}")`;
    await api.cmd('views.hidden', true);
  }
  function unfreeze() {
    frozen = Math.max(0, frozen - 1);
    if (frozen) return;
    if (!overlay && !onboardingShown) api.cmd('views.hidden', false);
    setTimeout(() => {
      if (overlay || frozen) return;
      $('#content').style.backgroundImage = '';
    }, 80);
  }

  async function openPeek() {
    if (!sidebarHidden() || peekState.open || overlay || onboardingShown || Date.now() < peekState.blockedUntil) return;
    peekState.open = true;
    peekState.tab = snap.currentTabId;
    clearTimeout(peekState.leaveTimer);
    clearTimeout(peekState.closeTimer);
    document.body.classList.remove('peek-out');
    await freeze();
    if (!peekState.open) { unfreeze(); return; }
    document.body.classList.add('peeking');
    api.cmd('peek.watch', { on: true, width: sideWidth(), side: S().sidebarPosition });
  }
  function closePeek(immediate) {
    if (!peekState.open) return;
    peekState.open = false;
    clearTimeout(peekState.leaveTimer);
    api.cmd('peek.watch', { on: false });
    const body = document.body;
    // Pas encore affichée : openPeek s'en chargera en voyant open = false.
    if (!body.classList.contains('peeking')) return;
    const done = () => {
      body.classList.remove('peeking', 'peek-out');
      unfreeze();
    };
    if (immediate) return done();
    body.classList.add('peek-out');
    peekState.closeTimer = setTimeout(done, 170);
  }
  api.on('peek:inside', (inside) => {
    if (!peekState.open) return;
    clearTimeout(peekState.leaveTimer);
    if (!inside && !resizing) peekState.leaveTimer = setTimeout(() => closePeek(), 260);
  });
  $('#edge-hot').addEventListener('mouseenter', openPeek);

  function toggleSidebar() {
    const hide = !sidebarHidden();
    closePeek(true);
    if (hide) peekState.blockedUntil = Date.now() + 700;
    api.cmd('settings.set', { sidebarAutoHide: hide });
  }
  $('#btn-hide-sidebar').addEventListener('click', toggleSidebar);

  // Poignée : glisser pour élargir / rétrécir, ou jusqu'au bord pour masquer.
  $('#side-resizer').addEventListener('pointerdown', async (e) => {
    if (e.button !== 0 || S().sidebarPosition === 'top') return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startW = sideWidth();
    resizing = { w: startW, hide: false };
    document.body.classList.add('resizing');
    freeze();
    const move = (ev) => {
      const right = S().sidebarPosition === 'right';
      const raw = right ? window.innerWidth - ev.clientX : ev.clientX;
      resizing.hide = raw < 150;
      resizing.w = Math.max(200, Math.min(440, raw));
      document.body.classList.toggle('will-hide', resizing.hide);
      document.documentElement.style.setProperty('--side-w', resizing.w + 'px');
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      const r = resizing;
      resizing = null;
      document.body.classList.remove('resizing', 'will-hide');
      if (r.hide) {
        document.documentElement.style.setProperty('--side-w', startW + 'px');
        closePeek(true);
        peekState.blockedUntil = Date.now() + 700;
        api.cmd('settings.set', { sidebarAutoHide: true });
      } else {
        api.cmd('settings.set', { sidebarWidth: Math.round(r.w) });
        if (peekState.open) api.cmd('peek.watch', { on: true, width: Math.round(r.w), side: S().sidebarPosition });
      }
      unfreeze();
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  });

  // Par défaut, glisser fait défiler les onglets. En option (Paramètres →
  // Barre des onglets), un glissement horizontal sur la barre latérale change de
  // poulailler, comme dans Arc. Jamais en barre du haut, où il sert à défiler.
  let swipeAcc = 0;
  let swipeLock = 0;
  $('#sidebar').addEventListener('wheel', (e) => {
    if (!S().swipePoulaillers || S().sidebarPosition === 'top') { swipeAcc = 0; return; }
    if (e.target.closest && e.target.closest('.lists')) return;
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY) * 2 || Date.now() < swipeLock) return;
    swipeAcc += e.deltaX;
    if (Math.abs(swipeAcc) > 220) {
      const list = snap.state.poulaillers;
      const i = list.findIndex((p) => p.id === snap.state.activePoulailler);
      const next = list[(i + (swipeAcc > 0 ? 1 : -1) + list.length) % list.length];
      swipeAcc = 0;
      swipeLock = Date.now() + 500;
      api.cmd('poulailler.switch', next.id);
    }
  }, { passive: true });

  // ───────────────────────────────────────────── boutons
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-cmd]');
    if (b) api.cmd(b.dataset.cmd);
  });
  $('#btn-reload').onclick = () => {
    const cur = current();
    api.cmd(cur && rtOf(cur.rec.id).loading ? 'tab.stop' : 'tab.reload');
  };
  $('#urlbox').onclick = () => openPalette(snap.currentTabId ? 'edit' : 'new');
  $('#btn-newtab').onclick = () => openPalette('new');
  $('#btn-all-tabs').onclick = () => api.cmd('tab.listMenu');
  $('#btn-pinned').onclick = () => api.cmd('tab.pinnedMenu');

  // ───────────────────────────────────────────── mini-lecteur
  const PLAY_SVG = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
  const PAUSE_SVG = '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>';
  let media = null;
  let mediaTick = 0;
  function renderMedia() {
    const box = $('#mini-player');
    box.classList.toggle('hidden', !media);
    if (!media) return;
    const art = $('#mp-art');
    const src = media.art || '';
    if (art.dataset.src !== src) {
      art.dataset.src = src;
      art.replaceChildren(src ? h('img', { src, alt: '' }) : h('span', { class: 'mp-noart', html: I.svg('musique') }));
    }
    $('#mp-title').textContent = media.title || 'Lecture en cours';
    $('#mp-sub').textContent = [media.artist, media.app].filter(Boolean).join(' · ');
    $('#mp-toggle').innerHTML = media.state === 'playing' ? PAUSE_SVG : PLAY_SVG;
    box.classList.toggle('playing', media.state === 'playing');
    box.classList.toggle('from-system', media.source === 'system');
    $('#mp-txt').title = media.source === 'tab' ? 'Aller à l’onglet' : media.app + ' (application)';
    updateProgress();
  }
  function updateProgress() {
    if (!media || !media.duration) { $('#mp-progress').style.width = '0%'; return; }
    $('#mp-progress').style.width = Math.min(100, (media.time / media.duration) * 100) + '%';
  }
  // La barre de progression avance entre deux relevés (toutes les 1,5 s).
  setInterval(() => { if (media && media.state === 'playing' && media.duration) { media.time += 0.5; updateProgress(); } }, 500);
  api.on('media', (m) => { media = m; renderMedia(); scheduleLayout(); });
  $('#mp-toggle').onclick = () => { if (media) { media.state = media.state === 'playing' ? 'paused' : 'playing'; renderMedia(); } api.cmd('media.cmd', 'toggle'); };
  $('#mp-next').onclick = () => api.cmd('media.cmd', 'next');
  $('#mp-prev').onclick = () => api.cmd('media.cmd', 'prev');
  $('#mp-art').onclick = () => api.cmd('media.open');
  $('#mp-txt').onclick = () => api.cmd('media.open');

  // ───────────────────────────────────────────── aperçu des favoris au survol
  let favHoverTimer = 0;
  $('#favorites').addEventListener('mouseover', (e) => {
    const fav = e.target.closest && e.target.closest('.fav');
    if (!fav || !S().favHoverPreview || dragging || overlay || peekState.open) return;
    clearTimeout(favHoverTimer);
    favHoverTimer = setTimeout(() => {
      if (!fav.matches(':hover')) return;
      const r = fav.getBoundingClientRect();
      const sb = $('#sidebar').getBoundingClientRect();
      api.cmd('fav.peek', { id: fav.dataset.id, anchor: { x: r.left, y: r.top, width: r.width, height: r.height }, edge: { x: sb.left, y: sb.top, width: sb.width, height: sb.height } });
    }, 450);
  });
  $('#favorites').addEventListener('mouseleave', () => clearTimeout(favHoverTimer));
  api.on('favpeek', (id) => {
    for (const f of document.querySelectorAll('.fav')) f.classList.toggle('peeking-fav', f.dataset.id === id);
  });
  // Glisser un onglet sur l'icône des épinglés = l'épingler
  $('#btn-pinned').addEventListener('dragover', (e) => { if (dragging) { e.preventDefault(); e.currentTarget.classList.add('drop-target'); } });
  $('#btn-pinned').addEventListener('dragleave', (e) => e.currentTarget.classList.remove('drop-target'));
  $('#btn-pinned').addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.classList.remove('drop-target');
    if (dragging) api.cmd('tab.move', { id: dragging, poulaillerId: activeP().id, pinned: true });
    clearDrop();
  });

  // Barre du haut : largeur commune des onglets = place libre / nombre d'onglets,
  // entre 40 px (icône seule) et 200 px. Au-delà, la zone défile.
  function sizeTopTabs() {
    const lists = $('.lists');
    if (!document.body.classList.contains('side-top')) { lists.style.removeProperty('--tab-w'); return; }
    const tabs = [...lists.querySelectorAll('.tab')];
    if (!tabs.length) return;
    let fixed = 0;
    for (const el of lists.querySelectorAll('.egg-head, .new-tab, .divider, .tab-list.pinned .tab')) fixed += el.getBoundingClientRect().width + 4;
    const free = lists.clientWidth - fixed - 8;
    const n = tabs.filter((t) => !t.closest('.tab-list.pinned')).length || 1;
    const w = Math.max(40, Math.min(200, Math.floor(free / n) - 2));
    lists.style.setProperty('--tab-w', w + 'px');
  }
  new ResizeObserver(() => sizeTopTabs()).observe($('.lists'));

  // Barre du haut : la molette fait défiler les onglets horizontalement,
  // et l'onglet actif est toujours ramené à l'écran.
  $('.lists').addEventListener('wheel', (e) => {
    if (!document.body.classList.contains('side-top')) return;
    const el = e.currentTarget;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  $('#btn-group-auto').innerHTML = eggSvg('#FFE100');
  $('#btn-group-auto').onclick = () => groupAuto();

  // ───────────────────────────────────────────── groupes d'œufs
  async function groupAuto() {
    const r = await api.cmd('group.auto');
    if (!r) return;
    if (!r.created && !r.joined) toast('Rien à ranger : aucun onglet ne va avec un autre pour l’instant.', { title: 'Groupes d’œufs' });
    else {
      cluck('cot');
      toast((r.created ? r.created + ' groupe' + (r.created > 1 ? 's' : '') + ' créé' + (r.created > 1 ? 's' : '') : '') +
        (r.created && r.joined ? ', ' : '') + (r.joined ? r.joined + ' onglet' + (r.joined > 1 ? 's' : '') + ' rangé' + (r.joined > 1 ? 's' : '') : '') + '.', { title: 'Groupes d’œufs' });
    }
  }
  let createdBatch = [];
  let createdTimer = 0;
  api.on('group:created', (g) => {
    createdBatch.push(g);
    clearTimeout(createdTimer);
    createdTimer = setTimeout(() => {
      const batch = createdBatch;
      createdBatch = [];
      cluck('cot');
      const one = batch.length === 1;
      toast(one ? '« ' + batch[0].name + ' » : deux onglets qui vont ensemble ont été réunis.'
        : batch.length + ' groupes créés : ' + batch.map((x) => x.name).join(', ') + '.', {
        id: 'groups-created', title: one ? 'Groupe d’œufs créé' : 'Groupes d’œufs créés', timeout: 6000,
        action: { label: 'Défaire', run: () => batch.forEach((x) => api.cmd('group.ungroup', x.id)) },
      });
    }, 700);
  });

  function openGroupEditor(g) {
    const data = { name: g.name, color: g.color, auto: !!g.auto, sites: [...(g.sites || [])] };
    openOverlay('group', () => {
      const root = h('div', { class: 'modal editor group-editor' });
      const draw = () => {
        root.style.setProperty('--c', data.color);
        const name = h('input', { type: 'text', value: data.name, placeholder: 'Nom du groupe', autofocus: true, oninput: (e) => { data.name = e.target.value; } });
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
        root.replaceChildren(
          h('h2', null, 'Groupe d’œufs'),
          h('div', { class: 'editor-head' }, h('span', { class: 'egg-big', html: eggSvg(data.color) }), name),
          h('div', { class: 'editor-label' }, 'Couleur'),
          h('div', { class: 'color-row' }, ...GROUP_COLORS.map((c) => h('button', { class: data.color === c ? 'on' : '', style: { background: c }, onclick: () => { data.color = c; draw(); } }))),
          h('div', { class: 'toggle-row' },
            h('div', { class: 'lbl' }, 'Rangement automatique', h('small', null, 'Les nouveaux onglets de ces sites rejoignent ce groupe tout seuls.')),
            switchEl(data.auto, (v) => { data.auto = v; draw(); })),
          data.sites.length ? h('div', { class: 'chips' }, ...data.sites.map((s) => h('span', { class: 'chip site-chip' }, s,
            h('button', { title: 'Retirer ce site', onclick: () => { data.sites = data.sites.filter((x) => x !== s); draw(); } }, '×')))) : null,
          h('div', { class: 'actions' },
            h('button', { class: 'btn danger', onclick: () => { closeOverlay(); api.cmd('group.ungroup', g.id); } }, 'Dégrouper'),
            h('span', { class: 'grow' }),
            h('button', { class: 'btn', onclick: () => closeOverlay() }, 'Annuler'),
            h('button', { class: 'btn primary', onclick: save }, 'Enregistrer')));
        setTimeout(() => name.focus(), 20);
      };
      const save = () => {
        closeOverlay();
        api.cmd('group.update', { id: g.id, name: data.name.trim() || g.name, color: data.color, auto: data.auto, sites: data.sites });
      };
      draw();
      return root;
    });
  }
  $('#btn-shot').innerHTML = I.svg('capture');
  $('#btn-float').innerHTML = I.svg('superposition');
  $('#btn-shot').onclick = () => api.cmd('shot.menu');
  $('#btn-pen').innerHTML = '<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M14 6l4 4"/></svg>';
  $('#btn-pen').onclick = () => api.cmd('pen.toggle');
  $('#btn-float').onclick = () => api.cmd('tab.float');
  $('#btn-split').innerHTML = I.svg('cote');
  $('#btn-repo').onclick = () => api.cmd('repo.menu');
  $('#btn-split').onclick = () => (splitActive() ? api.cmd('split.end') : openPalette('split'));
  $('#btn-dock').onclick = () => api.cmd('tab.dock');
  $('#btn-show-float').onclick = () => api.cmd('tab.focusFloat');

  // ───────────────────────────────────────────── capture : sélection d'une zone
  // La page est figée en image (haute qualité gardée côté principal), on trace
  // un rectangle par-dessus, puis le processus principal découpe la zone.
  let shotActive = false;
  async function startRegionShot() {
    if (shotActive || !snap || !snap.currentTabId || overlay || onboardingShown) return;
    if (rtOf(snap.currentTabId).floating) return;
    if (peekState.open) closePeek(true);
    shotActive = true;
    await freeze({ keep: true });
    const layer = $('#shot-layer');
    const box = $('#shot-rect');
    layer.classList.remove('hidden');
    box.classList.add('hidden');
    let start = null;
    let rect = null;
    const pos = (e) => {
      const r = layer.getBoundingClientRect();
      return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
    };
    const finish = async (ok) => {
      layer.removeEventListener('pointerdown', down);
      layer.removeEventListener('pointermove', move);
      layer.removeEventListener('pointerup', up);
      document.removeEventListener('keydown', key, true);
      layer.classList.add('hidden');
      box.classList.add('hidden');
      const size = { width: layer.clientWidth, height: layer.clientHeight };
      if (ok && rect && rect.width > 6 && rect.height > 6) await api.cmd('shot.capture', { mode: 'region', rect, size });
      else api.cmd('shot.cancel');
      shotActive = false;
      unfreeze();
    };
    const down = (e) => { start = pos(e); layer.setPointerCapture(e.pointerId); };
    const move = (e) => {
      if (!start) return;
      const p = pos(e);
      rect = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), width: Math.abs(p.x - start.x), height: Math.abs(p.y - start.y) };
      box.classList.remove('hidden');
      Object.assign(box.style, { left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      box.dataset.size = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    };
    const up = () => finish(true);
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } };
    layer.addEventListener('pointerdown', down);
    layer.addEventListener('pointermove', move);
    layer.addEventListener('pointerup', up);
    document.addEventListener('keydown', key, true);
  }

  api.on('shot:done', (s) => {
    const content = $('#content');
    content.classList.remove('flash');
    void content.offsetWidth;
    content.classList.add('flash');
    const what = s.mode === 'full' ? 'Page entière' : s.mode === 'region' ? 'Zone' : 'Zone visible';
    toast(`${what} ${s.copied ? "copiée dans le presse-papiers et " : ""}enregistrée dans Images › PouleyPwolu (${s.width} × ${s.height}).`, {
      title: 'Capture d’écran',
      timeout: 5000,
      action: { label: 'Afficher', run: () => api.cmd('download.show', s.id) },
    });
  });
  $('#empty-search').onclick = () => openPalette('new');
  $('#shield').onclick = () => openInspectorTab('privacy');
  $('#btn-inspector').onclick = () => toggleInspector();
  $('#btn-ai').onclick = () => api.cmd('ai.toggle');
  $('#btn-settings').onclick = () => openSettings();
  $('#btn-add-space').onclick = () => openPoulaillerEditor(null);
  $('#btn-archive').onclick = () => openArchive();
  $('#btn-vault').onclick = () => openVault();
  $('#poulailler-title').onclick = () => openPoulaillerEditor(activeP());
  $('#brand').innerHTML = pouleSvg();
  $('#empty-poule').innerHTML = pouleSvg();

  // ───────────────────────────────────────────── raccourcis venant du processus principal
  api.on('shortcut', (name) => {
    if (onboardingShown) return;
    switch (name) {
      case 'new-tab': return openPalette('new');
      case 'edit-url': return openPalette(snap.currentTabId ? 'edit' : 'new');
      case 'toggle-sidebar': return toggleSidebar();
      case 'find': return snap.currentTabId && openFind();
      case 'inspector': return toggleInspector();
      case 'aidetect': return openInspectorTab('ai');
      case 'settings': return openSettings();
      case 'edit-poulailler': return openPoulaillerEditor(activeP());
      case 'shot-region': return startRegionShot();
      case 'split': return snap.currentTabId && openPalette('split');
      default:
        if (name.startsWith('edit-group:')) {
          const id = name.split(':')[1];
          setTimeout(() => { const g = (activeP().groups || []).find((x) => x.id === id); if (g) openGroupEditor(g); }, 120);
          return;
        }
        if (name.startsWith('edit-poulailler:')) {
          const p = snap.state.poulaillers.find((x) => x.id === name.split(':')[1]);
          if (p) openPoulaillerEditor(p);
        }
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay) closeOverlay();
  });

  // ───────────────────────────────────────────── histoire d'installation
  function startOnboarding() {
    onboardingShown = true;
    api.cmd('views.hidden', true);
    window.PouleyOnboarding.start($('#onboarding'), {
      settings: S(),
      cometAvailable: snap.cometAvailable,
      onDone: async (choices) => {
        await api.cmd('onboarding.done', choices);
        onboardingShown = false;
        api.cmd('views.hidden', false);
      },
    });
  }

  // ───────────────────────────────────────────── démarrage
  api.on('state', (s) => { snap = s; render(); renderExtBar(); renderStoreBanner(); });
  api.getState().then((s) => { snap = s; render(); renderExtBar(); renderStoreBanner(); });
})();
