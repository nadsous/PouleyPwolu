// Outils de la page dans Chromium : stylo, captures d'écran, téléchargements.
// Repris de src/main/main.js. Le stylo vit dans la page (content/pen.js, injecté à la
// demande) ; les captures sont faites par Chromium (captureVisibleTab) et enregistrées
// dans Téléchargements › PouleyPwolu.
import { store, commands, runtime, byChrome, findTab, current, sendUi, sendBar, scheduleBroadcast, popupMenu, ready } from './main.js';
import { uid } from './state.js';

const S = () => store.state.settings;
const chromeIdOf = (recId) => { const rt = runtime.get(recId); return rt && rt.chromeId != null ? rt.chromeId : null; };

// ─────────────────────────────────────────────────────────────────────────────
// Stylo

async function penToggle() {
  const recId = current();
  const chromeId = chromeIdOf(recId);
  const f = recId && findTab(recId);
  if (chromeId == null || !f || !/^https?:|^file:/.test(f.rec.url)) return sendUi('toast', { text: 'Le stylo fonctionne sur les pages web.' });
  try {
    await chrome.scripting.executeScript({ target: { tabId: chromeId }, files: ['content/pen.js'] });
    await chrome.tabs.sendMessage(chromeId, { type: 'pen.toggle', prefs: S().pen || null }, { frameId: 0 });
    // La page reçoit le clavier (Échap, Ctrl+Z…).
    chrome.tabs.update(chromeId, { active: true }).catch(() => {});
  } catch {
    sendUi('toast', { text: 'Le stylo ne peut pas écrire sur cette page.' });
  }
}

const penColor = (c) => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c : '#EF3E36');
const PEN_TOOLS = new Set(['main', 'pen', 'marker', 'arrow', 'eraser']);

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || !sender.tab || sender.id !== chrome.runtime.id) return false;
  const recId = byChrome.get(sender.tab.id);
  if (msg.type === 'pen.prefs' && msg.prefs && typeof msg.prefs === 'object') {
    const p = msg.prefs;
    const size = (n) => Math.max(1, Math.min(40, Math.round(Number(n) || 4)));
    store.state.settings.pen = {
      tool: PEN_TOOLS.has(p.tool) ? p.tool : 'pen',
      color: penColor(p.color),
      size: size(p.size),
      pens: (Array.isArray(p.pens) ? p.pens : []).slice(0, 6).map((x) => ({
        tool: ['pen', 'marker', 'arrow'].includes(x && x.tool) ? x.tool : 'pen', color: penColor(x && x.color), size: size(x && x.size),
      })),
    };
    store.save();
    return false;
  }
  if (msg.type === 'pen.state') {
    const rt = recId && runtime.get(recId);
    if (rt) { rt.penOn = !!msg.on; scheduleBroadcast(); }
    return false;
  }
  if (msg.type === 'pen.shot') {
    if (recId !== current()) { reply(false); return false; }
    takeShot(msg.mode === 'full' ? 'full' : 'visible').then(() => reply(true), () => reply(false));
    return true;
  }
  return false;
});

