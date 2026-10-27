// GitHub / GitLab (repris de src/main/main.js) : menu d'actions sur le dépôt affiché
// (cloner, VS Code, issues…), et pastilles de notifications sur les onglets : nombre
// dans le titre « (3) … », point de notification GitHub, compteur « À faire » GitLab.
import { commands, runtime, findTab, current, sendUi, scheduleBroadcast, popupMenu, openTab, snapshotExtra, ready } from './main.js';

const GH_RESERVED = new Set(['settings', 'notifications', 'orgs', 'organizations', 'marketplace', 'explore', 'topics', 'search', 'pulls', 'issues', 'login', 'logout', 'join', 'signup', 'features', 'sponsors', 'apps', 'new', 'codespaces', 'collections', 'trending', 'about', 'pricing', 'enterprise', 'dashboard', 'security', 'site', 'contact', 'readme', 'copilot', 'stars', 'watching']);

// GitLab : gitlab.com, toute instance dont le nom contient « gitlab », ou repérée par les pastilles.
const gitlabHosts = new Set();
export function parseRepo(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host === 'github.com') {
    if (parts.length < 2 || GH_RESERVED.has(parts[0].toLowerCase())) return null;
    const [owner, repo] = parts;
    const name = repo.replace(/\.git$/, '');
    return { kind: 'github', host, owner, repo: name, path: owner + '/' + name, base: 'https://github.com/' + owner + '/' + name };
  }
  if (host === 'gitlab.com' || /(^|\.)gitlab\./.test(host) || gitlabHosts.has(host)) {
    const cut = parts.indexOf('-');
    const proj = (cut >= 0 ? parts.slice(0, cut) : parts).filter((p) => !['users', 'dashboard', 'explore', 'admin', 'help', 'search'].includes(p));
    if (proj.length < 2) return null;
    const path = proj.join('/').replace(/\.git$/, '');
    return { kind: 'gitlab', host, owner: proj.slice(0, -1).join('/'), repo: proj[proj.length - 1], path, base: u.origin + '/' + path };
  }
  return null;
}

// La barre affiche le bouton du dépôt quand l'onglet affiché en est un.
Object.defineProperty(snapshotExtra, 'repo', {
  enumerable: true,
  get() { const f = current() && findTab(current()); return f ? parseRepo(f.rec.url) : null; },
});

function repoMenu() {
  const f = current() && findTab(current());
  const r = f && parseRepo(f.rec.url);
  if (!r) return;
  const gh = r.kind === 'github';
  const https = r.base + '.git';
  const ssh = 'git@' + r.host + ':' + r.path + '.git';
  const copy = (t, label) => { sendUi('clipboard', t); sendUi('toast', { text: label + ' copié' }); };
  const open = (u) => openTab({ url: u });
  popupMenu([
    { label: (gh ? 'GitHub' : 'GitLab') + ' · ' + r.path, enabled: false },
    { type: 'separator' },
    { label: 'Copier « git clone » (HTTPS)', click: () => copy('git clone ' + https, 'git clone') },
    { label: 'Copier « git clone » (SSH)', click: () => copy('git clone ' + ssh, 'git clone SSH') },
    { label: 'Copier « ' + r.path + ' »', click: () => copy(r.path, 'Nom du dépôt') },
    { type: 'separator' },
    { label: 'Cloner et ouvrir dans VS Code', click: () => open('vscode://vscode.git/clone?url=' + encodeURIComponent(https)) },
    { label: 'Cloner et ouvrir dans Cursor', click: () => open('cursor://vscode.git/clone?url=' + encodeURIComponent(https)) },
    { label: gh ? 'Éditeur web (github.dev)' : 'Web IDE GitLab', click: () => open(gh ? 'https://github.dev/' + r.path : r.base + '/-/ide/project/' + r.path + '/edit') },
    { type: 'separator' },
    { label: gh ? 'Pull requests' : 'Merge requests', click: () => open(r.base + (gh ? '/pulls' : '/-/merge_requests')) },
    { label: 'Issues', click: () => open(r.base + (gh ? '/issues' : '/-/issues')) },
    { label: gh ? 'Actions' : 'Pipelines', click: () => open(r.base + (gh ? '/actions' : '/-/pipelines')) },
    { label: gh ? 'Releases' : 'Versions (tags)', click: () => open(r.base + (gh ? '/releases' : '/-/tags')) },
    { type: 'separator' },
    { label: 'Télécharger le code (ZIP)', click: () => chrome.downloads.download({ url: gh ? r.base + '/archive/HEAD.zip' : r.base + '/-/archive/HEAD/' + r.repo + '-HEAD.zip' }) },
  ]);
}
commands['repo.menu'] = () => repoMenu();

// Pastilles : lues dans les pages déjà ouvertes, sans réseau.
function badgeRead() {
  const t = document.title || '';
  const m = /^\((\d+)\+?\)/.exec(t) || /\((\d+)\)\s*$/.exec(t) || /\((\d+)\)/.exec(t.split(/[-–|·]/)[0] || '');
  let n = m ? parseInt(m[1], 10) : 0;
  let gitlab = false;
  if (location.hostname === 'github.com' && document.querySelector('.AppHeader-button--hasIndicator, a.notification-indicator .mail-status.unread, notification-indicator [data-target$="badge"]:not([hidden]), [data-target="notification-indicator.badge"]:not([hidden])')) n = Math.max(n, -1);
  if (document.querySelector('meta[property="og:site_name"][content="GitLab"], meta[name="description"][content*="GitLab"], .gl-app, body[data-page]') && /gitlab/i.test(document.documentElement.innerHTML.slice(0, 20000))) {
    gitlab = true;
    const el = document.querySelector('.todos-count, .js-todos-count, [data-testid="todos-shortcut-button"] .gl-badge, a[href$="/dashboard/todos"] .gl-badge');
    const v = el ? parseInt((el.textContent || '').replace(/\D/g, ''), 10) : 0;
    if (v > 0) n = Math.max(n, v);
  }
  return { n: n > 999 ? 999 : n, gitlab, host: location.hostname };
}

async function pollBadges() {
  let changed = false;
  for (const rt of runtime.values()) {
    if (rt.chromeId == null || rt.loading) continue;
    let res = null;
    try { [{ result: res }] = await chrome.scripting.executeScript({ target: { tabId: rt.chromeId }, func: badgeRead }); } catch { continue; }
    if (!res) continue;
    if (res.gitlab) gitlabHosts.add(res.host);
    if ((rt.badge || 0) !== res.n) { rt.badge = res.n; changed = true; }
  }
  if (changed) scheduleBroadcast();
}
setInterval(() => { ready.then(pollBadges).catch(() => {}); }, 15000);
