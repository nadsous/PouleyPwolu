// Barre de la fenêtre flottante (reprise de src/renderer/float.js) : titre de la page,
// transparence de la fenêtre, précédent, recharger, ramener dans le navigateur, fermer.
(async () => {
  const I = self.PouleyIcons;
  const $ = (id) => document.getElementById(id);
  const win = await chrome.windows.getCurrent();
  const cmd = (name, arg) => chrome.runtime.sendMessage({ type: 'float.cmd', windowId: win.id, name, arg }).catch(() => null);

  $('logo').innerHTML = I.svg('poule');
  $('op-ic').innerHTML = I.svg('opacite');
  $('back').innerHTML = PouleyIcons.svg('precedent');
  $('reload').innerHTML = PouleyIcons.svg('rafraichir');
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

  // La petite barre sert de barre de titre : on indique au navigateur ses zones sans
  // bouton (titre compris) ; il y pose de vraies zones de déplacement Windows.
  const P = (globalThis.browser && browser.pouleyPrivate) || chrome.pouleyPrivate;
  const bar = document.querySelector('.bar');
  function regions() {
    const b = bar.getBoundingClientRect();
    const blocks = [...bar.querySelectorAll('button, input, label')].map((e) => e.getBoundingClientRect())
      .filter((r) => r.width > 0 && getComputedStyle(document.body).opacity !== '0').sort((a, c) => a.left - c.left);
    const out = [];
    let x = b.left;
    for (const r of blocks) {
      if (r.left - x > 6) out.push({ x, y: b.top, width: r.left - x, height: b.height });
      x = Math.max(x, r.right);
    }
    if (b.right - x > 6) out.push({ x, y: b.top, width: b.right - x, height: b.height });
    return out.map((r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }));
  }
  let last = '';
  const send = () => {
    const r = regions();
    const key = JSON.stringify(r);
    if (key === last || !P || !P.setDragRegions) return;
    last = key;
    P.setDragRegions(win.id, r, 'top').catch(() => { last = ''; });
  };
  new ResizeObserver(send).observe(bar);
  addEventListener('resize', send);
  setInterval(send, 1500);
  send();
})();
