// Sound department — the little orchestra of THE BIG ONE, modelled in pure JS.
// Cozy end: kalimba, marimba, ukulele and pizzicato (Karplus-Strong), glockenspiel, soft pad.
// Epic end: brass sections, string sections, choir, taiko, timpani, booms, cymbals.
// Brass/strings/choir/taiko/timpani/boom/cymbal follow the LEVIATHAN instrument models (MIT).
import { SR, TAU, mtof, SVF, OnePole, Biquad, Noise, Drift, Rng, ping, panGains, clamp, smooth, mulberry32 } from './audio-dsp.js';

const C2F = Math.LN2 / 1200;
const blep = (t, dt) => { if (t < dt) { const x = t / dt; return x + x - x * x - 1; } if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; } return 0; };
// a stereo section buffer that remembers which samples were touched (so post-processing is cheap)
export const section = (n) => ({ L: new Float32Array(n), R: new Float32Array(n), i0: n, i1: 0 });
const touch = (sec, a, b) => { if (sec.i0 !== undefined) { sec.i0 = Math.min(sec.i0, Math.max(0, a)); sec.i1 = Math.max(sec.i1, Math.min(sec.L.length, b)); } };

// Unison stack of band-limited saws; each player has detune, vibrato, seat and start lag.
// env(tt) amplitude, pm(tt) pitch offset in semitones, tri 0..1 morphs saw toward triangle.
export function stack(L, R, t0, dur, m, o) {
  const f0 = mtof(m), nv = o.n ?? 4, r = new Rng(o.seed ?? 1);
  const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(L.length, Math.round((t0 + dur) * SR));
  if (i1 <= i0) return;
  const base = (i0 - t0 * SR) / SR, V = [];
  for (let k = 0; k < nv; k++) {
    const u = nv > 1 ? (k / (nv - 1)) * 2 - 1 : 0, [gl, gr] = panGains((o.pan ?? 0) + u * (o.spread ?? 0.5));
    V.push({ ph: r.next(), det: u * (o.det ?? 9) + (r.next() - 0.5) * (o.jit ?? 4), gl, gr, lag: Math.round(r.next() * (o.lag ?? 0.02) * SR), vr: (o.vibHz ?? 5) * (0.9 + 0.2 * r.next()), vp: r.next() * TAU, inc: f0 / SR });
  }
  const vd = o.vib ?? 6, vdel = o.vibDelay ?? 0.3, env = o.env, pm = o.pm, tri = o.tri ?? 0, norm = 1 / Math.sqrt(nv);
  let g = env(base) * norm, dg = 0;
  for (let i = i0; i < i1; i++) {
    const c = i - i0;
    if ((c & 31) === 0) {
      const tt = base + c / SR, p = pm ? pm(tt) * 100 : 0, vb = vd * smooth(tt / vdel);
      for (let v = 0; v < nv; v++) { const q = V[v]; q.inc = f0 * Math.exp((q.det + p + vb * Math.sin(TAU * q.vr * tt + q.vp)) * C2F) / SR; }
      dg = (env(tt + 32 / SR) * norm - g) / 32;
    }
    let sl = 0, sr = 0;
    for (let v = 0; v < nv; v++) {
      const q = V[v]; if (c < q.lag) continue;
      let p = q.ph + q.inc; if (p >= 1) p -= 1; q.ph = p;
      let s = 2 * p - 1 - blep(p, q.inc);
      if (tri) s = s * (1 - tri) + tri * (1 - 2 * Math.abs(2 * p - 1)) ;
      sl += s * q.gl; sr += s * q.gr;
    }
    L[i] += sl * g; R[i] += sr * g; g += dg;
  }
}

