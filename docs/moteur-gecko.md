# PouleyPwolu — moteur Gecko (Firefox)

Depuis le 23 novembre 2026, PouleyPwolu est construit sur le moteur de Firefox (Gecko,
licence MPL-2.0), version Release (une nouvelle version toutes les 4 semaines). L'édition
Chromium est archivée dans la branche `moteur-chromium`.

Ce dépôt ne contient pas Firefox : il fige la version utilisée et garde ce que
PouleyPwolu y ajoute.

## Organisation

| Chemin | Rôle |
| --- | --- |
| `engine/mozconfig` | Réglages de compilation (nom, marque, sans télémétrie ni rapport de plantage) |
| `engine/prefs/pouleypwolu.js` | Réglages par défaut (vie privée, interface, Mica) |
| `engine/extension/` | Extension intégrée : barre, poulaillers, bouclier, inspecteur, stylo… |
| `engine/extension/core/gecko.js` | Recrée pour Firefox les API de Chromium dont l'extension se sert |
| `engine/extension/experiments/` | API privée `pouleyPrivate` (droits du navigateur) |
| `engine/installateur/` | Fenêtre d'installation PouleyPwolu |
| `scripts/make-iconoir.js` | Copie les icônes Iconoir (MIT) dans `lib/icons.js` |

La compilation se fait hors du dépôt, dans `C:\pwff` (sources de Firefox 160.0.1 dans
`C:\pwff\src`, ou le dossier de la variable `POULEY_WORK`). Il faut environ 40 Go libres.

## Préparer la machine (une fois)

1. Installer [MozillaBuild](https://ftp.mozilla.org/pub/mozilla/libraries/win32/MozillaBuildSetup-Latest.exe)
   dans `C:\mozilla-build`, et Python 3 avec Pillow (`pip install pillow`).
2. Installer les outils de compilation de Mozilla (clang, Rust…, dans `~\.mozbuild`) :
   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Etape bootstrap
   ```
   Le premier passage calcule longuement la liste des outils : laisser faire.

`mach` est lancé depuis Windows par `scripts\mach.cmd`, pas depuis le shell de
MozillaBuild, qui entre en conflit avec Git Bash.

## Compiler

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Etape build     # ~1 h la première fois
powershell -ExecutionPolicy Bypass -File scripts\build.ps1 -Etape package   # zip + installateur du moteur
powershell -ExecutionPolicy Bypass -File scripts\package.ps1                # installateur PouleyPwolu
```

`build.ps1` relance toujours `scripts\prepare.py` : il télécharge les sources si besoin
(empreinte SHA-256 vérifiée), crée la marque, copie l'extension intégrée et `mozconfig`.
L'installateur et le zip arrivent dans `release\moteur`. Première compilation sur la
machine de Nads (22 cœurs) : 65 min.

### Essayer une modification de l'extension (sans recompiler Firefox)

```powershell
powershell -ExecutionPolicy Bypass -File scripts\essai.ps1 -Extension   # profil d'essai neuf
powershell -ExecutionPolicy Bypass -File scripts\capture.ps1            # capture de la fenêtre
```

`essai.ps1 -Extension` recopie `engine\extension` dans `dist\bin` puis lance le navigateur ;
la console (erreurs JavaScript) est dans `C:\pwff\essai-console.txt` et `essai-erreurs.txt`.
Ne pas utiliser `mach build faster` : sous Windows il remplace les fichiers par des liens
symboliques que Firefox ne lit pas (l'arrière-plan de l'extension ne démarre plus).

À savoir :
- Firefox ne donne les API privées (`experiment_apis`) qu'à l'espace `browser.*` :
  `core/gecko.js` les recopie sous `chrome.pouleyPrivate`.
- Windows enregistre le navigateur sous `Firefox-<empreinte>` (nom affiché : PouleyPwolu) ;
  ses liens s'appellent `FirefoxURL-<empreinte>`. L'installateur retrouve la bonne clé par
  le chemin de `pouleypwolu.exe`.

## Compiler gratuitement sur GitHub

Onglet **Actions** → **moteur-windows** → **Run workflow**, ou pousser un tag
`moteur-<version>`. L'installateur et le zip arrivent dans l'artefact
`pouleypwolu-windows`. Pour publier : `node scripts/release-moteur.js <version> --windows <n° d'exécution>`.

## Mettre à jour Firefox

Changer `firefox`, `url` et `sha256` dans `engine/source.lock.json` (empreintes :
`https://archive.mozilla.org/pub/firefox/releases/<version>/SHA256SUMS`), puis recompiler.

## Feuille de route

1. **Première version qui tourne** (fait le 23/11/2026) : marque PouleyPwolu (nom, icônes), scripts de
   préparation et de compilation, extension intégrée chargée, barre à gauche ou à droite.
2. **Installateur et mises à jour** (installateur fait ; publication à faire) : installateur Windows, publication sur les releases
   GitHub, passage proposé aux utilisateurs de la version Electron (0.1.11).
3. **Compilation gratuite sur GitHub** (workflow Windows).
4. **Parité avec l'édition Chromium** : barre en haut, aperçu des favoris, contrôles de la
   musique de Windows, import des données de la version Electron, installation des
   extensions depuis addons.mozilla.org dans la barre.
5. **Fenêtre Tor** (comme la « fenêtre privée avec Tor » de Brave) — faite et vérifiée (check.torproject.org) : page
   `pages/tor.html`, API `openTorWindow` / `torStatus` / `stopTor` dans
   `experiments/parent.js`, `tor.exe` ajouté par `scripts/prepare.py` (version et empreinte
   dans `engine/source.lock.json`). Tant qu'une fenêtre Tor est ouverte, **toutes** les
   fenêtres privées passent par Tor. Ponts (pays qui bloquent Tor) : plus tard.
   - `tor.exe` du Tor Project (BSD-3) fourni avec PouleyPwolu, lancé seulement à
     l'ouverture d'une fenêtre Tor (barre de connexion), arrêté à sa fermeture ;
   - seul le trafic de cette fenêtre passe par Tor (proxy SOCKS, DNS compris : les sites
     `.onion` fonctionnent), le reste de la navigation garde sa vitesse ;
   - dans cette fenêtre : protection contre l'empreinte (`resistFingerprinting` des
     fenêtres privées), WebRTC coupé, rien de gardé à la fermeture ;
   - raccourci (Ctrl+Maj+N) et bouton dans la barre ;
   - avertissement clair : moins anonyme que le Tor Browser ;
   - `tor.exe` mis à jour automatiquement à chaque version de PouleyPwolu.
6. **Mémoire** : mesurer avec `bench\ram.ps1` contre Chrome, Edge, Brave et Firefox.
7. **macOS et Linux.**

## Licences

Firefox est sous licence MPL-2.0 : les fichiers de Firefox modifiés restent sous MPL-2.0,
le reste de PouleyPwolu garde sa licence. Iconoir est sous licence MIT, Tor sous BSD-3.
« Firefox » et « Mozilla » sont des marques de la Mozilla Foundation : PouleyPwolu ne les
utilise pas comme nom de produit et n'est pas affilié à Mozilla.
Le nom et le logo PouleyPwolu appartiennent à Nadir Tounsi (Nads).
