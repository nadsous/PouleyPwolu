// Copie les icônes Iconoir (https://iconoir.com, licence MIT) utilisées par PouleyPwolu
// dans engine/extension/lib/icons.js, entre les marqueurs <iconoir> et </iconoir>.
//   npm pack iconoir && tar -xzf iconoir-*.tgz
//   node scripts/make-iconoir.js <dossier package/icons/regular>
const fs = require('fs');
const path = require('path');

// Nom PouleyPwolu -> nom Iconoir.
const MAP = {
  // Poulaillers
  oeuf: 'egg', maison: 'home-simple', travail: 'suitcase', jeu: 'gamepad', art: 'palette',
  livre: 'book', courses: 'cart', outils: 'tools', labo: 'flask', code: 'code',
  musique: 'music-double-note', coeur: 'heart', etoile: 'star', globe: 'globe',
  message: 'send-diagonal', ecole: 'graduation-cap', photo: 'camera', finance: 'credit-card',
  film: 'cinema-old', sport: 'basketball',
  // Interface
  reglages: 'settings', inspecter: 'search', ia: 'sparks', resume: 'chat-lines', retour: 'undo',
  epingle: 'pin', lien: 'link', archive: 'archive', 'barre-gauche': 'layout-left',
  'barre-droite': 'layout-right', 'barre-haut': 'align-top-box', 'barre-masquer': 'sidebar-collapse',
  bouclier: 'shield-check', 'bouclier-off': 'shield-xmark', theme: 'half-moon', effacer: 'bin',
  plus: 'plus', veille: 'moon-sat', extension: 'puzzle', capture: 'screenshot',
  superposition: 'multi-window', depot: 'git-fork', cote: 'view-columns-2', ramener: 'open-in-window',
  fermer: 'xmark', selection: 'frame-select', page: 'page', opacite: 'droplet-half', profil: 'user',
  cle: 'key', cadenas: 'lock', oeil: 'eye', copier: 'copy', des: 'dice-five',
  // Barre d'adresse, onglets, palette (sidebar/app.js)
  x: 'xmark', son: 'sound-high', muet: 'sound-off', ouvert: 'lock-slash', recherche: 'search',
  onglet: 'window-tabs', commande: 'terminal', accueil: 'home-simple', telechargement: 'download',
  historique: 'clock-rotate-right', favori: 'bookmark', rafraichir: 'refresh', precedent: 'nav-arrow-left',
  suivant: 'nav-arrow-right', haut: 'nav-arrow-up', bas: 'nav-arrow-down', plus_menu: 'more-horiz',
  stylo: 'design-pencil', 'piste-prec': 'skip-prev', 'piste-suiv': 'skip-next',
  tor: 'eye-closed',
};

const dir = process.argv[2];
if (!dir) { console.error('Usage : node scripts/make-iconoir.js <iconoir/icons/regular>'); process.exit(1); }

const out = {};
for (const [ours, theirs] of Object.entries(MAP)) {
  const src = fs.readFileSync(path.join(dir, theirs + '.svg'), 'utf8');
  const inner = src
    .replace(/^[\s\S]*?<svg[^>]*>/, '')
    .replace(/<\/svg>\s*$/, '')
    // Trait, extrémités et couleur viennent du CSS (svg { stroke: currentColor … }).
    .replace(/\s(stroke|stroke-linecap|stroke-linejoin|stroke-width)="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/> </g, '><')
    .trim();
  out[ours] = inner;
}

const file = path.join(__dirname, '..', 'engine', 'extension', 'lib', 'icons.js');
const code = fs.readFileSync(file, 'utf8');
const body = '  // <iconoir> Généré par scripts/make-iconoir.js : Iconoir (MIT), https://iconoir.com\n'
  + '  const ICONOIR = {\n'
  + Object.entries(out).map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
  + '\n  };\n  // </iconoir>';
const next = code.replace(/  \/\/ <iconoir>[\s\S]*?\/\/ <\/iconoir>/, body);
if (next === code && !code.includes(body)) throw new Error('Marqueurs <iconoir> absents de lib/icons.js');
fs.writeFileSync(file, next);
console.log(`${Object.keys(out).length} icônes Iconoir écrites dans ${file}`);
