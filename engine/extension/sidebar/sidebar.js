// Liste des onglets de la fenêtre (squelette : les poulaillers arrivent ensuite).
const list = document.getElementById('onglets');

async function render() {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  list.replaceChildren(...tabs.map((t) => {
    const li = document.createElement('li');
    li.textContent = t.title || t.url;
    li.className = t.active ? 'actif' : '';
    li.onclick = () => chrome.tabs.update(t.id, { active: true });
    return li;
  }));
}

for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onMoved']) chrome.tabs[ev].addListener(render);
render();
