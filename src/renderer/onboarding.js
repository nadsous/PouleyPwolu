// Histoire d'installation : Pouley la poule construit le poulailler le plus sûr
// du web pour échapper au Renard des Traqueurs. Les choix de l'utilisateur
// (IA, moteur de recherche, barre, premier poulailler) font partie du récit.
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

    root.classList.remove('hidden');
    root.replaceChildren();

    // Décor : ciel étoilé, lune, collines, herbe pixel
    const sky = h('div', { class: 'ob-sky' });
    for (let i = 0; i < 70; i++) {
      sky.append(h('i', { style: {
        left: Math.random() * 100 + '%', top: Math.random() * 62 + '%',
        animationDelay: (Math.random() * 4).toFixed(2) + 's',
        width: (Math.random() < 0.15 ? 3 : 2) + 'px', height: (Math.random() < 0.15 ? 3 : 2) + 'px',
      } }));
    }
    const moon = h('div', { class: 'ob-moon' });
    const hills = h('div', { class: 'ob-hills' });
    const grass = h('div', { class: 'ob-grass' });
    const stage = h('div', { class: 'ob-stage' });
    const panel = h('div', { class: 'ob-panel' });
    const dots = h('div', { class: 'ob-dots' });
    const skip = h('button', { class: 'ob-skip', onclick: () => finish() }, 'Passer l’histoire →');
    const brand = h('div', { class: 'ob-brand' }, h('span', { html: Sp.toSvg(Sp.POULE) }), 'PouleyPwolu');
    root.append(sky, moon, hills, grass, stage, brand, skip, h('div', { class: 'ob-bottom' }, panel, dots));

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
      dots.replaceChildren(...scenes.map((_, k) => h('i', { class: k === index ? 'on' : k < index ? 'past' : '' })));
      stage.replaceChildren();
      panel.replaceChildren();
      panel.classList.remove('wide');
      root.dataset.scene = String(index);
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

    // 1 — Il était une fois
    function sceneIntro() {
      const pouley = walker(Sp.POULE_RUN, 'pouley walk-in', true);
      stage.append(h('div', { class: 'ob-coop-ruin' }), pouley);
      setTimeout(() => pouley.classList.add('idle'), 2300);
      story('Il était une fois, au bord d’Internet, une petite poule nommée Pouley. Elle adorait picorer le web… mais elle n’était jamais tranquille.');
    }

    // 2 — Le Renard des Traqueurs
    function sceneFox() {
      const pouley = walker(Sp.POULE_RUN, 'pouley idle scared', true);
      const fox = walker(Sp.RENARD, 'fox sneak');
      const loot = h('div', { class: 'ob-loot' },
        ...['🍪 cookies', '🖐️ empreintes', '🖱️ clics', '📍 position'].map((t, i) => h('span', { style: { animationDelay: 0.6 + i * 0.35 + 's' } }, t)));
      stage.append(pouley, fox, loot);
      story('Car chaque nuit, le Renard des Traqueurs rôdait autour des poulaillers. Il volait les cookies, copiait les empreintes et espionnait chaque clic.');
    }

    // 3 — Construction du poulailler (= l'installation)
    function sceneBuild() {
      const coop = h('div', { class: 'ob-coop' },
        h('div', { class: 'roof' }), h('div', { class: 'wall' }, h('div', { class: 'door' }), h('div', { class: 'window' })),
        h('div', { class: 'shield-dome' }));
      const pouley = walker(Sp.POULE_RUN, 'pouley builder', true);
      const fox = walker(Sp.RENARD, 'fox bounce');
      stage.append(coop, pouley, fox);

      const steps = [
        'Bouclier anti-traqueurs posé (pub, pistage, empreinte, replay)',
        'Toute télémétrie débranchée — aucune donnée ne sort',
        'HTTPS partout, avec alerte si un site n’est pas chiffré',
        'Cookies tiers laissés à la porte',
        'Détecteur de technos et de couleurs installé',
        'Mise en veille des onglets pour rester léger',
      ];
      const eggs = h('div', { class: 'ob-eggs' }, ...steps.map(() => h('span', { html: Sp.toSvg(Sp.OEUF) })));
      const list = h('ul', { class: 'ob-steps' }, ...steps.map((s) => h('li', null, h('b'), s)));
      const p = h('p', { class: 'ob-text' });
      const n = nav({ disabled: true, next: 'Construction…' });
      panel.classList.add('wide');
      panel.append(p, eggs, list, n.el);
      typewrite(p, 'Alors Pouley décida de construire le poulailler le plus sûr du web. Brique par brique, œuf par œuf…');
      let k = 0;
      const tick = setInterval(() => {
        if (!root.isConnected || root.dataset.scene !== '2') return clearInterval(tick);
        eggs.children[k].classList.add('laid');
        list.children[k].classList.add('done');
        coop.dataset.stage = String(k + 1);
        k += 1;
        if (k >= steps.length) {
          clearInterval(tick);
          fox.classList.add('repelled');
          n.btnNext.disabled = false;
          n.btnNext.textContent = 'Le poulailler est prêt !';
          n.btnNext.focus();
        }
      }, 650);
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
      const pouley = walker(Sp.POULE_RUN, 'pouley idle', true);
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
      const cur = AI_PROVIDERS[choices.settings.ai];
      setBubble(choices.settings.ai);
    }

    // 5 — Moteur de recherche
    function sceneSearch() {
      const pouley = walker(Sp.POULE_RUN, 'pouley peck', true);
      const corn = h('div', { class: 'ob-corn' }, ...Array.from({ length: 5 }, (_, i) => h('span', { style: { left: i * 34 + 'px', animationDelay: i * 0.4 + 's' }, html: Sp.toSvg(Sp.MAIS) })));
      stage.append(corn, pouley);
      const p = h('p', { class: 'ob-text' });
      panel.classList.add('wide');
      panel.append(p, cards(SEARCH_ENGINES, 'searchEngine'),
        h('p', { class: 'ob-hint' }, '« Comet » lance tes recherches sur Perplexity, comme dans le navigateur Comet.' + (opts.cometAvailable ? ' Comet est installé : tu pourras aussi ouvrir n’importe quelle page dedans via clic droit.' : '')),
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
      stage.append(walker(Sp.POULE_RUN, 'pouley idle', true));
    }

    // 7 — Premier poulailler
    function sceneCoop() {
      const p = h('p', { class: 'ob-text' });
      const c = choices.poulailler;
      const preview = h('div', { class: 'ob-coop-badge' });
      const paint = () => {
        preview.replaceChildren(h('span', { class: 'ob-badge-ic', html: I.svg(c.icon) }), c.name || 'Poulailler');
        preview.style.setProperty('--c', c.color);
        icons.style.setProperty('--c', c.color);
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
        h('p', { class: 'ob-hint' }, 'Les poulaillers sont comme les Spaces d’Arc : un pour le perso, un pour le boulot… Chacun garde ses propres cookies. Change de poulailler avec Ctrl+1, Ctrl+2…'),
        nav({ next: 'Pondre l’œuf' }).el);
      stage.append(preview);
      typewrite(p, 'Il ne manque plus qu’une chose : baptiser ton premier poulailler.');
      setTimeout(() => name.focus(), 60);
    }

    // 8 — Éclosion
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
      setTimeout(() => egg.classList.add('cracking'), 300);
      setTimeout(() => {
        egg.classList.add('open');
        chick.classList.add('out');
        feathers(stage);
        typewrite(p, `Bienvenue dans PouleyPwolu ! Ton poulailler « ${choices.poulailler.name || 'Perso'} » est prêt, et le Renard peut toujours courir.`);
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
