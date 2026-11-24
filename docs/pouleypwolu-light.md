# PouleyPwolu Light : plan complet

Un deuxième PouleyPwolu, ni Chromium ni Firefox : moteur WebKit (celui de Safari) pour
Windows, interface et fonctions PouleyPwolu, extensions au format PouleyPwolu. Le but : que
tous les sites qu'on utilise au quotidien fonctionnent, vérifié par des tests automatiques
et non promis.

La version Chromium reste la version complète. PouleyPwolu Light vit à côté, dans `light/`.

## Pourquoi WebKit

- **Ladybird** et **Servo** (moteurs indépendants) ne sont pas prêts pour un usage
  quotidien, et Ladybird ne tourne pas sous Windows.
- **Écrire notre moteur** prendrait des années avant que Gmail ou YouTube s'affichent.
  Le plus gros mur, c'est un moteur JavaScript assez rapide pour 15 Mo de code (YouTube).
- **WebKit** a un portage Windows maintenu, avec un moteur JavaScript rapide
  (JavaScriptCore). Kagi s'en servait pour Orion Windows avant d'arrêter en octobre 2026 et
  d'annoncer la publication du code.

## Où en est WebKit sous Windows (mesuré le 26/10/2026)

Mesures faites avec le WebKit 27.2 de Playwright pour Windows, comparé à Chrome 156. Notre
propre compilation peut activer des fonctions désactivées dans celle de Playwright : le
tableau sera refait sur notre version (étape 1).

**Affichage** : Wikipédia, Le Monde, GitHub et YouTube s'affichent comme dans Chrome
(23 150 règles CSS et 81 composants web pour YouTube, sans souci).

