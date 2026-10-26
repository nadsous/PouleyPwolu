// PouleyPwolu : extension intégrée au navigateur, chargée par Chromium comme composant
// (engine/patches/extension-integree.patch). Elle ne peut pas être désinstallée.
import { getSettings } from './lib/settings.js';
import { applyShield } from './lib/shield.js';

// La barre latérale s'ouvre d'un clic sur l'icône PouleyPwolu.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Vie privée : bouclier, cookies tiers. Réappliqué à chaque démarrage et à chaque
// changement de réglage.
async function applyPrivacy() {
  const s = await getSettings();
  await applyShield(s);
  await chrome.privacy.websites.thirdPartyCookiesAllowed.set({ value: !s.blockThirdPartyCookies }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(applyPrivacy);
chrome.runtime.onStartup.addListener(applyPrivacy);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) applyPrivacy();
});
