// Stylo de PouleyPwolu (repris de src/preload/page.js), injecté à la demande par le cœur
// (core/tools.js). Les réglages et la capture passent par chrome.runtime.
// Stylo : écrire et dessiner sur toute la page (elle défile avec le dessin),
// puis enregistrer une capture d'écran. Le dessin est un SVG posé sur la page,
// dans une ombre fermée : la page ne peut ni le lire ni le modifier.
(() => {
  if (window.top !== window || window.__pouleyStylo) return;
  window.__pouleyStylo = true;
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
    saveTimer = setTimeout(() => { try { chrome.runtime.sendMessage({ type: 'pen.prefs', prefs }); } catch {} }, 300);
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
    try { await chrome.runtime.sendMessage({ type: 'pen.shot', mode }); } catch {}
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
    try { chrome.runtime.sendMessage({ type: 'pen.state', on }); } catch {}
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

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'pen.toggle') return;
    const saved = msg.prefs;
    if (saved && typeof saved === 'object') prefs = { ...prefs, ...saved, pens: Array.isArray(saved.pens) ? saved.pens : prefs.pens };
    if (!TOOLS[prefs.tool]) prefs.tool = 'pen';
    setActive(!active);
  });
})();
