// Rendu de l'inspecteur : vie privée, technologies et charte graphique.
(() => {
  function h(tag, attrs, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'style' && typeof v === 'object') {
        // Les variables CSS (--x) passent par setProperty, Object.assign les ignore.
        for (const [p, val] of Object.entries(v)) {
          if (p.startsWith('--')) e.style.setProperty(p, val);
          else e.style[p] = val;
        }
      }
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const sec = (title) => h('div', { class: 'sec' }, title);
  const hostOf = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

  // Couleur stable par nom de techno (pour les pastilles).
  const TECH_COLORS = {
    WordPress: '#21759b', React: '#61dafb', 'Next.js': '#ffffff', 'Vue.js': '#42b883', Nuxt: '#00dc82', Angular: '#dd0031',
    Svelte: '#ff3e00', jQuery: '#0769ad', PHP: '#777bb4', Shopify: '#95bf47', 'Tailwind CSS': '#38bdf8', Bootstrap: '#7952b3',
    Cloudflare: '#f38020', Nginx: '#009639', Apache: '#d22128', Vercel: '#ffffff', Netlify: '#00c7b7', Laravel: '#ff2d20',
    Django: '#0c4b33', 'Ruby on Rails': '#cc0000', 'Google Analytics': '#f9ab00', Stripe: '#635bff', Wix: '#0c6efc', Webflow: '#4353ff',
  };
  function techColor(name) {
    if (TECH_COLORS[name]) return TECH_COLORS[name];
    let x = 0;
    for (const ch of name) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${x % 360} 70% 62%)`;
  }
  const textOn = (hex) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '#111';
    const n = parseInt(m[1], 16);
    const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    return l > 0.6 ? '#111' : '#fff';
  };

  // Logo officiel de la techno (Simple Icons), sinon pastille à initiales.
  const TI = window.PouleyTechIcons || {};
  function logo(name, cls) {
    const d = TI[name];
    const c = d ? d.hex : techColor(name);
    const tile = h('span', { class: 'ico' + (cls ? ' ' + cls : '') + (d ? ' has-logo' : ''), title: name });
    tile.style.background = c;
    tile.style.color = textOn(c.startsWith('#') ? c : '#888888');
    if (d) tile.innerHTML = '<svg viewBox="0 0 24 24" class="logo" aria-hidden="true"><path fill="currentColor" d="' + d.path + '"/></svg>';
    else tile.textContent = name.replace(/[^A-Za-z0-9#+]/g, '').slice(0, 2);
    return tile;
  }

  function header(data) {
    const img = data.design && data.design.icon ? h('img', { src: data.design.icon, referrerpolicy: 'no-referrer' }) : h('span', { class: 'letter' }, hostOf(data.url)[0] || '•');
    if (img.tagName === 'IMG') img.onerror = () => img.replaceWith(h('span', { class: 'letter' }, (hostOf(data.url)[0] || '•').toUpperCase()));
    return h('div', { class: 'insp-site' }, img, h('div', { class: 't' }, h('b', null, data.title || hostOf(data.url)), h('span', null, hostOf(data.url))));
  }

  function privacy(data, ctx) {
    const p = data.privacy;
    const out = [header(data)];
    out.push(h('div', { class: 'grade-card' },
      h('div', { class: `grade g-${p.grade}` }, p.grade),
      h('div', { class: 'why' },
        h('b', null, p.grade <= 'B' ? 'Plutôt respectueux' : p.grade <= 'D' ? 'Assez curieux' : 'Très gourmand en données'),
        p.reasons.length ? p.reasons.join(' · ') : 'Rien de suspect repéré.',
        h('div', { class: 'bar' }, h('i', { style: { width: p.score + '%' } })))));

    out.push(sec('Ce que ce site récupère sur toi'));
    out.push(h('ul', { class: 'takes' }, ...p.takes.map((t) => h('li', { class: t.level }, h('span', { class: 'dot' }), h('span', null, t.text)))));

    out.push(sec('Connexion'));
    const kv = [
      'Chiffrement', p.https ? (p.upgradedToHttps ? 'HTTPS (forcé par Pouley)' : 'HTTPS') : 'Aucun — HTTP en clair',
    ];
    if (p.cert) {
      kv.push('Certificat émis par', p.cert.issuer || '—');
      if (p.cert.validExpiry) kv.push('Expire le', new Date(p.cert.validExpiry).toLocaleDateString('fr-FR'));
    }
    if (p.server) kv.push('Serveur', p.server);
    out.push(h('div', { class: 'kv' }, ...kv.map((x) => h('span', null, x))));

    out.push(sec('En-têtes de sécurité'));
    out.push(h('div', { class: 'checks' }, ...p.securityHeaders.map((x) => h('div', { class: 'check ' + (x.present ? 'ok' : 'ko'), title: x.header }, x.present ? '✓' : '○', x.label))));

    if (p.blockedByCategory.length) {
      out.push(sec(`Traqueurs bloqués (${p.blocked.length})`));
      out.push(h('div', { class: 'chips' }, ...p.blockedByCategory.map((c) => h('span', { class: 'chip blk' }, c.label, h('small', null, c.n)))));
      const byDomain = {};
      for (const b of p.blocked) byDomain[b.domain] = (byDomain[b.domain] || 0) + 1;
      out.push(h('div', { class: 'list-domains', style: { marginTop: '8px' } }, ...Object.entries(byDomain).sort((a, b) => b[1] - a[1]).map(([d, n]) => h('div', null, h('span', null, d), h('span', null, `×${n}`)))));
    }
    if (p.fingerprint.length) {
      out.push(sec('Empreinte numérique détectée'));
      out.push(h('ul', { class: 'takes' }, ...p.fingerprint.map((f) => h('li', { class: 'danger' }, h('span', { class: 'dot' }), f.label))));
    }
    if (p.thirdParties.length) {
      out.push(sec(`Domaines tiers contactés (${p.thirdParties.length})`));
      out.push(h('div', { class: 'list-domains' }, ...p.thirdParties.map((t) => h('div', null, h('span', null, t.site), h('span', null, `${t.n} req.`)))));
    }
    if (p.cookieNames && p.cookieNames.length) {
      out.push(sec(`Cookies du site (${p.cookieNames.length})`));
      out.push(h('div', { class: 'chips' }, ...p.cookieNames.map((c) => h('span', { class: 'chip' }, c))));
    }
    out.push(h('div', { class: 'row-actions' },
      h('button', { class: 'btn', onclick: () => ctx.askAi(`Que fait ce site avec mes données personnelles ? Analyse sa politique de confidentialité : ${data.url}`) }, `Demander à ${ctx.ai.label} sa politique de données`)));
    return out;
  }

  function tech(data) {
    const t = data.tech;
    const out = [header(data)];
    out.push(sec('Langages de programmation'));
    out.push(h('div', { class: 'chips' }, ...t.languages.map((l) => h('span', { class: 'chip lang' }, logo(l, 'sm'), l))));
    if (!t.techs.length) {
      out.push(h('p', { class: 'about', style: { marginTop: '16px' } }, 'Aucune technologie connue repérée — site fait main, ou bien caché derrière un CDN.'));
      return out;
    }
    const order = ['CMS', 'E-commerce', 'Constructeur de sites', 'Constructeur de pages', 'Framework web', 'Framework JavaScript', 'Générateur statique', 'Bibliothèque JavaScript', 'Framework CSS', 'Langage', 'Serveur web', 'Hébergement', 'CDN'];
    const cats = Object.keys(t.byCat).sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    });
    out.push(sec(`Technologies (${t.techs.length})`));
    for (const cat of cats) {
      out.push(h('div', { class: 'tech-cat' }, h('h4', null, cat), ...t.byCat[cat].map((x) => {
        return h('div', { class: 'tech', title: `Détecté via : ${x.why}` },
          logo(x.name),
          h('b', null, x.name), x.version ? h('span', { class: 'ver' }, x.version) : null,
          h('span', { class: 'why' }, x.why));
      })));
    }
    return out;
  }

  function design(data, ctx) {
    const d = data.design;
    const out = [header(data)];
    const copy = (text, label) => {
      navigator.clipboard.writeText(text).then(() => ctx.toast(`${label || text} copié`), () => ctx.toast('Copie impossible'));
    };
    if (!d.colors.length) {
      out.push(h('p', { class: 'about' }, 'Pas de couleurs relevées sur cette page.'));
      return out;
    }
    out.push(sec('Palette'));
    out.push(h('div', { class: 'palette-strip' }, ...d.colors.map((c) => h('i', { style: { background: c.hex, flex: String(Math.max(c.share, 0.03)) }, title: c.hex }))));
    out.push(h('div', { class: 'swatches' }, ...d.colors.map((c) => h('button', { class: 'swatch', onclick: () => copy(c.hex) },
      h('div', { class: 'c', style: { background: c.hex } }),
      h('div', { class: 'm' }, h('b', null, c.hex.toUpperCase()), h('span', null, `${c.role} · ${Math.round(c.share * 100)} %`))))));
    if (d.themeColor) {
      out.push(sec('Couleur de thème (meta)'));
      out.push(h('button', { class: 'chip', onclick: () => copy(d.themeColor) }, h('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '3px', background: d.themeColor, marginRight: '6px' } }), d.themeColor));
    }
    if (d.fonts.length) {
      out.push(sec('Typographies'));
      const headings = new Set(d.headingFonts.map((f) => f.name));
      for (const f of d.fonts) {
        out.push(h('div', { class: 'font-row' },
          h('span', { class: 'sample', style: { fontFamily: `"${f.name}", system-ui` } }, f.name),
          h('small', null, headings.has(f.name) ? 'titres + texte' : 'texte')));
      }
      for (const f of d.headingFonts) {
        if (d.fonts.some((x) => x.name === f.name)) continue;
        out.push(h('div', { class: 'font-row' }, h('span', { class: 'sample', style: { fontFamily: `"${f.name}", system-ui` } }, f.name), h('small', null, 'titres')));
      }
    }
    if (d.cssVars.length) {
      out.push(sec(`Variables CSS (${d.cssVars.length})`));
      out.push(h('div', { class: 'vars' }, ...d.cssVars.map((v) => h('div', { onclick: () => copy(`${v.name}: ${v.value};`, v.name), style: { cursor: 'pointer' } },
        h('i', { style: { background: v.value } }), v.name, h('span', null, v.value)))));
    }
    const css = ':root {\n' + d.colors.map((c, i) => `  --${c.role.normalize('NFD').replace(/[^a-z]/gi, '')}-${i + 1}: ${c.hex};`).join('\n') +
      (d.fonts[0] ? `\n  --font-texte: "${d.fonts[0].name}";` : '') + (d.headingFonts[0] ? `\n  --font-titres: "${d.headingFonts[0].name}";` : '') + '\n}';
    const json = JSON.stringify({ site: hostOf(data.url), colors: d.colors.map((c) => ({ hex: c.hex, role: c.role, share: Math.round(c.share * 1000) / 1000 })), fonts: d.fonts.map((f) => f.name), headingFonts: d.headingFonts.map((f) => f.name) }, null, 2);
    out.push(h('div', { class: 'row-actions' },
      h('button', { class: 'btn primary', onclick: () => copy(css, 'Variables CSS') }, 'Copier en CSS'),
      h('button', { class: 'btn', onclick: () => copy(json, 'JSON') }, 'Copier en JSON')));
    return out;
  }

  window.PouleyInspector = {
    render(container, data, tab, ctx) {
      container.scrollTop = 0;
      if (!data || data.error) {
        container.replaceChildren(h('div', { class: 'insp-loading' }, (data && data.error) || 'Analyse impossible.'));
        return;
      }
      if (data.internal) {
        container.replaceChildren(h('div', { class: 'insp-loading' }, 'Page interne de PouleyPwolu : rien à inspecter, rien à pister. 🐔'));
        return;
      }
      const parts = tab === 'tech' ? tech(data) : tab === 'design' ? design(data, ctx) : privacy(data, ctx);
      if (data.pageError) parts.push(h('p', { class: 'about' }, `Analyse partielle : ${data.pageError}`));
      container.replaceChildren(...parts);
    },
  };
})();
