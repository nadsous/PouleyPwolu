// Génère src/shared/brand-logos.js : logos des assistants IA (LobeHub Icons, MIT)
// et des moteurs de recherche (Simple Icons, CC0), embarqués hors ligne.
const fs = require('fs');
const path = require('path');
const si = require('simple-icons');

const LOBE = path.dirname(require.resolve('@lobehub/icons-static-svg/package.json'));

// Contenu d'un SVG LobeHub, sans balise <svg> ni <title>.
function lobe(name) {
  const svg = fs.readFileSync(path.join(LOBE, 'icons', name + '.svg'), 'utf8');
  const inner = svg.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/<title>[\s\S]*?<\/title>/, '');
  return inner.trim();
}

function simple(slug) {
  const icon = Object.values(si).find((i) => i.slug === slug);
  if (!icon) throw new Error('logo absent : ' + slug);
  return { body: `<path d="${icon.path}"/>`, color: '#' + icon.hex };
}

const out = {
  // mono : le logo prend la couleur du texte (s'adapte au thème clair/sombre)
  claude: { body: lobe('claude-color'), color: '#D97757' },
  chatgpt: { body: lobe('openai'), color: '#10A37F', mono: true },
  comet: { body: lobe('perplexity-color'), color: '#22B8CD' },
  duckduckgo: simple('duckduckgo'),
  brave: simple('brave'),
  startpage: simple('startpage'),
  google: simple('google'),
  // mots-clés de recherche (gh, gl, npm, mdn, so, yt, w)
  github: { ...simple('github'), mono: true },
  gitlab: simple('gitlab'),
  npm: simple('npm'),
  mdn: { ...simple('mdnwebdocs'), mono: true },
  stackoverflow: simple('stackoverflow'),
  youtube: simple('youtube'),
  wikipedia: { ...simple('wikipedia'), mono: true },
};

const file = `// Généré par scripts/make-brand-logos.js — ne pas modifier à la main.
// Logos IA : LobeHub Icons (MIT, https://github.com/lobehub/lobe-icons).
// Logos des moteurs : Simple Icons (CC0). Les marques appartiennent à leurs détenteurs.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleyBrands = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const LOGOS = ${JSON.stringify(out)};
  function svg(key, cls) {
    const l = LOGOS[key];
    if (!l) return '';
    const fill = l.mono ? 'currentColor' : l.color;
    // Couleur posée sur un <g> : le style global des icônes à trait (svg { fill: none })
    // ne s'applique qu'à la balise <svg> et ne l'écrase donc pas.
    return '<svg class="brand' + (cls ? ' ' + cls : '') + '" viewBox="0 0 24 24" aria-hidden="true"><g fill="' + fill + '" stroke="none" fill-rule="evenodd">' + l.body + '</g></svg>';
  }
  return { LOGOS, svg };
});
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'shared', 'brand-logos.js'), file);
console.log('Logos écrits :', Object.keys(out).join(', '));
