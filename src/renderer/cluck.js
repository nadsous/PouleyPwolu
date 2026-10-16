// Cris de poule synthétisés (Web Audio) pour les notifications.
// Pas de fichier son : chaque « cot » est une onde riche en harmoniques dont la
// hauteur monte puis retombe, filtrée par deux formants (la « voix » de la
// poule), avec un souffle de bruit à l'attaque.
(() => {
  let ctx = null;
  let noise = null;

  function audio() {
    if (!ctx) {
      ctx = new AudioContext();
      // Une seconde de bruit blanc, réutilisée pour l'attaque de chaque note.
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // Une note de poule. t0 : départ, dur : durée, f : [début, sommet, fin] en Hz.
  function cot(out, t0, dur, f, gain) {
    const a = ctx;
    const osc = a.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f[0], t0);
    osc.frequency.linearRampToValueAtTime(f[1], t0 + dur * 0.3);
    osc.frequency.exponentialRampToValueAtTime(f[2], t0 + dur);
    // Petit vibrato : le cri n'est jamais parfaitement stable.
    const vib = a.createOscillator();
    const vibGain = a.createGain();
    vib.frequency.value = 38;
    vibGain.gain.value = f[1] * 0.025;
    vib.connect(vibGain).connect(osc.frequency);

    const f1 = a.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = 1050;
    f1.Q.value = 3.2;
    const f2 = a.createBiquadFilter();
    f2.type = 'bandpass';
    f2.frequency.value = 2600;
    f2.Q.value = 5;
    const f2Gain = a.createGain();
    f2Gain.gain.value = 0.45;

    const env = a.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    env.gain.setValueAtTime(gain, t0 + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(f1).connect(env);
    osc.connect(f2).connect(f2Gain).connect(env);

    // Souffle à l'attaque (le « k » de « cot »).
    const n = a.createBufferSource();
    n.buffer = noise;
    const nf = a.createBiquadFilter();
    nf.type = 'highpass';
    nf.frequency.value = 1800;
    const ng = a.createGain();
    ng.gain.setValueAtTime(gain * 0.5, t0);
    ng.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.035);
    n.connect(nf).connect(ng).connect(out);

    env.connect(out);
    osc.start(t0); vib.start(t0); n.start(t0, Math.random() * 0.5);
    osc.stop(t0 + dur + 0.02); vib.stop(t0 + dur + 0.02); n.stop(t0 + 0.05);
  }

  // « Plop » d'un œuf qui tombe dans la paille.
  function plop(out, t0, gain) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(140, t0 + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    osc.connect(env).connect(out);
    osc.start(t0);
    osc.stop(t0 + 0.18);
  }

  const jitter = (v, p = 0.06) => v * (1 + (Math.random() * 2 - 1) * p);

  const PATTERNS = {
    // Une note brève : info.
    cot(out, t) {
      cot(out, t, 0.11, [jitter(430), jitter(620), 380], 0.5);
    },
    // « Cot cot codêêt » : alerte de confidentialité.
    alerte(out, t) {
      cot(out, t, 0.09, [jitter(450), jitter(640), 400], 0.5);
      cot(out, t + 0.14, 0.09, [jitter(450), jitter(660), 400], 0.5);
      cot(out, t + 0.3, 0.08, [jitter(480), jitter(700), 430], 0.45);
      cot(out, t + 0.42, 0.34, [jitter(520), jitter(980), 460], 0.6);
    },
    // « Cot cot » + plop : téléchargement terminé (l'œuf est pondu).
    oeuf(out, t) {
      cot(out, t, 0.09, [jitter(440), jitter(630), 390], 0.45);
      cot(out, t + 0.15, 0.2, [jitter(470), jitter(820), 420], 0.5);
      plop(out, t + 0.42, 0.55);
    },
    // Notification d'un site : deux notes interrogatives.
    notif(out, t) {
      cot(out, t, 0.1, [jitter(440), jitter(620), 400], 0.5);
      cot(out, t + 0.16, 0.18, [jitter(460), jitter(760), 640], 0.5);
    },
  };

  let last = 0;
  function play(kind = 'cot', volume = 0.6) {
    const now = performance.now();
    if (now - last < 350) return; // pas de basse-cour en rafale
    last = now;
    try {
      const a = audio();
      const master = a.createGain();
      master.gain.value = Math.max(0, Math.min(1, volume));
      master.connect(a.destination);
      (PATTERNS[kind] || PATTERNS.cot)(master, a.currentTime + 0.02);
    } catch (err) {
      console.warn('[cluck]', err);
    }
  }

  window.PouleySound = { play, kinds: Object.keys(PATTERNS) };
})();