// ---- brass: the filter opens with the breath, the tone tears at ff. o.swell(u) shapes the dynamic.
export function brassNote(sec, t0, dur, m, vel, o = {}) {
  const f0 = mtof(m), rel = o.rel ?? 0.32, att = o.att ?? (0.045 + 0.14 * (1 - vel)), tot = dur + rel + 0.04;
  const swell = o.swell, len = Math.ceil(tot * SR), tL = new Float32Array(len), tR = new Float32Array(len), seed = o.seed ?? 1;
  const dyn = (tt) => (swell ? swell(clamp(tt / dur)) : 1);
  const env = (tt) => (tt < att ? tt / att : 1) * (tt > dur ? Math.exp(-(tt - dur) / (rel * 0.4)) : 1) * (0.55 + 0.45 * dyn(tt)) * (tt > dur + rel ? Math.max(0, 1 - (tt - dur - rel) / 0.04) : 1);
  stack(tL, tR, 0, tot, m, { n: o.n ?? 5, det: o.det ?? 7, spread: o.spread ?? 0.35, pan: o.pan ?? 0, vib: o.vib ?? 3.5, vibDelay: 0.6, vibHz: 4.6, lag: o.lag ?? 0.03, env, seed, pm: (tt) => -(o.scoop ?? 0.55) * Math.exp(-tt / 0.045) + (o.bend ? o.bend(tt) : 0) });
  const fc = clamp(f0 * (1.7 + 8 * vel * vel), 260, o.maxCut ?? 6200), floor = f0 * 1.15;
  const a = new SVF(fc, 0.8), b = new SVF(fc, 0.8), drive = 1.1 + (o.drive ?? 3.2) * vel * vel, nd = 1 / Math.tanh(drive);
  const out = (o.gain ?? 0.13) * vel, s0 = Math.round(t0 * SR), n = sec.L.length;
  const nz = new Noise(seed + 31), blat = new SVF(Math.min(5000, f0 * 3.2), 1.6), blatN = Math.round(0.06 * SR);
  touch(sec, s0, s0 + len);
  for (let i = 0; i < len; i++) {
    const j = s0 + i; if (j >= n) break;
    if ((i & 63) === 0) {
      const tt = i / SR;
      let k = tt < att * 1.5 ? Math.pow(tt / (att * 1.5), 1.4) : 1 - 0.22 * smooth((tt - att * 1.5) / 0.7);
      k *= 0.45 + 0.55 * dyn(tt);
      if (tt > dur) k *= Math.exp(-(tt - dur) / (rel * 0.6));
      const f = floor + (fc - floor) * k; a.set(f, 0.8); b.set(f, 0.8);
    }
    let bl = 0;
    if (i < blatN) { blat.run(nz.white()); bl = blat.bp * 0.5 * vel * Math.exp(-i / (0.016 * SR)); }
    a.run(tL[i] + bl); b.run(tR[i] + bl);
    if (j >= 0) { sec.L[j] += Math.tanh(a.lp * drive) * nd * out; sec.R[j] += Math.tanh(b.lp * drive) * nd * out; }
  }
}

// ---- strings: bowed saw section; o.trem = measured tremolo strokes per second
export function stringNote(sec, t0, dur, m, vel, o = {}) {
  const f0 = mtof(m), att = o.att ?? 0.25, rel = o.rel ?? 0.4, tot = dur + rel, swell = o.swell, trem = o.trem ?? 0, seed = o.seed ?? 1;
  const tr = new Drift(seed + 3, 6), len = Math.ceil(tot * SR), tL = new Float32Array(len), tR = new Float32Array(len);
  const env = (tt) => {
    let e = (tt < att ? tt / att : 1) * (tt > dur ? Math.max(0, 1 - (tt - dur) / rel) : 1);
    e *= swell ? 0.15 + 0.85 * swell(clamp(tt / dur)) : 1;
    if (trem) { const ph = (tt * trem + 0.25 * tr.at(tt)) % 1; e *= 0.45 + 0.55 * Math.pow(Math.max(0, 1 - ph * 1.6), 1.6); }
    return e;
  };
  stack(tL, tR, 0, tot, m, { n: o.n ?? 5, det: o.det ?? 10, jit: 5, spread: o.spread ?? 0.45, pan: o.pan ?? 0, vib: o.vib ?? 7, vibDelay: 0.25, vibHz: 5.4, lag: att < 0.05 ? 0.008 : 0.05, env, seed });
  const fc = clamp(f0 * (o.bright ?? 4.5) * (0.6 + 0.6 * vel), 500, o.maxCut ?? 7200), a = new SVF(fc, 0.72), b = new SVF(fc, 0.72);
  const g = (o.gain ?? 0.09) * vel, s0 = Math.round(t0 * SR), n = sec.L.length;
  touch(sec, s0, s0 + len);
  for (let i = 0; i < len; i++) { const j = s0 + i; if (j >= n) break; a.run(tL[i]); b.run(tR[i]); if (j >= 0) { sec.L[j] += a.lp * g; sec.R[j] += b.lp * g; } }
}

