// Sound department — synthesis engines for the effects of THE BIG ONE.
// Generic engines (tex, tone, grains, impact, splash, boil, whale, friction) follow LEVIATHAN (MIT);
// the cartoon pieces (plip, bloop, gulp, pomf, beep, ratchet, gull, slap) are new.
import { SR, TAU, SVF, Noise, Drift, Rng, panGains, ping, bubble, pws, clamp, smooth, noiseBurst } from './audio-dsp.js';

export const K = (keys) => (t) => pws(keys, t);

// ---- tex: filtered stereo noise with f(t), g(t), pan(t) in film seconds
// o: { t0, t1, seed, color w|p|b, mode lp|bp|hp, f, q, g, pan, width 0..1, send, hp }
export function tex(G, o) {
  const N = G.dry.n, i0 = Math.max(0, Math.round(o.t0 * SR)), i1 = Math.min(N, Math.round(o.t1 * SR));
  const a = new Noise(o.seed ?? 1), b = new Noise((o.seed ?? 1) + 7717);
  const color = o.color ?? 'p', mode = o.mode ?? 'lp', q = o.q ?? 0.7, w = o.width ?? 0.8, send = o.send ?? 0.2;
  const src = color === 'w' ? (n) => n.white() : color === 'b' ? (n) => n.brown() : (n) => n.pink();
  const f = typeof o.f === 'function' ? o.f : () => o.f, g = typeof o.g === 'function' ? o.g : () => o.g ?? 1, pan = o.pan;
  const fa = new SVF(f(o.t0), q), fb = new SVF(f(o.t0), q), hpa = o.hp ? new SVF(o.hp, 0.7) : null, hpb = o.hp ? new SVF(o.hp, 0.7) : null;
  let gl = 0, gr = 0, dl = 0, dr = 0;
  const dL = G.dry.L, dR = G.dry.R, sL = G.send.L, sR = G.send.R, fadeN = Math.round(0.004 * SR);
  for (let i = i0; i < i1; i++) {
    if (((i - i0) & 63) === 0) {
      const t = i / SR, fc = f(t + 32 / SR), v = g(t + 64 / SR) * Math.SQRT2;
      fa.set(fc, q); fb.set(fc, q);
      const [pl, pr] = panGains(pan ? pan(t) : 0);
      dl = (v * pl - gl) / 64; dr = (v * pr - gr) / 64;
    }
    const x = src(a), y = x * (1 - w) + src(b) * w;
    fa.run(x); fb.run(y);
    let vL = mode === 'lp' ? fa.lp : mode === 'hp' ? fa.hp : fa.bp, vR = mode === 'lp' ? fb.lp : mode === 'hp' ? fb.hp : fb.bp;
    if (hpa) { hpa.run(vL); hpb.run(vR); vL = hpa.hp; vR = hpb.hp; }
    gl += dl; gr += dr;
    const end = i1 - i < fadeN ? (i1 - i) / fadeN : 1, l = vL * gl * end, r = vR * gr * end;
    dL[i] += l; dR[i] += r;
    if (send) { sL[i] += l * send; sR[i] += r * send; }
  }
}

