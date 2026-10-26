// État PouleyPwolu : onglets, favoris, poulaillers et réglages. Même forme que dans la
// version Electron (src/main/store.js), gardé dans chrome.storage.local.
import { DEFAULT_SITES } from './focus.js';

export const DEFAULT_STATE = {
  version: 2,
  onboarded: false,
  settings: {
    ai: 'claude', // claude | chatgpt | comet
    searchEngine: 'duckduckgo', // comet | duckduckgo | brave | startpage | google
    searchEngine2: 'duckduckgo',
    sidebarPosition: 'left',
    sidebarAutoHide: false,
    defaultAsked: false,
    newTabPosition: 'start', // start | end | next
    sidebarWidth: 264,
    swipePoulaillers: false,
    autoGroupTabs: true,
    windowMaterial: 'acrylic',
    chromeOpacity: 0.55,
    extNadspdf: true,
    mediaPlayer: true,
    mediaSystem: true,
    favHoverPreview: true,
    autoUpdate: true,
    notifSound: true,
    notifVolume: 0.6,
    theme: 'nads', // nads | light
    shieldLevel: 'strict', // off | standard | strict
    httpsOnly: true,
    blockThirdPartyCookies: true,
    sendGpc: true,
    clearOnExit: false,
    memoryMode: 'equilibre', // econome | equilibre | performance | perso
    wipeCacheOnExit: true,
    vaultOffer: true,
    vaultAutoLockMinutes: 15,
    vaultNever: [],
    sleepAfterMinutes: 15,
    archiveAfterHours: 12,
    focusEnabled: true,
    focusNudge: true,
    focusSites: DEFAULT_SITES,
    pen: { tool: 'pen', color: '#EF3E36', size: 4, pens: [] },
  },
  activePoulailler: null,
  poulaillers: [],
  favorites: [],
};

export const uid = (p) => p + Math.random().toString(36).slice(2, 10);

export function makePoulailler(name, color, icon) {
  return { id: uid('p'), name, color, icon, pinned: [], tabs: [], activeTab: null, isolated: false };
}

export class Store {
  constructor() {
    this.state = null;
    this.timer = null;
  }

  async load() {
    const { state: data } = await chrome.storage.local.get('state');
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
    if (!state.poulaillers.some((p) => p.id === state.activePoulailler)) state.activePoulailler = state.poulaillers[0].id;
    this.state = state;
    return state;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    return chrome.storage.local.set({ state: this.state }).catch((err) => console.error('[état] écriture impossible', err));
  }
}
