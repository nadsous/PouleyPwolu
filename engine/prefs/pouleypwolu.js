// Réglages par défaut de PouleyPwolu, ajoutés aux préférences de la marque
// (browser/branding/pouleypwolu/pref/firefox-branding.js) par scripts/prepare.ps1.
// L'utilisateur peut les changer dans about:config ; ils ne sont pas verrouillés.

// ── Aucune collecte de données ──────────────────────────────────────────────
pref("datareporting.healthreport.uploadEnabled", false);
pref("datareporting.policy.dataSubmissionEnabled", false);
pref("datareporting.usage.uploadEnabled", false);
pref("toolkit.telemetry.enabled", false);
pref("toolkit.telemetry.unified", false);
pref("toolkit.telemetry.archive.enabled", false);
pref("toolkit.telemetry.newProfilePing.enabled", false);
pref("toolkit.telemetry.shutdownPingSender.enabled", false);
pref("toolkit.telemetry.updatePing.enabled", false);
pref("toolkit.telemetry.bhrPing.enabled", false);
pref("toolkit.telemetry.firstShutdownPing.enabled", false);
pref("toolkit.telemetry.coverage.opt-out", true);
pref("toolkit.coverage.opt-out", true);
pref("app.shield.optoutstudies.enabled", false);
pref("app.normandy.enabled", false);
pref("app.normandy.api_url", "");
pref("messaging-system.rsexperimentloader.enabled", false);
pref("nimbus.rollouts.enabled", false);
pref("browser.discovery.enabled", false);
pref("browser.ping-centre.telemetry", false);
pref("browser.tabs.crashReporting.sendReport", false);
pref("breakpad.reportURL", "");
pref("dom.private-attribution.submission.enabled", false);
pref("captivedetect.canonicalURL", "");
pref("network.captive-portal-service.enabled", false);
pref("network.connectivity-service.enabled", false);

// Nouvel onglet et barre d'adresse : ni pub, ni suggestions sponsorisées, ni Pocket.
pref("browser.newtabpage.activity-stream.feeds.telemetry", false);
pref("browser.newtabpage.activity-stream.telemetry", false);
pref("browser.newtabpage.activity-stream.showSponsored", false);
pref("browser.newtabpage.activity-stream.showSponsoredTopSites", false);
pref("browser.newtabpage.activity-stream.feeds.section.topstories", false);
pref("browser.newtabpage.activity-stream.default.sites", "");
pref("browser.urlbar.quicksuggest.enabled", false);
pref("browser.urlbar.suggest.quicksuggest.sponsored", false);
pref("browser.urlbar.suggest.quicksuggest.nonsponsored", false);
pref("browser.urlbar.trending.featureGate", false);
pref("extensions.pocket.enabled", false);
pref("extensions.getAddons.showPane", false);
pref("extensions.htmlaboutaddons.recommendations.enabled", false);
pref("browser.preferences.moreFromMozilla", false);
pref("browser.aboutwelcome.enabled", false);
pref("browser.startup.homepage_override.mstone", "ignore");
pref("startup.homepage_welcome_url", "");
pref("startup.homepage_welcome_url.additional", "");
pref("startup.homepage_override_url", "");
pref("browser.shell.checkDefaultBrowser", false);

// Mises à jour : PouleyPwolu les annonce lui-même depuis ses releases GitHub.
pref("app.update.auto", false);
pref("app.update.checkInstallTime", false);