// ---- tone: a pitch contour through a harmonic table (whines, chirps, gulps)
export function tone(G, o) {
  const N = G.dry.n, i0 = Math.max(0, Math.round(o.t0 * SR)), i1 = Math.min(N, Math.round(o.t1 * SR)), H = o.h ?? [1];
  const f = o.f, g = o.g, pan = o.pan, send = o.send ?? 0.25, dr = new Drift(o.seed ?? 3, 7), jit = o.jit ?? 0, am = o.am ?? 0, amHz = o.amHz ?? 40;
  let ph = 0, gl = 0, gr = 0, dl = 0, dg = 0, ff = f(o.t0);
  const fadeN = Math.round(0.004 * SR);
  for (let i = i0; i < i1; i++) {
    if (((i - i0) & 31) === 0) {
      const t = i / SR, v = g(t + 32 / SR) * Math.SQRT2, [pl, pr] = panGains(pan ? pan(t) : 0);
      ff = f(t) * (1 + jit * dr.at(t)); dl = (v * pl - gl) / 32; dg = (v * pr - gr) / 32;
    }
    ph += ff / SR; ph -= Math.floor(ph);
    let s = 0; for (let h = 0; h < H.length; h++) if (ff * (h + 1) < SR * 0.42) s += H[h] * Math.sin(TAU * (h + 1) * ph);
    if (am) s *= 1 - am * (0.5 + 0.5 * Math.sin(TAU * amHz * i / SR));
    gl += dl; gr += dg;
    const end = i1 - i < fadeN ? (i1 - i) / fadeN : 1, a = s * gl * end, b = s * gr * end;
    G.dry.L[i] += a; G.dry.R[i] += b; G.send.L[i] += a * send; G.send.R[i] += b * send;
  }
}

// ---- grains: a random event cloud. density(t) per second; ev(mono, at, rng, t, pan, panGain)
export function grains(t0, t1, density, ev, seed, tail = 0.5) {
  const len = Math.ceil((t1 - t0 + tail) * SR), L = new Float32Array(len), R = new Float32Array(len), r = new Rng(seed);
  let t = t0;
  const dmax = (t) => Math.max(0.05, density(t));
  while (t < t1) {
    const d = dmax(t); t += -Math.log(1 - r.next() * 0.9999) / d;
    if (t >= t1) break;
    const pan = r.range(-1, 1), [gl, gr] = panGains(pan * 0.8), at = Math.round((t - t0) * SR), s = r.next() < gl * gl ? L : R;
    ev(s, at, r, t, pan, s === L ? gl : gr);
  }
  return { L, R, t0 };
}
export function putGr(G, g, o = {}) {
  const gain = o.gain ?? 1, send = o.send ?? 0.25, s0 = Math.round(g.t0 * SR), n = G.dry.n;
  for (let i = Math.max(0, -s0); i < Math.min(g.L.length, n - s0); i++) {
    const a = g.L[i] * gain, b = g.R[i] * gain, j = s0 + i;
    G.dry.L[j] += a; G.dry.R[j] += b; G.send.L[j] += a * send; G.send.R[j] += b * send;
  }
}
export function put1(G, t0, sig, o = {}) {
  const g = o.gain ?? 1, [gl, gr] = panGains(o.pan ?? 0), send = o.send ?? 0.2, s0 = Math.round(t0 * SR), n = G.dry.n;
  for (let i = Math.max(0, -s0); i < Math.min(sig.length, n - s0); i++) {
    const v = sig[i] * g, j = s0 + i, a = v * gl, b = v * gr;
    G.dry.L[j] += a; G.dry.R[j] += b; G.send.L[j] += a * send; G.send.R[j] += b * send;
  }
}

