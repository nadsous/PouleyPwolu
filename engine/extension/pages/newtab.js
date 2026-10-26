// Page Nouvel onglet (reprise de src/pages/newtab.html) : moteur et IA lus dans les réglages.
(async () => {
  const { SEARCH_ENGINES, AI_PROVIDERS, fill } = PouleyConfig;
  const { state } = await chrome.storage.local.get('state');
  const s = (state && state.settings) || {};
  const engineKey = SEARCH_ENGINES[s.searchEngine] ? s.searchEngine : 'duckduckgo';
  const engine = SEARCH_ENGINES[engineKey];
  const aiKey = AI_PROVIDERS[s.ai] ? s.ai : 'claude';
  const ai = AI_PROVIDERS[aiKey];
  // Second choix quand Perplexity est le moteur par défaut.
  const engine2Key = engineKey === 'comet' ? (s.searchEngine2 && s.searchEngine2 !== 'comet' && SEARCH_ENGINES[s.searchEngine2] ? s.searchEngine2 : 'duckduckgo') : null;

  const $ = (id) => document.getElementById(id);
  $('q').placeholder = 'Rechercher avec ' + engine.label + '…';
  $('t-engine').textContent = 'Rechercher avec ' + engine.label;
  $('lg-engine').innerHTML = PouleyBrands.svg(engineKey);
  $('t-ai').textContent = 'Demander à ' + ai.label;
  $('lg-ai').innerHTML = PouleyBrands.svg(aiKey);
  if (engine2Key) {
    $('b-engine2').hidden = false;
    $('t-engine2').textContent = SEARCH_ENGINES[engine2Key].label;
    $('lg-engine2').innerHTML = PouleyBrands.svg(engine2Key);
  }

  const poule = $('poule');
  poule.innerHTML = PouleySprites.toSvg(PouleySprites.POULE);
  poule.onclick = () => { poule.classList.remove('peck'); void poule.offsetWidth; poule.classList.add('peck'); };
  poule.addEventListener('animationend', () => poule.classList.remove('peck'));
  const hr = new Date().getHours();
  $('greet').textContent = hr < 5 ? 'Encore debout ? 🌙' : hr < 12 ? 'Bonjour ☀️' : hr < 18 ? 'Bon après-midi' : 'Bonsoir 🌙';
  const clock = $('clock');
  const tick = () => { clock.textContent = new Date().toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }); };
  tick();
  setInterval(tick, 15000);

  $('f').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('q').value.trim();
    if (!q) return;
    const go = (e.submitter && e.submitter.dataset.go) || 'search';
    const url = go === 'ask' ? fill(ai.ask, q) : fill(SEARCH_ENGINES[go === 'search2' && engine2Key ? engine2Key : engineKey].url, q);
    location.href = url;
  });
})();
