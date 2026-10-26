// Passage depuis PouleyPwolu Electron (0.1.12) : poulaillers, onglets, favoris et
// réglages laissés dans le dossier de migration (docs/migration-electron.md). Le moteur
// les déchiffre (chrome.pouleyPrivate.getMigrationState) ; on les importe une fois.
import { DEFAULT_STATE, uid } from './state.js';

const isWeb = (u) => /^https?:/.test(u || '');

function tabIn(t, groupIds) {
  let title = t.title || '';
  if (!title) { try { title = new URL(t.url).hostname.replace(/^www\./, ''); } catch { title = 'Page'; } }
  return {
    id: uid('t'), url: t.url, title, favicon: null, pinned: !!t.pinned, lastActive: Date.now(),
    groupId: t.groupId && groupIds.has(t.groupId) ? t.groupId : null,
  };
}

function poulaillerIn(p, keepId) {
  const groups = (p.groups || []).map((g) => ({ id: g.id || uid('g'), name: g.name || 'Groupe', color: g.color, collapsed: !!g.collapsed, auto: false }));
  const groupIds = new Set(groups.map((g) => g.id));
  const tabs = (p.tabs || []).filter((t) => isWeb(t.url)).map((t) => tabIn(t, groupIds));
  return {
    id: keepId && p.id ? p.id : uid('p'), name: String(p.name || 'Poulailler').slice(0, 40), color: p.color, icon: p.icon,
    isolated: !!p.isolated, pinned: [], tabs, activeTab: (tabs.find((t) => !t.pinned) || tabs[0] || {}).id || null, groups,
  };
}

// Renvoie les identifiants des extensions du Chrome Web Store installées dans l'ancienne
// version (à réinstaller), ou null s'il n'y avait rien à importer.
export async function importMigration(store) {
  const P = chrome.pouleyPrivate;
  if (!P || !P.getMigrationState) return null;
  let text = '';
  try { text = await P.getMigrationState(); } catch { return null; }
  if (!text) return null;
  let old;
  try { old = JSON.parse(text); } catch { return null; }
  const st = store.state;
  const fresh = !st.onboarded;
  const poulaillers = (old.poulaillers || []).map((p) => poulaillerIn(p, fresh));
  const favorites = (old.favorites || []).filter((t) => isWeb(t.url)).map((t) => tabIn(t, new Set()));
  if (fresh) {
    // Première ouverture de la version Chromium : on reprend tout tel quel.
    const keep = { ...DEFAULT_STATE.settings, ...st.settings, ...(old.settings || {}) };
    // Réglages propres à Electron : remis aux valeurs de Chromium.
    keep.sidebarPosition = 'left';
    keep.sidebarAutoHide = false;
    st.settings = keep;
    if (poulaillers.length) {
      st.poulaillers = poulaillers;
      st.activePoulailler = poulaillers.some((p) => p.id === old.activePoulailler) ? old.activePoulailler : poulaillers[0].id;
    }
    st.favorites = favorites;
    st.onboarded = true;
  } else {
    // Déjà utilisée : les anciens poulaillers et favoris s'ajoutent.
    st.poulaillers.push(...poulaillers);
    const known = new Set(st.favorites.map((t) => t.url));
    st.favorites.push(...favorites.filter((t) => !known.has(t.url)));
  }
  await store.flush();
  await P.markMigrationImported().catch(() => {});
  return (old.extensions || []).filter((e) => !e.builtin && /^[a-p]{32}$/.test(e.id || '')).map((e) => ({ id: e.id, name: e.name }));
}