// ---- impact: sub drop + body + crack. size 0..1.5 is how far the world moves
export function impact(G, t, o = {}) {
  const size = o.size ?? 1, seed = o.seed ?? 1, pan = o.pan ?? 0, dur = o.dur ?? (0.8 + 2.0 * size), len = Math.ceil(dur * SR), out = new Float32Array(len);
  const nz = new Noise(seed), lo = new SVF(o.body ?? 340, 0.7), hi = new SVF(o.crack ?? 2600, 0.7), f1 = Math.max(34, o.f1 ?? 40), f0 = o.f0 ?? 120, tau = o.tau ?? (0.3 + 0.45 * size);
  const D = (x) => Math.exp(-1 / (x * SR)), kf = D(0.07), ke = D(tau), kb = D(o.bodyT ?? (0.1 + 0.22 * size)), kc = D(o.crackT ?? 0.012);
  const nN = Math.min(len, Math.round(((o.bodyT ?? (0.1 + 0.22 * size)) * 9) * SR)), fo = Math.round(0.05 * SR), cA = o.crackA ?? 0.8, sub = o.sub ?? 1, drv = 1 + size;
  let p = 0, ef = 1, ee = 1, eb = 1, ec = 1;
  for (let i = 0; i < len; i++) {
    const tt = i / SR, f = f1 + (f0 - f1) * ef; p += f / SR; if (p > 1) p -= 1;
    const e = ee * (tt < 0.002 ? tt / 0.002 : 1);
    let body = 0, crack = 0;
    if (i < nN) { const w = nz.white(); lo.run(w); hi.run(w); body = lo.lp * 2.4 * eb; crack = hi.hp * cA * ec; }
    out[i] = (Math.tanh((Math.sin(TAU * p) * 1.4 * e * sub + body) * drv) * 0.5 * size + crack * size) * (i > len - fo ? (len - i) / fo : 1);
    ef *= kf; ee *= ke; eb *= kb; ec *= kc;
  }
  put1(G, t, out, { gain: o.gain ?? 1, pan, send: o.send ?? 0.3 });
}

// ---- splash: the thump, the sheet, and the rain falling back
export function splash(G, t, o = {}) {
  const size = o.size ?? 1, seed = o.seed ?? 2, pan = o.pan ?? 0, d = 0.4 + 1.6 * size, P = () => pan, g = o.gain ?? 1;
  impact(G, t, { size: 0.28 * size, f0: 90, f1: 42, crack: 1500, crackT: 0.02, seed, pan, gain: g * (o.thump ?? 1), send: 0.2 });
  tex(G, { t0: t, t1: t + d, seed: seed + 1, color: 'w', mode: 'bp', q: 0.6, f: (x) => (o.hi ?? 2600) - ((o.hi ?? 2600) * 0.7) * Math.min(1, (x - t) / d), g: (x) => g * 0.5 * size * Math.exp(-(x - t) / (d * 0.26)) * Math.min(1, (x - t) / 0.012), pan: P, send: 0.3 });
  tex(G, { t0: t + 0.08, t1: t + d * 1.3, seed: seed + 2, color: 'w', mode: 'hp', f: 3200, g: (x) => g * 0.12 * size * Math.sin(Math.PI * clamp((x - t - 0.08) / (d * 1.2))), pan: P, width: 1, send: 0.3 });
}

// ---- bubble clouds
export function boil(G, t0, t1, density, o = {}) {
  const lo = o.lo ?? 160, hi = o.hi ?? 900, amp = o.amp ?? ((t) => 1);
  const g = grains(t0, t1, density, (s, at, r, t) => bubble(s, at, lo * Math.pow(hi / lo, r.next()), r.range(0.02, 0.09) * amp(t), r.range(0.05, o.rise ?? 0.2)), o.seed ?? 6, 0.4);
  putGr(G, g, { gain: o.gain ?? 1, send: o.send ?? 0.3 });
}

// ---- whale: a gliding voice with a rough throat and formants. contour [[t, Hz]], levels [[t, g]]
export function whale(contour, levels, o = {}, seed = 1) {
  const dur = contour[contour.length - 1][0], len = Math.ceil((dur + 0.3) * SR), out = new Float32Array(len), dr = new Drift(seed, 5), gr = new Drift(seed + 1, 34), nz = new Noise(seed + 2);
  const F = [new SVF(o.f1 ?? 340, 2.4), new SVF(o.f2 ?? 880, 3.2), new SVF(o.f3 ?? 1900, 3.4)];
  const rough = o.rough ?? 0.5, fo = Math.round(0.02 * SR);
  let ph = 0, f = contour[0][1], a = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 31) === 0) { f = pws(contour, t) * (1 + 0.012 * dr.at(t) + (o.wob ?? 0.006) * Math.sin(TAU * 5.3 * t)); a = pws(levels, t); }
    ph += f / SR; ph -= Math.floor(ph);
    const b = 0.35 + 0.65 * a;
    let s = Math.sin(TAU * ph) + 0.55 * b * Math.sin(2 * TAU * ph + 0.4) + 0.32 * b * Math.sin(3 * TAU * ph + 1.1) + 0.18 * b * b * Math.sin(4 * TAU * ph) + 0.1 * b * b * Math.sin(5 * TAU * ph + 2);
    s *= 1 + rough * b * gr.at(t);
    const w = 0.05 * b * nz.white();
    F[0].run(s + w); F[1].run(s + w); F[2].run(s + w);
    out[i] = (s * 0.42 + F[0].bp * 0.5 + F[1].bp * 0.5 + F[2].bp * 0.26) * a * (o.gain ?? 0.34) * (i > len - fo ? (len - i) / fo : 1);
  }
  return out;
}

