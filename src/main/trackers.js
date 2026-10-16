// Liste embarquée de domaines traqueurs (aucune mise à jour réseau : rien ne
// sort de la machine). Un domaine bloque aussi tous ses sous-domaines.
// Catégories : ads, analytics, social, fingerprint, session (replay de session).
const TRACKERS = {
  ads: [
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'adservice.google.com',
    'adnxs.com', 'criteo.com', 'criteo.net', 'taboola.com', 'outbrain.com', 'amazon-adsystem.com',
    'adsrvr.org', 'rubiconproject.com', 'pubmatic.com', 'openx.net', 'casalemedia.com',
    'smartadserver.com', 'teads.tv', 'moatads.com', 'adform.net', 'yieldmo.com', 'bidswitch.net',
    'sharethrough.com', 'media.net', 'zemanta.com', 'quantserve.com', 'quantcount.com',
    'scorecardresearch.com', '33across.com', 'indexww.com', 'lijit.com', 'sovrn.com',
    'contextweb.com', 'serving-sys.com', 'advertising.com', 'adcolony.com', 'applovin.com',
    'unityads.unity3d.com', 'ads.yahoo.com', 'ads-twitter.com', 'ads.linkedin.com',
    'bat.bing.com', 'adroll.com', 'mathtag.com', 'demdex.net', 'everesttech.net', 'rlcdn.com',
    'agkn.com', 'bluekai.com', 'krxd.net', 'exelator.com', 'tapad.com', 'crwdcntrl.net',
    'eyeota.net', 'id5-sync.com', 'liadm.com', 'pippio.com', 'adsafeprotected.com',
    'doubleverify.com', 'ezoic.net', 'mgid.com', 'propellerads.com', 'popads.net', 'exoclick.com',
    'trafficjunky.net', 'adskeeper.com', 'revcontent.com', 'snapads.com', 'tiktokads.com',
  ],
  analytics: [
    'google-analytics.com', 'googletagmanager.com', 'analytics.google.com', 'stats.g.doubleclick.net',
    'segment.com', 'segment.io', 'cdn.segment.com', 'api.segment.io', 'mixpanel.com', 'amplitude.com',
    'heap.io', 'heapanalytics.com', 'kissmetrics.com', 'chartbeat.com', 'chartbeat.net',
    'newrelic.com', 'nr-data.net', 'omtrdc.net', '2o7.net', 'adobedtm.com', 'xiti.com', 'atinternet.com',
    'at-o.net', 'matomo.cloud', 'statcounter.com', 'clicky.com', 'woopra.com', 'pendo.io',
    'branch.io', 'app-measurement.com', 'appsflyer.com', 'adjust.com', 'kochava.com',
    'optimizely.com', 'mouseflow.com', 'crazyegg.com', 'luckyorange.com', 'clarity.ms',
    'yandex.ru/metrika', 'mc.yandex.ru', 'hs-analytics.net', 'hsadspixel.net', 'hubspot.com/analytics',
    'parsely.com', 'parse.ly', 'comscore.com', 'gemius.pl', 'mediarithmics.com', 'eulerian.net',
    'kameleoon.eu', 'abtasty.com', 'contentsquare.net', 'piano.io', 'tinypass.com', 'sentry-cdn.com',
  ],
  social: [
    'connect.facebook.net', 'facebook.com/tr', 'pixel.facebook.com', 'graph.facebook.com',
    'platform.twitter.com', 'syndication.twitter.com', 'analytics.twitter.com', 'static.ads-twitter.com',
    'snap.licdn.com', 'px.ads.linkedin.com', 'platform.linkedin.com', 'analytics.tiktok.com',
    'business-api.tiktok.com', 'ct.pinterest.com', 'pintrk', 'sc-static.net', 'tr.snapchat.com',
    'addthis.com', 'sharethis.com', 'disqus.com', 'disquscdn.com', 'reddit.com/static/pixel',
    'alb.reddit.com', 'quora.com/_/ad',
  ],
  fingerprint: [
    'fingerprintjs.com', 'fpjs.io', 'fpcdn.io', 'iovation.com', 'threatmetrix.com', 'online-metrix.net',
    'maxmind.com', 'deviceatlas.com', 'perimeterx.net', 'px-cdn.net', 'kaxsdc.com', 'sift.com',
    'siftscience.com', 'forter.com', 'riskified.com', 'seon.io', 'castle.io',
  ],
  session: [
    'hotjar.com', 'hotjar.io', 'fullstory.com', 'logrocket.com', 'lr-ingest.io', 'smartlook.com',
    'smartlook.cloud', 'inspectlet.com', 'sessioncam.com', 'quantummetric.com', 'glassbox.com',
    'decibelinsight.net', 'mouseflow.com', 'uxcam.com', 'posthog.com/s', 'clarity.ms',
  ],
};

const CATEGORY_LABELS = {
  ads: 'Publicité',
  analytics: 'Mesure d’audience',
  social: 'Réseaux sociaux',
  fingerprint: 'Empreinte numérique',
  session: 'Enregistrement de session',
};

// Index : domaine -> catégorie ; entrées avec chemin -> liste séparée.
const domainIndex = new Map();
const pathRules = [];
for (const [cat, list] of Object.entries(TRACKERS)) {
  for (const entry of list) {
    if (entry.includes('/')) pathRules.push({ needle: entry, cat });
    else if (!domainIndex.has(entry)) domainIndex.set(entry, cat);
  }
}

// Mode « standard » : on laisse passer la mesure d'audience (souvent nécessaire
// au fonctionnement), on bloque le reste.
const STANDARD_CATEGORIES = new Set(['ads', 'social', 'fingerprint', 'session']);

function classify(urlString) {
  let u;
  try {
    u = new URL(urlString);
  } catch {
    return null;
  }
  let host = u.hostname.toLowerCase();
  while (host.includes('.')) {
    const cat = domainIndex.get(host);
    if (cat) return { domain: host, category: cat };
    host = host.slice(host.indexOf('.') + 1);
  }
  const hostPath = u.hostname + u.pathname;
  for (const rule of pathRules) {
    if (hostPath.includes(rule.needle)) return { domain: rule.needle, category: rule.cat };
  }
  return null;
}

function shouldBlock(hit, level) {
  if (!hit || level === 'off') return false;
  if (level === 'strict') return true;
  return STANDARD_CATEGORIES.has(hit.category);
}

// Domaine « enregistrable » approximatif (eTLD+1) sans liste publique complète.
const TWO_LEVEL_SUFFIXES = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'com.au', 'net.au', 'co.jp', 'co.nz', 'com.br', 'com.mx',
  'co.in', 'com.tr', 'com.cn', 'gouv.fr', 'asso.fr', 'co.za', 'com.ar', 'github.io', 'vercel.app',
  'netlify.app', 'pages.dev', 'herokuapp.com', 'blogspot.com', 'web.app', 'firebaseapp.com',
]);

function siteOf(hostname) {
  if (!hostname) return '';
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return h;
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join('.');
  return lastTwo;
}

module.exports = { classify, shouldBlock, siteOf, CATEGORY_LABELS };