// ---- choir: voices into a section buffer; choirFormants() then makes them sing a vowel
export function choirNote(sec, t0, dur, m, vel, o = {}) {
  const att = o.att ?? 0.5, rel = o.rel ?? 0.7, tot = dur + rel, swell = o.swell;
  const env = (tt) => (o.gain ?? 0.11) * vel * (tt < att ? smooth(tt / att) : 1) * (tt > dur ? Math.max(0, 1 - (tt - dur) / rel) : 1) * (swell ? 0.2 + 0.8 * swell(clamp(tt / dur)) : 1);
  touch(sec, Math.round(t0 * SR), Math.round((t0 + tot) * SR));
  stack(sec.L, sec.R, t0, tot, m, { n: o.n ?? 5, det: o.det ?? 14, jit: 7, spread: o.spread ?? 0.7, pan: o.pan ?? 0, vib: o.vib ?? 16, vibDelay: 0.5, vibHz: 5.1, lag: 0.08, env, seed: o.seed ?? 1, tri: 0.15 });
}
const VOWEL = {
  f: { ah: [[830, 1], [1180, 0.55], [2850, 0.28], [3850, 0.14]], oh: [[470, 1], [830, 0.5], [2830, 0.14], [3800, 0.08]], oo: [[350, 1], [720, 0.32], [2700, 0.07], [3800, 0.04]] },
  m: { ah: [[660, 1], [1080, 0.5], [2650, 0.2], [2950, 0.12]], oh: [[400, 1], [800, 0.42], [2600, 0.1], [2850, 0.06]], oo: [[300, 1], [650, 0.3], [2300, 0.05], [2800, 0.03]] },
};
// in place over the touched range: vowelAt(t) -> [vowelA, vowelB, mix]
export function choirFormants(sec, kind, vowelAt, breath = 0.012, seed = 7) {
  const T = VOWEL[kind], Lb = [0, 1, 2, 3].map(() => new SVF(800, 7)), Rb = [0, 1, 2, 3].map(() => new SVF(800, 7));
  let quiet = 0;
  const nz = new Noise(seed), gn = [1, 1, 1, 1], i0 = sec.i0, i1 = Math.min(sec.L.length, sec.i1 + Math.round(0.05 * SR));
  for (let i = i0; i < i1; i++) {
    if (((i - i0) & 255) === 0) {
      const [a, b, x] = vowelAt(i / SR);
      for (let k = 0; k < 4; k++) {
        const f = T[a][k][0] + (T[b][k][0] - T[a][k][0]) * x, q = 5 + f / 500;
        Lb[k].set(f, q); Rb[k].set(f, q); gn[k] = T[a][k][1] + (T[b][k][1] - T[a][k][1]) * x;
      }
    }
    const xL = sec.L[i], xR = sec.R[i];
    if (xL === 0 && xR === 0) { if (++quiet > 4096) continue; } else quiet = 0;
    const e = (Math.abs(xL) + Math.abs(xR)) * breath * nz.white();
    let oL = 0, oR = 0;
    for (let k = 0; k < 4; k++) { Lb[k].run(xL + e); Rb[k].run(xR + e); oL += Lb[k].bp * gn[k]; oR += Rb[k].bp * gn[k]; }
    sec.L[i] = oL; sec.R[i] = oR;
  }
}

