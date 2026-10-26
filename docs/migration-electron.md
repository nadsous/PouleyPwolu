# Passage de PouleyPwolu Electron au moteur Chromium

## Les étapes

1. **0.1.12**, dernière version Electron, arrive par la mise à jour habituelle. Elle ne change
   rien tant qu'aucune version Chromium n'est publiée.
2. Une version Chromium est publiée : la 0.1.12 la voit (fichier `moteur.json` dans la
   dernière version GitHub) et propose « Passer au nouveau moteur ».
3. Si un coffre existe, la personne l'ouvre une fois (Windows Hello ou mot de passe maître).
4. La 0.1.12 écrit le dossier de migration, télécharge l'installateur Chromium, vérifie son
   empreinte, le lance avec `/S --migration=<dossier>` et se ferme.
5. L'installateur de Chromium (mini_installer, sans questions) installe la nouvelle version et
   la lance. Les arguments `/S --migration=…` lui sont indifférents.
6. Au premier démarrage, Chromium :
   - importe les mots de passe, puis efface `mots-de-passe.bin`
     (`chrome/browser/password_manager/pouley_migration.cc`). Ils ne sont jamais écrits en
     clair sur le disque ;
   - fait pointer les ProgIds `PouleyPwoluURL` et `PouleyPwoluHTML` et
     `StartMenuInternet\PouleyPwolu` vers son exécutable : le choix « navigateur par défaut »
     de Windows reste valable ;
   - désinstalle la version Electron (`Uninstall PouleyPwolu.exe /S --updated` : `--updated`
     garde ces inscriptions, les données restent), une seule fois (fichier `electron-retire`).
7. L'extension intégrée lit l'état (`chrome.pouleyPrivate.getMigrationState`), reprend
   poulaillers, onglets, favoris et réglages, puis efface `etat.bin`
   (`engine/extension/core/migration.js`). Les extensions du Chrome Web Store de l'ancienne
   version s'ouvrent dans des onglets, pour les réinstaller.

Le code se trouve dans `src/main/engine-switch.js`.

Les connexions aux sites ne suivent pas : les cookies d'Electron ne sont pas transférables.
Les extensions du Chrome Web Store sont listées, et Chromium propose de les réinstaller.

## Publier une version Chromium sans laisser personne en route

Les versions Electron 0.1.11 et antérieures demandent à GitHub la dernière version
(`/releases/latest`), puis y cherchent `latest.yml`.

Chaque version Chromium publiée doit donc contenir **en plus** :

- `latest.yml` et `PouleyPwolu-Setup-0.1.12.exe`, repris de la version v0.1.12 : une
  ancienne version passe d'abord par la 0.1.12, qui seule sait ouvrir le coffre ;
- `moteur.json` :

  ```json
  { "format": 1, "version": "0.2.0", "installer": "<nom de l'installateur>", "sha256": "<64 hex>" }
  ```

  L'installateur doit être un fichier de la même version.

Sans `latest.yml`, les anciennes versions restent bloquées en erreur de mise à jour.

## Le dossier de migration

Il se trouve dans `%LOCALAPPDATA%\PouleyPwolu\Migration\` :

| Fichier | Contenu |
|---|---|
| `manifest.json` | En clair, écrit en dernier : sa présence veut dire que le dossier est complet. `format` (1), `depuis` (version Electron), `creeLe`, `etat`, `motsDePasse` (nom du fichier ou `null`), `compte`. |
| `cle.dpapi` | Clé K de 32 octets, protégée par `CryptProtectData` (portée utilisateur, entropie `pouley-migration` en UTF-8). |
| `etat.bin` | JSON chiffré par K, données additionnelles `pouley-migration-etat`. |
| `mots-de-passe.bin` | CSV au format de Chrome (`name,url,username,password,note`), chiffré par K, données additionnelles `pouley-migration-mdp`. |
| `installateur\` | L'installateur téléchargé, supprimable après l'installation. |

### Format chiffré

Les octets sont, dans l'ordre :

| Octets | Contenu |
|---|---|
| 4 | `PLY1` |
| 12 | IV |
| 16 | tag GCM |
| reste | données chiffrées |

L'algorithme est AES-256-GCM.

### Contenu de `etat.bin`

```json
{
  "settings": { "...": "réglages Electron tels quels" },
  "activePoulailler": "p…",
  "poulaillers": [
    {
      "id": "p…", "name": "Perso", "color": "#FFE100", "icon": "poule", "isolated": false,
      "groups": [{ "id": "g…", "name": "…", "color": "…", "collapsed": false }],
      "tabs": [{ "url": "https://…", "title": "…", "pinned": false, "groupId": null }]
    }
  ],
  "favorites": [{ "url": "https://…", "title": "…" }],
  "extensions": [{ "id": "<32 lettres a-p, ou nadspdf>", "name": "…", "builtin": false, "enabled": true }]
}
```

Seules les adresses `http(s)` sont gardées. Les onglets éphémères ne sont pas exportés.

## Côté Chromium

**Mots de passe (fait)** : `engine/patches/migration-mots-de-passe.patch`.

Au démarrage du profil, l'import de mots de passe déjà présent dans Chromium 155
(`StartupPasswordsImporter`) cherche le dossier. Si le dossier n'existe pas, il ne fait rien.
S'il le trouve :

1. Il ouvre la clé avec `CryptUnprotectData`.
2. Il déchiffre `mots-de-passe.bin` en mémoire.
3. Il passe le CSV à `PasswordImporter::Import(std::string csv_data, …)` : rien n'est écrit en
   clair sur le disque.
4. Une fois l'import réussi, il efface `mots-de-passe.bin`.

`cle.dpapi` et `etat.bin` restent pour l'import des favoris et des poulaillers.

Testé avec un dossier écrit par le code de la 0.1.12. Les deux identifiants ont été importés,
dont un mot de passe avec virgule, guillemets et retour à la ligne.

**À faire** :

- Favoris et poulaillers (`etat.bin`), d'abord sous forme de dossiers de favoris.
- Liste des extensions à réinstaller.
- Effacement du dossier une fois tout importé.
