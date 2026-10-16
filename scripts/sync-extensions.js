// Copie les extensions Chrome préinstallées depuis leurs projets sources.
// NadsPDF : ../nadspdf/dist/chrome-extension (construite par packaging/chrome/build.ps1).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCES = {
  nadspdf: path.join(ROOT, '..', 'nadspdf', 'dist', 'chrome-extension'),
};

for (const [name, src] of Object.entries(SOURCES)) {
  const dest = path.join(ROOT, 'extensions', name);
  if (!fs.existsSync(path.join(src, 'manifest.json'))) {
    console.warn(`${name} : source introuvable (${src}), copie existante conservée.`);
    continue;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  const v = JSON.parse(fs.readFileSync(path.join(dest, 'manifest.json'), 'utf8')).version;
  console.log(`${name} ${v} copiée dans extensions/${name}`);
}
