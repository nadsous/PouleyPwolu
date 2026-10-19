// Détecteur d'IA, entièrement local : rien n'est envoyé à un service.
//  - Images : on cherche les signatures que laissent les générateurs (Content
//    Credentials C2PA, champ IPTC « média créé par un algorithme », paramètres
//    de Stable Diffusion / ComfyUI, nom de l'outil dans les métadonnées, adresse
//    d'un service de génération). Une image sans signature n'est pas pour autant
//    une vraie photo : les réseaux sociaux effacent souvent ces données.
//  - Texte : des indices de style (formules typiques, phrases trop régulières,
//    restes de mise en forme, caractères invisibles…) combinés en un score.
//    Ce sont des indices, pas une preuve.
const zlib = require('zlib');

// ───────────────────────────────────────────── images

const GENERATORS = [
  ['Midjourney', /midjourney/i],
  ['DALL·E', /dall[-·.\s]?e\b/i],
  ['OpenAI (ChatGPT, Sora)', /openai|chatgpt|gpt-4o|\bsora\b/i],
  ['Stable Diffusion', /stable[\s-]?diffusion|\bsdxl\b|automatic1111|invokeai|fooocus|Steps: \d+, Sampler: /i],
  ['ComfyUI', /comfyui|"class_type"\s*:/i],
  ['Adobe Firefly', /firefly/i],
  ['Google (Imagen, Gemini)', /google imagen|imagen [234]|synthid|\bgemini\b/i],
  ['Flux', /black[\s-]?forest[\s-]?labs|flux\.1|flux[-_](dev|pro|schnell)/i],
  ['Leonardo.ai', /leonardo\.ai/i],
  ['Ideogram', /ideogram/i],
  ['NovelAI', /novelai/i],
  ['Grok (xAI)', /\bgrok\b|xai aurora/i],
  ['Microsoft Designer', /bing image creator|microsoft designer/i],
];

const AI_HOSTS = [
  [/oaidalleapiprodscus\.blob\.core\.windows\.net|(^|\.)openai\.com$/i, 'OpenAI (DALL·E, ChatGPT)'],
  [/(^|\.)midjourney\.com$/i, 'Midjourney'],
  [/(^|\.)civitai\.com$/i, 'Civitai (Stable Diffusion)'],
  [/(^|\.)lexica\.art$/i, 'Lexica (Stable Diffusion)'],
  [/(^|\.)leonardo\.ai$/i, 'Leonardo.ai'],
  [/(^|\.)ideogram\.ai$/i, 'Ideogram'],
  [/(^|\.)pollinations\.ai$/i, 'Pollinations'],
  [/(^|\.)replicate\.delivery$/i, 'Replicate'],
  [/(^|\.)nightcafe\.studio$/i, 'NightCafe'],
  [/(^|\.)playgroundai\.com$/i, 'Playground AI'],
];

const CAMERAS = /\b(Canon|NIKON|Nikon|SONY|FUJIFILM|OLYMPUS|Panasonic|LEICA|RICOH|PENTAX|GoPro|DJI|Apple iPhone|iPhone \d+|SAMSUNG|SM-[A-Z]\d{3}|Pixel \d+|HUAWEI|Xiaomi|OnePlus)\b/;