// ─────────────────────────────────────────────────────────────────────────────
// Captures d'écran

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Chromium accepte deux captures par seconde.
let lastCaptureAt = 0;
async function captureVisible(windowId) {
  const wait = lastCaptureAt + 520 - Date.now();
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

const bitmapOf = async (dataUrl) => createImageBitmap(await (await fetch(dataUrl)).blob());

async function toDataUrl(canvas) {
  const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return 'data:image/png;base64,' + btoa(bin);
}

const run = async (tabId, func, args = []) => (await chrome.scripting.executeScript({ target: { tabId }, func, args }))[0].result;

// Page entière : on fait défiler la page et on recolle les morceaux. Les éléments fixes
// (bandeaux, menus) ne sont gardés que sur le premier morceau.
async function captureFull(tab) {
  const m = await run(tab.id, () => {
    const el = document.scrollingElement || document.documentElement;
    return { h: Math.min(el.scrollHeight, 16000), vh: innerHeight, vw: innerWidth, x: scrollX, y: scrollY, dpr: devicePixelRatio };
  });
  const steps = Math.max(1, Math.ceil(m.h / m.vh));
  let canvas = null;
  let ctx = null;
  try {
    for (let i = 0; i < steps; i++) {
      const top = Math.min(i * m.vh, Math.max(0, m.h - m.vh));
      await run(tab.id, (y, hideFixed) => {
        scrollTo(0, y);
        if (hideFixed) {
          for (const e of document.querySelectorAll('body *')) {
            const pos = getComputedStyle(e).position;
            if ((pos === 'fixed' || pos === 'sticky') && !e.dataset.pouleyHidden) { e.dataset.pouleyHidden = e.style.visibility || '-'; e.style.visibility = 'hidden'; }
          }
        }
        return new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, [top, i > 0]);
      const bmp = await bitmapOf(await captureVisible(tab.windowId));
      const k = bmp.width / m.vw;
      if (!canvas) {
        canvas = new OffscreenCanvas(bmp.width, Math.round(m.h * k));
        ctx = canvas.getContext('2d');
      }
      ctx.drawImage(bmp, 0, Math.round(top * k));
      bmp.close();
    }
  } finally {
    await run(tab.id, (x, y) => {
      for (const e of document.querySelectorAll('[data-pouley-hidden]')) {
        e.style.visibility = e.dataset.pouleyHidden === '-' ? '' : e.dataset.pouleyHidden;
        delete e.dataset.pouleyHidden;
      }
      scrollTo(x, y);
    }, [m.x, m.y]).catch(() => {});
  }
  return canvas;
}

// Zone : un calque dans la page, on trace un rectangle (Échap pour annuler).
function pickRegion() {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.setAttribute('style', 'all:initial;position:fixed;inset:0;z-index:2147483647;cursor:crosshair;');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `<style>
      .veil{position:fixed;inset:0;background:rgba(8,8,10,.35)}
      .hint{position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:7px 14px;border-radius:999px;background:rgba(18,18,22,.92);color:#f3f3f5;font:13px system-ui,sans-serif}
      .rect{position:fixed;border:2px solid #ffe100;box-shadow:0 0 0 9999px rgba(8,8,10,.45);display:none}
      .rect::after{content:attr(data-size);position:absolute;right:0;bottom:-24px;padding:2px 7px;border-radius:6px;background:#ffe100;color:#111;font:600 11px system-ui,sans-serif}
    </style><div class="veil"></div><div class="hint">Glisse pour sélectionner une zone · Échap pour annuler</div><div class="rect"></div>`;
    const box = root.querySelector('.rect');
    const veil = root.querySelector('.veil');
    let start = null;
    let rect = null;
    const finish = (ok) => {
      removeEventListener('keydown', key, true);
      host.remove();
      // Le calque doit avoir disparu de l'écran avant la capture.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(ok && rect && rect.width > 6 && rect.height > 6 ? { rect, vw: innerWidth } : null)));
    };
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); } };
    host.addEventListener('pointerdown', (e) => { start = { x: e.clientX, y: e.clientY }; host.setPointerCapture(e.pointerId); });
    host.addEventListener('pointermove', (e) => {
      if (!start) return;
      rect = { x: Math.min(start.x, e.clientX), y: Math.min(start.y, e.clientY), width: Math.abs(e.clientX - start.x), height: Math.abs(e.clientY - start.y) };
      veil.style.display = 'none';
      Object.assign(box.style, { display: 'block', left: rect.x + 'px', top: rect.y + 'px', width: rect.width + 'px', height: rect.height + 'px' });
      box.dataset.size = `${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    });
    host.addEventListener('pointerup', () => finish(true));
    addEventListener('keydown', key, true);
    document.documentElement.append(host);
  });
}

async function crop(dataUrl, { rect, vw }) {
  const bmp = await bitmapOf(dataUrl);
  const k = bmp.width / vw;
  const x = Math.max(0, Math.round(rect.x * k));
  const y = Math.max(0, Math.round(rect.y * k));
  const w = Math.max(1, Math.min(bmp.width - x, Math.round(rect.width * k)));
  const h = Math.max(1, Math.min(bmp.height - y, Math.round(rect.height * k)));
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext('2d').drawImage(bmp, x, y, w, h, 0, 0, w, h);
  bmp.close();
  return canvas;
}

// Copie dans le presse-papiers : par la barre (qui vient d'être cliquée) ou par la page.
const clipWaiters = new Map();
async function copyImage(dataUrl, tabId) {
  const id = uid('clip');
  const viaBar = new Promise((resolve) => {
    clipWaiters.set(id, resolve);
    setTimeout(() => { if (clipWaiters.delete(id)) resolve(false); }, 1500);
  });
  sendBar('clipboard-image', { id, dataUrl });
  if (await viaBar) return true;
  try {
    return await run(tabId, async (url) => {
      try {
        const blob = await (await fetch(url)).blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch { return false; }
    }, [dataUrl]);
  } catch { return false; }
}

const shots = new Map(); // id de capture -> id de téléchargement Chromium

// Enregistrement : une adresse data: de plus de 2 Mo ne se télécharge pas ; la barre
// en fait un fichier (blob) et le télécharge elle-même.
const saveWaiters = new Map();
async function saveImage(dataUrl, filename) {
  if (dataUrl.length < 1900000) {
    return chrome.downloads.download({ url: dataUrl, filename, conflictAction: 'uniquify', saveAs: false }).catch(() => null);
  }
  const id = uid('save');
  const done = new Promise((resolve) => {
    saveWaiters.set(id, resolve);
    setTimeout(() => { if (saveWaiters.delete(id)) resolve(null); }, 20000);
  });
  if (!sendBar('save-image', { id, dataUrl, filename })) { saveWaiters.delete(id); return null; }
  return done;
}

async function takeShot(mode) {
  const recId = current();
  const f = recId && findTab(recId);
  const chromeId = chromeIdOf(recId);
  if (!f || chromeId == null) return null;
  const tab = await chrome.tabs.get(chromeId).catch(() => null);
  if (!tab) return null;
  let canvas = null;
  let dataUrl = null;
  try {
    if (mode === 'full') canvas = await captureFull(tab);
    else if (mode === 'region') {
      const zone = await run(chromeId, pickRegion);
      if (!zone) return null;
      canvas = await crop(await captureVisible(tab.windowId), zone);
    } else dataUrl = await captureVisible(tab.windowId);
    if (canvas) dataUrl = await toDataUrl(canvas);
  } catch (err) {
    console.warn('[capture]', err);
  }
  if (!dataUrl) return sendUi('toast', { text: 'Capture impossible sur cette page.' });
  const bmp = await bitmapOf(dataUrl);
  const { width, height } = bmp;
  bmp.close();

  let host = 'page';
  try { host = new URL(f.rec.url).hostname.replace(/^www\./, '') || 'pouley'; } catch {}
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
  const name = `${host.replace(/[^a-z0-9.-]/gi, '_')}_${stamp}.png`;
  const copied = await copyImage(dataUrl, chromeId);
  const id = uid('shot');
  const downloadId = await saveImage(dataUrl, `PouleyPwolu/Captures/${name}`);
  shots.set(id, downloadId);
  sendUi('shot:done', { id, name, width, height, mode, copied });
  return { id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Téléchargements : annoncés dans la barre (Chromium n'a plus de barre d'outils où
// afficher les siens).

const active = new Map(); // id Chromium -> dernière info envoyée
const baseName = (p) => String(p || '').split(/[\\/]/).pop() || 'telechargement';

function announce(item) {
  const info = {
    id: 'dl' + item.id, name: baseName(item.filename), received: item.bytesReceived, total: item.totalBytes > 0 ? item.totalBytes : 0,
    state: item.state === 'complete' ? 'completed' : item.state === 'interrupted' ? (item.error === 'USER_CANCELED' ? 'cancelled' : 'interrupted') : 'progressing',
  };
  active.set(item.id, info);
  sendUi('download', info);
}

let pollTimer = null;
function poll() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const items = await chrome.downloads.search({ state: 'in_progress' });
    for (const it of items) if (active.has(it.id)) announce(it);
    if (!items.length) { clearInterval(pollTimer); pollTimer = null; }
  }, 1000);
}

chrome.downloads.onCreated.addListener((item) => {
  // Captures d'écran : déjà annoncées par « shot:done ».
  const src = item.url || item.finalUrl || '';
  if (src.startsWith('data:image/png') || src.startsWith('blob:' + chrome.runtime.getURL(''))) return;
  active.set(item.id, null);
  if (item.filename) announce(item);
  poll();
});
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!active.has(delta.id)) return;
  if (!delta.filename && !delta.state && !delta.error) return;
  const [item] = await chrome.downloads.search({ id: delta.id });
  if (!item || !item.filename) return;
  announce(item);
  if (item.state !== 'in_progress') active.delete(item.id);
});

const downloadIdOf = (id) => {
  if (shots.has(id)) return shots.get(id);
  const m = /^dl(\d+)$/.exec(String(id));
  return m ? Number(m[1]) : null;
};

Object.assign(commands, {
  'pen.toggle': () => penToggle(),
  'shot.capture': (a = {}) => takeShot(a.mode === 'full' ? 'full' : a.mode === 'region' ? 'region' : 'visible'),
  'shot.region': () => takeShot('region'),
  'shot.cancel': () => null,
  'shot.menu': () => {
    if (current() == null) return;
    popupMenu([
      { label: 'Capturer la zone visible', sublabel: 'Ctrl+Maj+S', click: () => takeShot('visible') },
      { label: 'Capturer la page entière', click: () => takeShot('full') },
      { label: 'Sélectionner une zone…', sublabel: 'Ctrl+Maj+X', click: () => takeShot('region') },
      { label: 'Écrire sur la page, puis capturer…', sublabel: 'Ctrl+Maj+D', click: () => penToggle() },
      { type: 'separator' },
      { label: 'Ouvrir le dossier des téléchargements', click: () => chrome.downloads.showDefaultFolder() },
    ]);
  },
  'save.result': ({ id, downloadId } = {}) => {
    const resolve = saveWaiters.get(id);
    if (resolve) { saveWaiters.delete(id); resolve(downloadId ?? null); }
  },
  'clip.result': ({ id, ok } = {}) => {
    const resolve = clipWaiters.get(id);
    if (resolve) { clipWaiters.delete(id); resolve(!!ok); }
  },
  'download.show': (id) => { const n = downloadIdOf(id); if (n != null) chrome.downloads.show(n); },
  'download.open': (id) => { const n = downloadIdOf(id); if (n != null) chrome.downloads.open(n); },
});

// Raccourcis clavier de Chromium (manifest « commands »).
chrome.commands.onCommand.addListener(async (name) => {
  await ready;
  if (name === 'capture') takeShot('visible');
  else if (name === 'capture-zone') takeShot('region');
  else if (name === 'stylo') penToggle();
  else if (name === 'inspecteur') commands['inspector.toggle']({});
});
