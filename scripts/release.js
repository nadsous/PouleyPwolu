// Publie une nouvelle version pour tous les utilisateurs, sur les releases GitHub :
//   npm run release            → version corrective (0.1.0 → 0.1.1)
//   npm run release -- minor   → nouvelle fonctionnalité (0.1.1 → 0.2.0)
//   npm run release -- --sans-version   → republier la version actuelle
// Construit l'installateur puis crée la release vX.Y.Z sur GitHub avec les
// 3 fichiers lus par la mise à jour automatique. Il faut la commande « gh »
// connectée au compte propriétaire du dépôt (gh auth login).
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const level = ['patch', 'minor', 'major'].find((l) => args.includes(l)) || 'patch';
const env = { ...process.env, ELECTRON_RUN_AS_NODE: '' };
const sh = (cmd) => execSync(cmd, { cwd: ROOT, stdio: 'inherit', env });

if (!args.includes('--sans-version')) sh(`npm version ${level} --no-git-tag-version`);
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const { version } = pkg;
const { owner, repo } = pkg.build.publish[0];
sh('npm run dist');

const exe = `PouleyPwolu-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'].map((f) => path.join(ROOT, 'release', f));
const sha = crypto.createHash('sha256').update(fs.readFileSync(files[0])).digest('hex');
const notes = [
  `## PouleyPwolu ${version}`,
  '',
  `Moteur : Electron ${require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version} (version de Chromium dans Paramètres → À propos).`,
  '',
  '### Installer',
  `Télécharge **${exe}** ci-dessous. L'installateur n'est pas encore signé : Windows affiche « Windows a protégé votre ordinateur ». Clique sur **Informations complémentaires**, puis **Exécuter quand même**.`,
  '',
  'Si PouleyPwolu est déjà installé, la mise à jour arrive toute seule.',
  '',
  '### Empreinte SHA-256 de l’installateur',
  '```',
  sha,
  '```',
].join('\n');
const notesFile = path.join(ROOT, 'release', 'notes.md');
fs.writeFileSync(notesFile, notes);

execFileSync('gh', ['release', 'create', `v${version}`, ...files, '--repo', `${owner}/${repo}`, '--title', `PouleyPwolu ${version}`, '--notes-file', notesFile], { cwd: ROOT, stdio: 'inherit' });
console.log(`\nVersion ${version} publiée : https://github.com/${owner}/${repo}/releases/tag/v${version}`);
console.log('Les utilisateurs la recevront automatiquement (vérification au lancement puis toutes les 6 h).');
console.log('SHA-256 de l’installateur : ' + sha);
