// Met à jour Chromium = met à jour Electron (chaque version d'Electron embarque
// une version précise de Chromium, avec ses correctifs de sécurité).
//   npm run update-chromium            → dernière version de la même version majeure (sûr)
//   npm run update-chromium -- --major → dernière version majeure (à tester davantage)
const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const run = (cmd) => execSync(cmd, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString().trim();
const current = require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
const major = process.argv.includes('--major');
const target = major ? run('npm view electron@latest version') : JSON.parse(run(`npm view electron@^${current.split('.')[0]} version --json`)).slice(-1)[0];

async function chromiumOf(version) {
  try {
    const res = await fetch('https://releases.electronjs.org/releases.json');
    const list = await res.json();
    const r = list.find((x) => x.version === version);
    return r ? `Chromium ${r.chrome} (sortie le ${r.date})` : 'Chromium inconnu';
  } catch {
    return 'Chromium : vérification impossible (hors ligne ?)';
  }
}

(async () => {
  console.log(`Electron installé : ${current} — ${await chromiumOf(current)}`);
  if (target === current) {
    console.log('Déjà à jour, rien à faire.');
    return;
  }
  console.log(`Mise à jour vers Electron ${target} — ${await chromiumOf(target)}…`);
  execSync(`npm install electron@${target} --save-dev --no-audit --no-fund`, { cwd: ROOT, stdio: 'inherit' });
  console.log(`\nFait. Teste avec « npm start », puis publie avec « npm run release ».`);
  if (major) console.log('Changement de version majeure : vérifie les notes de version d’Electron avant de publier.');
})();
