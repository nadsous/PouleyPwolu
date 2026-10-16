// Rapport de confidentialité d'une visite : ce que le site essaie de récupérer
// sur l'utilisateur, ce que le bouclier a bloqué, et une note de A à F.
const { CATEGORY_LABELS } = require('./trackers');

const FINGERPRINT_LABELS = {
  canvas: 'Lecture du canvas (empreinte graphique de ta machine)',
  webgl: 'Identification de ta carte graphique (WebGL)',
  audio: 'Empreinte audio (OfflineAudioContext)',
  fonts: 'Liste des polices installées sur ton ordinateur',
  battery: 'Niveau de ta batterie',
  webrtc: 'Connexion WebRTC (peut révéler ton IP locale)',
  clipboard: 'Lecture du presse-papiers',
};

const SECURITY_HEADERS = [
  ['strict-transport-security', 'HSTS (force le HTTPS)'],
  ['content-security-policy', 'CSP (limite les scripts injectés)'],
  ['x-frame-options', 'Protection anti-clickjacking'],
  ['x-content-type-options', 'Anti-sniffing MIME'],
  ['referrer-policy', 'Politique de référent'],
  ['permissions-policy', 'Politique de permissions'],
];

function newReport(url, site) {
  return {
    url,
    site,
    startedAt: Date.now(),
    blocked: [],
    blockedByCategory: {},
    allowedTrackers: [],
    thirdParties: {},
    cookies: { firstParty: [], thirdPartyBlocked: 0, thirdPartyAllowed: [] },
    headers: {},
    apiHeaders: {}, // en-têtes des appels d'API du site lui-même (fetch / XHR)
    apiPaths: [],
    fingerprint: {},
    permissions: [],
    beacons: 0,
    upgradedToHttps: false,
    cert: null,
    alerted: {},
  };
}

function addUnique(arr, v, max = 200) {
  if (!arr.includes(v) && arr.length < max) arr.push(v);
}

function grade(score) {
  if (score >= 88) return 'A';
  if (score >= 74) return 'B';
  if (score >= 60) return 'C';
  if (score >= 45) return 'D';
  if (score >= 30) return 'E';
  return 'F';
}

// Construit la synthèse affichée dans l'inspecteur.
function summarize(report, page) {
  const url = safeUrl(report.url);
  const https = url && url.protocol === 'https:';
  const thirdPartyList = Object.entries(report.thirdParties).sort((a, b) => b[1] - a[1]);
  const fp = Object.keys(report.fingerprint).filter((k) => FINGERPRINT_LABELS[k]);
  const sessionReplay = (report.blockedByCategory.session || 0) > 0 ||
    (page && page.techs && page.techs.some((t) => t.cat === 'Enregistrement de session'));

  let score = 100;
  const reasons = [];
  if (!https) { score -= 35; reasons.push('Connexion non chiffrée (HTTP)'); }
  const nBlocked = report.blocked.length;
  if (nBlocked) { score -= Math.min(30, nBlocked * 2.5); reasons.push(`${nBlocked} traqueur(s) détecté(s)`); }
  if (fp.length) { score -= Math.min(30, fp.length * 10); reasons.push('Tentative d’empreinte numérique'); }
  if (sessionReplay) { score -= 12; reasons.push('Enregistrement de session (clics, mouvements)'); }
  if (thirdPartyList.length > 8) { score -= Math.min(15, (thirdPartyList.length - 8) * 1.5); reasons.push(`${thirdPartyList.length} domaines tiers contactés`); }
  if (report.cookies.thirdPartyBlocked > 0) { score -= Math.min(10, report.cookies.thirdPartyBlocked); }
  if (page && page.insecureForm) { score -= 25; reasons.push('Formulaire envoyé sans chiffrement'); }
  const headersPresent = SECURITY_HEADERS.map(([h, label]) => ({ header: h, label, present: h in report.headers }));
  const missing = headersPresent.filter((h) => !h.present).length;
  score -= missing * 1.5;
  score = Math.max(0, Math.round(score));

  // « Ce que ce site récupère sur toi », en langage clair.
  const takes = [
    { level: 'info', text: 'Ton adresse IP, ta langue et ton type de navigateur (comme tout site web).' },
  ];
  if (report.cookies.firstParty.length) {
    takes.push({ level: 'info', text: `${report.cookies.firstParty.length} cookie(s) du site pour te reconnaître d’une visite à l’autre.` });
  }
  if (report.cookies.thirdPartyBlocked) {
    takes.push({ level: 'blocked', text: `${report.cookies.thirdPartyBlocked} cookie(s) tiers de pistage — bloqués.` });
  }
  for (const [cat, n] of Object.entries(report.blockedByCategory)) {
    takes.push({ level: 'blocked', text: `${CATEGORY_LABELS[cat] || cat} : ${n} requête(s) — bloquée(s).` });
  }
  if (report.allowedTrackers.length) {
    takes.push({ level: 'warn', text: `Mesure d’audience autorisée (bouclier standard) : ${report.allowedTrackers.slice(0, 4).join(', ')}.` });
  }
  for (const k of fp) takes.push({ level: 'danger', text: FINGERPRINT_LABELS[k] + '.' });
  if (sessionReplay) takes.push({ level: 'danger', text: 'Tes clics, défilements et frappes peuvent être enregistrés (session replay).' });
  if (page && page.formFields && page.formFields.length) {
    takes.push({ level: 'warn', text: `Les formulaires demandent : ${page.formFields.join(', ')}.` });
  }
  if (page && page.storage) {
    const s = page.storage;
    const n = (s.localStorage || 0) + (s.sessionStorage || 0) + (s.indexedDB || []).length;
    if (n) takes.push({ level: 'info', text: `${n} élément(s) stockés dans ton navigateur (localStorage, IndexedDB).` });
    if (s.serviceWorker) takes.push({ level: 'info', text: 'Un service worker tourne en arrière-plan pour ce site.' });
  }
  for (const p of report.permissions) {
    takes.push({ level: p.granted ? 'warn' : 'blocked', text: `Permission « ${p.label} » demandée — ${p.granted ? 'accordée' : 'refusée'}.` });
  }
  if (report.beacons) takes.push({ level: 'warn', text: `${report.beacons} balise(s) d’envoi en arrière-plan (sendBeacon).` });

  return {
    score,
    grade: grade(score),
    reasons,
    https,
    upgradedToHttps: report.upgradedToHttps,
    cert: report.cert,
    takes,
    blocked: report.blocked.slice(0, 80),
    blockedByCategory: Object.entries(report.blockedByCategory).map(([cat, n]) => ({ cat, label: CATEGORY_LABELS[cat] || cat, n })),
    thirdParties: thirdPartyList.slice(0, 40).map(([site, n]) => ({ site, n })),
    cookies: report.cookies,
    fingerprint: fp.map((k) => ({ kind: k, label: FINGERPRINT_LABELS[k] })),
    securityHeaders: headersPresent,
    server: report.headers.server || null,
  };
}

function safeUrl(u) {
  try { return new URL(u); } catch { return null; }
}

module.exports = { newReport, summarize, addUnique, FINGERPRINT_LABELS };
