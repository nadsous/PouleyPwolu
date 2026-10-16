// Icônes de PouleyPwolu (SVG, trait 24 px, couleur héritée via currentColor).
// La poule et le renard sont des silhouettes pixel, comme le logo.
(function (root, factory) {
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleyIcons = api;
})(typeof self !== 'undefined' ? self : this, function (root) {
  const dot = (cx, cy) => `<circle cx="${cx}" cy="${cy}" r="1" fill="currentColor" stroke="none"/>`;

  const PATHS = {
    // ── Icônes de poulailler
    oeuf: '<path d="M12 3c3.6 0 6.5 5.6 6.5 10.2a6.5 6.5 0 0 1-13 0C5.5 8.6 8.4 3 12 3z"/><path d="M8.8 13.6a3.3 3.3 0 0 0 2.2 3"/>',
    maison: '<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.2V20h12V9.2"/><path d="M10 20v-5.5h4V20"/>',
    travail: '<rect x="3" y="7" width="18" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M3 12.5h18"/><path d="M11 12.5v1.5h2v-1.5"/>',
    jeu: '<rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7.5 10.5v4M5.5 12.5h4"/>' + dot(15.5, 11.5) + dot(17.8, 13.8),
    art: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.8 1.8-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.8-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.6 17 3 12 3z"/>' + dot(7.5, 11.5) + dot(9.5, 7.5) + dot(14.5, 7.2),
    livre: '<path d="M12 6.5C10.5 5 8 4.5 4 4.5v13c4 0 6.5.5 8 2 1.5-1.5 4-2 8-2v-13c-4 0-6.5.5-8 2z"/><path d="M12 6.5v13"/>',
    courses: '<path d="M3 4h2.2l2.2 10.6a1.6 1.6 0 0 0 1.6 1.3h8.4a1.6 1.6 0 0 0 1.5-1.1L20.6 8H6.2"/><circle cx="9.5" cy="19.6" r="1.3"/><circle cx="17" cy="19.6" r="1.3"/>',
    outils: '<path d="M14.5 4.2a4.8 4.8 0 0 0-4.4 6.6L4 16.9V20h3.1l6.1-6.1a4.8 4.8 0 0 0 6.6-4.4l-2.9 2.9-3.3-3.3 2.9-2.9z"/>',
    labo: '<path d="M9 3h6"/><path d="M10 3v6.2L4.6 18.4A1.7 1.7 0 0 0 6.1 21h11.8a1.7 1.7 0 0 0 1.5-2.6L14 9.2V3"/><path d="M7.3 15h9.4"/>',
    code: '<path d="M8 7.5 3.5 12 8 16.5M16 7.5l4.5 4.5-4.5 4.5M13.5 4.5l-3 15"/>',
    musique: '<path d="M9 18V5.5l11-2.2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>',
    coeur: '<path d="M12 20s-7.6-4.6-8.8-9.3C2.3 7.3 4.5 4.5 7.6 4.5c1.9 0 3.4 1 4.4 2.5 1-1.5 2.5-2.5 4.4-2.5 3.1 0 5.3 2.8 4.4 6.2C19.6 15.4 12 20 12 20z"/>',
    etoile: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.4 2.5 3.7 5.5 3.7 9s-1.3 6.5-3.7 9c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3z"/>',
    message: '<path d="M21 3 3 10.4l7.2 2.6L12.8 20z"/><path d="M21 3 10.2 13"/>',
    ecole: '<path d="M2.5 9.5 12 5l9.5 4.5L12 14z"/><path d="M6.5 11.6v4.6c1.6 1.3 3.5 1.9 5.5 1.9s3.9-.6 5.5-1.9v-4.6"/><path d="M21.5 9.5V15"/>',
    photo: '<path d="M4 8h3l1.6-2.5h6.8L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/>',
    finance: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3 10h18"/><path d="M15.5 14.5h2.5"/>',
    film: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 4v16M16.5 4v16M3 9h4.5M3 15h4.5M16.5 9H21M16.5 15H21"/>',
    sport: '<circle cx="12" cy="12" r="9"/><path d="M12 7.5l4.2 3-1.6 5H9.4l-1.6-5z"/><path d="M12 3v4.5M20.6 9.2l-4.4 1.3M17.3 19.3l-2.7-3.8M6.7 19.3l2.7-3.8M3.4 9.2l4.4 1.3"/>',

    // ── Icônes d'interface
    reglages: '<path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1"/><circle cx="15" cy="6.5" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="17.5" r="2"/>',
    inspecter: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.4-4.4"/>',
    ia: '<path d="M12 3l1.9 4.9 4.9 1.9-4.9 1.9L12 16.6l-1.9-4.9-4.9-1.9 4.9-1.9z"/><path d="M18.5 15l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>',
    resume: '<path d="M4.5 5h15v11H9l-4.5 3.5z"/><path d="M8.5 9h7M8.5 12.2h4.5"/>',
    fantome: '<path d="M5.5 20.5V11a6.5 6.5 0 0 1 13 0v9.5l-2.2-1.6-2.1 1.6-2.2-1.6-2.2 1.6-2.1-1.6z"/>' + dot(9.8, 11) + dot(14.2, 11),
    retour: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    epingle: '<path d="M9 3.5h6l-1 5.5 3.5 3.5h-11L10 9z"/><path d="M12 12.5v8"/>',
    lien: '<path d="M10 14a4.2 4.2 0 0 0 6 0l3-3a4.2 4.2 0 0 0-6-6l-1 1"/><path d="M14 10a4.2 4.2 0 0 0-6 0l-3 3a4.2 4.2 0 0 0 6 6l1-1"/>',
    archive: '<rect x="3" y="4" width="18" height="5" rx="1.2"/><path d="M5 9v10.5h14V9M10 13h4"/>',
    'barre-gauche': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16"/>',
    'barre-droite': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M15 4v16"/>',
    'barre-haut': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9.5h18"/>',
    'barre-masquer': '<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M9 4v16" stroke-dasharray="2 2.5"/><path d="M14 10l2 2-2 2"/>',
    bouclier: '<path d="M12 3l7.5 3v6c0 4.6-3.1 7.8-7.5 9.3-4.4-1.5-7.5-4.7-7.5-9.3V6z"/><path d="M9 12l2.2 2.2L15.5 10"/>',
    'bouclier-off': '<path d="M12 3l7.5 3v6c0 4.6-3.1 7.8-7.5 9.3-4.4-1.5-7.5-4.7-7.5-9.3V6z"/><path d="M4 4l16 16"/>',
    theme: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/>',
    effacer: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13.5h10L18 7M9 7V4h6v3"/>',
    comet: '<circle cx="16" cy="8" r="3.2"/><path d="M13.6 10.4 4 20M10.8 8.6 5 14.4M15.4 13.2 9.6 19"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    veille: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" fill="currentColor" stroke="none"/>',
    extension: '<path d="M9 4.5a2 2 0 1 1 4 0V6h3.5A1.5 1.5 0 0 1 18 7.5V11h1.5a2 2 0 1 1 0 4H18v3.5a1.5 1.5 0 0 1-1.5 1.5H13v-1.5a2 2 0 1 0-4 0V20H5.5A1.5 1.5 0 0 1 4 18.5V15h1.5a2 2 0 1 0 0-4H4V7.5A1.5 1.5 0 0 1 5.5 6H9z"/>',
    capture: '<path d="M4 8.5V6a2 2 0 0 1 2-2h2.5M15.5 4H18a2 2 0 0 1 2 2v2.5M20 15.5V18a2 2 0 0 1-2 2h-2.5M8.5 20H6a2 2 0 0 1-2-2v-2.5"/><circle cx="12" cy="12" r="3.2"/>',
    superposition: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><rect x="11.5" y="11" width="7" height="6" rx="1.3" fill="currentColor" stroke="none"/>',
    depot: '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 7.5v9M18 10c0 4.5-6 3.5-11 7"/>',
    cote: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15"/><path d="M6.5 9h2.5M6.5 12h2.5M15 9h2.5M15 12h2.5"/>',
    ramener: '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M16 9l-6 6M10 10.5V15h4.5"/>',
    fermer: '<path d="M7 7l10 10M17 7L7 17"/>',
    selection: '<path d="M4 7V5a1 1 0 0 1 1-1h2M11 4h2M17 4h2a1 1 0 0 1 1 1v2M20 11v2M4 11v2M4 17v2a1 1 0 0 0 1 1h2M11 20h2"/><path d="M14 14l6 2.5-2.5 1-1 2.5z"/>',
    page: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 15.5h6"/>',
    opacite: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M12 7.5h4.7M12 11.5h6.5M12 15.5h5"/>',
    profil: '<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6"/>',
    cle: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
    cadenas: '<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><path d="M12 14.5v2.5"/>',
    oeil: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
    copier: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    des: '<rect x="4" y="4" width="16" height="16" rx="3.5"/>' + dot(8.5, 8.5) + dot(15.5, 8.5) + dot(12, 12) + dot(8.5, 15.5) + dot(15.5, 15.5),
  };

  // Silhouettes pixel (poule, renard) tirées des sprites, en currentColor.
  function pixelIcon(rows, holes) {
    const h = rows.length;
    const w = rows[0].length;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    let rects = '';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = rows[y][x];
        if (c === '.' || holes.includes(c)) continue;
        let run = 1;
        while (x + run < w && rows[y][x + run] !== '.' && !holes.includes(rows[y][x + run])) run++;
        rects += `<rect x="${x}" y="${y}" width="${run}" height="1"/>`;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x + run);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y + 1);
        x += run - 1;
      }
    }
    const size = Math.max(maxX - minX, maxY - minY) + 2;
    const ox = minX - (size - (maxX - minX)) / 2;
    const oy = minY - (size - (maxY - minY)) / 2;
    return { viewBox: `${ox} ${oy} ${size} ${size}`, body: `<g fill="currentColor" stroke="none" shape-rendering="crispEdges">${rects}</g>` };
  }

  const PIXEL = {};
  const sprites = root && root.PouleySprites;
  if (sprites) {
    PIXEL.poule = pixelIcon(sprites.POULE, ['K']);
    PIXEL.renard = pixelIcon(sprites.RENARD[0], ['K', 'W']);
  }

  // Icônes proposées pour un poulailler, dans l'ordre d'affichage.
  const POULAILLER_ICONS = [
    'poule', 'oeuf', 'maison', 'travail', 'jeu', 'art', 'livre', 'courses', 'outils',
    'labo', 'code', 'musique', 'coeur', 'etoile', 'globe', 'message', 'ecole', 'photo',
    'finance', 'film', 'sport',
  ];

  // Anciens poulaillers enregistrés avec un emoji.
  const FROM_EMOJI = {
    '🐔': 'poule', '🥚': 'oeuf', '🐣': 'poule', '🌽': 'etoile', '🏡': 'maison', '💼': 'travail',
    '🎮': 'jeu', '🎨': 'art', '📚': 'livre', '🛒': 'courses', '🔧': 'outils', '🧪': 'labo',
  };

  function normalize(id) {
    if (id && (PATHS[id] || PIXEL[id])) return id;
    return FROM_EMOJI[id] || 'poule';
  }

  function svg(id, cls) {
    const key = PIXEL[id] || PATHS[id] ? id : normalize(id);
    const klass = `ic${cls ? ' ' + cls : ''}`;
    if (PIXEL[key]) return `<svg class="${klass} ic-px" viewBox="${PIXEL[key].viewBox}" aria-hidden="true">${PIXEL[key].body}</svg>`;
    return `<svg class="${klass}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[key]}</svg>`;
  }

  return { svg, normalize, POULAILLER_ICONS, FROM_EMOJI };
});