// ---- friction: stick-slip pulses through resonant modes. Wood creaks, groans.
export function friction(dur, o, seed = 1) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), r = new Rng(seed), dr = new Drift(seed, o.jitHz ?? 17), jit = o.jit ?? 0.45;
  const M = o.modes.map(([f, q, a]) => { const rr = Math.exp(-Math.PI * f / (q * SR)); return { c1: 2 * rr * Math.cos(TAU * f / SR), c2: -rr * rr, a, y1: 0, y2: 0, g: (1 - rr) * 12 }; });
  let ph = 0, rate = 1, e = 0, pulse = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    if ((i & 63) === 0) { rate = o.rate(u) * (1 + jit * dr.at(i / SR)); e = o.env(u); }
    ph += rate / SR; pulse *= 0.86;
    if (ph >= 1) { ph -= 1; pulse += r.range(0.4, 1) * r.sign(); }
    const ex = pulse * e;
    let s = 0;
    for (const q of M) { const y = q.c1 * q.y1 + q.c2 * q.y2 + ex * q.g; q.y2 = q.y1; q.y1 = y; s += y * q.a; }
    out[i] = Math.tanh(s * (o.drive ?? 1)) * (o.gain ?? 0.5);
  }
  return out;
}
export const BOATWOOD = [[143, 14, 0.9], [251, 18, 1], [419, 22, 0.7], [701, 26, 0.45], [1130, 30, 0.22], [1820, 32, 0.1]];
export const FLESH = (k = 1) => [[52 * k, 6, 1], [83 * k, 7, 0.8], [131 * k, 8, 0.6], [207 * k, 9, 0.35], [330 * k, 10, 0.18]];

// a wooden creak of the little boat rocking
export function creak(G, t, o = {}) {
  const d = o.dur ?? 0.5, sig = friction(d, { modes: BOATWOOD.map(([f, q, a]) => [f * (o.pitch ?? 1), q, a]), rate: (u) => (o.r0 ?? 26) + (o.r1 ?? 60) * Math.sin(Math.PI * u), env: (u) => Math.sin(Math.PI * u) ** 1.5, gain: 0.5, drive: 1.4, jit: 0.5 }, o.seed ?? 1);
  put1(G, t, sig, { gain: o.gain ?? 0.2, pan: o.pan ?? 0, send: o.send ?? 0.2 });
}

// ---- seagull: "kee-ow" calls, nasal and rough
export function gull(G, t, o = {}) {
  const k = o.pitch ?? 1, calls = o.calls ?? 2, gap = o.gap ?? 0.32, seed = o.seed ?? 1;
  for (let c = 0; c < calls; c++) {
    const t0 = t + c * gap * (1 + 0.15 * ((c * 7 + seed) % 3)), d = (c === calls - 1 ? 0.42 : 0.26) * (o.len ?? 1), kk = k * (1 - 0.03 * c);
    tone(G, {
      t0, t1: t0 + d, seed: seed + c, h: [1, 0.6, 0.42, 0.22, 0.12, 0.06], jit: 0.02, am: 0.35, amHz: 70,
      f: (x) => { const u = (x - t0) / d; return kk * (u < 0.12 ? 1500 + 900 * (u / 0.12) : 2400 - 1100 * smooth((u - 0.12) / 0.88)); },
      g: (x) => { const u = (x - t0) / d; return (o.gain ?? 0.03) * (u < 0.08 ? u / 0.08 : 1) * (1 - smooth((u - 0.55) / 0.45)); },
      pan: () => o.pan ?? 0, send: o.send ?? 0.6,
    });
  }
}

