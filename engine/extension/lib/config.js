// Moteurs de recherche et assistants IA proposés. Partagé main / interface.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PouleyConfig = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const SEARCH_ENGINES = {
    comet: { label: 'Comet (Perplexity)', url: 'https://www.perplexity.ai/search?q=%s', note: 'Recherche par IA, comme dans Comet' },
    duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', note: 'Sans pistage' },
    brave: { label: 'Brave Search', url: 'https://search.brave.com/search?q=%s', note: 'Index indépendant' },
    startpage: { label: 'Startpage', url: 'https://www.startpage.com/sp/search?query=%s', note: 'Résultats Google, anonymisés' },
    google: { label: 'Google', url: 'https://www.google.com/search?q=%s', note: 'Moins respectueux de la vie privée' },
  };

  const AI_PROVIDERS = {
    claude: { label: 'Claude', home: 'https://claude.ai/new', ask: 'https://claude.ai/new?q=%s', color: '#D97757', by: 'Anthropic' },
    chatgpt: { label: 'ChatGPT', home: 'https://chatgpt.com/', ask: 'https://chatgpt.com/?q=%s', color: '#10A37F', by: 'OpenAI' },
    comet: { label: 'Comet', home: 'https://www.perplexity.ai/', ask: 'https://www.perplexity.ai/search?q=%s', color: '#20B8CD', by: 'Perplexity' },
  };

  const POULAILLER_COLORS = ['#FFE100', '#1565D8', '#EF3E36', '#FE7146', '#3BB273', '#A66CFF', '#FF5FA2', '#2EC4B6'];

  // Recherches par mot-clé : « gh pouley » cherche sur GitHub, etc.
  const KEYWORDS = {
    gh: { label: 'GitHub', url: 'https://github.com/search?q=%s&type=repositories', logo: 'github' },
    gl: { label: 'GitLab', url: 'https://gitlab.com/search?search=%s', logo: 'gitlab' },
    npm: { label: 'npm', url: 'https://www.npmjs.com/search?q=%s', logo: 'npm' },
    mdn: { label: 'MDN', url: 'https://developer.mozilla.org/fr/search?q=%s', logo: 'mdn' },
    so: { label: 'Stack Overflow', url: 'https://stackoverflow.com/search?q=%s', logo: 'stackoverflow' },
    yt: { label: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s', logo: 'youtube' },
    w: { label: 'Wikipédia', url: 'https://fr.wikipedia.org/w/index.php?search=%s', logo: 'wikipedia' },
  };
  // « owner/repo » tout seul : probablement un dépôt GitHub
  const REPO_SHORT = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
  function keywordSearch(text) {
    const m = /^([a-z]{1,4})\s+(.+)$/i.exec(String(text || '').trim());
    if (!m) return null;
    const k = KEYWORDS[m[1].toLowerCase()];
    return k ? { key: m[1].toLowerCase(), ...k, query: m[2], target: fill(k.url, m[2]) } : null;
  }

  // Moteur personnalisé (Paramètres › Recherche) : une adresse avec %s.
  function withCustomEngine(settings) {
    const url = settings && settings.customSearchUrl;
    if (typeof url === 'string' && /^https?:\/\/\S+%s/.test(url)) {
      SEARCH_ENGINES.perso = { label: (settings.customSearchName || '').trim() || 'Mon moteur', url, note: 'Ton moteur' };
    } else {
      delete SEARCH_ENGINES.perso;
    }
  }

  function fill(template, q) {
    return template.replace('%s', encodeURIComponent(q));
  }

  return { SEARCH_ENGINES, AI_PROVIDERS, POULAILLER_COLORS, KEYWORDS, REPO_SHORT, keywordSearch, fill, withCustomEngine };
});
