// Réglages PouleyPwolu, mêmes noms et mêmes valeurs par défaut que la version Electron
// (src/main/store.js). Gardés dans chrome.storage.local.
export const DEFAULTS = {
  ai: 'claude',
  searchEngine: 'duckduckgo',
  sidebarPosition: 'left',
  newTabPosition: 'start',
  autoGroupTabs: true,
  theme: 'nads',
  shieldLevel: 'strict',
  httpsOnly: true,
  blockThirdPartyCookies: true,
  sendGpc: true,
  memoryMode: 'equilibre',
  sleepAfterMinutes: 15,
  focusEnabled: true,
  focusNudge: true,
  notifSound: true,
  notifVolume: 0.6,
  pen: { tool: 'pen', color: '#EF3E36', size: 4, pens: [] },
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}

export async function setSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}
