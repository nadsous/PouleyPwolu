// Page Téléchargements (pouley://telechargements, Ctrl+J) : chrome.downloads, progression
// en direct, ouvrir, afficher dans le dossier, pause / reprise / annulation, réessayer,
// retirer de la liste ou supprimer le fichier.
(() => {
  const $ = (id) => document.getElementById(id);
  const list = $('list');
  const q = $('q');
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const hue = (s) => { let x = 0; for (const c of s) x = (x * 31 + c.charCodeAt(0)) % 360; return `hsl(${x} 70% 68%)`; };
  const hostOf = (u) => { if (/^(data|blob):/.test(u || '')) return 'capture PouleyPwolu'; try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
  const nameOf = (p) => String(p || '').split(/[\\/]/).pop();
  const toast = (t) => { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 1800); };
  const size = (b) => (b < 0 || b == null ? '?' : b < 1024 ? b + ' o' : b < 1048576 ? (b / 1024).toFixed(0) + ' Ko' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' Mo' : (b / 1073741824).toFixed(2) + ' Go');
  const icons = new Map();

  async function load() {
    const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 500 });
    const text = q.value.trim().toLowerCase();
    const shown = items.filter((d) => d.filename || d.state === 'in_progress')
      .filter((d) => !text || (nameOf(d.filename) + ' ' + d.url).toLowerCase().includes(text));
    $('empty').hidden = shown.length > 0;
    const done = items.filter((d) => d.state === 'complete');
    const total = done.reduce((n, d) => n + Math.max(0, d.fileSize || d.totalBytes || 0), 0);
    $('stats').replaceChildren(stat(done.length, 'terminés'), stat(items.filter((d) => d.state === 'in_progress').length, 'en cours'), stat(size(total), 'au total'));
    list.replaceChildren(...shown.map(row));
    if (items.some((d) => d.state === 'in_progress')) { clearTimeout(load.t); load.t = setTimeout(load, 1000); }
  }

  function stat(v, label) { const s = el('div', 'stat'); s.append(el('b', null, String(v)), label); return s; }

  function button(label, run, cls) { const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label); b.onclick = (e) => { e.stopPropagation(); run(); }; return b; }

  function row(d) {
    const r = el('div', 'row');
    const host = hostOf(d.finalUrl || d.url);
    r.style.setProperty('--h', hue(host));
    const ic = el('div', 'ic');
    if (d.filename) {
      const img = el('img');
      img.alt = '';
      ic.append(img);
      const cached = icons.get(d.id);
      if (cached) img.src = cached;
      else chrome.downloads.getFileIcon(d.id, { size: 32 }).then((u) => { if (u) { icons.set(d.id, u); img.src = u; } }).catch(() => {});
    }
    const txt = el('div', 'txt');
    const name = nameOf(d.filename) || 'Téléchargement…';
    const url = el('div', 'url');
    url.append(...(host ? [el('b', null, host), ' · '] : []), new Date(d.startTime).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }));
    txt.append(el('div', 'title', name), url);
    const meta = el('div', 'meta');
    const acts = el('div', 'acts');
    if (d.state === 'in_progress') {
      const pct = d.totalBytes > 0 ? Math.round((d.bytesReceived / d.totalBytes) * 100) : null;
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = (pct ?? 30) + '%';
      bar.append(fill);
      txt.append(bar);
      meta.append(el('span', 'chip st', d.paused ? 'en pause' : pct != null ? pct + ' %' : '…'), el('span', null, size(d.bytesReceived) + ' / ' + size(d.totalBytes)));
      acts.append(d.paused ? button('Reprendre', () => chrome.downloads.resume(d.id).then(load)) : button('Pause', () => chrome.downloads.pause(d.id).then(load)),
        button('Annuler', () => chrome.downloads.cancel(d.id).then(load), 'danger'));
    } else if (d.state === 'complete') {
      r.classList.add(d.exists === false ? 'gone' : 'done');
      meta.append(el('span', 'chip st', d.exists === false ? 'supprimé' : 'terminé'), el('span', null, size(d.fileSize || d.totalBytes)));
      if (d.exists !== false) {
        acts.append(button('Ouvrir', () => chrome.downloads.open(d.id)), button('Dossier', () => chrome.downloads.show(d.id)),
          button('Supprimer', async () => { if (!confirm('Supprimer « ' + name + ' » de l’ordinateur ?')) return; await chrome.downloads.removeFile(d.id).catch(() => {}); toast('Fichier supprimé'); load(); }, 'danger'));
      }
    } else {
      r.classList.add('fail');
      meta.append(el('span', 'chip st', d.error === 'USER_CANCELED' ? 'annulé' : 'échec' + (d.error ? ' · ' + d.error.toLowerCase() : '')));
      if (!/^(data|blob):/.test(d.url)) acts.append(button('Réessayer', () => chrome.downloads.download({ url: d.url }).then(load)));
    }
    acts.append(button('✕', async () => { await chrome.downloads.erase({ id: d.id }); load(); }));
    meta.append(acts);
    r.append(ic, txt, meta);
    r.title = d.finalUrl || d.url;
    r.onclick = () => { if (d.state === 'complete' && d.exists !== false) chrome.downloads.open(d.id); };
    return r;
  }

  q.addEventListener('input', load);
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); } });
  $('folder').onclick = () => chrome.downloads.showDefaultFolder();
  $('clear').onclick = async () => {
    const items = await chrome.downloads.search({});
    for (const d of items) if (d.state !== 'in_progress') await chrome.downloads.erase({ id: d.id });
    toast('Liste vidée (les fichiers restent sur l’ordinateur)');
    load();
  };
  chrome.downloads.onCreated.addListener(load);
  chrome.downloads.onChanged.addListener(load);
  chrome.downloads.onErased.addListener(load);
  load();
})();
