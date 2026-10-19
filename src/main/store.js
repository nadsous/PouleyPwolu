// Stockage 100 % local, chiffré : onglets, favoris, poulaillers et réglages
// sont dans pouley-state.enc (AES-256-GCM, clé protégée par Windows).
// Rien ne quitte la machine. Écriture atomique (fichier temporaire + rename).
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { normalize } = require('../shared/icons');
const { seal, unseal, writeAtomic, shred, getDataKey } = require('./seal');
const { DEFAULT_SITES } = require('./focus');

const AAD = 'pouley-state';

const DEFAULT_STATE = {
  version: 2,
  onboarded: false,
  settings: {
    ai: 'claude', // claude | chatgpt | comet
    searchEngine: 'duckduckgo', // comet | duckduckgo | brave | startpage | google
    searchEngine2: 'duckduckgo', // second choix quand Perplexity est le moteur par défaut
    sidebarPosition: 'left', // left | right | top
    sidebarAutoHide: false,
    sidebarWidth: 264,
    swipePoulaillers: false, // glisser = défiler les onglets (pas changer de poulailler)
    autoGroupTabs: true, // groupes d'œufs automatiques
    windowMaterial: 'acrylic', // none | mica | acrylic (Windows 11)
    chromeOpacity: 0.55, // opacité du fond de l'interface quand la fenêtre est transparente
    extNadspdf: true, // extension Chrome NadsPDF préinstallée
    mediaPlayer: true, // mini-lecteur (YouTube, YouTube Music, Spotify appli…)
    mediaSystem: true, // piloter la musique des applications Windows (Spotify…)
    favHoverPreview: true, // aperçu d'un favori au survol
    autoUpdate: true, // vérifier les mises à jour sur nads.site
    notifSound: true,
    notifVolume: 0.6,
    theme: 'nads', // nads | light
    shieldLevel: 'strict', // off | standard | strict
    httpsOnly: true,
    blockThirdPartyCookies: true,
    sendGpc: true,
    clearOnExit: false,
    memoryMode: 'equilibre', // econome | equilibre | performance
    wipeCacheOnExit: true, // le cache des pages ne reste pas sur le disque
    vaultOffer: true, // proposer d'enregistrer les mots de passe
    vaultAutoLockMinutes: 15, // verrouiller le coffre après inactivité
    vaultNever: [], // sites pour lesquels ne jamais proposer
    sleepAfterMinutes: 15,
    archiveAfterHours: 12,
    focusEnabled: true, // compteur de plumes et de tenders
    focusNudge: true, // petit mot quand les tenders s'accumulent
    focusSites: DEFAULT_SITES, // sites qui distraient
    pen: { tool: 'pen', color: '#EF3E36', size: 4, pens: [] }, // stylo : outil, couleur, épaisseur, « Mes stylos »
  },
  activePoulailler: null,
  poulaillers: [],
  favorites: [],
};

function makePoulailler(name, color, icon) {
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  return { id, name, color, icon, pinned: [], tabs: [], activeTab: null, isolated: false };
}

class Store {
  constructor() {
    const dir = app.getPath('userData');
    this.plainFile = path.join(dir, 'pouley-state.json');
    this.file = path.join(dir, 'pouley-state.enc');
    this.key = getDataKey();
    this.state = this.load();
    // Ancien fichier en clair : on chiffre tout de suite et on l'efface.
    if (this.key && fs.existsSync(this.plainFile)) {
      this.flush();
      shred(this.plainFile);
    }
    this.timer = null;
  }

  load() {
    let data = null;
    if (this.key && fs.existsSync(this.file)) {
      try {
        data = JSON.parse(unseal(fs.readFileSync(this.file), this.key, AAD).toString('utf8'));
      } catch {
        // Illisible (clé Windows perdue ou fichier abîmé) : on le met de côté.
        try { fs.renameSync(this.file, this.file + '.illisible-' + Date.now()); } catch {}
      }
    }
    if (!data) {
      try {
        data = JSON.parse(fs.readFileSync(this.plainFile, 'utf8'));
      } catch {
        data = null;
      }
    }
    const state = structuredClone(DEFAULT_STATE);
    if (data && typeof data === 'object') {
      Object.assign(state, data);
      state.settings = { ...DEFAULT_STATE.settings, ...(data.settings || {}) };
    }
    if (!Array.isArray(state.poulaillers) || state.poulaillers.length === 0) {
      const p = makePoulailler('Perso', '#FFE100', 'poule');
      state.poulaillers = [p];
      state.activePoulailler = p.id;
    }
    // Avant la version 2, chaque poulailler avait ses propres connexions : on les
    // partage désormais (un seul compte Proton, Google… pour tous les poulaillers).
    if (data && (data.version || 1) < 2) for (const p of state.poulaillers) p.isolated = false;
    state.version = DEFAULT_STATE.version;
    // Les premières versions enregistraient un emoji comme icône.
    for (const p of state.poulaillers) p.icon = normalize(p.icon);
    if (!state.poulaillers.some((p) => p.id === state.activePoulailler)) {
      state.activePoulailler = state.poulaillers[0].id;
    }
    return state;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      const json = Buffer.from(JSON.stringify(this.state));
      if (this.key) writeAtomic(this.file, seal(json, this.key, AAD));
      else writeAtomic(this.plainFile, json);
    } catch (err) {
      console.error('[store] écriture impossible', err);
    }
  }
}

module.exports = { Store, makePoulailler };
