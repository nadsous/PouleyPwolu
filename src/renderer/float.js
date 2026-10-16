// Barre de la mini-fenêtre flottante.
(() => {
  const api = window.pouleyFloat;
  const I = window.PouleyIcons;
  const $ = (id) => document.getElementById(id);

  $('logo').innerHTML = I.svg('poule');
  $('op-ic').innerHTML = I.svg('opacite');
  $('back').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  $('reload').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>';
  $('dock').innerHTML = I.svg('ramener');
  $('close').innerHTML = I.svg('fermer');

  $('back').onclick = () => api.cmd('back');
  $('reload').onclick = () => api.cmd('reload');
  $('dock').onclick = () => api.cmd('dock');
  $('close').onclick = () => api.cmd('close');
  $('opacity').oninput = (e) => api.cmd('opacity', Number(e.target.value));

  api.onInfo((info) => {
    $('title').textContent = info.title || info.url;
    $('title').title = info.url;
    const fav = $('fav');
    if (info.favicon) { fav.src = info.favicon; fav.hidden = false; $('logo').hidden = true; }
    else { fav.hidden = true; $('logo').hidden = false; }
    if (typeof info.opacity === 'number') $('opacity').value = info.opacity;
    $('back').disabled = !info.canGoBack;
  });
  $('fav').onerror = () => { $('fav').hidden = true; $('logo').hidden = false; };
  api.cmd('info');
})();