// ---- soft pad: warm detuned triangles through a gentle lowpass (the summer haze)
export function padNote(sec, t0, dur, m, vel, o = {}) {
  const att = o.att ?? 0.8, rel = o.rel ?? 1.0, tot = dur + rel, len = Math.ceil(tot * SR), tL = new Float32Array(len), tR = new Float32Array(len);
  const env = (tt) => vel * (tt < att ? smooth(tt / att) : 1) * (tt > dur ? Math.max(0, 1 - (tt - dur) / rel) ** 2 : 1);
  stack(tL, tR, 0, tot, m, { n: o.n ?? 3, det: o.det ?? 8, jit: 3, spread: o.spread ?? 0.8, pan: o.pan ?? 0, vib: 3, vibDelay: 0.8, vibHz: 4.2, lag: 0, env, seed: o.seed ?? 1, tri: o.tri ?? 0.85 });
  const a = new SVF(o.cut ?? 1400, 0.6), b = new SVF(o.cut ?? 1400, 0.6), g = o.gain ?? 0.06, s0 = Math.round(t0 * SR), n = sec.L.length;
  touch(sec, s0, s0 + len);
  for (let i = 0; i < len; i++) { const j = s0 + i; if (j >= n) break; a.run(tL[i]); b.run(tR[i]); if (j >= 0) { sec.L[j] += a.lp * g; sec.R[j] += b.lp * g; } }
}

