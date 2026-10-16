// Extrait de Simple Icons (CC0) les logos des technos détectées et les écrit
// dans src/shared/tech-icons.js. Le navigateur n'embarque que ce sous-ensemble.
const fs = require('fs');
const path = require('path');
const si = require('simple-icons');
const { TECH_NAMES } = require('../src/main/techdetect');

const LANGUAGES = ['HTML', 'CSS', 'JavaScript', 'TypeScript', 'PHP', 'Python', 'Ruby', 'C#', 'Java', 'Go'];

// Noms dont le logo porte un autre titre dans Simple Icons.
const ALIASES = {
  SvelteKit: 'svelte', AngularJS: 'angular', Lottie: 'lottiefiles', 'ASP.NET': 'dotnet', 'C#': 'dotnet',
  Java: 'openjdk', OVHcloud: 'ovh', Plausible: 'plausibleanalytics', 'Meta Pixel': 'meta',
  'TikTok Pixel': 'tiktok', HTML: 'html5', 'Yoast SEO': 'yoast', 'Cloudflare Turnstile': 'cloudflare',
};

const bySlug = new Map();
const byTitle = new Map();
for (const icon of Object.values(si)) {
  bySlug.set(icon.slug, icon);
  byTitle.set(icon.title.toLowerCase(), icon);
}

const out = {};
const missing = [];
for (const name of [...new Set([...TECH_NAMES, ...LANGUAGES])]) {
  const icon = ALIASES[name] ? bySlug.get(ALIASES[name]) : byTitle.get(name.toLowerCase());
  if (icon) out[name] = { hex: '#' + icon.hex, path: icon.path };
  else missing.push(name);
}

const file = `// Généré par scripts/make-tech-icons.js — ne pas modifier à la main.
// Logos : Simple Icons (https://simpleicons.org), licence CC0 1.0. Les marques
// restent la propriété de leurs détenteurs.
(function (root, data) {
  if (typeof module === 'object' && module.exports) module.exports = data;
  else root.PouleyTechIcons = data;
})(typeof self !== 'undefined' ? self : this, ${JSON.stringify(out)});
`;
fs.writeFileSync(path.join(__dirname, '..', 'src', 'shared', 'tech-icons.js'), file);
console.log(`${Object.keys(out).length} logos écrits, sans logo : ${missing.join(', ')}`);
