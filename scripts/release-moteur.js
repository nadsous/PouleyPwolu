// Publie la version Chromium de PouleyPwolu (Windows, macOS, Linux) sur les releases GitHub.
//   node scripts/release-moteur.js <version> --windows <id> --macos <id> --linux <id> [--brouillon]
// <id> : numéro d'exécution des workflows moteur-windows, moteur-macos et moteur-linux
// (gh run list -w moteur-windows). Une plateforme absente est simplement omise.
//
// La release contient aussi, comme l'exige docs/migration-electron.md :
// - latest.yml et l'installateur de la dernière version Electron (0.1.12), repris de sa
//   release : les versions 0.1.11 et antérieures y passent d'abord ;
// - moteur.json : la 0.1.12 y lit l'installateur Windows à proposer et son empreinte.
// Il faut la commande « gh » connectée au compte propriétaire du dépôt.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { owner, repo } = pkg.build.publish[0];
const REPO = `${owner}/${repo}`;
const ELECTRON = pkg.version; // dernière version Electron (0.1.12)

const args = process.argv.slice(2);
const version = args[0];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('Usage : node scripts/release-moteur.js <version> --windows <id> --macos <id> --linux <id> [--brouillon]');
  process.exit(1);
}
const opt = (name) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : null; };
const draft = args.includes('--brouillon');
const gh = (...a) => execFileSync('gh', a, { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] }).toString();
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pouley-release-'));
const out = path.join(work, 'release');
fs.mkdirSync(out);
const files = [];

// Fichiers d'une exécution de workflow : artefacts téléchargés puis renommés.
function fromRun(runId, wanted) {
  const dir = path.join(work, 'run-' + runId);
  gh('run', 'download', String(runId), '--repo', REPO, '--dir', dir);
  const all = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else all.push(p); } };
  walk(dir);
  for (const [re, name] of wanted) {
    const f = all.find((p) => re.test(path.basename(p)));
    if (!f) throw new Error(`Exécution ${runId} : aucun fichier ${re}`);
    const to = path.join(out, name);
    fs.copyFileSync(f, to);
    files.push(to);
  }
}

let installer = null;
if (opt('windows')) {
  installer = `PouleyPwolu-${version}-windows-x64-installer.exe`;
  fromRun(opt('windows'), [
    [/installer.*\.exe$/i, installer],
    [/windows.*\.zip$|x64\.zip$/i, `PouleyPwolu-${version}-windows-x64.zip`],
  ]);
}
if (opt('macos')) {
  fromRun(opt('macos'), [
    [/arm64-macos\.dmg$/, `PouleyPwolu-${version}-macos-arm64.dmg`],
    [/x86_64-macos\.dmg$/, `PouleyPwolu-${version}-macos-intel.dmg`],
  ]);
}
if (opt('linux')) {
  fromRun(opt('linux'), [
    [/x86_64\.AppImage$/, `PouleyPwolu-${version}-linux-x86_64.AppImage`],
    [/arm64\.AppImage$/, `PouleyPwolu-${version}-linux-arm64.AppImage`],
    [/x86_64_linux\.tar\.xz$/, `PouleyPwolu-${version}-linux-x86_64.tar.xz`],
    [/arm64_linux\.tar\.xz$/, `PouleyPwolu-${version}-linux-arm64.tar.xz`],
  ]);
}

// Ce que la 0.1.12 lit pour proposer le passage (src/main/engine-switch.js).
if (installer) {
  const moteur = path.join(out, 'moteur.json');
  fs.writeFileSync(moteur, JSON.stringify({ format: 1, version, installer, sha256: sha256(path.join(out, installer)) }, null, 2) + '\n');
  files.push(moteur);
}

// Mise à jour des versions Electron : repris de la release v0.1.12.
const electronDir = path.join(work, 'electron');
gh('release', 'download', `v${ELECTRON}`, '--repo', REPO, '--dir', electronDir,
  '--pattern', 'latest.yml', '--pattern', `PouleyPwolu-Setup-${ELECTRON}.exe`, '--pattern', `PouleyPwolu-Setup-${ELECTRON}.exe.blockmap`);
for (const f of fs.readdirSync(electronDir)) files.push(path.join(electronDir, f));

const sums = files.filter((f) => !/latest\.yml$|blockmap$/.test(f)).map((f) => `${sha256(f)}  ${path.basename(f)}`).join('\n');
const notes = [
  `## PouleyPwolu ${version} : le nouveau moteur Chromium`,
  '',
  'PouleyPwolu passe sur un vrai Chromium (ungoogled-chromium) : toutes les extensions du Chrome Web Store, moins de mémoire, et des versions pour Windows, macOS et Linux.',
  '',
  '### Déjà sur PouleyPwolu ?',
  `La version ${ELECTRON} propose « Passer au nouveau moteur » : poulaillers, onglets, favoris, réglages et mots de passe suivent tout seuls.`,
  '',
  '### Installer',
  '- **Windows** : `…-windows-x64-installer.exe`. Pas encore signé : « Informations complémentaires » puis « Exécuter quand même ».',
  '- **macOS** : `…-macos-arm64.dmg` (Apple Silicon) ou `…-macos-intel.dmg`. Pas encore notarisé par Apple : après l’avoir glissé dans Applications, clic droit sur PouleyPwolu puis « Ouvrir » (ou `xattr -cr /Applications/PouleyPwolu.app`).',
  '- **Linux** : `…AppImage` (rendre exécutable puis lancer) ou l’archive `.tar.xz`.',
  '',
  '### Empreintes SHA-256',
  '```',
  sums,
  '```',
].join('\n');
const notesFile = path.join(work, 'notes.md');
fs.writeFileSync(notesFile, notes);

execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', REPO, '--title', `PouleyPwolu ${version}`,
  '--notes-file', notesFile, '--latest', ...(draft ? ['--draft'] : [])], { cwd: ROOT, stdio: 'inherit' });
console.log(`\n${draft ? 'Brouillon créé' : 'Publié'} : https://github.com/${REPO}/releases/tag/v${version}`);