// ---- Karplus-Strong plucked string (ukulele, pizzicato, upright bass, harp)
// o: t60 (s), bright 0..1 (pluck hardness), damp 0..1 (loop lowpass), pick 0..0.5, gate (s, then muted), body [[f,q,db]]
export function pluck(m, o = {}, seed = 1) {
  const f = mtof(m), t60 = o.t60 ?? 1.5, gate = o.gate ?? 99, tot = Math.min(gate + 0.12, o.len ?? t60 * 1.2), len = Math.ceil(tot * SR), out = new Float32Array(len);
  const S = 0.29 + 0.21 * (o.damp ?? 0.4);           // loop lowpass blend: 0.5 darkest, lower is brighter
  const P = SR / f, N = Math.max(2, Math.floor(P - S - 0.1)), frac = P - N - S, C = (1 - frac) / (1 + frac);
  const d = new Float32Array(N), nz = new Noise(seed), ex = new OnePole(200 + 9000 * (o.bright ?? 0.6) ** 2);
  for (let i = 0; i < N; i++) d[i] = ex.run(nz.white());
  // pick-position comb: kills harmonics at multiples of 1/pick
  const pk = Math.max(1, Math.round(N * (o.pick ?? 0.18))), d2 = new Float32Array(N);
  for (let i = 0; i < N; i++) d2[i] = d[i] - (i >= pk ? d[i - pk] : 0);
  let mean = 0; for (let i = 0; i < N; i++) mean += d2[i]; mean /= N;
  for (let i = 0; i < N; i++) d[i] = d2[i] - mean;
  const rho = (T) => Math.pow(10, -3 / (Math.max(0.01, T) * f));
  let r1 = rho(t60), idx = 0, prev = 0, apx = 0, apy = 0;
  const muteT = rho(0.06);
  for (let i = 0; i < len; i++) {
    if (i === Math.round(gate * SR)) r1 = muteT;
    const y = d[idx];
    const lp = (1 - S) * y + S * prev; prev = y;
    const ap = C * lp + apx - C * apy; apx = lp; apy = ap;
    d[idx] = ap * r1; idx = idx + 1 === N ? 0 : idx + 1;
    out[i] = y;
  }
  if (o.body) for (const [bf, bq, db] of o.body) { const bi = Biquad.peak(bf, bq, db); for (let i = 0; i < len; i++) out[i] = bi.run(out[i]); }
  const fo = Math.min(len, Math.round(0.01 * SR)); for (let i = 0; i < fo; i++) out[len - 1 - i] *= i / fo;
  const fi = Math.round((o.attack ?? 0.0007) * SR); for (let i = 0; i < fi; i++) out[i] *= i / fi;
  const g = o.gain ?? 0.5; for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

// ---- struck bars and tines (modal): kalimba, marimba, xylophone, glockenspiel, bell
const MODES = {
  kalimba: { p: [[1, 1, 1.3], [2.0, 0.06, 0.5], [5.95, 0.22, 0.16], [9.4, 0.06, 0.06]], click: 0.18, cf: 3500 },
  marimba: { p: [[1, 1, 0.8], [3.93, 0.28, 0.22], [9.8, 0.08, 0.06]], click: 0.3, cf: 1400 },
  xylo: { p: [[1, 1, 0.42], [3.0, 0.42, 0.14], [6.0, 0.14, 0.05], [9.6, 0.06, 0.03]], click: 0.5, cf: 5000 },
  glock: { p: [[1, 1, 2.6], [2.76, 0.35, 1.2], [5.4, 0.22, 0.5], [8.93, 0.1, 0.25]], click: 0.25, cf: 8000 },
  bell: { p: [[1, 1, 4.2], [2.0, 0.42, 3.0], [2.76, 0.3, 2.2], [5.4, 0.2, 1.0], [8.93, 0.1, 0.5], [0.5, 0.2, 3.5]], click: 0.15, cf: 9000 },
};
export function bar(kind, m, vel, seed = 1, decay = 1) {
  const M = MODES[kind], f0 = mtof(m), dmax = Math.max(...M.p.map((p) => p[2])) * decay, out = new Float32Array(Math.ceil((dmax * 1.15 + 0.02) * SR));
  // harder hits ring the upper modes more
  ping(out, 0, f0, 0.3 * vel, M.p.map(([r, a, d], k) => [r, a * (k ? 0.5 + 0.7 * vel : 1), d * decay]), (seed % 7) * 0.3);
  const nz = new Noise(seed), f = new SVF(M.cf, 0.9), n = Math.min(out.length, Math.round(0.006 * SR));
  for (let i = 0; i < n; i++) { f.run(nz.white()); out[i] += f.bp * M.click * vel * (1 - i / n); }
  return out;
}

// ---- slide whistle: a breathy sine sliding on a pitch contour [[t, Hz]]
export function slideWhistle(contour, levels, seed = 1) {
  const dur = contour[contour.length - 1][0], len = Math.ceil((dur + 0.05) * SR), out = new Float32Array(len), nz = new Noise(seed), bp = new SVF(2000, 4), dr = new Drift(seed, 9);
  let ph = 0, f = contour[0][1], a = 0;
  const pw = (k, t) => { if (t <= k[0][0]) return k[0][1]; for (let i = 1; i < k.length; i++) if (t <= k[i][0]) { const u = (t - k[i - 1][0]) / (k[i][0] - k[i - 1][0]); return k[i - 1][1] + (k[i][1] - k[i - 1][1]) * u; } return k[k.length - 1][1]; };
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 15) === 0) { f = pw(contour, t) * (1 + 0.004 * dr.at(t)); a = pw(levels, t); bp.set(f, 6); }
    ph += f / SR; ph -= Math.floor(ph);
    bp.run(nz.white());
    out[i] = (Math.sin(TAU * ph) + 0.08 * Math.sin(2 * TAU * ph) + bp.bp * 0.5) * a * 0.5;
  }
  return out;
}

