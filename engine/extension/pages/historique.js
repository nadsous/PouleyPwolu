// Page Historique (pouley://historique, Ctrl+H) : chrome.history, groupé par jour,
// recherche (« site:github.com » pour un site), suppression d'une page ou d'une période.
(() => {
  const $ = (id) => document.getElementById(id);
  const list = $('list');
  const q = $('q');
  let limit = 300;
  let loading = false;
  let full = false;

  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return `hsl(${x} 70% 68%)`; };
  const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const icon = (u) => chrome.runtime.getURL('_favicon/') + '?size=32&pageUrl=' + encodeURIComponent(u);
  const pad = (n) => String(n).padStart(2, '0');
  const toast = (t) => { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 1800); };

  function dayLabel(d) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const diff = Math.round((today - new Date(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000);
    if (diff === 0) return 'Aujourd’hui';
    if (diff === 1) return 'Hier';
    return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
  }

  async function load() {
    if (loading) return;
    loading = true;
    const raw = q.value.trim();
    const site = /^site:(\S+)\s*(.*)$/i.exec(raw);
    const items = await chrome.history.search({ text: site ? site[2] : raw, startTime: 0, maxResults: site ? 5000 : limit });
    const shown = site ? items.filter((i) => hostOf(i.url).endsWith(site[1].replace(/^www\./, ''))).slice(0, limit) : items;
    full = items.length < limit;
    draw(shown.filter((i) => !/^chrome-extension:|^chrome:/.test(i.url)));
    loading = false;
  }

  function draw(items) {
    list.replaceChildren();
    $('empty').hidden = items.length > 0;
    // Petites statistiques : pages, sites, site le plus visité.
    const hosts = new Map();
    for (const i of items) hosts.set(hostOf(i.url), (hosts.get(hostOf(i.url)) || 0) + (i.visitCount || 1));
    const top = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    $('stats').replaceChildren(
      stat(items.length, 'pages'), stat(hosts.size, 'sites'),
      ...top.map(([h, n]) => { const s = stat(n + '×', h); s.style.cursor = 'pointer'; s.onclick = () => { q.value = 'site:' + h; load(); }; return s; }));
    let lastDay = '';
    for (const it of items) {
      const d = new Date(it.lastVisitTime);
      const key = d.toDateString();
      if (key !== lastDay) {
        lastDay = key;
        const head = el('div', 'day', dayLabel(d));
        head.append(el('span', 'cm', `// ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`));
        list.append(head);
      }
      list.append(row(it, d));
    }
  }

  function stat(v, label) { const s = el('div', 'stat'); s.append(el('b', null, String(v)), label); return s; }

  function row(it, d) {
    const r = el('div', 'row');
    const host = hostOf(it.url);
    r.style.setProperty('--h', hue(host));
    const img = el('img');
    img.src = icon(it.url);
    img.alt = '';
    const txt = el('div', 'txt');
    const url = el('div', 'url');
    const at = it.url.indexOf(host);
    if (host && at >= 0) url.append(it.url.slice(0, at), el('b', null, host), it.url.slice(at + host.length));
    else url.textContent = it.url;
    txt.append(el('div', 'title', it.title || host || it.url), url);
    const meta = el('div', 'meta');
    if (it.visitCount > 1) meta.append(el('span', 'chip', '×' + it.visitCount));
    if (it.typedCount > 0) meta.append(el('span', 'chip', 'tapé'));
    const del = el('button', 'act', '✕');
    del.title = 'Retirer de l’historique';
    del.onclick = async (e) => { e.stopPropagation(); await chrome.history.deleteUrl({ url: it.url }); r.remove(); toast('Retiré de l’historique'); };
    meta.append(del);
    r.append(el('span', 'time', `${pad(d.getHours())}:${pad(d.getMinutes())}`), img, txt, meta);
    r.title = it.url;
    r.onclick = (e) => chrome.tabs.create({ url: it.url, active: !(e.ctrlKey || e.metaKey || e.button === 1) });
    r.onauxclick = (e) => { if (e.button === 1) chrome.tabs.create({ url: it.url, active: false }); };
    return r;
  }

  let t = 0;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { limit = 300; load(); }, 150); });
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
  addEventListener('scroll', () => {
    if (!full && innerHeight + scrollY > document.body.scrollHeight - 600) { limit += 300; load(); }
  });
  const clear = async (ms, label) => {
    await chrome.history.deleteRange({ startTime: Date.now() - ms, endTime: Date.now() });
    toast(label);
    load();
  };
  $('clear-hour').onclick = () => clear(3600000, 'Dernière heure effacée');
  $('clear-day').onclick = () => { const s = new Date(); s.setHours(0, 0, 0, 0); clear(Date.now() - s, 'Historique du jour effacé'); };
  $('clear-all').onclick = async () => {
    if (!confirm('Effacer tout l’historique ?')) return;
    await chrome.history.deleteAll();
    toast('Historique effacé');
    load();
  };
  chrome.history.onVisited.addListener(() => { if (!q.value && scrollY < 200) load(); });
  load();
})();
