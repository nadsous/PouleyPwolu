// Sprites pixel-art de PouleyPwolu, partagés par l'icône, l'interface,
// l'histoire d'installation et le jeu hors ligne.
// Chaque caractère est un pixel ; '.' = transparent.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleySprites = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const PALETTE = {
    Y: '#FFE100', // jaune poule
    y: '#FFF27A', // reflet
    B: '#1565D8', // contour bleu
    b: '#0B3F8F', // ombre bleue
    K: '#0E0E10', // œil / noir
    W: '#FFFFFF',
    O: '#F28A1E', // renard
    o: '#B85A0E', // renard ombre
    R: '#EF3E36', // crête / rouge Nads
    G: '#3BB273', // herbe
    g: '#23864F',
    E: '#F4E9D2', // œuf
    e: '#D9C7A3',
    M: '#E8B33C', // maïs
  };

  // La poule du logo, de profil, tournée vers la gauche (24 x 24).
  const POULE = [
    '....B.BB.B..............',
    '...BYBYYBYB.............',
    '....BYYyYYYB............',
    '....BYYYYYYYB......Y..Y.',
    '...BBYYKYYYYB.....BYBBYB',
    '..BYYBYYYYYYB....BYYBYYB',
    '..BBBBYYYYYYB...BYYBYYB.',
    '....BYYYYYYYB..BYYBYYYB.',
    '....BYYYYYYYYBBYYBYYYB..',
    '...BYYYYYYYYYYYYYYYYYB..',
    '..BYYYYYYYYYYYYYYYYYYB..',
    '..BYYYYYYBBYYYYYBBYYYB..',
    '..BYYYYYYYBBBBBBYYYYB...',
    '..BYYYYYYYYYYYYYYYYYB...',
    '..BYYYYYYYYYYYYYYYYB....',
    '...BYYYYYYYYYYYYYYB.....',
    '....BBYYYYYYYYYYBB......',
    '......BBBYYYYBBB........',
    '........BY..BY..........',
    '........BY..BY..........',
    '.......YYY.YYY..........',
    '......YY.Y.Y.YY.........',
    '........................',
    '........................',
  ];

  // Petite poule de course pour le jeu (16 x 16), deux images d'animation.
  const POULE_RUN = [
    [
      '................',
      '....BBB.........',
      '...BYYYB........',
      '..BYKYYB....YY..',
      '.BBYYYYB...BYYB.',
      'B.BYYYYBB.BYYB..',
      '..BYYYYYYBYYYB..',
      '..BYYYYYYYYYYB..',
      '..BYYYBBBYYYB...',
      '..BYYYYYYYYYB...',
      '...BYYYYYYYB....',
      '....BBYYYBB.....',
      '.....BY.BY......',
      '.....BY..YY.....',
      '....YY....Y.....',
      '................',
    ],
    [
      '................',
      '....BBB.........',
      '...BYYYB........',
      '..BYKYYB....YY..',
      '.BBYYYYB...BYYB.',
      'B.BYYYYBB.BYYB..',
      '..BYYYYYYBYYYB..',
      '..BYYYYYYYYYYB..',
      '..BYYBBBYYYYB...',
      '..BYYYYYYYYYB...',
      '...BYYYYYYYB....',
      '....BBYYYBB.....',
      '......BYBY......',
      '.....YY.BY......',
      '.........YY.....',
      '................',
    ],
  ];

  // Le renard (16 x 16), tourné vers la gauche.
  const RENARD = [
    [
      '................',
      '..o.o...........',
      '.oOoO...........',
      '.OOOOO..........',
      'KOKOOOo.........',
      'OOOOOOOOOOO..oo.',
      '.WWOOOOOOOOOoOOo',
      '..WOOOOOOOOOOOWo',
      '...OOOOOOOOOOWW.',
      '...OOOOOOOOOO...',
      '...Oo.....oO....',
      '...KK.....KK....',
      '................',
      '................',
      '................',
      '................',
    ],
    [
      '................',
      '..o.o...........',
      '.oOoO...........',
      '.OOOOO..........',
      'KOKOOOo.........',
      'OOOOOOOOOOO.....',
      '.WWOOOOOOOOOo.oo',
      '..WOOOOOOOOOOOOo',
      '...OOOOOOOOOOOWW',
      '...OOOOOOOOOO...',
      '....Oo...oO.....',
      '....KK...KK.....',
      '................',
      '................',
      '................',
      '................',
    ],
  ];

  const OEUF = [
    '...EEEE...',
    '..EEEEEE..',
    '.EEEEEEEE.',
    '.EEEEEEEE.',
    'EEEEEEEEEe',
    'EEEEEEEEEe',
    'EEEEEEEEee',
    '.EEEEEEee.',
    '..eEEEee..',
    '...eeee...',
  ];

  const MAIS = [
    '..g...',
    '.gMg..',
    '.MMMg.',
    '.MMMM.',
    '.MMMM.',
    '..MM..',
  ];

  function toSvg(rows, opts = {}) {
    const scale = opts.scale || 1;
    const h = rows.length;
    const w = rows[0].length;
    let rects = '';
    for (let y = 0; y < h; y++) {
      const row = rows[y];
      for (let x = 0; x < w; x++) {
        const c = row[x];
        if (c === '.' || !PALETTE[c]) continue;
        let run = 1;
        while (x + run < w && row[x + run] === c) run++;
        rects += `<rect x="${x}" y="${y}" width="${run}" height="1" fill="${PALETTE[c]}"/>`;
        x += run - 1;
      }
    }
    const pad = opts.pad || 0;
    const vb = `${-pad} ${-pad} ${w + pad * 2} ${h + pad * 2}`;
    const bg = opts.background
      ? `<rect x="${-pad}" y="${-pad}" width="${w + pad * 2}" height="${h + pad * 2}" rx="${(w + pad * 2) * 0.22}" fill="${opts.background}"/>`
      : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" class="px" viewBox="${vb}" width="${(w + pad * 2) * scale}" height="${(h + pad * 2) * scale}" shape-rendering="crispEdges">${bg}${rects}</svg>`;
  }

  function drawToCanvas(ctx, rows, x, y, scale, flip) {
    const w = rows[0].length;
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < w; c++) {
        const ch = row[c];
        if (ch === '.' || !PALETTE[ch]) continue;
        ctx.fillStyle = PALETTE[ch];
        const cx = flip ? x + (w - 1 - c) * scale : x + c * scale;
        ctx.fillRect(Math.round(cx), Math.round(y + r * scale), scale, scale);
      }
    }
  }

  return { PALETTE, POULE, POULE_RUN, RENARD, OEUF, MAIS, toSvg, drawToCanvas };
});
