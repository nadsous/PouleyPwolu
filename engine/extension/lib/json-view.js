// Affichage du JSON pour les développeurs : arbre en couleurs (thème One Dark, comme
// le mode Code des réglages), nœuds repliables, liens cliquables, chemins copiables,
// et coloration d'un texte JSON brut (éditeur des réglages).
// Utilisé par content/json-viewer.js, les réglages (pouley.json) et pages/json.html.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleyJson = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const CSS = `
.jv { --jv-key: #e06c75; --jv-str: #98c379; --jv-num: #d19a66; --jv-kw: #c678dd; --jv-null: #56b6c2; --jv-pn: #abb2bf; --jv-cm: #7f848e;
  --jv-sel: rgba(254, 113, 70, 0.16); --jv-hit: rgba(255, 225, 0, 0.28); --jv-guide: rgba(171, 178, 191, 0.12);
  font: 13px/1.75 'JetBrains Mono', ui-monospace, Consolas, monospace; color: var(--jv-pn); }
.jv.light { --jv-key: #e45649; --jv-str: #50a14f; --jv-num: #986801; --jv-kw: #a626a4; --jv-null: #0184bc; --jv-pn: #383a42; --jv-cm: #a0a1a7; --jv-guide: rgba(56, 58, 66, 0.12); }
.jv ul { list-style: none; margin: 0; padding: 0 0 0 18px; border-left: 1px solid var(--jv-guide); }
.jv > ul { border: 0; padding: 0; }
.jv li { position: relative; white-space: pre-wrap; word-break: break-word; }
.jv .jr { border-radius: 4px; padding: 0 4px; margin-left: -4px; }
.jv .jr:hover { background: var(--jv-sel); }
.jv .tg { cursor: pointer; user-select: none; display: inline-block; width: 14px; margin-left: -16px; color: var(--jv-cm); text-align: center; }
.jv .tg::before { content: '▾'; }
.jv li.shut > .jr .tg::before { content: '▸'; }
.jv li.shut > ul { display: none; }
.jv li:not(.shut) > .jr .more { display: none; }
.jv li.shut > .end { display: none; }
.jv .k { color: var(--jv-key); cursor: pointer; }
.jv .s { color: var(--jv-str); }
.jv .n { color: var(--jv-num); }
.jv .b { color: var(--jv-kw); }
.jv .z { color: var(--jv-null); font-style: italic; }
.jv .p { color: var(--jv-pn); }
.jv .more { color: var(--jv-cm); font-style: italic; cursor: pointer; }
.jv .cnt { color: var(--jv-cm); font-size: 11px; margin-left: 8px; user-select: none; }
.jv a.s { text-decoration: underline; text-decoration-color: color-mix(in srgb, var(--jv-str) 45%, transparent); text-underline-offset: 3px; }
.jv .hit { background: var(--jv-hit); border-radius: 3px; }
.jv .gone { display: none; }
`;

  const type = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  const isUrl = (s) => /^(https?:\/\/|pouley:\/\/|chrome-extension:\/\/)[^\s"]+$/.test(s);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const quote = (s) => JSON.stringify(s);

  // Arbre : chaque nœud garde son chemin (data-path), pour le copier d'un clic sur la clé.
  function render(value, { light = false, collapseAfter = 3, onPath } = {}) {
    const box = el('div', 'jv' + (light ? ' light' : ''));
    const top = el('ul');
    top.append(node(undefined, value, '$', 0, true));
    box.append(top);

    function scalar(v) {
      const t = type(v);
      if (t === 'string') {
        if (isUrl(v)) { const a = el('a', 's', quote(v)); a.href = v; a.target = '_blank'; a.rel = 'noreferrer'; return a; }
        return el('span', 's', quote(v));
      }
      if (t === 'number') return el('span', 'n', String(v));
      if (t === 'boolean') return el('span', 'b', String(v));
      return el('span', 'z', 'null');
    }

    function node(key, v, path, depth, last) {
      const li = el('li');
      li.dataset.path = path;
      const row = el('div', 'jr');
      const t = type(v);
      const comma = last ? '' : ',';
      if (key !== undefined) {
        const k = el('span', 'k', typeof key === 'number' ? '' : quote(key));
        if (typeof key === 'number') k.className = 'p';
        else {
          k.title = 'Copier le chemin ' + path;
          k.addEventListener('click', () => { if (onPath) onPath(path); });
          row.append(k, el('span', 'p', ': '));
        }
      }
      if (t !== 'object' && t !== 'array') {
        row.append(scalar(v), el('span', 'p', comma));
        li.append(row);
        return li;
      }
      const entries = t === 'array' ? v.map((x, i) => [i, x]) : Object.entries(v);
      const [open, close] = t === 'array' ? ['[', ']'] : ['{', '}'];
      if (!entries.length) {
        row.append(el('span', 'p', open + close + comma));
        li.append(row);
        return li;
      }
      const tg = el('span', 'tg');
      tg.addEventListener('click', () => li.classList.toggle('shut'));
      row.prepend(tg);
      const more = el('span', 'more', ' … ');
      more.addEventListener('click', () => li.classList.remove('shut'));
      row.append(el('span', 'p', open), more, el('span', 'cnt', t === 'array' ? entries.length + ' élément' + (entries.length > 1 ? 's' : '') : entries.length + ' clé' + (entries.length > 1 ? 's' : '')));
      // Replié : la fermeture s'affiche sur la même ligne.
      more.textContent = ' … ' + close + comma;
      const ul = el('ul');
      entries.forEach(([k, x], i) => ul.append(node(k, x, t === 'array' ? `${path}[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `${path}.${k}` : `${path}[${quote(k)}]`, depth + 1, i === entries.length - 1)));
      li.append(row, ul, el('div', 'p end', close + comma));
      if (depth >= collapseAfter) li.classList.add('shut');
      return li;
    }
    return box;
  }

  function setAll(box, open) {
    for (const li of box.querySelectorAll('li')) if (li.querySelector(':scope > ul')) li.classList.toggle('shut', !open);
  }

  // Filtre : garde les lignes dont la clé ou la valeur contient le texte, et leurs parents.
  function filter(box, text) {
    const q = String(text || '').trim().toLowerCase();
    for (const h of box.querySelectorAll('.hit')) h.classList.remove('hit');
    for (const li of box.querySelectorAll('li')) li.classList.remove('gone');
    if (!q) return 0;
    let n = 0;
    const lis = [...box.querySelectorAll('li')];
    const keep = new Set();
    for (const li of lis) {
      const row = li.querySelector(':scope > .jr');
      const hit = [...row.querySelectorAll('.k, .s, .n, .b, .z')].filter((x) => x.textContent.toLowerCase().includes(q));
      if (!hit.length) continue;
      n++;
      hit.forEach((x) => x.classList.add('hit'));
      for (let p = li; p && p.tagName === 'LI'; p = p.parentElement.closest('li')) { keep.add(p); p.classList.remove('shut'); }
      for (const d of li.querySelectorAll('li')) keep.add(d);
    }
    for (const li of lis) if (!keep.has(li)) li.classList.add('gone');
    return n;
  }

  // Coloration d'un texte JSON brut (HTML échappé) : pour l'éditeur des réglages.
  function highlight(text) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    return String(text).replace(/("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false)\b|\b(null)\b|([{}[\],:])|([^"\d{}[\],:tfn-]+|.)/g,
      (m, str, colon, num, bool, nul, pn, other) => {
        if (str) return colon ? `<span class="k">${esc(str)}</span><span class="p">${colon}</span>` : `<span class="s">${esc(str)}</span>`;
        if (num) return `<span class="n">${num}</span>`;
        if (bool) return `<span class="b">${bool}</span>`;
        if (nul) return `<span class="z">${nul}</span>`;
        if (pn) return `<span class="p">${pn}</span>`;
        return esc(other || m);
      });
  }

  // Erreur de JSON.parse avec sa ligne et sa colonne, en français.
  function parseError(text) {
    try { JSON.parse(text); return null; } catch (err) {
      const m = /position (\d+)/.exec(err.message);
      let line = null;
      let col = null;
      if (m) {
        const before = text.slice(0, Number(m[1]));
        line = before.split('\n').length;
        col = before.length - before.lastIndexOf('\n');
      }
      return { message: err.message, line, col };
    }
  }

  return { CSS, render, setAll, filter, highlight, parseError };
});