// ── Interface PouleyPwolu ───────────────────────────────────────────────────
// La barre PouleyPwolu (l'extension intégrée) remplace la barre d'onglets : on part
// des onglets verticaux de Firefox, dont la barre native est ensuite masquée par
// l'extension (experiments/parent.js), qui affiche la sienne à la place.
pref("sidebar.revamp", true);
pref("sidebar.verticalTabs", true);
pref("sidebar.visibility", "always-show");
pref("sidebar.main.tools", "");
pref("sidebar.position_start", true);
pref("browser.toolbars.bookmarks.visibility", "never");
pref("browser.tabs.inTitlebar", 1);
pref("browser.compactmode.show", true);
pref("browser.uidensity", 1);
// Fond Mica de Windows 11 (l'ancien « verre » du moteur Chromium).
pref("widget.windows.mica", true);
pref("widget.windows.mica.toplevel-backdrop", 2);
// Ne pas fermer la fenêtre en fermant le dernier onglet (la barre en rouvre un).
pref("browser.tabs.closeWindowWithLastTab", false);
// Toujours rouvrir la session précédente.
pref("browser.startup.page", 3);
// Français par défaut quand la langue est disponible.
pref("intl.locale.requested", "fr,en-US");

// ── Outils de développement (F12) ──────────────────────────────────────────
// Thème sombre, habillé aux couleurs de PouleyPwolu (devtools/theme-pouleypwolu.css).
pref("devtools.theme", "dark");
// Réseau : pas de vidage à chaque navigation, durées et tailles visibles.
pref("devtools.netmonitor.persistlog", false);
pref("devtools.netmonitor.visibleColumns", "[\"status\",\"method\",\"domain\",\"file\",\"initiator\",\"type\",\"transferred\",\"contentSize\",\"waterfall\"]");
// Inspecteur : la vue en trois colonnes (règles CSS et calculées côte à côte).
pref("devtools.inspector.three-pane-enabled", true);

// ── Langues ─────────────────────────────────────────────────────────────────
// Les paquets de langue fournis (distribution\extensions) sont ceux de Mozilla avec la
// marque PouleyPwolu (scripts/prepare.py) : leur signature d'origine n'est plus valable.
pref("extensions.langpacks.signatures.required", false);

// ── Extensions d'addons.mozilla.org ─────────────────────────────────────────
// Le site ne propose « Ajouter à Firefox » que si l'identité du navigateur contient
// « Firefox/ » : sans ce réglage, elle finit par « PouleyPwolu/160 » seul et le site
// affiche « Télécharger Firefox » (impossible d'installer Proton Pass, uBlock…).
pref("general.useragent.compatMode.firefox", true);

// ── Extension intégrée ──────────────────────────────────────────────────────
// Pas de doorhanger « une extension a changé votre page Nouvel onglet ».
pref("extensions.webextensions.newtab.doorhanger.suppress", true);

// ── Fenêtres privées et fenêtre Tor ─────────────────────────────────────────
// Pas d'encarts de Mozilla (« épingler à la barre des tâches », VPN, Focus).
pref("browser.promo.pin.enabled", false);
pref("browser.promo.focus.enabled", false);
pref("browser.promo.cookiebanners.enabled", false);
pref("browser.vpn_promo.enabled", false);
pref("browser.privatebrowsing.vpnpromourl", "");
pref("browser.privatebrowsing.promoEnabled", false);
// Protection contre l'empreinte dans les fenêtres privées (dont les fenêtres Tor).
pref("privacy.resistFingerprinting.pbmode", true);
// WebRTC ne contourne jamais un proxy : dans une fenêtre Tor, il ne peut pas révéler l'IP.
pref("media.peerconnection.ice.proxy_only_if_behind_proxy", true);
pref("media.peerconnection.ice.default_address_only", true);
// Aucune connexion ni résolution DNS anticipée (elles pourraient sortir hors de Tor).
pref("network.dns.disablePrefetch", true);
pref("network.dns.disablePrefetchFromHTTPS", true);
pref("network.prefetch-next", false);
pref("network.predictor.enabled", false);
pref("network.http.speculative-parallel-limit", 0);
pref("browser.urlbar.speculativeConnect.enabled", false);
pref("browser.places.speculativeConnect.enabled", false);

// ── Mémoire ─────────────────────────────────────────────────────────────────
// Les onglets inutilisés sont déchargés quand la mémoire manque.
pref("browser.tabs.unloadOnLowMemory", true);