// Les zones de métadonnées du fichier, en texte (le reste, ce sont des pixels).
function metadataText(buf) {
  const parts = [];
  // JPEG : segments APPn (EXIF, XMP, C2PA) et commentaires, jusqu'aux pixels.
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 4 < buf.length && buf[i] === 0xff) {
      const marker = buf[i + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const len = buf.readUInt16BE(i + 2);
      if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) parts.push(buf.subarray(i + 4, i + 2 + len));
      i += 2 + len;
    }
    return { kind: 'jpeg', text: Buffer.concat(parts).toString('latin1') };
  }
  // PNG : tous les morceaux sauf les pixels (les textes zTXt/iTXt sont parfois compressés).
  if (buf.length > 8 && buf.toString('latin1', 1, 4) === 'PNG') {
    let i = 8;
    while (i + 12 <= buf.length) {
      const len = buf.readUInt32BE(i);
      const type = buf.toString('latin1', i + 4, i + 8);
      const data = buf.subarray(i + 8, i + 8 + len);
      if (type !== 'IDAT') {
        parts.push(data);
        const nul = data.indexOf(0);
        if (type === 'zTXt' && nul > 0) { try { parts.push(zlib.inflateSync(data.subarray(nul + 2))); } catch {} }
        if (type === 'iTXt' && nul > 0 && data[nul + 1] === 1) {
          let j = nul + 3; // après le drapeau et la méthode : langue\0 mot-clé traduit\0 texte
          for (let z = 0; z < 2; z++) j = data.indexOf(0, j) + 1;
          try { parts.push(zlib.inflateSync(data.subarray(j))); } catch {}
        }
      }
      if (type === 'IEND') break;
      i += 12 + len;
    }
    return { kind: 'png', text: Buffer.concat(parts).toString('latin1') };
  }
  // WebP : morceaux EXIF et XMP.
  if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    let i = 12;
    while (i + 8 <= buf.length) {
      const type = buf.toString('latin1', i, i + 4);
      const len = buf.readUInt32LE(i + 4);
      if (type !== 'VP8 ' && type !== 'VP8L' && type !== 'ANMF') parts.push(buf.subarray(i + 8, i + 8 + len));
      i += 8 + len + (len % 2);
    }
    return { kind: 'webp', text: Buffer.concat(parts).toString('latin1') };
  }
  // Autres formats (AVIF, HEIC…) : les métadonnées sont au début du fichier.
  return { kind: 'autre', text: buf.subarray(0, 512 * 1024).toString('latin1') };
}

