// Outil « Masquer » (comme « Masquer les éléments gênants » de Safari) : on survole la page,
// l'élément visé s'entoure ; un clic le fait disparaître et il reste masqué sur ce site.
// Injecté à la demande (core/tools.js) ; le masquage durable est appliqué par
// content/masquer-appliquer.js. Échap ou « Terminé » pour quitter, ↑ pour viser le parent.
(() => {
  if (window.__pouleyHidePick) { window.__pouleyHidePick.stop(); return; }
  const host = location.hostname.replace(/^www\./, '');
  const ease = 'cubic-bezier(0.23, 1, 0.32, 1)';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ── Interface (dans un shadow DOM : le CSS du site ne s'y applique pas)
  const root = document.createElement('pouley-masquer');
  root.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = root.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, sans-serif; }
      .box { position: fixed; pointer-events: none; border: 2px solid #ffe100; border-radius: 6px;
        background: rgba(255, 225, 0, 0.12); box-shadow: 0 0 0 9999px rgba(8, 8, 10, 0.25);
        transition: left 90ms ${ease}, top 90ms ${ease}, width 90ms ${ease}, height 90ms ${ease}; display: none; }
      .tag { position: absolute; left: -2px; top: -26px; padding: 3px 8px; border-radius: 6px; background: #ffe100;
        color: #17140a; font: 600 11.5px/1.3 'Segoe UI', sans-serif; white-space: nowrap; max-width: 320px; overflow: hidden; text-overflow: ellipsis; }
      .bar { position: fixed; top: 14px; left: 50%; transform: translateX(-50%); pointer-events: auto;
        display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-radius: 14px;
        background: rgba(27, 27, 30, 0.96); border: 1px solid rgba(255, 255, 255, 0.12); color: #f4f4f5;
        box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.7); font-size: 13px; }
      .bar b { color: #ffe100; font-weight: 600; }
      .bar span { color: #c9c9d0; }
      button { all: unset; cursor: pointer; padding: 6px 11px; border-radius: 9px; background: #26262a; color: #f4f4f5;
        font: 600 12.5px 'Segoe UI', sans-serif; transition: background 0.15s ease, transform 0.16s ${ease}; }
      button:hover { background: #2f2f34; }
      button:active { transform: scale(0.96); }
      button.main { background: #ffe100; color: #17140a; }
      button[disabled] { opacity: 0.4; pointer-events: none; }
      kbd { font: 11px 'Cascadia Mono', monospace; padding: 1px 5px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.18); color: #c9c9d0; }
    </style>
    <div class="box"><div class="tag"></div></div>
    <div class="bar">
      <b>Masquer</b><span class="hint">Clique sur ce qui te gêne · <kbd>↑</kbd> parent · <kbd>Échap</kbd></span>
      <button class="undo" disabled>Annuler</button>
      <button class="reset">Tout réafficher</button>
      <button class="main done">Terminé</button>
    </div>`;
  document.documentElement.appendChild(root);
  const box = shadow.querySelector('.box');
  const tag = shadow.querySelector('.tag');
  const bar = shadow.querySelector('.bar');
  const undoBtn = shadow.querySelector('.undo');

  // ── Sélecteur CSS durable pour un élément
  const stableClass = (c) => /^[a-z][\w-]{1,40}$/i.test(c) && !/\d{3,}|^(css|sc|jsx|svelte|emotion)-|__[a-z0-9]{5,}$/i.test(c);
  const stableId = (id) => /^[a-z][\w-]{1,60}$/i.test(id) && !/\d{4,}/.test(id);
  const esc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);

  function partFor(el) {
    if (el.id && stableId(el.id) && document.querySelectorAll('#' + esc(el.id)).length === 1) return { sel: '#' + esc(el.id), anchor: true };
    let s = el.localName;
    const classes = [...el.classList].filter(stableClass).slice(0, 3);
    if (classes.length) s += classes.map((c) => '.' + esc(c)).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter((x) => x.localName === el.localName);
      if (same.length > 1 && !classes.length) s += `:nth-of-type(${same.indexOf(el) + 1})`;
    }
    return { sel: s, anchor: false };
  }

  function selectorFor(el) {
    const parts = [];
    let cur = el;
    while (cur && cur !== document.body && cur !== document.documentElement && parts.length < 6) {
      const p = partFor(cur);
      parts.unshift(p.sel);
      const sel = parts.join(' > ');
      const found = document.querySelectorAll(sel);
      if (p.anchor || (found.length === 1 && found[0] === el)) return sel;
      cur = cur.parentElement;
    }
    const sel = parts.join(' > ');
    return document.querySelectorAll(sel)[0] === el ? sel : null;
  }

  const label = (el) => {
    const r = el.getBoundingClientRect();
    const name = el.id ? '#' + el.id : el.classList[0] ? '.' + el.classList[0] : el.localName;
    return `${el.localName}${name !== el.localName ? ' ' + name : ''} · ${Math.round(r.width)}×${Math.round(r.height)}`;
  };

  // ── Survol et choix
  let target = null;
  const isOurs = (el) => el === root || root.contains(el);
  function show(el) {
    target = el;
    if (!el) { box.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    box.style.display = 'block';
    box.style.left = r.left - 2 + 'px';
    box.style.top = r.top - 2 + 'px';
    box.style.width = r.width + 4 + 'px';
    box.style.height = r.height + 4 + 'px';
    tag.textContent = label(el);
    tag.style.top = r.top < 34 ? 'calc(100% + 4px)' : '-26px';
  }

  function onMove(e) {
    if (bar.matches(':hover')) { show(null); return; }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || isOurs(el) || el === document.documentElement || el === document.body) { show(null); return; }
    if (el !== target) show(el);
  }

  async function save(list) {
    const { hidden = {} } = await chrome.storage.local.get('hidden');
    if (list.length) hidden[host] = list; else delete hidden[host];
    await chrome.storage.local.set({ hidden });
  }
  const current = async () => ((await chrome.storage.local.get('hidden')).hidden || {})[host] || [];

  // ── Animation PouleyPwolu : Pouley picore l'élément, qui éclate en pixels jaunes et
  // bleus ; une plume retombe. Moins d'une seconde, et un simple fondu si l'utilisateur
  // demande moins de mouvement.
  const SP = window.PouleySprites;
  const COLORS = ['#ffe100', '#ffe100', '#ffe100', '#ffd000', '#1565d8', '#4a8cf0', '#ffffff'];

  function pixelBurst(rect) {
    const canvas = document.createElement('canvas');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;';
    shadow.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    const size = 6;
    const count = Math.max(24, Math.min(140, Math.round((rect.width * rect.height) / 700)));
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const parts = Array.from({ length: count }, () => {
      const x = rect.left + Math.random() * rect.width;
      const y = rect.top + Math.random() * rect.height;
      const a = Math.atan2(y - cy, x - cx) + (Math.random() - 0.5) * 0.8;
      const v = 140 + Math.random() * 260;
      return { x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 160, c: COLORS[(Math.random() * COLORS.length) | 0], d: Math.random() * 90 };
    });
    const t0 = performance.now();
    const life = 650;
    return new Promise((resolve) => {
      function frame(now) {
        const t = now - t0;
        ctx.clearRect(0, 0, innerWidth, innerHeight);
        for (const p of parts) {
          const lt = Math.max(0, t - p.d) / 1000;
          if (lt <= 0) continue;
          const k = Math.min(1, (t - p.d) / (life - p.d));
          const x = p.x + p.vx * lt;
          const y = p.y + p.vy * lt + 900 * lt * lt; // gravité
          ctx.globalAlpha = Math.max(0, 1 - k * k);
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(x), Math.round(y), size, size); // pixels nets, comme le logo
        }
        if (t < life) requestAnimationFrame(frame);
        else { canvas.remove(); resolve(); }
      }
      requestAnimationFrame(frame);
    });
  }

  // Petite poule pixel qui donne deux coups de bec au bas de l'élément.
  function peck(rect) {
    if (!SP) return Promise.resolve();
    const s = 44;
    const p = document.createElement('div');
    const left = Math.min(innerWidth - s - 8, Math.max(8, rect.left + rect.width / 2 - s / 2));
    const top = Math.min(innerHeight - s - 8, Math.max(8, rect.top + rect.height - s * 0.6));
    p.style.cssText = `position:fixed;left:${left}px;top:${top}px;width:${s}px;height:${s}px;pointer-events:none;transform-origin:50% 90%;image-rendering:pixelated;`;
    p.innerHTML = SP.toSvg(SP.POULE);
    const svg = p.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
    shadow.appendChild(p);
    return p.animate([
      { transform: 'translateY(14px) scale(0.9)', opacity: 0, offset: 0 },
      { transform: 'translateY(0) scale(1)', opacity: 1, offset: 0.18 },
      { transform: 'rotate(-16deg) translateY(3px)', offset: 0.32 },
      { transform: 'rotate(0deg)', offset: 0.44 },
      { transform: 'rotate(-16deg) translateY(3px)', offset: 0.56 },
      { transform: 'rotate(0deg)', offset: 0.68 },
      { transform: 'translate(26px, -10px) scale(1)', opacity: 1, offset: 0.84 },
      { transform: 'translate(40px, 0) scale(0.95)', opacity: 0, offset: 1 },
    ], { duration: 760, easing: 'linear' }).finished.catch(() => {}).then(() => p.remove());
  }

  // Une plume pixel qui retombe en se balançant.
  function feather(rect) {
    if (!SP || !SP.PLUME) return;
    const f = document.createElement('div');
    f.style.cssText = `position:fixed;left:${rect.left + rect.width * 0.6}px;top:${rect.top + rect.height * 0.3}px;width:18px;height:18px;pointer-events:none;`;
    f.innerHTML = SP.toSvg(SP.PLUME);
    const svg = f.querySelector('svg');
    if (svg) { svg.style.width = '100%'; svg.style.height = '100%'; }
    shadow.appendChild(f);
    f.animate([
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 0 },
      { transform: 'translate(-12px, -24px) rotate(-20deg)', opacity: 1, offset: 0.2 },
      { transform: 'translate(10px, 10px) rotate(18deg)', opacity: 1, offset: 0.55 },
      { transform: 'translate(-6px, 44px) rotate(-12deg)', opacity: 0 },
    ], { duration: 900, easing: 'ease-in-out' }).finished.catch(() => {}).then(() => f.remove());
  }

  async function vanish(el) {
    const rect = el.getBoundingClientRect();
    if (reduce || !el.animate) {
      if (el.animate) await el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }).finished.catch(() => {});
      return;
    }
    const pecking = peck(rect);
    // Premier coup de bec, puis l'élément se tasse et éclate.
    await new Promise((r) => setTimeout(r, 230));
    el.animate([
      { transform: 'scale(1)', opacity: 1, filter: 'none' },
      { transform: 'scale(0.97, 0.94)', opacity: 0.9, offset: 0.35 },
      { transform: 'scale(1.02)', opacity: 0, filter: 'blur(2px)' },
    ], { duration: 200, easing: ease, fill: 'forwards' });
    feather(rect);
    await Promise.all([pixelBurst(rect), pecking]);
  }

  const done = [];
  async function hide(el) {
    const sel = selectorFor(el);
    if (!sel) return;
    show(null);
    await vanish(el);
    const list = await current();
    if (!list.includes(sel)) list.push(sel);
    await save(list);
    done.push(sel);
    undoBtn.disabled = false;
  }

  function onClick(e) {
    if (isOurs(e.target) || e.composedPath().includes(root)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    if (target) hide(target);
  }
  const swallow = (e) => { if (!isOurs(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } };

  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowUp' && target && target.parentElement && target.parentElement !== document.body) { e.preventDefault(); show(target.parentElement); }
    else if (e.key === 'Enter' && target) { e.preventDefault(); hide(target); }
  }

  undoBtn.addEventListener('click', async () => {
    const sel = done.pop();
    if (sel) await save((await current()).filter((x) => x !== sel));
    undoBtn.disabled = !done.length;
  });
  shadow.querySelector('.reset').addEventListener('click', async () => { done.length = 0; undoBtn.disabled = true; await save([]); });
  shadow.querySelector('.done').addEventListener('click', () => stop());

  addEventListener('mousemove', onMove, true);
  addEventListener('click', onClick, true);
  addEventListener('mousedown', swallow, true);
  addEventListener('mouseup', swallow, true);
  addEventListener('keydown', onKey, true);
  addEventListener('scroll', () => target && show(target), true);

  function stop() {
    removeEventListener('mousemove', onMove, true);
    removeEventListener('click', onClick, true);
    removeEventListener('mousedown', swallow, true);
    removeEventListener('mouseup', swallow, true);
    removeEventListener('keydown', onKey, true);
    root.remove();
    delete window.__pouleyHidePick;
  }
  window.__pouleyHidePick = { stop };
})();