// ---- water slap against the hull (one lap)
export function slap(out, at, r, amp) {
  const nz = new Noise(at + 11);
  noiseBurst(out, at, { a: r.range(0.008, 0.03), tau: r.range(0.03, 0.09), f0: r.range(500, 1100), f1: r.range(250, 500), q: 0.9, amp: amp * 0.9 }, nz);
  if (r.next() < 0.6) bubble(out, at + Math.round(r.range(0.01, 0.06) * SR), r.range(280, 700), amp * 0.35, 0.12);
}

// ---- ratchet: one click of the reel's pawl
export function click(out, at, r, amp, bright = 1) {
  ping(out, at, r.range(2900, 3400) * bright, amp * 0.5, [[1, 1, 0.012], [1.63, 0.6, 0.008], [2.71, 0.35, 0.005]], r.next() * 6);
  const nz = new Noise(at + 3), n = Math.min(out.length - at, Math.round(0.0012 * SR)), f = new SVF(6000, 0.8);
  for (let i = 0; i < n; i++) { f.run(nz.white()); out[at + i] += f.hp * amp * 0.6 * (1 - i / n); }
}
export function ratchet(G, t0, t1, rate, amp, o = {}) {
  const r = new Rng(o.seed ?? 31), len = Math.ceil((t1 - t0 + 0.05) * SR), L = new Float32Array(len);
  let t = t0;
  while (t < t1) {
    const at = Math.round((t - t0) * SR);
    click(L, at, r, amp(t) * r.range(0.75, 1), o.bright ?? 1);
    t += 1 / Math.max(1, rate(t)) * r.range(0.9, 1.1);
  }
  put1(G, t0, L, { gain: o.gain ?? 1, pan: o.pan ?? 0.1, send: o.send ?? 0.15 });
}

