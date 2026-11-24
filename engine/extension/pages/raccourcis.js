// Aide-mémoire des raccourcis clavier (Ctrl+/). Les raccourcis eux-mêmes sont dans
// lib/keys.js, core/layout.js et manifest.json (commands) : garder cette liste à jour.
const GROUPS = [
  ['Naviguer', [
    ['Rechercher ou ouvrir un site', ['Ctrl', 'K']],
    ['Modifier l’adresse', ['Ctrl', 'L']],
    ['Nouvel onglet', ['Ctrl', 'T']],
    ['Fermer l’onglet', ['Ctrl', 'W']],
    ['Rouvrir l’onglet fermé', ['Ctrl', 'Maj', 'T']],
    ['Page précédente / suivante', ['Alt', '← / →']],
    ['Recharger', ['Ctrl', 'R']],
    ['Chercher dans la page', ['Ctrl', 'F']],
  ]],
  ['Poulaillers et onglets', [
    ['Aller au poulailler 1 à 9', ['Ctrl', '1…9']],
    ['Poulailler précédent / suivant', ['Alt', '↑ / ↓']],
    ['Épingler l’onglet', ['Ctrl', 'D']],
    ['Deux sites côte à côte', ['Ctrl', 'Maj', 'K']],
    ['Mettre en superposition', ['Ctrl', 'Maj', 'P']],
    ['Fenêtre Tor', ['Ctrl', 'Maj', 'N']],
  ]],
  ['Barre', [
    ['Masquer / afficher la barre', ['Ctrl', 'S']],
    ['Paramètres', ['Ctrl', ',']],
    ['Assistant IA', ['Ctrl', 'E']],
    ['Inspecter le site', ['Ctrl', 'I']],
  ]],
  ['Outils', [
    ['Capture de la zone visible', ['Ctrl', 'Maj', 'S']],
    ['Capture d’une zone', ['Ctrl', 'Maj', 'X']],
    ['Écrire sur la page (stylo)', ['Ctrl', 'Maj', 'D']],
    ['Masquer des éléments gênants', ['Ctrl', 'Maj', 'H']],
    ['Historique', ['Ctrl', 'H']],
    ['Téléchargements', ['Ctrl', 'J']],
    ['Cet aide-mémoire', ['Ctrl', '/']],
  ]],
];

const $ = (id) => document.getElementById(id);
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function render(query) {
  const q = norm(query.trim());
  const root = $('groups');
  root.replaceChildren();
  let shown = 0;
  for (const [title, rows] of GROUPS) {
    const hits = rows.filter(([label, keys]) => !q || norm(label + ' ' + title + ' ' + keys.join(' ')).includes(q));
    if (!hits.length) continue;
    const sec = document.createElement('section');
    const h2 = document.createElement('h2');
    h2.textContent = title;
    sec.append(h2);
    for (const [label, keys] of hits) {
      const row = document.createElement('div');
      row.className = 'row';
      const name = document.createElement('span');
      name.textContent = label;
      const k = document.createElement('div');
      k.className = 'keys';
      for (const key of keys) {
        const kbd = document.createElement('kbd');
        kbd.textContent = key;
        k.append(kbd);
      }
      row.append(name, k);
      sec.append(row);
      shown += 1;
    }
    root.append(sec);
  }
  $('none').hidden = shown > 0;
}

$('q').addEventListener('input', (e) => render(e.target.value));
render('');
