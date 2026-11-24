# Composants tiers

PouleyPwolu est construit à partir de ces projets. Leurs licences doivent accompagner
toute version distribuée (le navigateur les affiche aussi dans `about:license`).

| Projet | Licence | Source |
| --- | --- | --- |
| Firefox (Gecko) | MPL-2.0, plus les licences de ses composants (`about:license`) | https://www.mozilla.org/firefox/ |
| Iconoir (icônes) | MIT | https://iconoir.com/ |
| Onest, JetBrains Mono (polices) | SIL Open Font License 1.1 | https://fonts.google.com/ |

Les fichiers de Firefox modifiés par PouleyPwolu restent sous MPL-2.0 ; leur code source
est publié dans ce dépôt (`engine/`, `scripts/prepare.py`).

« Firefox » et « Mozilla » sont des marques de la Mozilla Foundation. PouleyPwolu ne les
utilise pas comme nom de produit et n'est pas affilié à Mozilla.

La version Electron (0.1.x, dossier `src/`) embarquait Chromium (BSD-3-Clause, marques
de Google LLC) ; l'édition Chromium abandonnée est archivée dans la branche
`moteur-chromium`.
