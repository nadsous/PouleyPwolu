// Fonction exécutée DANS la page inspectée (monde principal), à la demande de
// l'utilisateur. Elle ne fait aucune requête réseau : elle lit le DOM et
// renvoie un relevé (technos, charte graphique, formulaires, stockage).
async function pouleyAnalyze(globalPaths) {
  const out = {};

  // ── Signaux pour la détection de technologies
  out.scripts = [...document.scripts].map((s) => s.src).filter(Boolean).slice(0, 300);
  const metas = {};
  for (const m of document.querySelectorAll('meta[name], meta[property]')) {
    const k = (m.getAttribute('name') || m.getAttribute('property') || '').toLowerCase();
    if (k && !(k in metas)) metas[k] = m.getAttribute('content') || '';
  }
  out.meta = metas;
  const html = document.documentElement.outerHTML;
  out.html = html.length > 400000 ? html.slice(0, 200000) + html.slice(-100000) : html;

  const has = (p) => {
    try {
      let o = window;
      for (const part of p.split('.')) {
        if (o == null) return false;
        o = o[part];
      }
      return o !== undefined;
    } catch {
      return false;
    }
  };
  const globals = globalPaths.filter((p) => !p.startsWith('@') && has(p));
  const sample = [...document.querySelectorAll('body, body > *, #root, #app, #__next, [data-reactroot]')].slice(0, 40);
  for (const el of sample) {
    const keys = Object.keys(el);
    if (keys.some((k) => k.startsWith('__reactFiber') || k.startsWith('__reactContainer') || k === '_reactRootContainer')) globals.push('@react-dom');
    if (el.__vue_app__ || el.__vue__) globals.push('@vue-app');
  }
  // WordPress : seuls les fichiers /wp-content/ ou /wp-includes/ servis par le
  // site lui-même comptent (pas les images d'un blog WordPress tiers affichées ici).
  const siteOf = (h) => h.split('.').slice(-2).join('.');
  const here = siteOf(location.hostname);
  for (const el of document.querySelectorAll('[src*="/wp-"], [href*="/wp-"]')) {
    const raw = el.getAttribute('src') || el.getAttribute('href') || '';
    try {
      const u = new URL(raw, location.href);
      // CDN de WordPress (Jetpack) : i0.wp.com/<site>/wp-content/… désigne <site>
      const cdn = /^i\d\.wp\.com$/.test(u.hostname) ? (u.pathname.split('/')[1] || '') : '';
      const owner = cdn || u.hostname;
      if (/\/wp-(content|includes)\//.test(u.pathname) && siteOf(owner) === here) { globals.push('@wp-local'); break; }
    } catch {}
  }
  out.globals = [...new Set(globals)];

  const versions = {};
  try { if (window.jQuery && jQuery.fn) versions.jquery = jQuery.fn.jquery; } catch {}
  try { if (window.React && React.version) versions.react = React.version; } catch {}
  try { if (window.Vue && Vue.version) versions.vue = Vue.version; } catch {}
  try { const ng = document.querySelector('[ng-version]'); if (ng) versions.angular = ng.getAttribute('ng-version'); } catch {}
  try { if (window.next && next.version) versions.next = next.version; } catch {}
  out.versions = versions;
  out.hasTypeScriptHints = out.scripts.some((s) => /\.tsx?(\?|$)/.test(s));

  // ── Charte graphique : couleurs pondérées par surface / quantité de texte
  const toHex = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c);
    if (!m) return null;
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    if (a < 0.15 || [r, g, b].some((v) => Number.isNaN(v))) return null;
    return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const bucket = new Map();
  const addColor = (hex, weight, role) => {
    if (!hex) return;
    const e = bucket.get(hex) || { hex, weight: 0, roles: {} };
    e.weight += weight;
    e.roles[role] = (e.roles[role] || 0) + weight;
    bucket.set(hex, e);
  };
  const fonts = new Map();
  const headingFonts = new Map();
  const vw = innerWidth;
  const vh = Math.max(innerHeight, 1);
  const els = document.querySelectorAll('body, body *');
  const limit = Math.min(els.length, 3500);
  for (let i = 0; i < limit; i++) {
    const el = els[i];
    const tag = el.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'META' || tag === 'LINK') continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    const area = Math.min(r.width, vw) * Math.min(r.height, vh * 3);
    if (area <= 0) continue;
    addColor(toHex(cs.backgroundColor), area / 1000, 'fond');
    let text = 0;
    for (const n of el.childNodes) if (n.nodeType === 3) text += n.textContent.trim().length;
    if (text > 0) {
      addColor(toHex(cs.color), text * 2, 'texte');
      const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
      fonts.set(fam, (fonts.get(fam) || 0) + text);
      if (/^H[1-3]$/.test(tag)) headingFonts.set(fam, (headingFonts.get(fam) || 0) + text);
    }
    if (cs.borderTopWidth !== '0px' && cs.borderTopStyle !== 'none') addColor(toHex(cs.borderTopColor), (r.width + r.height) / 40, 'bordure');
    if (tag === 'A' || tag === 'BUTTON' || el.getAttribute('role') === 'button') {
      addColor(toHex(cs.backgroundColor), 40, 'action');
      addColor(toHex(cs.color), 20, 'action');
    }
    if (el instanceof SVGElement) {
      addColor(toHex(cs.fill), 15, 'icône');
    }
  }
  // Fusion des teintes très proches
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const dist = (a, b) => { const x = rgb(a), y = rgb(b); return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]); };
  const sorted = [...bucket.values()].sort((a, b) => b.weight - a.weight);
  const merged = [];
  for (const c of sorted) {
    const near = merged.find((m) => dist(m.hex, c.hex) < 14);
    if (near) {
      near.weight += c.weight;
      for (const [k, v] of Object.entries(c.roles)) near.roles[k] = (near.roles[k] || 0) + v;
    } else merged.push({ ...c, roles: { ...c.roles } });
  }
  const total = merged.reduce((s, c) => s + c.weight, 0) || 1;
  out.colors = merged.slice(0, 14).map((c) => ({
    hex: c.hex,
    share: c.weight / total,
    role: Object.entries(c.roles).sort((a, b) => b[1] - a[1])[0][0],
  }));

  // Variables CSS de couleur déclarées sur :root (feuilles de style accessibles)
  const vars = [];
  const rootStyle = getComputedStyle(document.documentElement);
  try {
    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; }
      for (const rule of rules || []) {
        if (!rule.selectorText || !/(^|,)\s*(:root|html)\b/.test(rule.selectorText)) continue;
        for (const prop of rule.style) {
          if (!prop.startsWith('--')) continue;
          const val = rootStyle.getPropertyValue(prop).trim();
          if (/^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|oklch\()/i.test(val)) vars.push({ name: prop, value: val });
        }
        if (vars.length > 60) break;
      }
    }
  } catch {}
  out.cssVars = vars.slice(0, 60);

  const topFonts = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, w]) => ({ name, weight: w }));
  out.fonts = topFonts(fonts);
  out.headingFonts = topFonts(headingFonts);
  out.themeColor = metas['theme-color'] || null;
  const icon = document.querySelector('link[rel~="icon"], link[rel="apple-touch-icon"]');
  out.icon = icon ? icon.href : null;
  out.icons = [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')]
    .map((l) => ({ href: l.href, sizes: l.getAttribute('sizes') || '', type: l.type || '', rel: l.rel }))
    .filter((l) => /^https?:|^data:image\//.test(l.href))
    .slice(0, 12);
  out.title = document.title;

  // ── Données que les formulaires demandent
  const fields = new Set();
  let insecureForm = false;
  for (const input of document.querySelectorAll('input, select, textarea')) {
    const t = (input.type || '').toLowerCase();
    const hint = `${input.name || ''} ${input.id || ''} ${input.autocomplete || ''} ${input.placeholder || ''}`.toLowerCase();
    if (t === 'hidden') continue;
    if (t === 'password') fields.add('mot de passe');
    if (t === 'email' || /e-?mail|courriel/.test(hint)) fields.add('adresse e-mail');
    if (t === 'tel' || /phone|t[ée]l[ée]phone|mobile/.test(hint)) fields.add('numéro de téléphone');
    if (/cc-|card|carte|cvc|cvv/.test(hint)) fields.add('carte bancaire');
    if (/address|adresse|street|postal|zip|city|ville/.test(hint)) fields.add('adresse postale');
    if (/bday|birth|naissance/.test(hint) || t === 'date' && /birth|naiss/.test(hint)) fields.add('date de naissance');
    if (/given-name|family-name|name|nom|pr[ée]nom/.test(hint) && t !== 'search') fields.add('nom');
    if (t === 'file') fields.add('fichiers');
    if (/iban|bic|siret|ssn|s[ée]cu/.test(hint)) fields.add('données administratives');
  }
  for (const f of document.forms) {
    if (f.action && f.action.startsWith('http:')) insecureForm = true;
  }
  out.formFields = [...fields];
  out.insecureForm = insecureForm || (location.protocol === 'http:' && fields.has('mot de passe'));

  // ── Stockage local utilisé par le site
  const storage = {};
  try { storage.localStorage = localStorage.length; } catch { storage.localStorage = 0; }
  try { storage.sessionStorage = sessionStorage.length; } catch { storage.sessionStorage = 0; }
  try { storage.jsCookies = document.cookie ? document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean) : []; } catch { storage.jsCookies = []; }
  try { storage.indexedDB = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []; } catch { storage.indexedDB = []; }
  try { storage.serviceWorker = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length > 0 : false; } catch { storage.serviceWorker = false; }
  out.storage = storage;

  out.iframes = [...document.querySelectorAll('iframe[src]')]
    .map((f) => { try { return new URL(f.src).hostname; } catch { return null; } })
    .filter(Boolean)
    .slice(0, 30);
  return out;
}

// Chromium : passée telle quelle à chrome.scripting.executeScript (monde principal).
export { pouleyAnalyze };
