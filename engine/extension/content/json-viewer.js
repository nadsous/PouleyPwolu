// Visionneuse JSON : une page qui renvoie du JSON (API, fichier .json) s'affiche en
// arbre coloré, repliable, avec recherche, chemins copiables et vue brute / formatée.
// Réglage « Visionneuse JSON » (Paramètres › Développeurs).
(async () => {
  if (window.top !== window) return;
  const ctype = document.contentType || '';
  const pre = document.body && document.body.children.length === 1 && document.body.firstElementChild.tagName === 'PRE' ? document.body.firstElementChild : null;
  if (!/json/i.test(ctype) && !(pre && /^text\/plain/i.test(ctype))) return;
  const raw = (pre || document.body).textContent;
  if (!raw || raw.length > 8 * 1024 * 1024 || !/^\s*[[{]/.test(raw)) return;
  let data;
  try { data = JSON.parse(raw); } catch { return; }
  try {
    const { state } = await chrome.storage.local.get('state');
    if (state && state.settings && state.settings.jsonViewer === false) return;
  } catch {}

  const J = self.PouleyJson;
  const host = document.createElement('div');
  const root = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // Polices de PouleyPwolu (ressources accessibles aux pages, voir manifest.json).
  const font = (name, file, weight) => `@font-face { font-family: '${name}'; src: url('${chrome.runtime.getURL('sidebar/' + file)}'); font-weight: ${weight}; }`;
  const fonts = document.createElement('style');
  fonts.textContent = font('Onest', 'Onest-Regular.ttf', 400) + font('Onest', 'Onest-SemiBold.ttf', '600 700') + font('JetBrains Mono', 'JetBrainsMono-Regular.ttf', 400);
  (document.head || document.documentElement).append(fonts);
  style.textContent = J.CSS + `
    :host { all: initial; }
    .wrap { position: fixed; inset: 0; display: flex; flex-direction: column; background: #16161a; color: #c9c9d0; font: 13px 'Onest', system-ui, sans-serif; }
    .bar { display: flex; align-items: center; gap: 6px; padding: 8px 12px; border-bottom: 1px solid rgba(255,255,255,.08); background: #1b1b1e; flex-wrap: wrap; }
    .bar b { color: #ffe100; font-weight: 600; margin-right: 6px; }
    .bar .meta { color: #8b8b95; font: 12px 'JetBrains Mono', monospace; margin-right: auto; }
    .seg { display: inline-flex; background: #26262a; border-radius: 8px; padding: 2px; }
    button { all: unset; cursor: pointer; padding: 5px 10px; border-radius: 6px; color: #c9c9d0; font: 600 12px 'Onest', system-ui, sans-serif; }
    button:hover { background: rgba(255,255,255,.08); }
    .seg button.on { background: #ffe100; color: #17140a; }
    input { all: unset; width: 200px; padding: 5px 10px; border-radius: 6px; background: #26262a; color: #f4f4f5; font: 12px 'JetBrains Mono', monospace; }
    input:focus { box-shadow: 0 0 0 2px rgba(255,225,0,.5); }
    .n-hit { color: #8b8b95; font: 12px 'JetBrains Mono', monospace; min-width: 70px; }
    .body { flex: 1; overflow: auto; padding: 14px 22px 40px 30px; }
    pre.raw { margin: 0; font: 13px/1.7 'JetBrains Mono', monospace; white-space: pre-wrap; word-break: break-word; }
    .toast { position: fixed; bottom: 18px; left: 50%; transform: translateX(-50%); background: #ffe100; color: #17140a; padding: 7px 14px; border-radius: 999px; font: 600 12px 'Onest', sans-serif; opacity: 0; transition: opacity .2s; pointer-events: none; }
    .toast.on { opacity: 1; }
  `;
  const size = raw.length > 1024 * 1024 ? (raw.length / 1048576).toFixed(1) + ' Mo' : raw.length > 1024 ? Math.round(raw.length / 1024) + ' Ko' : raw.length + ' o';
  const kind = Array.isArray(data) ? `tableau · ${data.length} élément${data.length > 1 ? 's' : ''}` : data && typeof data === 'object' ? `objet · ${Object.keys(data).length} clé${Object.keys(data).length > 1 ? 's' : ''}` : typeof data;
  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="bar">
      <b>{ } JSON</b><span class="meta"></span>
      <input class="q" placeholder="Filtrer clés et valeurs…" spellcheck="false" /><span class="n-hit"></span>
      <span class="seg"><button data-v="tree" class="on">Arbre</button><button data-v="pretty">Formaté</button><button data-v="raw">Brut</button></span>
      <button data-a="open">Tout déplier</button><button data-a="shut">Tout replier</button><button data-a="copy">Copier</button><button data-a="save">Enregistrer</button>
    </div>
    <div class="body"></div>
    <div class="toast"></div>`;
  root.append(style, wrap);
  wrap.querySelector('.meta').textContent = `${kind} · ${size}`;
  const body = wrap.querySelector('.body');
  const toastEl = wrap.querySelector('.toast');
  const toast = (t) => { toastEl.textContent = t; toastEl.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => toastEl.classList.remove('on'), 1600); };
  const copy = (t, msg) => navigator.clipboard.writeText(t).then(() => toast(msg), () => toast('Copie impossible'));
  const pretty = JSON.stringify(data, null, 2);
  const tree = J.render(data, { collapseAfter: raw.length > 300000 ? 1 : 3, onPath: (p) => copy(p, 'Chemin copié : ' + p) });
  let view = 'tree';
  function show(v) {
    view = v;
    for (const b of wrap.querySelectorAll('.seg button')) b.classList.toggle('on', b.dataset.v === v);
    body.replaceChildren();
    if (v === 'tree') body.append(tree);
    else {
      const p = document.createElement('pre');
      p.className = 'raw jv';
      if (v === 'pretty' && pretty.length < 2 * 1024 * 1024) p.innerHTML = J.highlight(pretty);
      else p.textContent = v === 'pretty' ? pretty : raw;
      body.append(p);
    }
  }
  wrap.querySelector('.seg').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) show(b.dataset.v); });
  wrap.querySelector('.bar').addEventListener('click', (e) => {
    const a = e.target.closest('button[data-a]');
    if (!a) return;
    if (a.dataset.a === 'open') { show('tree'); J.setAll(tree, true); }
    if (a.dataset.a === 'shut') { show('tree'); J.setAll(tree, false); }
    if (a.dataset.a === 'copy') copy(view === 'raw' ? raw : pretty, 'JSON copié');
    if (a.dataset.a === 'save') {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([pretty], { type: 'application/json' }));
      link.download = (location.pathname.split('/').pop() || 'donnees').replace(/\.json$/i, '') + '.json';
      link.click();
    }
  });
  const q = wrap.querySelector('.q');
  q.addEventListener('input', () => {
    if (view !== 'tree') show('tree');
    const n = J.filter(tree, q.value);
    wrap.querySelector('.n-hit').textContent = q.value.trim() ? n + ' trouvé' + (n > 1 ? 's' : '') : '';
  });
  addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !e.shiftKey) { e.preventDefault(); q.focus(); q.select(); } }, true);
  document.body.replaceChildren(host);
  document.title = document.title || (location.pathname.split('/').pop() || location.host) + ' · JSON';
  show('tree');
})();