**Déjà présent** : WebGL et WebGL2, WebAssembly, service workers, notifications, Push,
IndexedDB, Cache API, WebSocket, WebAuthn (clés d'accès), presse-papiers, composants web,
plein écran, géolocalisation, CSS récent (`:has()`, container queries, nesting, view
transitions), décodage H.264, VP9, AV1, MP3 et AAC.

**Manquant** :

| API | Ce qui casse sans elle |
| --- | --- |
| MediaSource | Vidéo en flux : YouTube, Twitch, Dailymotion, la plupart des lecteurs vidéo |
| EME | DRM : Netflix, Disney+, Prime Video, Canal+, Deezer, Spotify |
| Web Audio | Spotify, jeux, Discord, éditeurs audio, sons des applis web |
| WebRTC, getUserMedia, getDisplayMedia | Appels et partage d'écran : Meet, Discord, Teams, Zoom web, WhatsApp Web |
| Opus | Audio de YouTube, Discord, WebRTC |
| WebCodecs | Montage vidéo en ligne, certains lecteurs, outils de visio |
| Picture-in-picture | Vidéo en vignette |
| WebGPU | Jeux et IA dans le navigateur (encore rare) |
| WebTransport | Rare pour l'instant (jeux, streaming à faible latence) |
| File System Access | Éditeurs en ligne qui enregistrent directement un fichier (vscode.dev, Photopea…) |

## Les étapes

Chaque étape se termine quand ses sites de test passent sur le banc d'essai (étape 0).

### 0. Banc d'essai

Le juge de tout le projet, à construire en premier, dans `light/bench/` :

- **Liste de 100 sites** : les 50 les plus visités en France, plus les sites qu'on utilise
  (Gmail, Proton, YouTube, Netflix, banques, impots.gouv, Ameli, Doctolib, Leboncoin,
  Discord, Notion, Figma, Canva…).
- **Comparaison visuelle** avec `agent-browser` : capture dans Chrome, capture dans
  PouleyPwolu Light, pourcentage de pixels différents.
- **Tableau des API** (ci-dessus), refait à chaque nouvelle version.
- **Scénarios** : lancer une vidéo, se connecter, envoyer un message, passer un appel.
- Un résumé par site : ✅ fonctionne, ⚠️ dégradé, ❌ cassé, avec la raison.

### 1. Le moteur

- Compiler WebKit pour Windows sur GitHub Actions, découpé en étapes comme pour Chromium.
  La version est figée dans `light/engine/source.lock.json`.
- Regarder le code d'Orion Windows quand il sort : licence, état, ce qu'on peut reprendre.
- Ouvrir une fenêtre PouleyPwolu Light qui affiche Wikipédia.
- Refaire le tableau des API sur notre compilation.

**Licence** : WebCore et JavaScriptCore sont en LGPL. PouleyPwolu reste gratuit et
fermé, mais WebKit doit être livré en DLL séparées, et nos modifications de WebKit
publiées. Le reste (interface, fonctions, extensions) reste à nous.

### 2. Le navigateur et les fonctions PouleyPwolu

- Onglets, barre latérale, barre d'adresse, historique, favoris, téléchargements,
  impression, zoom, recherche dans la page, onglets qui s'endorment.
- **Poulaillers** : un stockage séparé par poulailler (WebKit sait isoler les cookies et
  les données par profil), avec l'option d'une connexion partagée.
- **Bloqueur de traqueurs** : les règles de blocage natives de WebKit (le même mécanisme
  que les bloqueurs de Safari), donc rapide et sans script injecté. Cookies tiers refusés,
  HTTPS partout, alerte d'empreinte.
- **Coffre à mots de passe** avec Windows Hello, remplissage automatique.
- **Inspecteur**, **détecteur d'IA**, **stylo**, **plumes et tenders**, **lecteur PDF**
  (nadspdf) : on reprend le code JavaScript existant.
- Import depuis PouleyPwolu Chromium : favoris, historique, mots de passe.
- Mises à jour automatiques via les releases GitHub, installateur signé.

### 3. Vidéo et audio

Le chantier qui débloque le plus de sites.

**La solution : GStreamer.** WebKit a déjà toute une partie multimédia écrite pour
GStreamer (bibliothèque multimédia libre, LGPL). C'est elle qui fait tourner la vidéo, le
son et les appels dans les versions Linux de WebKit (WebKitGTK, et WPE sur des millions de
box TV). Elle n'est simplement pas branchée dans la version Windows. Or GStreamer
fonctionne aussi sous Windows, avec des modules natifs : décodage par la carte graphique
(Direct3D 11 et 12), Media Foundation, son WASAPI. Une seule brique bouche les trous :

| Trou | Côté WebKit (existe déjà) | Côté GStreamer sous Windows |
| --- | --- | --- |
| MediaSource (vidéo en flux) | lecteur MSE GStreamer | décodeurs Direct3D 11/12 : H.264, VP9, AV1, avec dav1d en secours |
| Opus | — | module `opus` |
| Web Audio | sortie audio GStreamer | `wasapi2sink` |
| WebRTC (appels) | backend GstWebRTC | `webrtcbin` |
| Caméra, micro | capture GStreamer | `mfvideosrc`, `wasapi2src` |
| Partage d'écran | capture GStreamer | capture d'écran Direct3D 11 |

En 2014, WebKit Windows avait abandonné GStreamer pour deux raisons : environ 100 Mo de
DLL et des doutes sur la licence. Les parades :

- n'embarquer que les modules utiles, pas le paquet GStreamer complet ;
- n'utiliser que des modules LGPL ou BSD, aucun module GPL (x264 par exemple) ;
- décoder H.264 et AAC via Windows (Media Foundation, Direct3D), qui en paie déjà les
  brevets.

**Plan B**, si GStreamer s'avère trop lourd une fois mesuré : écrire nous-mêmes ces
parties directement sur Windows (lecteur MSE sur Media Foundation, Web Audio sur WASAPI,
libwebrtc pour les appels). C'est plus léger, mais beaucoup plus de code.

Autres manques à combler ensuite : **WebCodecs** et **picture-in-picture**.

Sites de validation : YouTube, Twitch, Dailymotion, Arte, France.tv, SoundCloud, Spotify
(hors DRM).

### 4. Appels et partage d'écran

- **WebRTC** via le backend GstWebRTC de WebKit et `webrtcbin` (voir l'étape 3).
- **Caméra, micro et partage d'écran** via les modules GStreamer Windows (voir l'étape 3).
- Une demande d'autorisation claire, site par site.

Sites de validation : Google Meet, Discord, Teams, Zoom web, WhatsApp Web, Messenger.

### 5. DRM (Netflix et compagnie)

- **EME** branché sur **PlayReady**, la DRM de Microsoft intégrée à Windows (c'est ce
  qu'utilise Edge).
- La vidéo protégée ne passe pas par GStreamer : PlayReady exige le « chemin protégé » de
  Windows, où l'image déchiffrée ne sort jamais du système. Ces vidéos auront donc leur
  propre lecteur Media Foundation, branché sur l'EME de WebKit.
- Activée seulement sur les sites qui en ont besoin, avec un interrupteur visible.
- **Ne dépend pas que de nous** : chaque service décide s'il accepte un navigateur et en
  quelle qualité. On teste avec de vrais comptes, et on contacte les services si besoin.
- Widevine (Google) seulement si Google l'accorde. Ce n'est pas la piste principale.

Sites de validation : Netflix, Disney+, Prime Video, Canal+, Deezer, Spotify, Apple TV+.

### 6. Le reste du web

- WebGPU, WebTransport, File System Access, SharedArrayBuffer (isolation cross-origin).
- **Identité du navigateur** : certains sites refusent ce qu'ils ne connaissent pas. Le
  navigateur s'annonce comme un Safari compatible, avec une liste de correctifs par site
  quand c'est nécessaire.
- Le reste vient avec : correcteur orthographique, saisie IME, accessibilité (lecteurs
  d'écran), écrans haute densité, mode sombre.
- Un bouton « Ce site ne marche pas » : il prépare un rapport, montré à l'utilisateur et
  envoyé seulement s'il clique. Aucune collecte automatique.

### 6 bis. Ce que voient les traqueurs

Mesuré sur le WebKit Windows de Playwright, le 26/10/2026 : il s'annonce comme un Safari
sur Mac (`Macintosh`), mais avoue `Win32` et des polices Windows (Segoe UI, Calibri).
Ce mélange est rare, donc reconnaissable, et les anti-fraudes (connexion Google,
Cloudflare, banques) le prennent pour un robot. À l'inverse, il bride déjà le nombre de
cœurs (8), masque la carte graphique (`Apple GPU`) et ne donne pas la mémoire.

La règle : être **cohérent** et **banal**, pas unique.

- Une identité honnête et stable : Windows et WebKit, pas un faux Mac. Les mêmes valeurs
  pour tous les utilisateurs de PouleyPwolu Light.
- Valeurs arrondies pour tout le monde : 8 cœurs, carte graphique générique, pas de
  `deviceMemory`, liste de polices limitée aux polices standard de Windows.
- Bruit léger sur canvas, WebGL et audio, différent par site et par session : le site
  fonctionne, mais l'empreinte ne suit pas d'un site à l'autre.
- Ce que WebKit a déjà (ITP de Safari) : stockage séparé par site, cookies tiers bloqués,
  protection contre les redirections pisteuses.
- En plus : paramètres de pistage retirés des liens (`utm_`, `fbclid`, `gclid`…), signal
  GPC envoyé, bloqueur de l'étape 2, alerte quand un site lit l'empreinte.
- **Réseau** : l'empreinte TLS et HTTP/2 (la façon dont le navigateur ouvre une connexion
  chiffrée) identifie aussi le navigateur. Il faut vérifier quelle pile réseau utilise
  WebKit Windows et qu'elle ne ressemble pas à un robot.
- Le banc d'essai mesure tout ça à chaque version, sur des sites de test d'empreinte et sur
  les connexions Google, Cloudflare et bancaires.

### 7. Extensions

- **Format PouleyPwolu** : chaque extension tourne isolée de la page, sans aucun droit par
  défaut. Elle déclare chaque droit (pages lues, domaines contactés, stockage), affichés à
  l'installation. Un domaine non déclaré est bloqué. Extensions signées, vérifiées avant
  publication, dans un petit catalogue PouleyPwolu.
- **Adaptateur Chrome** : les extensions simples (scripts de contenu, styles, stockage,
  menus) tournent dans notre format, avec nos permissions.
- **Passerelles** pour les grosses extensions : Bitwarden (outil officiel en ligne de
  commande), Proton Pass (outil officiel à confirmer), branchées sur notre remplissage
  automatique.
- Un kit pour les développeurs (SDK) avec la documentation.

### 8. Sortie

- Bêta privée, puis publique, quand les 100 sites du banc passent ou ont une raison
  connue de ne pas passer.
- Comparaison de mémoire avec Chrome, Edge, Brave et PouleyPwolu Chromium (`bench/ram.ps1`).

## « Tous les sites » : la vraie règle

Aucun navigateur ne fait fonctionner 100 % du web, même pas Chrome. La règle du projet :
chaque site du banc d'essai fonctionne, ou bien on sait précisément pourquoi il ne
fonctionne pas et ce qui le débloquera. Le banc grandit avec chaque site signalé.

## Risques

| Risque | Parade |
| --- | --- |
| Le portage Windows de WebKit a peu de mainteneurs | Version figée, nos correctifs proposés en amont, code d'Orion |
| Un service vidéo refuse notre DRM | Tests avec de vrais comptes, contact des services, PouleyPwolu Chromium en secours |
| Un site bloque les navigateurs inconnus | Identité Safari compatible, correctifs par site |
| Compilation trop longue pour GitHub Actions | Découpage en étapes, comme pour Chromium |
