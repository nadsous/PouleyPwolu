# Passage de PouleyPwolu Electron au moteur Chromium

## Les étapes

1. **0.1.12**, dernière version Electron, arrive par la mise à jour habituelle. Elle ne change
   rien tant qu'aucune version Chromium n'est publiée.
2. Une version Chromium est publiée : la 0.1.12 la voit (fichier `moteur.json` dans la
   dernière version GitHub) et propose « Passer au nouveau moteur ».
3. Si un coffre existe, la personne l'ouvre une fois (Windows Hello ou mot de passe maître).
4. La 0.1.12 écrit le dossier de migration, télécharge l'installateur Chromium, vérifie son
   empreinte, le lance avec `/S --migration=<dossier>` et se ferme.
5. L'installateur attend la fermeture de `PouleyPwolu.exe` et désinstalle la version Electron
   (`%LOCALAPPDATA%\Programs\PouleyPwolu\Uninstall PouleyPwolu.exe /S`, qui ne touche pas aux
   données). Il installe Chromium et garde les ProgIds `PouleyPwoluURL` et `PouleyPwoluHTML`,
   pour rester le navigateur par défaut.
6. Au premier démarrage, Chromium importe le dossier, puis efface `mots-de-passe.bin`.

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

## Côté Chromium (à faire)

Un patch lit le dossier au démarrage du profil :

1. `CryptUnprotectData` sur la clé, puis déchiffrement en mémoire.
2. Import du CSV avec `password_manager::PasswordImporter`, en écrivant le CSV déchiffré dans
   un fichier temporaire supprimé juste après.
3. Création des espaces et des onglets.
4. Effacement de `mots-de-passe.bin` et `cle.dpapi`.
