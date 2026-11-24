// Page d'accueil des fenêtres Tor : état de la connexion et recherche DuckDuckGo en .onion.
// Une adresse tapée (site.com, http://…, xxx.onion) s'ouvre directement.
const $ = (id) => document.getElementById(id);
const P = (globalThis.browser && browser.pouleyPrivate) || chrome.pouleyPrivate;

if (window.PouleySprites) $('poule').innerHTML = PouleySprites.toSvg(PouleySprites.POULE);

async function refresh() {
  const st = P ? await P.torStatus().catch(() => null) : null;
  const ok = st && st.state === 'ready';
  $('status').classList.toggle('off', !ok);
  $('status-text').textContent = ok ? 'Connecté au réseau Tor' : 'Tor n’est pas connecté : rien ne sort de cette fenêtre';
}
refresh();
setInterval(refresh, 5000);

const looksLikeUrl = (v) => /^[a-z][a-z0-9+.-]*:\/\//i.test(v) || /^[^\s/]+\.[a-z]{2,}(\/|$)/i.test(v);

$('search').addEventListener('submit', (e) => {
  const v = $('q').value.trim();
  if (!v) { e.preventDefault(); return; }
  if (looksLikeUrl(v)) {
    e.preventDefault();
    location.href = /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : 'https://' + v;
  }
});
