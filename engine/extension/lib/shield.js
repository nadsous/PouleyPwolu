// Bouclier : les traqueurs de lib/trackers.js deviennent des règles de blocage natives
// de Chromium (declarativeNetRequest), appliquées par le moteur sans JavaScript.
// Niveaux, comme dans la version Electron :
// - strict : tout est bloqué ;
// - standard : la mesure d'audience passe (souvent nécessaire au site) ;
// - off : rien.
// Seules les requêtes tierces sont bloquées : un site reste joignable directement.
// Global Privacy Control : en-tête « Sec-GPC: 1 » envoyé partout si sendGpc.
import { TRACKERS, STANDARD_CATEGORIES } from './trackers.js';

const GPC_RULE_ID = 1;
const FIRST_TRACKER_RULE_ID = 1000;
const RESOURCE_TYPES = ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'websocket', 'stylesheet', 'font', 'other'];

export function buildRules({ shieldLevel = 'strict', sendGpc = true } = {}) {
  const rules = [];
  if (sendGpc) {
    rules.push({
      id: GPC_RULE_ID,
      priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Sec-GPC', operation: 'set', value: '1' }] },
      condition: { resourceTypes: ['main_frame', ...RESOURCE_TYPES] },
    });
  }
  if (shieldLevel === 'off') return rules;
  let id = FIRST_TRACKER_RULE_ID;
  for (const [cat, entries] of Object.entries(TRACKERS)) {
    if (shieldLevel !== 'strict' && !STANDARD_CATEGORIES.has(cat)) continue;
    const domains = entries.filter((e) => !e.includes('/'));
    const paths = entries.filter((e) => e.includes('/'));
    // Un domaine bloque aussi ses sous-domaines (requestDomains).
    if (domains.length) {
      rules.push({ id: id++, priority: 2, action: { type: 'block' }, condition: { requestDomains: domains, domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES } });
    }
    for (const p of paths) {
      rules.push({ id: id++, priority: 2, action: { type: 'block' }, condition: { urlFilter: '||' + p, domainType: 'thirdParty', resourceTypes: RESOURCE_TYPES } });
    }
  }
  return rules;
}

// Remplace toutes les règles dynamiques par celles qui correspondent aux réglages.
export async function applyShield(settings) {
  const old = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old.map((r) => r.id),
    addRules: buildRules(settings),
  });
}