function analyzeImage(buf, url, { alt = '' } = {}) {
  const signals = [];
  let verdict = 'inconnu';
  let tool = null;
  const strong = (text) => { signals.push({ kind: 'preuve', text }); verdict = 'ia'; };
  const hint = (text) => { signals.push({ kind: 'indice', text }); if (verdict !== 'ia') verdict = 'indice'; };

  const meta = buf ? metadataText(buf) : { kind: 'inconnu', text: '' };
  const m = meta.text;
  if (/compositeWithTrainedAlgorithmicMedia/.test(m)) strong('Marquée « retouchée avec l’IA » (norme IPTC).');
  else if (/trainedAlgorithmicMedia/.test(m)) strong('Marquée « créée par une IA » (norme IPTC).');
  if (/c2pa/i.test(m) && /jumb/i.test(m)) {
    const gen = /claim_generator(?:_info)?[\s\S]{0,6}?([\x20-\x7e]{3,80})/.exec(m);
    signals.push({ kind: 'info', text: 'Contient des « Content Credentials » (C2PA)' + (gen ? ` signés par « ${gen[1].trim()} »` : '') + '.' });
  }
  if (/Steps: \d+, Sampler: /.test(m)) strong('Contient les réglages de génération de Stable Diffusion (prompt, sampler, steps).');
  if (/"class_type"\s*:/.test(m)) strong('Contient le flux de génération ComfyUI.');
  for (const [name, re] of GENERATORS) {
    if (re.test(m)) {
      tool = tool || name;
      if (verdict !== 'ia') strong(`Le nom de l’outil ${name} figure dans les métadonnées.`);
    }
  }

  let host = '';
  let file = '';
  try { const u = new URL(url); host = u.hostname; file = decodeURIComponent(u.pathname.split('/').pop() || ''); } catch {}
  for (const [re, name] of AI_HOSTS) if (re.test(host)) { tool = tool || name; hint(`Hébergée par un service de génération d’images (${name}).`); }
  if (/dall[-·]?e|midjourney|chatgpt image|stable.?diffusion|comfyui|_upscaled|firefly/i.test(file)) hint(`Le nom du fichier évoque un générateur (« ${file.slice(0, 60)} »).`);
  if (/(généré|générée|créé|créée|generated|made|created) (par|avec|by|with) (l['’])?(ia|ai|intelligence artificielle|midjourney|dall)|\bai[- ]generated\b|\bimage ia\b/i.test(alt)) {
    hint('La légende de l’image dit qu’elle a été générée par IA.');
  }

  if (verdict === 'inconnu' && meta.kind === 'jpeg' && /Exif\0\0/.test(m)) {
    const cam = CAMERAS.exec(m);
    if (cam) {
      verdict = 'appareil';
      signals.push({ kind: 'info', text: `Les métadonnées indiquent un appareil photo (${cam[1]}). Ça se falsifie, mais c’est bon signe.` });
    }
  }
  if (!signals.length) signals.push({ kind: 'info', text: 'Aucune signature trouvée. Ça ne prouve pas que c’est une vraie photo : beaucoup de sites effacent ces informations.' });
  return { verdict, tool, signals, format: meta.kind };
}

// ───────────────────────────────────────────── textes

// [motif, explication, poids]. Les poids s'additionnent par occurrence (plafonnés plus bas).
const MARKERS = [
  [/il est (important|essentiel|crucial|primordial) de (noter|souligner|comprendre|rappeler)/gi, '« il est important de noter »', 7],
  [/\ben (conclusion|résumé|somme|définitive)\b/gi, '« en conclusion / en résumé »', 4],
  [/\bplongeons\b|\bplongeons dans\b|\bplonger dans l['’]univers/gi, '« plongeons dans… »', 7],
  [/(monde|paysage|univers) (numérique )?(en constante évolution|en perpétuelle évolution|d['’]aujourd['’]hui)/gi, '« dans un monde en constante évolution »', 7],
  [/n['’]hésitez pas à/gi, '« n’hésitez pas à »', 4],
  [/(véritable|vrai|réel) (pilier|atout|levier|tremplin|catalyseur)/gi, '« un véritable atout / levier »', 5],
  [/une (multitude|myriade|pléthore) de/gi, '« une multitude de »', 4],
  [/\b(tapisserie|symphonie|mosaïque|kaléidoscope) (de|d['’])/gi, 'métaphore pompeuse (« une tapisserie de… »)', 6],
  [/non seulement [^.]{1,90} mais (aussi|également)/gi, '« non seulement… mais aussi »', 3],
  [/\b(incontournable|fascinant|crucial|essentiel|primordial|optimiser|favoriser|renforcer|révolutionner)\b/gi, 'vocabulaire « brochure » (crucial, essentiel, optimiser…)', 1.2],
  [/\bdelv(e|es|ing)\b/gi, '« delve »', 7],
  [/it['’]?s (important|worth|crucial|essential) (to note|noting|to remember)/gi, '« it’s important to note »', 7],
  [/\bin (conclusion|summary)\b/gi, '« in conclusion »', 4],
  [/\b(tapestry|testament to|ever-evolving|ever-changing|fast-paced world|navigate the complexities)\b/gi, 'formules typiques (tapestry, ever-evolving…)', 6],
  [/\b(pivotal|seamless(ly)?|robust|leverage|underscore[sd]?|showcas(e|es|ing)|realm|landscape|holistic|multifaceted)\b/gi, 'vocabulaire « brochure » (pivotal, seamless, leverage…)', 1.2],
  [/not only [^.]{1,90} but also/gi, '« not only… but also »', 3],
  [/here['’]?s (a|an|the) (breakdown|overview|quick)/gi, '« here’s a breakdown »', 5],
];
// Phrases d'assistant laissées par un copier-coller : très parlant.
const ADMISSIONS = [
  /en tant qu['’](ia|intelligence artificielle|assistant|modèle de langage)/gi,
  /\bas an ai( language model)?\b/gi,
  /j['’]espère que (cela|ces informations|ça) (vous|t['’]|te) (aide|aidera|sera|seront)/gi,
  /\bi hope this helps\b/gi,
  /\b(certainly|absolutely|great question)!/gi,
  /(voici|here is) (une version|a revised|an improved|une proposition) /gi,
  /\b(je ne peux pas|i can(not|['’]t)) (naviguer|browse|accéder à internet)/gi,
];
const INFORMAL = /\b(mdr|ptdr|lol|jsp|jpp|wesh|chui|chuis|j['’]sais|tkt|bcp|stp|svp|ouais|bah|genre,|lmao|idk|tbh|gonna|wanna|kinda)\b|!!|\?\?|\.\.\.(?!\S)/gi;
const INVISIBLE = /[​‌‍⁠﻿]/g;

function words(text) { return text.match(/[\p{L}\p{N}'’-]+/gu) || []; }

function analyzeText(raw) {
  const text = String(raw || '').replace(/\r/g, '').slice(0, 40000);
  const w = words(text);
  const n = w.length;
  const per1k = (count) => (count * 1000) / Math.max(n, 1);
  const signals = [];
  let score = 22;
  const add = (points, label) => { score += points; signals.push({ points: Math.round(points), text: label }); };

  const fr = (text.match(/\b(le|la|les|des|est|une|que|pour|dans|avec)\b/gi) || []).length;
  const en = (text.match(/\b(the|and|is|are|of|to|with|that|for|this)\b/gi) || []).length;
  const lang = fr >= en ? 'fr' : 'en';

  let admissions = 0;
  for (const re of ADMISSIONS) admissions += (text.match(re) || []).length;
  if (admissions) add(Math.min(50, admissions * 30), 'Phrase d’assistant IA restée dans le texte (« en tant qu’IA », « j’espère que cela vous aide »…)');

  let markerPts = 0;
  const found = [];
  for (const [re, label, weight] of MARKERS) {
    const c = (text.match(re) || []).length;
    if (!c) continue;
    markerPts += c * weight;
    found.push(label);
  }
  // Rapporté à la longueur : 3 formules dans 2 000 mots, c'est moins parlant que dans 200.
  markerPts = Math.min(36, markerPts * Math.min(1.6, Math.max(0.5, 400 / Math.max(n, 1))));
  if (markerPts >= 3) add(markerPts, 'Formules typiques des IA : ' + found.slice(0, 4).join(', '));

  // Régularité : les IA écrivent des phrases de longueur très semblable.
  const sentences = text.split(/(?<=[.!?…])\s+|\n+/).map((s) => words(s).length).filter((x) => x >= 3);
  if (sentences.length >= 6) {
    const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length;
    const sd = Math.sqrt(sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length);
    const cv = sd / mean;
    if (cv < 0.32) add(18, 'Phrases de longueur très régulière (peu de variation)');
    else if (cv < 0.42) add(9, 'Phrases de longueur assez régulière');
    else if (cv > 0.75) add(-12, 'Phrases très variées, comme à l’écrit humain');
  }

  const dashes = (text.match(/—/g) || []).length;
  if (n > 80 && per1k(dashes) > 5) add(per1k(dashes) > 10 ? 14 : 8, `Beaucoup de tirets longs « — » (${dashes})`);

  const md = (text.match(/\*\*[^*\n]{2,60}\*\*|^#{1,4} |^\s*[-*] \*\*/gm) || []).length;
  if (md) add(Math.min(14, 5 + md * 2), 'Restes de mise en forme Markdown (**gras**, ### titres)');

  const inv = (text.match(INVISIBLE) || []).length;
  if (inv) add(16, `${inv} caractère${inv > 1 ? 's' : ''} invisible${inv > 1 ? 's' : ''} (possible filigrane ou copier-coller d’un chat)`);
  if (lang === 'en' && / /.test(text)) add(10, 'Espaces fines insécables dans un texte anglais (fréquent dans les réponses de ChatGPT)');

  const informal = (text.match(INFORMAL) || []).length;
  if (informal) add(-Math.min(22, 6 + informal * 4), 'Langage familier ou ponctuation spontanée (mdr, !!, …)');
  const starts = text.split(/(?<=[.!?])\s+/).filter((s) => /^\p{L}/u.test(s));
  const lower = starts.filter((s) => /^\p{Ll}/u.test(s)).length;
  if (starts.length >= 5 && lower / starts.length > 0.3) add(-12, 'Phrases qui commencent sans majuscule');

  score = Math.max(3, Math.min(97, Math.round(score)));
  // Moins de 40 mots : pas assez pour se prononcer.
  const level = n < 40 ? 'court' : score >= 65 ? 'ia' : score >= 40 ? 'incertain' : 'humain';
  if (!signals.length) signals.push({ points: 0, text: 'Aucun indice marquant dans un sens ou dans l’autre.' });
  return { score, level, words: n, short: n < 80, lang, signals };
}

module.exports = { analyzeImage, analyzeText, metadataText };
