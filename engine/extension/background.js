// PouleyPwolu : extension intégrée au navigateur, chargée par Chromium comme composant
// (engine/patches/extension-integree.patch). Elle ne peut pas être désinstallée.
import { getSettings } from './lib/settings.js';
import { applyShield } from './lib/shield.js';

// La barre PouleyPwolu remplace la barre d'onglets : elle s'ouvre dans chaque fenêtre
// normale (le moteur l'autorise sans clic pour l'extension intégrée).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
const openBar = (windowId) => chrome.sidePanel.open({ windowId }).catch(() => {});
chrome.windows.onCreated.addListener((w) => { if (w.type === 'normal') openBar(w.id); }, { windowTypes: ['normal'] });
chrome.windows.getAll({ windowTypes: ['normal'] }).then((ws) => ws.forEach((w) => openBar(w.id)));

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
