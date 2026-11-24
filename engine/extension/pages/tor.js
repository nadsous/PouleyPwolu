// Page de la fenêtre Tor (pouley://tor) : avertissement, puis connexion à Tor avec sa
// progression ; la fenêtre Tor s'ouvre quand Tor est prêt et cette page se ferme.
const P = (globalThis.browser && browser.pouleyPrivate) || chrome.pouleyPrivate;
const $ = (id) => document.getElementById(id);
let polling = 0;

async function poll() {
  const st = await P.torStatus().catch(() => null);
  if (!st) return;
  $('bar').style.width = Math.max(4, st.progress) + '%';
  $('status').textContent = st.state === 'ready' ? 'Connecté à Tor.' : `Connexion au réseau Tor… ${st.progress} %`;
}

async function open() {
  if (!P || !P.openTorWindow) {
    $('status').textContent = 'Cette version de PouleyPwolu ne contient pas Tor.';
    $('status').classList.add('error');
    $('progress').classList.add('on');
    return;
  }
  if ($('remember').checked) await chrome.runtime.sendMessage({ type: 'tor.remember' }).catch(() => {});
  $('go').disabled = true;
  $('progress').classList.add('on');
  $('status').classList.remove('error');
  polling = setInterval(poll, 400);
  try {
    await P.openTorWindow();
    clearInterval(polling);
    const tab = await chrome.tabs.getCurrent();
    if (tab) chrome.tabs.remove(tab.id);
  } catch (err) {
    clearInterval(polling);
    $('status').textContent = 'Tor n’a pas pu se connecter : ' + (err && err.message || err);
    $('status').classList.add('error');
    $('go').disabled = false;
  }
}

$('go').addEventListener('click', open);
if (new URLSearchParams(location.search).get('auto') === '1') open();
