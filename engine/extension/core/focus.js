// Repris de src/main/focus.js (version Electron), en module ES.
// Compteur de productivité. Le temps passé sur un site qui distrait (TikTok,
// Twitch…) fait gagner des tenders ; le temps actif ailleurs fait gagner des
// plumes. Moins de tenders, plus de plumes : c'est bien. Tout reste dans l'état
// chiffré, sur la machine, et seuls les 14 derniers jours sont gardés.

const DEFAULT_SITES = [
  'tiktok.com', 'twitch.tv', 'kick.com', 'instagram.com', 'facebook.com', 'x.com', 'twitter.com',
  'reddit.com', 'snapchat.com', 'pinterest.com', 'threads.net', '9gag.com', 'youtube.com',
  'netflix.com', 'primevideo.com', 'disneyplus.com', 'crunchyroll.com',
];
const UNIT = 5 * 60; // secondes pour gagner une plume ou un tender
const KEEP_DAYS = 14;
const NUDGE_EVERY = 3; // un petit mot tous les 3 tenders (15 min)

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Le site de la liste qui correspond à l'adresse (youtube.com couvre m.youtube.com).
function distractingSite(url, sites) {
  if (!/^https?:/.test(url || '')) return null;
  let host;
  try { host = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
  // music.youtube.com sert à travailler en musique : pas un tender.
  if (host === 'music.youtube.com') return null;
  return (sites || []).find((s) => host === s || host.endsWith('.' + s)) || null;
}

// Nettoie une saisie : « https://www.TikTok.com/@x » → « tiktok.com ».
function cleanSite(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  try { s = new URL(/^[a-z]+:\/\//.test(s) ? s : 'https://' + s).hostname; } catch { return null; }
  s = s.replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(s) ? s : null;
}

const count = (secs) => Math.floor((secs || 0) / UNIT);

// Ajoute `seconds` à la journée. idle = secondes sans clavier ni souris.
// Renvoie le site qui distrait quand un palier de tenders vient d'être franchi.
function tick(state, url, seconds, { idle = 0, audible = false, sites } = {}) {
  if (!/^https?:/.test(url || '')) return null;
  const focus = (state.focus = state.focus || { days: {} });
  const key = dayKey();
  const day = (focus.days[key] = focus.days[key] || { good: 0, bad: 0, sites: {} });
  const site = distractingSite(url, sites);
  let nudge = null;
  if (site) {
    // Une vidéo qui tourne compte même sans toucher la souris.
    if (idle > 300 && !audible) return null;
    const before = count(day.bad);
    day.bad += seconds;
    day.sites[site] = (day.sites[site] || 0) + seconds;
    const after = count(day.bad);
    if (after > before && after % NUDGE_EVERY === 0) nudge = { site, tenders: after };
  } else {
    if (idle > 90) return null;
    day.good += seconds;
  }
  const keys = Object.keys(focus.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete focus.days[k];
  return { changed: true, nudge };
}

export { DEFAULT_SITES, UNIT, dayKey, distractingSite, cleanSite, tick };