// ---- cartoon pieces
export function plip(G, t, o = {}) {
  const b = new Float32Array(Math.round(0.25 * SR)), r = new Rng(o.seed ?? 1);
  bubble(b, 0, o.f ?? 1150, 0.5, 0.25);
  noiseBurst(b, 0, { a: 0.002, tau: 0.008, f0: 3200, q: 1.4, amp: 0.25 }, new Noise(o.seed ?? 1));
  put1(G, t, b, { gain: o.gain ?? 0.2, pan: o.pan ?? 0, send: o.send ?? 0.25 });
}
export function bloop(G, t, o = {}) {
  const len = Math.round(0.7 * SR), b = new Float32Array(len), nz = new Noise(o.seed ?? 2), lo = new SVF(600, 0.8);
  bubble(b, 0, o.f ?? 150, 0.9, 0.6);
  let p = 0;
  for (let i = 0; i < len; i++) {
    const tt = i / SR, f = 55 + 70 * Math.exp(-tt / 0.06); p += f / SR;
    lo.run(nz.white());
    b[i] += Math.sin(TAU * p) * 0.8 * Math.exp(-tt / 0.14) * Math.min(1, tt / 0.004) + lo.bp * 0.5 * Math.exp(-tt / 0.05);
  }
  put1(G, t, b, { gain: o.gain ?? 0.5, pan: o.pan ?? 0, send: o.send ?? 0.25 });
}
export function gulp(G, t, o = {}) {
  const g = o.gain ?? 0.4, P = () => o.pan ?? 0;
  // "gl": a throat chirp falling, then "uk": the low boop, then a tiny click
  tone(G, { t0: t, t1: t + 0.09, h: [1, 0.35, 0.12], f: (x) => 620 - 330 * smooth((x - t) / 0.09), g: (x) => g * 0.7 * Math.sin(Math.PI * clamp((x - t) / 0.09)), pan: P, send: 0.08 });
  const t2 = t + 0.11, d2 = 0.2;
  tone(G, { t0: t2, t1: t2 + d2, h: [1, 0.5, 0.2, 0.08], f: (x) => 210 - 95 * smooth((x - t2) / d2), g: (x) => { const u = (x - t2) / d2; return g * (u < 0.06 ? u / 0.06 : Math.exp(-(u - 0.06) * 3)); }, pan: P, send: 0.08 });
  const b = new Float32Array(Math.round(0.03 * SR)); noiseBurst(b, 0, { a: 0.001, tau: 0.004, f0: 1800, q: 2, amp: 0.7 }, new Noise(91));
  put1(G, t + 0.1, b, { gain: g * 0.5, pan: o.pan ?? 0, send: 0.05 });
}
export function pomf(G, t, o = {}) {
  const len = Math.round(0.3 * SR), b = new Float32Array(len), nz = new Noise(o.seed ?? 5), f = new SVF(700, 0.8);
  let p = 0;
  for (let i = 0; i < len; i++) { const tt = i / SR; f.run(nz.white()); p += (150 + 60 * Math.exp(-tt / 0.02)) / SR; b[i] = (f.lp * 1.2 * Math.exp(-tt / 0.045) + Math.sin(TAU * p) * 0.4 * Math.exp(-tt / 0.06)) * Math.min(1, tt / 0.003); }
  put1(G, t, b, { gain: o.gain ?? 0.3, pan: o.pan ?? 0, send: o.send ?? 0.15 });
}
// a cute robot beep: notes [[dt, Hz, dur]]
export function beep(G, t, notes, o = {}) {
  for (const [dt, f, d] of notes) tone(G, { t0: t + dt, t1: t + dt + d, h: [1, 0, 0.3, 0, 0.12], f: () => f, g: (x) => { const u = (x - t - dt) / d; return (o.gain ?? 0.05) * Math.min(1, u * 20) * Math.min(1, (1 - u) * 10); }, pan: () => o.pan ?? 0, send: 0.2 });
}
// metallic robot clank
export function clank(G, t, o = {}) {
  const b = new Float32Array(Math.round(0.6 * SR)), f0 = o.f ?? 820;
  ping(b, 0, f0, 0.3, [[1, 1, 0.25], [1.47, 0.7, 0.18], [2.09, 0.5, 0.12], [2.83, 0.35, 0.08], [3.9, 0.2, 0.05]], 0.5);
  noiseBurst(b, 0, { a: 0.0008, tau: 0.004, f0: 4000, q: 0.9, amp: 0.4 }, new Noise(o.seed ?? 3));
  put1(G, t, b, { gain: o.gain ?? 0.2, pan: o.pan ?? 0, send: o.send ?? 0.2 });
}
// whoosh: a bandpass sweep through noise, f [[t, Hz]], g [[t, gain]], pan [[t, p]] (relative times)
export function whoosh(G, t, o) {
  const dur = o.f[o.f.length - 1][0], fk = o.f.map(([x, y]) => [t + x, y]), gk = o.g.map(([x, y]) => [t + x, y]), pk = (o.pan ?? [[0, 0], [dur, 0]]).map(([x, y]) => [t + x, y]);
  const fl = o.flutter ?? 0, fh = o.flutterHz ?? 22;
  tex(G, { t0: t, t1: t + dur, seed: o.seed ?? 4, color: o.color ?? 'w', mode: 'bp', q: o.q ?? 1.1, f: K(fk), g: fl ? (x) => K(gk)(x) * (1 - fl * (0.5 + 0.5 * Math.sin(TAU * fh * x))) : K(gk), pan: K(pk), width: 0.5, send: o.send ?? 0.25 });
}
