// Histoire d'installation : Pouley la poule construit le poulailler le plus sûr
// du web pour échapper au Renard des Traqueurs. Les choix de l'utilisateur
// (IA, moteur de recherche, barre, premier poulailler) font partie du récit.
// Le poulailler reste à l'écran d'une scène à l'autre : une fois construit, il
// vit (poules qui picorent, traqueurs qui rebondissent sur le bouclier) et la
// nuit laisse place à l'aube jusqu'à l'éclosion.
(() => {
  const Sp = window.PouleySprites;
  const { SEARCH_ENGINES, AI_PROVIDERS, POULAILLER_COLORS } = window.PouleyConfig;
  const I = window.PouleyIcons;
  const B = window.PouleyBrands;
  const logoHtml = (k) => (B && B.LOGOS[k] ? B.svg(k) : '');
  const POULAILLER_ICONS = I.POULAILLER_ICONS;

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
      else if (k === 'html') e.innerHTML = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
    return e;
  }
  const sprite = (rows, cls, flip) => h('div', { class: 'sprite ' + (cls || '') + (flip ? ' flip' : ''), html: Sp.toSvg(rows) });
  const walker = (frames, cls, flip) => h('div', { class: 'walker ' + (cls || '') + (flip ? ' flip' : '') },
    h('div', { class: 'f f1', html: Sp.toSvg(frames[0]) }), h('div', { class: 'f f2', html: Sp.toSvg(frames[1]) }));
  const rand = (a, b) => a + Math.random() * (b - a);
  const LOCK = '<svg viewBox="0 0 16 16"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="#4ade80"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="#4ade80" stroke-width="2"/><rect x="7" y="9.5" width="2" height="3" fill="#0e0e10"/></svg>';
  const TRACKERS = ['pub', 'pixel espion', 'empreinte', 'cookie tiers', 'replay', 'pisteur'];
  // L'aube se lève au fil de l'histoire (0 = nuit noire, 1 = matin).
  const DAWN = [0, 0, 0.08, 0.16, 0.24, 0.34, 0.46, 1];

  function start(root, opts) {
    const choices = {
      settings: {
        ai: opts.settings.ai || 'claude',
        searchEngine: opts.settings.searchEngine || 'duckduckgo',
        sidebarPosition: opts.settings.sidebarPosition || 'left',
        sidebarAutoHide: !!opts.settings.sidebarAutoHide,
      },
      poulailler: { name: 'Perso', icon: 'poule', color: '#FFE100' },
    };
    let index = 0;
    let typing = null;
    let finished = false;
    let dawn = 0;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Minuteurs de la scène en cours (coupés au changement de scène) et du décor.
    const sceneTimers = new Set();
    const worldTimers = new Set();
    const later = (set, fn, ms) => { const t = setTimeout(() => { set.delete(t); fn(); }, ms); set.add(t); return t; };
    const every = (set, fn, ms) => { const t = setInterval(fn, ms); set.add(t); return t; };
    const clear = (set) => { for (const t of set) clearTimeout(t); set.clear(); };

    root.classList.remove('hidden');
    root.replaceChildren();

    // Décor : ciel étoilé, nuages, lune puis soleil, collines et sapins, herbe pixel.
    const sky = h('div', { class: 'ob-sky' });
    for (let i = 0; i < 90; i++) {
      sky.append(h('i', { style: {
        left: Math.random() * 100 + '%', top: Math.random() * 62 + '%',
        animationDelay: (Math.random() * 4).toFixed(2) + 's',
        width: (Math.random() < 0.15 ? 3 : 2) + 'px', height: (Math.random() < 0.15 ? 3 : 2) + 'px',
      } }));
    }
    const clouds = h('div', { class: 'ob-clouds' }, ...[0, 1, 2, 3].map((i) => h('i', { style: {
      top: 6 + i * 8 + '%', '--s': (1 - i * 0.18).toFixed(2),
      animationDuration: 110 + i * 40 + 's', animationDelay: -i * 37 + 's',
    } })));
    const hills = h('div', { class: 'ob-hills' }, h('div', { class: 'ob-trees' }, ...Array.from({ length: 14 }, (_, i) => h('i', { style: {
      left: (i / 14) * 100 + rand(-2, 2) + '%', height: rand(40, 90) + 'px', bottom: rand(40, 110) + 'px',
    } }))));
    const eyes = h('div', { class: 'ob-eyes' }, h('i'), h('i'));
    const grass = h('div', { class: 'ob-grass' }, ...Array.from({ length: 48 }, () => h('i', { style: {
      left: Math.random() * 100 + '%', animationDelay: -Math.random() * 3 + 's',
    } })));
    const fireflies = h('div', { class: 'ob-fireflies' }, ...Array.from({ length: 16 }, () => h('i', { style: {
      left: Math.random() * 100 + '%', bottom: rand(0, 180) + 'px',
      '--x': rand(-60, 60) + 'px', '--y': rand(-50, 30) + 'px',
      animationDuration: rand(4, 9).toFixed(1) + 's, ' + rand(1.5, 3.5).toFixed(1) + 's',
      animationDelay: -rand(0, 8).toFixed(1) + 's',
    } })));

    // Le poulailler, qui reste d'une scène à l'autre.
    const sign = h('div', { class: 'board' });
    const coop = h('div', { class: 'ob-coop' },
      h('div', { class: 'shield-dome' }),
      h('div', { class: 'flag' }),
      h('div', { class: 'roof' }),
      h('div', { class: 'ob-lock', title: 'HTTPS', html: LOCK }),
      h('div', { class: 'wall' },
        ...Array.from({ length: 5 }, (_, i) => h('i', { class: 'plank', style: { transitionDelay: i * 0.07 + 's' } })),
        h('div', { class: 'door' }, h('i')),
        h('div', { class: 'window' }, h('i', { class: 'scope' }))),
      h('div', { class: 'ob-zz' }, h('b', null, 'z'), h('b', null, 'z'), h('b', null, 'Z')),
      h('i', { class: 'cookie' }),
      h('div', { class: 'coop-sign' }, sign, h('i', { class: 'post' })));
    const yard = h('div', { class: 'ob-yard' });
    const world = h('div', { class: 'ob-world' }, h('div', { class: 'ob-coop-ruin' }), h('div', { class: 'ob-fence' }), coop, yard);
    const blockedEl = h('b', null, '0');
    const hud = h('div', { class: 'ob-hud' }, h('span', { class: 'ob-hud-dot' }), 'Bouclier actif · ', blockedEl, ' traqueurs repoussés');

    const stage = h('div', { class: 'ob-stage' });
    const panel = h('div', { class: 'ob-panel' });
    const dots = h('div', { class: 'ob-dots' });
    const skip = h('button', { class: 'ob-skip', onclick: () => finish() }, 'Passer l’histoire →');
    const brand = h('div', { class: 'ob-brand' }, h('span', { html: Sp.toSvg(Sp.POULE) }), 'PouleyPwolu');
    root.append(sky, h('div', { class: 'ob-dawn' }), h('div', { class: 'ob-day' }), clouds,
      h('div', { class: 'ob-moon' }), h('div', { class: 'ob-sun' }), hills, eyes, grass, fireflies,
      world, stage, hud, brand, skip, h('div', { class: 'ob-bottom' }, panel, dots));

    // Léger relief qui suit la souris.
    root.onmousemove = (e) => {
      root.style.setProperty('--px', (e.clientX / innerWidth - 0.5).toFixed(3));
      root.style.setProperty('--py', (e.clientY / innerHeight - 0.5).toFixed(3));
    };

    // Étoiles filantes, tant qu'il fait nuit.
    if (!calm) {
      every(worldTimers, () => {
        if (dawn > 0.5 || document.hidden) return;
        const s = h('i', { class: 'ob-shoot', style: { left: rand(30, 95) + '%', top: rand(3, 30) + '%' } });
        sky.append(s);
        s.addEventListener('animationend', () => s.remove());
      }, 4800);
    }

    const scenes = [sceneIntro, sceneFox, sceneBuild, sceneAi, sceneSearch, sceneSidebar, sceneCoop, sceneHatch];

    function typewrite(el, text, done) {
      clearInterval(typing);
      el.textContent = '';
      let i = 0;
      const full = () => { clearInterval(typing); typing = null; el.textContent = text; if (done) done(); };
      el.onclick = full;
      typing = setInterval(() => {
        i += 1;
        el.textContent = text.slice(0, i);
        if (i >= text.length) full();
      }, 20);
    }

    function show(i) {
      index = Math.max(0, Math.min(scenes.length - 1, i));
      clear(sceneTimers);
      dots.replaceChildren(...scenes.map((_, k) => h('i', { class: k === index ? 'on' : k < index ? 'past' : '' })));
      stage.replaceChildren();
      panel.replaceChildren();
      panel.classList.remove('wide');
      root.dataset.scene = String(index);
      dawn = DAWN[index];
      root.style.setProperty('--dawn', String(dawn));
      if (index < 2) { simStop(); coopStage(0); }
      else if (index > 2) { coopStage(6); paintSign(); simStart(); }
      scenes[index]();
    }

    function nav({ next = 'Suivant', back = index > 0, disabled = false, onNext } = {}) {
      const btnNext = h('button', { class: 'ob-btn primary', disabled, onclick: () => (onNext ? onNext() : show(index + 1)) }, next);
      return { el: h('div', { class: 'ob-nav' }, back ? h('button', { class: 'ob-btn', onclick: () => show(index - 1) }, 'Retour') : h('span'), btnNext), btnNext };
    }

    function story(text, navOpts) {
      const p = h('p', { class: 'ob-text' });
      const n = nav(navOpts);
      panel.append(p, n.el);
      typewrite(p, text);
      setTimeout(() => n.btnNext.focus(), 50);
      return n;
    }

    // ——— Le poulailler vivant ———

    // n = nombre d'étapes de construction terminées (0 à 6).
    function coopStage(n) {
      for (let k = 1; k <= 6; k++) coop.classList.toggle('b' + k, k <= n);
      world.classList.toggle('built', n > 0);
    }

    function paintSign() {
      const c = choices.poulailler;
      sign.replaceChildren(h('span', { class: 'ob-badge-ic', html: I.svg(c.icon) }), h('span', { class: 'name' }, c.name || 'Poulailler'));
      coop.style.setProperty('--c', c.color);
    }

    // Le bouclier : un dôme d'environ 150 px de rayon, posé sur 70 px de mur droit.
    function dome() {
      return { cx: coop.offsetLeft + coop.offsetWidth / 2, rx: coop.offsetWidth / 2 + 40, ry: 175, base: 69, W: world.clientWidth };
    }

    const sim = { on: false, timers: new Set(), blocked: 0 };
    function simStart() {
      if (sim.on) return;
      sim.on = true;
      hud.classList.add('on');
      for (let i = 0; i < 3; i++) addHen(i);
      if (!calm) {
        later(sim.timers, spawnTracker, 400);
        every(sim.timers, spawnTracker, 1500);
      }
    }
    function simStop() {
      sim.on = false;
      clear(sim.timers);
      yard.replaceChildren();
      hud.classList.remove('on');
      for (const e of world.querySelectorAll('.tracker, .hit')) e.remove();
    }

    // Un traqueur fonce sur le poulailler et rebondit sur le bouclier.
    function spawnTracker() {
      if (!sim.on || document.hidden) return;
      const { cx, rx, ry, base, W } = dome();
      const a = rand(12, 72) * Math.PI / 180;
      const hx = cx + rx * Math.cos(a);
      const hy = base + ry * Math.sin(a);
      const sy = Math.max(30, Math.min(270, hy + rand(-40, 90)));
      const t = h('div', { class: 'tracker' }, h('i'), TRACKERS[Math.floor(Math.random() * TRACKERS.length)]);
      world.append(t);
      const dur = rand(1900, 2700);
      const anim = t.animate([
        { transform: `translate(${W + 30}px, ${-sy}px)` },
        { transform: `translate(${hx}px, ${-hy}px)`, offset: 0.72 },
        { transform: `translate(${hx + 90 * Math.cos(a) + 30}px, ${-(hy + 90 * Math.sin(a))}px) rotate(220deg) scale(0.5)`, opacity: 0 },
      ], { duration: dur, easing: 'linear' });
      anim.onfinish = () => t.remove();
      later(sim.timers, () => {
        const ring = h('i', { class: 'hit', style: { left: hx + 'px', bottom: hy + 'px' } });
        world.append(ring);
        ring.addEventListener('animationend', () => ring.remove());
        sim.blocked += 1;
        blockedEl.textContent = String(sim.blocked);
        blockedEl.classList.remove('bump'); void blockedEl.offsetWidth; blockedEl.classList.add('bump');
      }, dur * 0.72);
    }

    // Les poules (tes onglets) se promènent devant le poulailler.
    function addHen(i) {
      const hen = walker(Sp.POULE_RUN, 'hen idle');
      const { cx } = dome();
      hen.style.left = cx - 130 + i * 90 + 'px';
      yard.append(hen);
      const wander = () => {
        if (!sim.on) return;
        const { cx } = dome();
        const from = parseFloat(hen.style.left);
        const to = cx - 150 + Math.random() * 230;
        const d = Math.max(0.4, Math.abs(to - from) / 55);
        hen.classList.toggle('flip', to > from);
        hen.classList.remove('idle', 'peck');
        hen.style.transition = `left ${d}s linear`;
        hen.style.left = to + 'px';
        later(sim.timers, () => {
          hen.classList.add('idle');
          if (Math.random() < 0.6) hen.classList.add('peck');
          later(sim.timers, wander, rand(1400, 4200));
        }, d * 1000);
      };
      later(sim.timers, wander, 500 + i * 1100);
    }

    function dust() {
      const { cx } = dome();
      for (let i = 0; i < 10; i++) {
        const d = h('i', { class: 'dust', style: { left: cx + rand(-90, 90) + 'px', '--dx': rand(-40, 40) + 'px', '--dy': rand(14, 50) + 'px', animationDelay: rand(0, 0.12) + 's' } });
        world.append(d);
        d.addEventListener('animationend', () => d.remove());
      }
    }

    // ——— Les scènes ———

    // 1 — Il était une fois
    function sceneIntro() {
      const pouley = walker(Sp.POULE_RUN, 'pouley walk-in', true);
      stage.append(pouley);
      later(sceneTimers, () => pouley.classList.add('idle'), 2300);
      story('Il était une fois, au bord d’Internet, une petite poule nommée Pouley. Elle adorait picorer le web… mais la nuit, son vieux poulailler laissait tout passer.');
    }

    // 2 — Le Renard des Traqueurs
    function sceneFox() {
      const pouley = walker(Sp.POULE_RUN, 'pouley idle scared', true);
      const fox = walker(Sp.RENARD, 'fox sneak');
      const loot = h('div', { class: 'ob-loot' },
        ...['🍪 cookies', '🖐️ empreintes', '🖱️ clics', '📍 position'].map((t, i) => h('span', { style: { animationDelay: 1.2 + i * 0.45 + 's' } }, t)));
      stage.append(pouley, fox, loot);
      story('Car chaque nuit, le Renard des Traqueurs rôdait autour des poulaillers. Il volait les cookies, copiait les empreintes et espionnait chaque clic.');
    }

    // 3 — Construction du poulailler (= l'installation)
    function sceneBuild() {
      simStop();
      coopStage(0);
      paintSign();
      const pouley = walker(Sp.POULE_RUN, 'pouley builder idle', true);
      const hammer = h('div', { class: 'hammer' });
      const fox = walker(Sp.RENARD, 'fox bounce');
      stage.append(pouley, hammer, fox);

      const steps = [
        'Murs montés : aucune télémétrie, aucune donnée ne sort',
        'Toit cadenassé : HTTPS partout, alerte si un site n’est pas chiffré',
        'Porte verrouillée : les cookies tiers restent dehors',
        'Fenêtre-vigie : détecteur de technos et de couleurs',
        'Perchoir douillet : les onglets inactifs dorment pour rester légers',
        'Bouclier anti-traqueurs : pub, pistage, empreinte, replay',
      ];
      const eggs = h('div', { class: 'ob-eggs' }, ...steps.map(() => h('span', { html: Sp.toSvg(Sp.OEUF) })));
      const list = h('ul', { class: 'ob-steps' }, ...steps.map((s) => h('li', null, h('b'), s)));
      const p = h('p', { class: 'ob-text' });
      const n = nav({ disabled: true, next: 'Construction…' });
      panel.classList.add('wide');
      panel.append(p, eggs, list, n.el);
      typewrite(p, 'Alors Pouley décida de construire le poulailler le plus sûr du web. Planche par planche, œuf par œuf…');
      let k = 0;
      const tick = every(sceneTimers, () => {
        eggs.children[k].classList.add('laid');
        list.children[k].classList.add('done');
        k += 1;
        coopStage(k);
        dust();
        const toc = h('i', { class: 'toc' }, ['toc !', 'tac !', 'boum !'][k % 3]);
        stage.append(toc);
        toc.addEventListener('animationend', () => toc.remove());
        if (k >= steps.length) {
          clearInterval(tick);
          hammer.classList.add('rest');
          fox.classList.add('repelled');
          simStart();
          n.btnNext.disabled = false;
          n.btnNext.textContent = 'Le poulailler est prêt !';
          n.btnNext.focus();
        }
      }, 900);
    }

    function cards(options, key, onPick) {
      return h('div', { class: 'ob-cards' }, ...Object.entries(options).map(([k, o]) => h('button', {
        class: 'ob-card' + (choices.settings[key] === k ? ' on' : ''),
        style: { '--c': o.color || '#FFE100' },
        onclick: (e) => {
          choices.settings[key] = k;
          for (const c of e.currentTarget.parentNode.children) c.classList.toggle('on', c === e.currentTarget);
          if (onPick) onPick(k);
        },
      }, h('span', { class: 'ob-card-logo', html: logoHtml(k) }), h('b', null, o.label), h('small', null, o.by ? `par ${o.by}` : o.note || ''))));
    }

    // 4 — Compagnon IA
    function sceneAi() {
      const pouley = walker(Sp.POULE_RUN, 'pouley side idle', true);
      const bubble = h('div', { class: 'ob-bubble' }, '?');
      const setBubble = (k) => {
        bubble.innerHTML = '';
        bubble.append(h('span', { class: 'ob-bubble-logo', html: logoHtml(k) }), AI_PROVIDERS[k].label);
      };
      stage.append(pouley, bubble);
      const p = h('p', { class: 'ob-text' });
      panel.classList.add('wide');
      panel.append(p, cards(AI_PROVIDERS, 'ai', (k) => { setBubble(k); bubble.style.setProperty('--c', AI_PROVIDERS[k].color); bubble.classList.remove('pop'); void bubble.offsetWidth; bubble.classList.add('pop'); }),
        h('p', { class: 'ob-hint' }, 'Ton IA s’ouvre dans un panneau latéral (Ctrl+E). Tape « ? » dans la barre d’adresse pour lui poser une question. Tu pourras changer plus tard.'),
        nav().el);
      typewrite(p, 'Pour l’aider à veiller, Pouley cherche un compagnon. Quelle IA veux-tu à tes côtés ?');
      setBubble(choices.settings.ai);
    }

    // 5 — Moteur de recherche
    function sceneSearch() {
      const pouley = walker(Sp.POULE_RUN, 'pouley side peck', true);
      const corn = h('div', { class: 'ob-corn' }, ...Array.from({ length: 5 }, (_, i) => h('span', { style: { left: i * 34 + 'px', animationDelay: i * 0.4 + 's' }, html: Sp.toSvg(Sp.MAIS) })));
      stage.append(corn, pouley);
      const p = h('p', { class: 'ob-text' });
      panel.classList.add('wide');
      panel.append(p, cards(SEARCH_ENGINES, 'searchEngine'),
        h('p', { class: 'ob-hint' }, '« Comet » lance tes recherches sur Perplexity, comme dans le navigateur Comet, avec un moteur classique en second choix (Ctrl+Entrée, à régler dans les Paramètres).' + (opts.cometAvailable ? ' Comet est installé : tu pourras aussi ouvrir n’importe quelle page dedans via clic droit.' : '')),
        nav().el);
      typewrite(p, 'Et pour picorer les meilleures graines du web, quel moteur de recherche ?');
    }

    // 6 — Position de la barre
    function sceneSidebar() {
      const p = h('p', { class: 'ob-text' });
      const mk = (pos, label) => h('button', {
        class: 'ob-layout' + (choices.settings.sidebarPosition === pos ? ' on' : ''),
        onclick: (e) => {
          choices.settings.sidebarPosition = pos;
          for (const c of e.currentTarget.parentNode.children) c.classList.toggle('on', c === e.currentTarget);
        },
      }, h('div', { class: 'mini ' + pos }, h('i', { class: 'bar' }), h('i', { class: 'page' })), label);
      const auto = h('label', { class: 'ob-check' }, h('input', {
        type: 'checkbox', checked: choices.settings.sidebarAutoHide,
        onchange: (e) => { choices.settings.sidebarAutoHide = e.target.checked; },
      }), 'Masquer la barre automatiquement (elle réapparaît au bord de l’écran)');
      panel.classList.add('wide');
      panel.append(p, h('div', { class: 'ob-layouts' }, mk('left', 'À gauche — comme Arc'), mk('right', 'À droite'), mk('top', 'En haut — classique')), auto, nav().el);
      typewrite(p, 'Dans un poulailler bien rangé, chaque chose a sa place. Où veux-tu la barre des onglets ?');
      stage.append(walker(Sp.POULE_RUN, 'pouley side idle', true));
    }

    // 7 — Premier poulailler : l'enseigne et le drapeau changent en direct.
    function sceneCoop() {
      const p = h('p', { class: 'ob-text' });
      const c = choices.poulailler;
      const paint = () => {
        paintSign();
        icons.style.setProperty('--c', c.color);
        sign.classList.remove('pop'); void sign.offsetWidth; sign.classList.add('pop');
      };
      const name = h('input', { class: 'ob-input', value: c.name, maxlength: '40', placeholder: 'Perso, Travail, Jeux…', oninput: (e) => { c.name = e.target.value; paint(); } });
      const icons = h('div', { class: 'ob-icons' }, ...POULAILLER_ICONS.map((i) => h('button', {
        class: c.icon === i ? 'on' : '', onclick: (e) => { c.icon = i; for (const b of icons.children) b.classList.toggle('on', b === e.currentTarget); paint(); },
      }, h('span', { html: I.svg(i) }))));
      const colors = h('div', { class: 'ob-colors' }, ...POULAILLER_COLORS.map((col) => h('button', {
        class: c.color === col ? 'on' : '', style: { background: col }, onclick: (e) => { c.color = col; for (const b of colors.children) b.classList.toggle('on', b === e.currentTarget); paint(); },
      })));
      paint();
      panel.classList.add('wide');
      panel.append(p, name, icons, colors,
        h('p', { class: 'ob-hint' }, 'Les poulaillers sont comme les Spaces d’Arc : un pour le perso, un pour le boulot… Tes connexions sont partagées entre eux (un seul compte Proton, Google…) ; tu peux isoler un poulailler dans ses réglages. Change de poulailler avec Ctrl+1, Ctrl+2…'),
        nav({ next: 'Pondre l’œuf' }).el);
      stage.append(walker(Sp.POULE_RUN, 'pouley side idle', true));
      typewrite(p, 'Il ne manque plus qu’une chose : baptiser ton premier poulailler. Regarde l’enseigne !');
      setTimeout(() => name.focus(), 60);
    }

    // 8 — Éclosion, au lever du soleil
    function sceneHatch() {
      const egg = h('div', { class: 'ob-egg' },
        h('div', { class: 'half top', html: Sp.toSvg(Sp.OEUF) }),
        h('div', { class: 'half bottom', html: Sp.toSvg(Sp.OEUF) }),
        h('div', { class: 'crack', html: '<svg viewBox="0 0 100 20" preserveAspectRatio="none"><path d="M0 10 L14 3 L26 15 L40 4 L52 16 L64 4 L76 15 L88 3 L100 10" fill="none" stroke="#0E0E10" stroke-width="3"/></svg>' }));
      const chick = sprite(Sp.POULE, 'ob-chick');
      stage.append(egg, chick);
      const p = h('p', { class: 'ob-text' });
      const n = nav({ next: 'Entrer dans le poulailler', disabled: true, onNext: finish });
      panel.append(p, n.el);
      typewrite(p, 'Crac ! Crac ! …');
      later(sceneTimers, () => egg.classList.add('cracking'), 300);
      later(sceneTimers, () => {
        egg.classList.add('open');
        chick.classList.add('out');
        feathers(stage);
        for (const hen of yard.children) hen.classList.add('cheer');
        typewrite(p, `Le soleil se lève sur PouleyPwolu ! Ton poulailler « ${choices.poulailler.name || 'Perso'} » est prêt, et le Renard peut toujours courir.`);
        n.btnNext.disabled = false;
        n.btnNext.focus();
      }, 2100);
    }

    function feathers(container) {
      const colors = ['#FFE100', '#FFF27A', '#1565D8', '#EF3E36', '#FFFFFF'];
      for (let i = 0; i < 46; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = 140 + Math.random() * 260;
        container.append(h('i', { class: 'feather', style: {
          background: colors[i % colors.length],
          '--dx': Math.cos(a) * d + 'px', '--dy': Math.sin(a) * d - 120 + 'px', '--r': (Math.random() * 720 - 360) + 'deg',
          animationDelay: Math.random() * 0.15 + 's',
        } }));
      }
    }

    function finish() {
      if (finished) return;
      finished = true;
      clearInterval(typing);
      clear(sceneTimers);
      clear(worldTimers);
      simStop();
      root.onmousemove = null;
      root.classList.add('leaving');
      setTimeout(() => {
        root.classList.add('hidden');
        root.classList.remove('leaving');
        root.replaceChildren();
        opts.onDone(choices);
      }, 650);
    }

    root.onkeydown = (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'BUTTON' && e.target.tagName !== 'INPUT') {
        const btn = panel.querySelector('.ob-btn.primary:not([disabled])');
        if (btn) btn.click();
      }
    };
    show(0);
  }

  window.PouleyOnboarding = { start };
})();