// ---- taiko: pitch-dropping membrane, stick crack (decays run as multipliers: this is called a lot)
export function taiko(vel, seed = 1, big = 1) {
  const len = Math.ceil((0.75 + 0.3 * big) * SR), out = new Float32Array(len), nz = new Noise(seed), f = new SVF(1800 + vel * 2200, 0.8), lo = new SVF(420, 0.8);
  const f0 = (74 + (seed % 5) * 1.5) / big, D = (tau) => Math.exp(-1 / (tau * SR));
  const k1 = D(0.02), k2 = D(0.018), kb = D(0.3 * big), kb2 = D(0.095), kc1 = D(0.007), kc2 = D(0.04), fo = 1200, crN = Math.round(0.3 * SR);
  let p1 = 0, p2 = 0, e1 = 1, e2 = 1, eb = 1, eb2 = 1, ec1 = 1, ec2 = 1;
  const g = 0.55 * vel, drv = 1.1 + vel;
  for (let i = 0; i < len; i++) {
    p1 += f0 * (1 + 1.9 * e1) / SR; p2 += f0 * 1.59 * (1 + 0.8 * e2) / SR;
    if (p1 > 1) p1 -= 1; if (p2 > 1) p2 -= 1;
    let x = Math.sin(TAU * p1) * eb + 0.36 * Math.sin(TAU * p2) * eb2;
    if (i < crN) { f.run(nz.white()); lo.run(nz.white()); x = x * 0.95 + f.bp * 0.42 * ec1 + lo.lp * 0.85 * ec2; } else x *= 0.95;
    out[i] = Math.tanh(x * drv) * g * (i > len - fo ? (len - i) / fo : 1);
    e1 *= k1; e2 *= k2; eb *= kb; eb2 *= kb2; ec1 *= kc1; ec2 *= kc2;
  }
  return out;
}
export function timpani(m, vel, seed = 1, ring = 1) {
  const f0 = mtof(m), out = new Float32Array(Math.ceil(2.9 * ring * SR));
  ping(out, 0, f0, 0.6 * vel, [[0.62, 0.5, 0.3], [1, 1, 2.6 * ring], [1.5, 0.55, 1.7 * ring], [1.98, 0.35, 1.25 * ring], [2.44, 0.22, 0.9 * ring], [2.9, 0.12, 0.6 * ring]], seed * 0.37);
  const nz = new Noise(seed), f = new SVF(900 + vel * 1500, 0.7), n = Math.round(0.03 * SR);
  for (let i = 0; i < n; i++) { f.run(nz.white()); out[i] += f.lp * 0.3 * vel * Math.exp(-i / (0.0055 * SR)); }
  return out;
}
// ---- trailer boom: sweeping sine, saturated, long sub tail
export function boom(o = {}, seed = 1) {
  const dur = o.dur ?? 3.5, len = Math.ceil(dur * SR), out = new Float32Array(len), f0 = o.f0 ?? 110, f1 = Math.max(o.f1 ?? 43, 34), sw = o.sweep ?? 0.09, tau = o.tau ?? 0.9, drive = o.drive ?? 2.2;
  const nz = new Noise(seed), lo = new SVF(o.nf ?? 260, 0.7), ks = Math.exp(-1 / (sw * SR)), ke = Math.exp(-1 / (tau * SR)), kn = Math.exp(-1 / (0.06 * SR)), nN = Math.round(0.5 * SR), g = o.gain ?? 0.8;
  let p = 0, es = 1, ee = 1, en = 1;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = f1 + (f0 - f1) * es; p += f / SR; if (p > 1) p -= 1;
    const e = ee * (t < 0.003 ? t / 0.003 : 1) * (i > len - 2400 ? (len - i) / 2400 : 1);
    let x = Math.sin(TAU * p) * drive * e;
    if (i < nN) { lo.run(nz.white()); x += lo.lp * 1.7 * en; }
    out[i] = Math.tanh(x) * g * Math.min(1, e * 2.5);
    es *= ks; ee *= ke; en *= kn;
  }
  return out;
}
// ---- heart: a soft low stroke with a fast thud and a body that breathes out
export function heart(f0, vel, seed = 1) {
  const len = Math.ceil(0.62 * SR), out = new Float32Array(len), nz = new Noise(seed), lo = new SVF(170, 0.8);
  let p = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR, f = f0 * (1 + 0.32 * Math.exp(-t / 0.02)); p += f / SR;
    lo.run(nz.white());
    const a = smooth(t / 0.022), e = a * (0.72 * Math.exp(-t / 0.13) + 0.28 * Math.exp(-t / 0.42)), s = Math.sin(TAU * p);
    const x = (s + 0.42 * Math.sin(2 * TAU * p) + 0.2 * Math.sin(3 * TAU * p + 0.6)) * e * (1.2 + 1.1 * vel) + lo.lp * 1.3 * Math.exp(-t / 0.03);
    out[i] = Math.tanh(x) * 0.62 * vel * (i > len - 1600 ? (len - i) / 1600 : 1);
  }
  return out;
}
// ---- crash cymbal: dense inharmonic shimmer over filtered noise
export function crash(vel, seed = 1, ring = 3.4) {
  const len = Math.ceil(ring * 1.25 * SR), out = new Float32Array(len), nz = new Noise(seed), r = new Rng(seed);
  const hp = new SVF(3400, 0.7), b1 = new SVF(5200, 2.2), b2 = new SVF(8700, 2.6), b3 = new SVF(2900, 2);
  for (let i = 0; i < len; i++) {
    const t = i / SR, w = nz.white();
    hp.run(w); b1.run(w); b2.run(w); b3.run(w);
    const e = Math.exp(-t / (ring * 0.28)), a = t < 0.002 ? t / 0.002 : 1;
    out[i] = (hp.hp * (0.28 * e + 0.5 * Math.exp(-t / 0.05)) + (b1.bp * 0.6 + b2.bp * 0.5) * e + b3.bp * 0.4 * Math.exp(-t / (ring * 0.15))) * a * vel * 0.34 * (i > len - 2400 ? (len - i) / 2400 : 1);
  }
  for (let k = 0; k < 24; k++) ping(out, Math.round(r.next() * 200), r.range(900, 9000), 0.012 * vel, [[1, 1, r.range(0.3, ring * 0.5)]], r.next() * 6);
  return out;
}
// ---- suspended cymbal swell peaking `rise` seconds in
export function cymbalSwell(rise, ring, vel, seed = 1) {
  const len = Math.ceil((rise + ring) * SR), out = new Float32Array(len);
  const nz = new Noise(seed), b1 = new SVF(4300, 3), b2 = new SVF(6900, 4), b3 = new SVF(9600, 2), hp = new SVF(2800, 0.7);
  for (let i = 0; i < len; i++) {
    const t = i / SR, w = nz.white();
    b1.run(w); b2.run(w); b3.run(w); hp.run(w);
    const e = t < rise ? (Math.exp(3.2 * t / rise) - 1) / (Math.exp(3.2) - 1) : Math.exp(-(t - rise) / (ring * 0.3));
    out[i] = (b1.bp * 0.6 + b2.bp * 0.5 + b3.bp * 0.35 + hp.hp * 0.12) * e * vel * 0.22 * (i > len - 1200 ? (len - i) / 1200 : 1);
  }
  return out;
}
// ---- Shepard riser: endless climb, octave stack under a sine window
export function shepard(dur, o = {}, seed = 1) {
  const len = Math.ceil(dur * SR), out = new Float32Array(len), nv = o.voices ?? 6, oct = o.octaves ?? 2, fb = o.base ?? 110, r = mulberry32(seed);
  const ph = new Float64Array(nv).map(() => r());
  for (let i = 0; i < len; i++) {
    const u = i / len, t = i / SR; let s = 0;
    for (let v = 0; v < nv; v++) {
      const x = ((v + u * oct) % nv) / nv, f = fb * Math.pow(2, x * nv);
      ph[v] += f / SR; ph[v] -= Math.floor(ph[v]);
      const w = Math.sin(Math.PI * x);
      s += (Math.sin(TAU * ph[v]) + 0.3 * Math.sin(2 * TAU * ph[v])) * w * w;
    }
    out[i] = s * Math.pow(u, o.curve ?? 2) * (o.gain ?? 0.18) * (i > len - 120 ? (len - i) / 120 : 1) * (t < 0.01 ? t / 0.01 : 1);
  }
  return out;
}
