# PouleyPwolu — moteur Chromium

Le nouveau PouleyPwolu, construit sur un vrai Chromium au lieu d'Electron : toutes les
extensions du Chrome Web Store, et l'objectif de consommer moins de mémoire que Chrome,
Edge et Brave, mesuré et non promis.

Le socle est [ungoogled-chromium](https://github.com/ungoogled-software/ungoogled-chromium)
(licence BSD-3) : Chromium sans les services Google. Ce dépôt ne contient pas Chromium ;
il fige la version utilisée et garde ce que PouleyPwolu y ajoute.

## Organisation

| Chemin | Rôle |
| --- | --- |
| `engine/source.lock.json` | Version figée d'ungoogled-chromium-windows et de son sous-module |
| `engine/patches/` | Patches PouleyPwolu sur Chromium, appliqués dans l'ordre de `series` |
| `engine/flags.gn` | Réglages de compilation ajoutés à ceux d'ungoogled-chromium |
| `scripts/check-env.ps1` | Vérifie la machine sans rien installer |
| `scripts/prepare.ps1` | Récupère ungoogled-chromium-windows et y injecte nos patches |
| `scripts/build.ps1` | Compile, puis crée l'installateur et le zip |
| `bench/ram.ps1` | Compare la mémoire de plusieurs navigateurs sur les mêmes onglets |

La compilation se fait hors du dépôt, dans `C:\pw` par défaut (`-Work` ou la variable
`POULEY_WORK` pour changer). Il faut environ 110 Go libres sur ce disque.

## Préparer la machine (une fois)

1. Vérifier ce qui manque : `powershell -File scripts\check-env.ps1`
2. Installer ce qu'il signale. Pour Visual Studio 2026, avec le développement Desktop C++
   et MFC/ATL :
   ```powershell
   winget install Microsoft.VisualStudio.Community --override "--add Microsoft.VisualStudio.Workload.NativeDesktop --add Microsoft.VisualStudio.Component.VC.ATLMFC --includeRecommended --passive"
   ```
   puis, dans Visual Studio Installer, le **Windows 11 SDK 10.0.28000** et ses
   **Debugging Tools for Windows**.
3. Relancer `check-env.ps1` jusqu'à « Tout est prêt pour compiler ».

## Compiler

Dans un PowerShell **administrateur** :

```powershell
powershell -ExecutionPolicy Bypass -File scripts\build.ps1
```

La première fois, comptez plusieurs heures. Ensuite, seul ce qui a changé est recompilé.
Après un changement de patch, de réglage ou de version, le script demande `-Clean`.
Le navigateur compilé est dans `C:\pw\ucw\build\src\out\Default\chrome.exe`,
l'installateur et le zip dans `C:\pw\ucw\build`.

## Compiler sur Azure (versions publiées)

Une machine Spot de 64 vCPU compile en ~2 h 30 pour ~1 €/h, au lieu d'une nuit sur un
portable. Il faut un abonnement Azure « Paiement à l'utilisation » (l'essai gratuit n'accepte
pas les machines Spot) et `az login`.

```powershell
powershell -ExecutionPolicy Bypass -File cloud\azure\setup.ps1   # une fois : budget, quota, machine, outils
powershell -ExecutionPolicy Bypass -File cloud\azure\build.ps1   # à chaque version
```

`setup.ps1` crée une alerte mail à 80 % de 30 €/mois, demande le quota Spot, crée le stockage
et la machine, y installe Visual Studio et le reste, puis l'éteint. `build.ps1` envoie le dernier
commit, allume la machine, compile sur son disque local rapide, rapatrie l'installateur et le zip
dans `release\`, puis éteint la machine, y compris en cas d'erreur. Si Azure reprend la machine
Spot en cours de route, la compilation est relancée. Machine éteinte, il ne reste à payer que
son disque de 128 Go et son adresse IP, quelques euros par mois.

## Mesurer la mémoire

```powershell
powershell -ExecutionPolicy Bypass -File bench\ram.ps1 -Browser chrome,edge,brave,comet,pouley
```

Chaque navigateur part d'un profil vierge avec les 20 pages de `bench\sites.txt`. Le
script relève trois fois la mémoire privée de tous ses processus et garde la médiane.
Toute optimisation mémoire doit être justifiée par ce banc, avant et après.

## Feuille de route

1. Compiler ungoogled-chromium tel quel avec ces scripts (mesure de référence).
2. Nom, icône et page Nouvel onglet PouleyPwolu.
3. Mémoire : onglets gelés puis déchargés plus tôt, services inutiles retirés.
4. Bouclier anti-traqueurs dans le moteur (adblock-rust de Brave, MPL-2.0).
5. API privée `chrome.pouley.*` et une extension intégrée unique pour les fonctions
   PouleyPwolu (détecteur de technos, coffre, poulaillers), sur le modèle de Comet.
6. macOS et Linux, avec ungoogled-chromium-macos et ungoogled-chromium-portablelinux.

## Licences

Chromium et ungoogled-chromium sont sous licence BSD-3 : voir [NOTICE.md](NOTICE.md).
Le nom et le logo PouleyPwolu appartiennent à Nadir Tounsi (Nads).
