// Détection des technologies d'un site, entièrement locale (façon Wappalyzer).
// Les signaux viennent des en-têtes HTTP de la page, des noms de cookies et
// d'un relevé fait dans la page (scripts, balises meta, variables globales).
//
// Chaque signature : name, cat, lang (langage associé), et des tests :
//   headers: { nom: RegExp }   cookies: [RegExp]   meta: { nom: RegExp }
//   scripts: [RegExp] (src des <script>)   html: [RegExp] (extrait du HTML)
//   globals: [nom]   (présence de window[nom], relevée dans la page)
//   version: clé de version relevée dans la page
//   implies: [noms]
const SIGNATURES = [
  // ── CMS & constructeurs de sites
  { name: 'WordPress', cat: 'CMS', lang: 'PHP', meta: { generator: /WordPress\s*([\d.]+)?/i }, cookies: [/^wordpress_/, /^wp-settings/], globals: ['wp', '@wp-local'], implies: ['PHP', 'MySQL'] },
  { name: 'WooCommerce', cat: 'E-commerce', lang: 'PHP', html: [/class=["'][^"']*\bwoocommerce\b/], scripts: [/woocommerce/], globals: ['woocommerce_params'], implies: ['WordPress'] },
  { name: 'Elementor', cat: 'Constructeur de pages', html: [/elementor-(element|widget)/], scripts: [/elementor/], globals: ['elementorFrontend'], implies: ['WordPress'] },
  { name: 'Divi', cat: 'Constructeur de pages', html: [/et_pb_/], implies: ['WordPress'] },
  { name: 'Yoast SEO', cat: 'SEO', html: [/class=["']yoast-schema-graph/], implies: ['WordPress'] },
  { name: 'Drupal', cat: 'CMS', lang: 'PHP', meta: { generator: /Drupal\s*([\d.]+)?/i }, headers: { 'x-generator': /Drupal/i, 'x-drupal-cache': /./ }, globals: ['Drupal'], implies: ['PHP'] },
  { name: 'Joomla', cat: 'CMS', lang: 'PHP', meta: { generator: /Joomla!?\s*([\d.]+)?/i }, globals: ['Joomla'], implies: ['PHP'] },
  { name: 'Ghost', cat: 'CMS', lang: 'JavaScript', meta: { generator: /Ghost\s*([\d.]+)?/i }, headers: { 'x-ghost-cache-status': /./ }, implies: ['Node.js'] },
  { name: 'PrestaShop', cat: 'E-commerce', lang: 'PHP', meta: { generator: /PrestaShop/i }, globals: ['prestashop'], cookies: [/^PrestaShop-/], implies: ['PHP'] },
  { name: 'Magento', cat: 'E-commerce', lang: 'PHP', html: [/Mage\.Cookies|mage\/cookies/], globals: ['Mage'], cookies: [/^frontend$/, /^mage-/], implies: ['PHP'] },
  { name: 'Shopify', cat: 'E-commerce', lang: 'Ruby', headers: { 'x-shopid': /./, 'x-shopify-stage': /./ }, scripts: [/cdn\.shopify\.com/], globals: ['Shopify'], cookies: [/^_shopify_/] },
  { name: 'Wix', cat: 'Constructeur de sites', meta: { generator: /Wix\.com/i }, headers: { 'x-wix-request-id': /./ }, scripts: [/static\.parastorage\.com/] },
  { name: 'Squarespace', cat: 'Constructeur de sites', scripts: [/static1?\.squarespace\.com/], globals: ['Squarespace'] },
  { name: 'Webflow', cat: 'Constructeur de sites', meta: { generator: /Webflow/i }, html: [/data-wf-page/], globals: ['Webflow'] },
  { name: 'Framer', cat: 'Constructeur de sites', meta: { generator: /Framer/i }, scripts: [/framerusercontent\.com|framer\.com\/m\//] },
  { name: 'Hugo', cat: 'Générateur statique', lang: 'Go', meta: { generator: /Hugo\s*([\d.]+)?/i } },
  { name: 'Jekyll', cat: 'Générateur statique', lang: 'Ruby', meta: { generator: /Jekyll\s*v?([\d.]+)?/i } },
  { name: 'Docusaurus', cat: 'Générateur statique', meta: { generator: /Docusaurus\s*v?([\d.]+)?/i }, implies: ['React'] },
  { name: 'Contentful', cat: 'CMS headless', html: [/ctfassets\.net/] },
  { name: 'Sanity', cat: 'CMS headless', html: [/cdn\.sanity\.io/] },
  { name: 'Strapi', cat: 'CMS headless', headers: { 'x-powered-by': /Strapi/i } },

  // ── Frameworks JavaScript
  { name: 'Next.js', cat: 'Framework web', lang: 'JavaScript', headers: { 'x-powered-by': /Next\.js/i }, html: [/(?:src|href)=["'][^"']*\/_next\/static\//], globals: ['__NEXT_DATA__', 'next'], version: 'next', implies: ['React', 'Node.js'] },
  { name: 'Nuxt', cat: 'Framework web', lang: 'JavaScript', html: [/(?:src|href)=["'][^"']*\/_nuxt\//], globals: ['__NUXT__', '$nuxt'], implies: ['Vue.js', 'Node.js'] },
  { name: 'Gatsby', cat: 'Générateur statique', lang: 'JavaScript', meta: { generator: /Gatsby\s*([\d.]+)?/i }, html: [/id="___gatsby"/], implies: ['React'] },
  { name: 'Remix', cat: 'Framework web', lang: 'JavaScript', globals: ['__remixContext', '__reactRouterContext'], implies: ['React'] },
  { name: 'Astro', cat: 'Framework web', lang: 'JavaScript', meta: { generator: /Astro\s*v?([\d.]+)?/i }, html: [/astro-island|data-astro-cid/] },
  { name: 'SvelteKit', cat: 'Framework web', lang: 'JavaScript', html: [/__sveltekit|data-sveltekit/], implies: ['Svelte'] },
  { name: 'Angular', cat: 'Framework JavaScript', lang: 'TypeScript', html: [/ng-version="([\d.]+)"/], globals: ['ng'], version: 'angular' },
  { name: 'AngularJS', cat: 'Framework JavaScript', lang: 'JavaScript', globals: ['angular'], html: [/ng-app/] },
  { name: 'React', cat: 'Framework JavaScript', lang: 'JavaScript', globals: ['React', '@react-dom'], html: [/data-reactroot/], version: 'react' },
  { name: 'Vue.js', cat: 'Framework JavaScript', lang: 'JavaScript', globals: ['Vue', '__VUE__', '@vue-app'], html: [/data-v-[0-9a-f]{8}/], version: 'vue' },
  { name: 'Svelte', cat: 'Framework JavaScript', lang: 'JavaScript', html: [/class="[^"]*svelte-[a-z0-9]{6}/] },
  { name: 'Preact', cat: 'Framework JavaScript', lang: 'JavaScript', globals: ['preact'] },
  { name: 'Ember.js', cat: 'Framework JavaScript', lang: 'JavaScript', globals: ['Ember'] },
  { name: 'Alpine.js', cat: 'Bibliothèque JavaScript', lang: 'JavaScript', globals: ['Alpine'], html: [/x-data=/] },
  { name: 'htmx', cat: 'Bibliothèque JavaScript', lang: 'JavaScript', globals: ['htmx'], html: [/hx-(get|post)=/] },
  { name: 'jQuery', cat: 'Bibliothèque JavaScript', lang: 'JavaScript', globals: ['jQuery'], scripts: [/jquery[.-]([\d.]+)?/i], version: 'jquery' },
  { name: 'Lodash', cat: 'Bibliothèque JavaScript', lang: 'JavaScript', globals: ['_.VERSION'] },
  { name: 'GSAP', cat: 'Animation', lang: 'JavaScript', globals: ['gsap', 'TweenMax'] },
  { name: 'Three.js', cat: 'Graphisme 3D', lang: 'JavaScript', globals: ['THREE'] },
  { name: 'Lottie', cat: 'Animation', globals: ['lottie', 'bodymovin'] },
  { name: 'Swiper', cat: 'Bibliothèque JavaScript', globals: ['Swiper'] },
  { name: 'Vite', cat: 'Outil de build', html: [/\/@vite\/client|type="module" crossorigin src="\/assets\/index-/] },
  { name: 'webpack', cat: 'Outil de build', globals: ['webpackJsonp', 'webpackChunk'] },

  // ── CSS
  { name: 'Tailwind CSS', cat: 'Framework CSS', html: [/class="[^"]*\b(?:flex|grid)\b[^"]*\b(?:px|py|mx|my|gap)-\d/] },
  { name: 'Bootstrap', cat: 'Framework CSS', scripts: [/bootstrap(\.bundle)?(\.min)?\.js/], html: [/bootstrap(\.min)?\.css/, /class="[^"]*\bcol-(?:md|lg|sm)-\d/], globals: ['bootstrap'] },
  { name: 'Bulma', cat: 'Framework CSS', html: [/bulma(\.min)?\.css/] },
  { name: 'Font Awesome', cat: 'Icônes', html: [/font-?awesome|fa-solid|fa-brands/i] },
  { name: 'Google Fonts', cat: 'Polices', html: [/fonts\.googleapis\.com|fonts\.gstatic\.com/] },
  { name: 'Adobe Fonts', cat: 'Polices', html: [/use\.typekit\.net/] },

  // ── Back-end & langages
  { name: 'PHP', cat: 'Langage', lang: 'PHP', headers: { 'x-powered-by': /PHP\/?([\d.]+)?/i }, cookies: [/^PHPSESSID$/] },
  { name: 'Laravel', cat: 'Framework web', lang: 'PHP', cookies: [/^laravel_session$/, /^XSRF-TOKEN$/], implies: ['PHP'] },
  { name: 'Symfony', cat: 'Framework web', lang: 'PHP', headers: { 'x-debug-token': /./ }, cookies: [/^sf_redirect$/], implies: ['PHP'] },
  { name: 'Django', cat: 'Framework web', lang: 'Python', cookies: [/^csrftoken$/, /^django_language$/], html: [/csrfmiddlewaretoken/], implies: ['Python'] },
  { name: 'Flask', cat: 'Framework web', lang: 'Python', headers: { server: /Werkzeug/i }, implies: ['Python'] },
  { name: 'Python', cat: 'Langage', lang: 'Python', headers: { server: /Python|gunicorn|uvicorn/i } },
  { name: 'Ruby on Rails', cat: 'Framework web', lang: 'Ruby', headers: { 'x-runtime': /^[\d.]+$/ }, meta: { 'csrf-param': /authenticity_token/ }, cookies: [/^_[a-z0-9_]+_session$/], implies: ['Ruby'] },
  { name: 'Ruby', cat: 'Langage', lang: 'Ruby', headers: { server: /Phusion|Puma|Passenger/i } },
  { name: 'ASP.NET', cat: 'Framework web', lang: 'C#', headers: { 'x-aspnet-version': /([\d.]+)/, 'x-powered-by': /ASP\.NET/i }, cookies: [/^ASP\.NET_SessionId$/, /^\.AspNetCore\./], html: [/__VIEWSTATE/] },
  { name: 'Java', cat: 'Langage', lang: 'Java', cookies: [/^JSESSIONID$/], headers: { 'x-powered-by': /Servlet|JSP/i } },
  { name: 'Express', cat: 'Framework web', lang: 'JavaScript', headers: { 'x-powered-by': /Express/i }, implies: ['Node.js'] },
  { name: 'Node.js', cat: 'Langage', lang: 'JavaScript' },
  { name: 'Deno', cat: 'Langage', lang: 'TypeScript', headers: { server: /deno/i, 'x-powered-by': /Deno/i, 'x-deno-ray': /./ } },
  { name: 'Hono', cat: 'Framework web', lang: 'TypeScript', headers: { 'x-powered-by': /Hono/i, 'x-hono': /./ } },
  { name: 'Bun', cat: 'Langage', lang: 'TypeScript', headers: { server: /\bbun\b/i, 'x-powered-by': /\bBun\b/i } },
  { name: 'Fastify', cat: 'Framework web', lang: 'JavaScript', headers: { 'x-powered-by': /Fastify/i, 'x-fastify': /./ }, implies: ['Node.js'] },
  { name: 'API JSON', cat: 'Backend' },
  { name: 'MySQL', cat: 'Base de données' },

  // ── Serveurs, hébergement, CDN
  { name: 'Nginx', cat: 'Serveur web', headers: { server: /nginx\/?([\d.]+)?/i } },
  { name: 'Apache', cat: 'Serveur web', headers: { server: /Apache\/?([\d.]+)?/i } },
  { name: 'LiteSpeed', cat: 'Serveur web', headers: { server: /LiteSpeed/i } },
  { name: 'Microsoft IIS', cat: 'Serveur web', headers: { server: /IIS\/?([\d.]+)?/i } },
  { name: 'Caddy', cat: 'Serveur web', headers: { server: /Caddy/i } },
  { name: 'Cloudflare', cat: 'CDN', headers: { server: /cloudflare/i, 'cf-ray': /./ } },
  { name: 'Fastly', cat: 'CDN', headers: { 'x-served-by': /cache-/i, via: /varnish/i } },
  { name: 'Amazon CloudFront', cat: 'CDN', headers: { 'x-amz-cf-id': /./ } },
  { name: 'Akamai', cat: 'CDN', headers: { 'x-akamai-transformed': /./, server: /AkamaiGHost/i } },
  { name: 'Vercel', cat: 'Hébergement', headers: { server: /Vercel/i, 'x-vercel-id': /./ } },
  { name: 'Netlify', cat: 'Hébergement', headers: { server: /Netlify/i, 'x-nf-request-id': /./ } },
  { name: 'GitHub Pages', cat: 'Hébergement', headers: { server: /GitHub\.com/i } },
  { name: 'Amazon S3', cat: 'Hébergement', headers: { server: /AmazonS3/i } },
  { name: 'Google Cloud', cat: 'Hébergement', headers: { server: /Google Frontend|gws/i } },
  { name: 'OVHcloud', cat: 'Hébergement', headers: { 'x-iplb-instance': /./ } },

  // ── Analytics, marketing, outils
  { name: 'Google Analytics', cat: 'Mesure d’audience', scripts: [/google-analytics\.com|googletagmanager\.com\/gtag/], globals: ['ga', 'gtag'] },
  { name: 'Google Tag Manager', cat: 'Gestion de tags', scripts: [/googletagmanager\.com\/gtm\.js/], globals: ['google_tag_manager'] },
  { name: 'Matomo', cat: 'Mesure d’audience', globals: ['Matomo', 'Piwik', '_paq'] },
  { name: 'Plausible', cat: 'Mesure d’audience', scripts: [/plausible\.io\/js/] },
  { name: 'Fathom', cat: 'Mesure d’audience', scripts: [/cdn\.usefathom\.com/] },
  { name: 'Umami', cat: 'Mesure d’audience', scripts: [/umami/], globals: ['umami'] },
  { name: 'Microsoft Clarity', cat: 'Enregistrement de session', scripts: [/clarity\.ms/], globals: ['clarity'] },
  { name: 'Hotjar', cat: 'Enregistrement de session', scripts: [/static\.hotjar\.com/], globals: ['hj'] },
  { name: 'Meta Pixel', cat: 'Publicité', scripts: [/connect\.facebook\.net/], globals: ['fbq'] },
  { name: 'TikTok Pixel', cat: 'Publicité', globals: ['ttq'] },
  { name: 'LinkedIn Insight', cat: 'Publicité', globals: ['_linkedin_partner_id'] },
  { name: 'HubSpot', cat: 'Marketing', scripts: [/js\.hs-scripts\.com|js\.hsforms\.net/], globals: ['_hsq'] },
  { name: 'Mailchimp', cat: 'Marketing', html: [/list-manage\.com/] },
  { name: 'Intercom', cat: 'Chat client', globals: ['Intercom'] },
  { name: 'Crisp', cat: 'Chat client', globals: ['$crisp'] },
  { name: 'Tidio', cat: 'Chat client', scripts: [/code\.tidio\.co/], globals: ['tidioChatApi'] },
  { name: 'Zendesk', cat: 'Chat client', globals: ['zE'] },
  { name: 'Stripe', cat: 'Paiement', scripts: [/js\.stripe\.com/], globals: ['Stripe'] },
  { name: 'PayPal', cat: 'Paiement', scripts: [/paypal\.com\/sdk/], globals: ['paypal'] },
  { name: 'reCAPTCHA', cat: 'Sécurité', scripts: [/recaptcha/], globals: ['grecaptcha'] },
  { name: 'hCaptcha', cat: 'Sécurité', scripts: [/hcaptcha\.com/], globals: ['hcaptcha'] },
  { name: 'Cloudflare Turnstile', cat: 'Sécurité', scripts: [/challenges\.cloudflare\.com\/turnstile/], globals: ['turnstile'] },
  { name: 'Sentry', cat: 'Suivi d’erreurs', globals: ['Sentry', '__SENTRY__'] },
  { name: 'Axeptio', cat: 'Consentement cookies', globals: ['axeptioSettings'] },
  { name: 'Didomi', cat: 'Consentement cookies', globals: ['Didomi'] },
  { name: 'OneTrust', cat: 'Consentement cookies', globals: ['OneTrust', 'OptanonWrapper'] },
  { name: 'Cookiebot', cat: 'Consentement cookies', globals: ['Cookiebot'] },
  { name: 'tarteaucitron', cat: 'Consentement cookies', globals: ['tarteaucitron'] },
  { name: 'YouTube', cat: 'Vidéo', html: [/youtube(-nocookie)?\.com\/embed/] },
  { name: 'Vimeo', cat: 'Vidéo', html: [/player\.vimeo\.com/] },
  { name: 'Google Maps', cat: 'Cartes', html: [/maps\.googleapis\.com|google\.com\/maps\/embed/] },
  { name: 'Leaflet', cat: 'Cartes', globals: ['L.version'] },
  { name: 'Firebase', cat: 'Backend as a Service', globals: ['firebase'], scripts: [/firebasejs/] },
  { name: 'Supabase', cat: 'Backend as a Service', html: [/supabase\.co/] },
];

const BY_NAME = new Map(SIGNATURES.map((s) => [s.name, s]));

function firstMatch(re, value) {
  if (value == null) return null;
  const m = re.exec(String(value));
  return m ? m[1] || true : null;
}

/**
 * @param {object} input
 * @param {Record<string,string>} input.headers  en-têtes de la réponse principale (clés en minuscules)
 * @param {string[]} input.cookies              noms des cookies
 * @param {object} input.page                    relevé fait dans la page (analyze-page.js)
 */
function detect({ headers = {}, apiHeaders = {}, apiPaths = [], cookies = [], page = {} }) {
  const found = new Map();
  const add = (name, version, why) => {
    const sig = BY_NAME.get(name);
    if (!sig) return;
    const prev = found.get(name);
    if (prev) {
      if (!prev.version && typeof version === 'string') prev.version = version;
      return;
    }
    found.set(name, { name, cat: sig.cat, lang: sig.lang || null, version: typeof version === 'string' ? version : null, why });
  };

  const html = page.html || '';
  const scripts = page.scripts || [];
  const meta = page.meta || {};
  const globals = new Set(page.globals || []);
  const versions = page.versions || {};

  for (const sig of SIGNATURES) {
    let hit = null;
    let why = '';
    if (sig.headers) {
      for (const [h, re] of Object.entries(sig.headers)) {
        const v = firstMatch(re, headers[h]);
        if (v) { hit = v; why = `en-tête ${h}`; break; }
        // même en-tête renvoyé par l'API du site (fetch / XHR)
        for (const one of apiHeaders[h] || []) {
          const w = firstMatch(re, one);
          if (w) { hit = w; why = `en-tête ${h} de l’API`; break; }
        }
        if (hit) break;
      }
    }
    if (!hit && sig.meta) {
      for (const [m, re] of Object.entries(sig.meta)) {
        const v = firstMatch(re, meta[m]);
        if (v) { hit = v; why = `balise meta ${m}`; break; }
      }
    }
    if (!hit && sig.cookies) {
      for (const re of sig.cookies) {
        if (cookies.some((c) => re.test(c))) { hit = true; why = 'cookie'; break; }
      }
    }
    if (!hit && sig.globals) {
      for (const g of sig.globals) {
        if (globals.has(g)) { hit = true; why = g === '@wp-local' ? 'fichiers /wp-content/ du site' : g.startsWith('@') ? 'structure de la page' : `variable ${g}`; break; }
      }
    }
    if (!hit && sig.scripts) {
      for (const re of sig.scripts) {
        const s = scripts.find((src) => re.test(src));
        if (s) { hit = firstMatch(re, s) || true; why = 'script chargé'; break; }
      }
    }
    if (!hit && sig.html) {
      for (const re of sig.html) {
        const v = firstMatch(re, html);
        if (v) { hit = v; why = 'code HTML'; break; }
      }
    }
    if (hit) {
      const v = sig.version && versions[sig.version] ? versions[sig.version] : hit;
      add(sig.name, typeof v === 'string' && /\d/.test(v) ? v : null, why);
    }
  }

  // Un backend séparé qui répond en JSON, même s'il ne dit pas sa techno.
  if (apiPaths.length) {
    const shown = apiPaths.slice(0, 2).join(', ') + (apiPaths.length > 2 ? '…' : '');
    found.set('API JSON', { name: 'API JSON', cat: 'Backend', lang: null, version: null, why: shown });
  }

  // Implications (WordPress => PHP, Next.js => React, …), en cascade.
  let changed = true;
  while (changed) {
    changed = false;
    for (const t of [...found.values()]) {
      const sig = BY_NAME.get(t.name);
      for (const imp of sig.implies || []) {
        if (!found.has(imp)) {
          add(imp, null, `déduit de ${t.name}`);
          changed = true;
        }
      }
    }
  }

  const techs = [...found.values()];
  const languages = [...new Set(techs.map((t) => t.lang).filter(Boolean))];
  if (page.hasTypeScriptHints && !languages.includes('TypeScript')) languages.push('TypeScript');
  if (!languages.includes('JavaScript') && scripts.length > 0) languages.push('JavaScript');
  if (!languages.includes('HTML')) languages.unshift('HTML', 'CSS');

  const byCat = {};
  for (const t of techs) (byCat[t.cat] ||= []).push(t);
  return { techs, byCat, languages };
}

// Variables globales à relever dans la page (les noms en @ sont des tests spéciaux).
const GLOBAL_PATHS = [...new Set(SIGNATURES.flatMap((s) => s.globals || []))];

const TECH_NAMES = SIGNATURES.map((s) => s.name);

export { detect, GLOBAL_PATHS, TECH_NAMES };
