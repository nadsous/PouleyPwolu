// pouley://json : un JSON préparé par le cœur (rapport de la page pour les développeurs),
// affiché avec la visionneuse (lib/json-view.js).
(async () => {
  const J = self.PouleyJson;
  const $ = (id) => document.getElementById(id);
  const style = document.createElement('style');
  style.textContent = J.CSS;
  document.head.append(style);
  const toast = (t) => { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), 1800); };
  const { devJson } = await chrome.storage.session.get('devJson');
  const data = devJson ? devJson.data : { info: 'Rien à afficher : ouvre « Rapport de la page (JSON) » depuis la palette ou les réglages Développeurs.' };
  const title = devJson ? devJson.title : 'JSON';
  $('title').textContent = title;
  document.title = title;
  const text = JSON.stringify(data, null, 2);
  const tree = J.render(data, { collapseAfter: 2, onPath: (p) => navigator.clipboard.writeText(p).then(() => toast('Chemin copié : ' + p)) });
  $('tree').append(tree);
  $('q').addEventListener('input', () => { const n = J.filter(tree, $('q').value); $('n').textContent = $('q').value.trim() ? n + ' trouvé' + (n > 1 ? 's' : '') : ''; });
  addEventListener('keydown', (e) => { if (e.key === '/' && document.activeElement !== $('q')) { e.preventDefault(); $('q').focus(); } });
  $('open').onclick = () => J.setAll(tree, true);
  $('shut').onclick = () => J.setAll(tree, false);
  $('copy').onclick = () => navigator.clipboard.writeText(text).then(() => toast('JSON copié'));
  $('save').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = title.replace(/[^\w.-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() + '.json';
    a.click();
  };
})();
