// Barre de la fenêtre flottante (reprise de src/renderer/float.js) : titre de la page,
// transparence de la fenêtre, précédent, recharger, ramener dans le navigateur, fermer.
(async () => {
  const I = self.PouleyIcons;
  const $ = (id) => document.getElementById(id);
  const win = await chrome.windows.getCurrent();
  const cmd = (name, arg) => chrome.runtime.sendMessage({ type: 'float.cmd', windowId: win.id, name, arg }).catch(() => null);

  $('logo').innerHTML = I.svg('poule');
  $('op-ic').innerHTML = I.svg('opacite');
  $('back').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>';
  $('reload').innerHTML = '<svg class="ic" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6M20 4v5h-5"/></svg>';
  $('dock').innerHTML = I.svg('ramener');
  $('close').innerHTML = I.svg('fermer');

  $('back').onclick = () => cmd('back');
  $('reload').onclick = () => cmd('reload');
  $('dock').onclick = () => cmd('dock');
  $('close').onclick = () => cmd('close');
  $('opacity').oninput = (e) => cmd('opacity', Number(e.target.value));

  function show(info) {
    if (!info) return;
    $('title').textContent = info.title || info.url;
    $('title').title = info.url;
    document.title = (info.title || 'Superposition') + ' — PouleyPwolu';
    const fav = $('fav');
    if (info.favicon) { fav.src = info.favicon; fav.hidden = false; $('logo').hidden = true; }
    else { fav.hidden = true; $('logo').hidden = false; }
    if (typeof info.opacity === 'number') $('opacity').value = info.opacity;
    $('back').disabled = !info.canGoBack;
  }
  $('fav').onerror = () => { $('fav').hidden = true; $('logo').hidden = false; };
  // Titre et adresse suivent la page affichée dans la fenêtre.
  chrome.tabs.onUpdated.addListener((_id, _c, tab) => { if (tab.windowId === win.id) cmd('info').then(show); });
  show(await cmd('info'));
})();
