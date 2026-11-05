// Sound department — DSP toolkit for THE BIG ONE.
// Pure JS, deterministic: every noise source is a seeded RNG, never Math.random.
// Techniques adapted from the LEVIATHAN sound department (MIT): TPT state-variable
// filters, Kellet pink noise, Minnaert bubbles, damped-resonator pings.

// The sample rate is a live binding: renderScore(SR) sets it before anything is built.
export let SR = 48000;
export function setSR(sr) { SR = sr; }
export const TAU = Math.PI * 2;

// ------------------------------------------------------------------ helpers
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Rng {
  constructor(seed) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.r() * arr.length)]; }
  sign() { return this.r() < 0.5 ? -1 : 1; }
}
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
// 'Bb4' | 'F#3' | 'C5' -> midi (C4 = 60)
export function nm(s) {
  if (typeof s === 'number') return s;
  const m = /^([A-G])([b#]?)(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3], 10) + 1) * 12;
}
export const nf = (s) => mtof(nm(s));
export const dbToGain = (db) => Math.pow(10, db / 20);
export const gainToDb = (g) => 20 * Math.log10(Math.max(g, 1e-12));
export const list = (x) => [].concat(x);

// piecewise-linear and cosine-smoothed envelopes from [[t, v], ...]
export function pwl(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; return v0 + (v1 - v0) * (t - t0) / Math.max(1e-9, t1 - t0); }
  return keys[keys.length - 1][1];
}
export function pws(keys, t) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) { const [t0, v0] = keys[i - 1], [t1, v1] = keys[i]; const u = (t - t0) / Math.max(1e-9, t1 - t0); return v0 + (v1 - v0) * (1 - Math.cos(u * Math.PI)) / 2; }
  return keys[keys.length - 1][1];
}

// ------------------------------------------------------------------ buses
// A group is { dry: Bus, send: Bus }; the send feeds that group's reverb in the master.
export class Bus { constructor(n) { this.n = n; this.L = new Float32Array(n); this.R = new Float32Array(n); } }
export const group = (n) => ({ dry: new Bus(n), send: new Bus(n) });
export function panGains(p) { const a = (clamp(p, -1, 1) + 1) * Math.PI / 4; return [Math.cos(a), Math.sin(a)]; }

// mono signal into a group at film time t0
export function put(G, t0, sig, o = {}) {
  const g = o.gain ?? 1, send = o.send ?? 0.2, [gl, gr] = panGains(o.pan ?? 0);
  const s0 = Math.round(t0 * SR), n = G.dry.n, dL = G.dry.L, dR = G.dry.R, sL = G.send.L, sR = G.send.R;
  const i0 = Math.max(0, -s0), i1 = Math.min(sig.length, n - s0);
  for (let i = i0; i < i1; i++) {
    const v = sig[i] * g, j = s0 + i, a = v * gl, b = v * gr;
    dL[j] += a; dR[j] += b;
    if (send) { sL[j] += a * send; sR[j] += b * send; }
  }
}
// stereo signal {L, R} into a group
export function put2(G, t0, S, o = {}) {
  const g = o.gain ?? 1, send = o.send ?? 0.2, s0 = Math.round(t0 * SR), n = G.dry.n;
  const i0 = Math.max(0, -s0), i1 = Math.min(S.L.length, n - s0);
  for (let i = i0; i < i1; i++) {
    const j = s0 + i, l = S.L[i] * g, r = S.R[i] * g;
    G.dry.L[j] += l; G.dry.R[j] += r;
    if (send) { G.send.L[j] += l * send; G.send.R[j] += r * send; }
  }
}

// ---------------------------------------------------------------- filters
// Topology-preserving state-variable filter (Zavalishin). Cheap to modulate.
export class SVF {
  constructor(f = 1000, q = 0.707) { this.ic1 = 0; this.ic2 = 0; this.lp = 0; this.bp = 0; this.hp = 0; this.set(f, q); }
  set(f, q = this.q) {
    this.q = q;
    const g = Math.tan(Math.PI * clamp(f, 5, SR * 0.46) / SR), k = 1 / q;
    this.k = k; this.a1 = 1 / (1 + g * (g + k)); this.a2 = g * this.a1; this.a3 = g * this.a2;
  }
  run(x) {
    const v3 = x - this.ic2, v1 = this.a1 * this.ic1 + this.a2 * v3, v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1; this.ic2 = 2 * v2 - this.ic2;
    this.lp = v2; this.bp = v1; this.hp = x - this.k * v1 - v2;
    return v2;
  }
}
export class OnePole {
  constructor(f) { this.y = 0; this.set(f); }
  set(f) { this.a = Math.exp(-TAU * f / SR); }
  run(x) { this.y = x + (this.y - x) * this.a; return this.y; }
}
export class Biquad {
  constructor(b0, b1, b2, a1, a2) { Object.assign(this, { b0, b1, b2, a1, a2 }); this.x1 = this.x2 = this.y1 = this.y2 = 0; }
  run(x) { const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2; this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y; return y; }
  static hp(f, q = 0.707) { const w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al; return new Biquad((1 + c) / 2 / a0, -(1 + c) / a0, (1 + c) / 2 / a0, -2 * c / a0, (1 - al) / a0); }
  static lp(f, q = 0.707) { const w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al; return new Biquad((1 - c) / 2 / a0, (1 - c) / a0, (1 - c) / 2 / a0, -2 * c / a0, (1 - al) / a0); }
  static hishelf(f, db) { const A = Math.pow(10, db / 40), w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) * Math.SQRT1_2, q = 2 * Math.sqrt(A) * al, a0 = (A + 1) - (A - 1) * c + q; return new Biquad(A * ((A + 1) + (A - 1) * c + q) / a0, -2 * A * ((A - 1) + (A + 1) * c) / a0, A * ((A + 1) + (A - 1) * c - q) / a0, 2 * ((A - 1) - (A + 1) * c) / a0, ((A + 1) - (A - 1) * c - q) / a0); }
  static loshelf(f, db) { const A = Math.pow(10, db / 40), w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) * Math.SQRT1_2, q = 2 * Math.sqrt(A) * al, a0 = (A + 1) + (A - 1) * c + q; return new Biquad(A * ((A + 1) - (A - 1) * c + q) / a0, 2 * A * ((A - 1) - (A + 1) * c) / a0, A * ((A + 1) - (A - 1) * c - q) / a0, -2 * ((A - 1) + (A + 1) * c) / a0, ((A + 1) + (A - 1) * c - q) / a0); }
  static peak(f, q, db) { const A = Math.pow(10, db / 40), w = TAU * f / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al / A; return new Biquad((1 + al * A) / a0, -2 * c / a0, (1 - al * A) / a0, -2 * c / a0, (1 - al / A) / a0); }
}

// ------------------------------------------------------------------ noise
export class Noise {
  constructor(seed) { this.r = mulberry32(seed * 7919 + 13); this.b0 = this.b1 = this.b2 = this.b3 = this.b4 = this.b5 = this.b6 = 0; this.br = 0; }
  white() { return this.r() * 2 - 1; }
  pink() { // Paul Kellet
    const w = this.white();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179; this.b1 = 0.99332 * this.b1 + w * 0.0750759; this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856; this.b4 = 0.55 * this.b4 + w * 0.5329522; this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const o = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362; this.b6 = w * 0.115926;
    return o * 0.11;
  }
  brown() { this.br = (this.br + 0.02 * this.white()) / 1.02; return this.br * 3.5; }
}
// smooth deterministic random curve in -1..1 (value noise, cosine interpolation)
export class Drift {
  constructor(seed, rate) { const r = mulberry32(seed * 31 + 5); this.rate = rate; this.k = new Float32Array(2048); for (let i = 0; i < 2048; i++) this.k[i] = r() * 2 - 1; }
  at(t) { const x = Math.abs(t * this.rate), i = Math.floor(x), f = x - i, u = (1 - Math.cos(f * Math.PI)) / 2; return lerp(this.k[i & 2047], this.k[(i + 1) & 2047], u); }
}

// ------------------------------------------------------------- primitives
export const buf = (sec) => new Float32Array(Math.max(1, Math.ceil(sec * SR)));

// Minnaert bubble (van den Doel): rising-pitch damped sine, added into out at sample `at`
export function bubble(out, at, f0, amp, rise = 0.1) {
  const d = 0.13 * f0 + 0.0072 * Math.pow(f0, 1.5), len = Math.min(Math.ceil(SR * 7 / d), out.length - at);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    ph += TAU * f0 * (1 + rise * d * t) / SR;
    out[at + i] += amp * (i < 24 ? i / 24 : 1) * Math.sin(ph) * Math.exp(-d * t);
  }
}

// damped resonator bank ("ping"): partials [[ratio, amp, decaySec]]
export function ping(out, at, f0, amp, partials, phase = 0) {
  for (const [r, a, dec] of partials) {
    const f = f0 * r; if (f > SR * 0.45 || at >= out.length) continue;
    const w = TAU * f / SR, rr = Math.exp(-6.91 / (dec * SR)), len = Math.min(Math.ceil(dec * SR * 1.1), out.length - at);
    const c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
    let y1 = Math.sin(phase) * amp * a, y2 = Math.sin(phase - w) * amp * a / rr;
    const fade = Math.max(1, Math.round(SR * 0.0003));
    for (let i = 0; i < len; i++) { const y = c1 * y1 + c2 * y2; out[at + i] += y1 * (i < fade ? i / fade : 1); y2 = y1; y1 = y; }
  }
}

// filtered-noise burst with a swept filter. o = { a, tau, f0, f1, q, mode, amp, hp, sweep }
export function noiseBurst(out, at, o, nz) {
  const len = Math.min(Math.ceil((o.a + o.tau * 5.5) * SR), out.length - at), f = new SVF(o.f0, o.q ?? 1.2), hp = o.hp ? new SVF(o.hp, 0.7) : null;
  for (let i = 0; i < len; i++) {
    const t = i / SR;
    if ((i & 31) === 0 && o.f1 !== undefined) f.set(o.f0 * Math.pow(o.f1 / o.f0, Math.min(1, t / (o.sweep ?? (o.a + o.tau * 2)))));
    const e = (t < o.a ? t / o.a : Math.exp(-(t - o.a) / o.tau)) * (i > len - 64 ? (len - i) / 64 : 1);
    f.run(nz.white());
    let v = o.mode === 'lp' ? f.lp : o.mode === 'hp' ? f.hp : f.bp;
    if (hp) { hp.run(v); v = hp.hp; }
    out[at + i] += v * e * o.amp;
  }
}

// --------------------------------------------------------------- metering
export function peakOf(L, R, i0 = 0, i1 = L.length) { let p = 0; for (let i = i0; i < i1; i++) { const a = Math.abs(L[i]), b = Math.abs(R[i]); if (a > p) p = a; if (b > p) p = b; } return p; }
export function rmsOf(L, R, i0 = 0, i1 = L.length) { let s = 0; for (let i = i0; i < i1; i++) s += L[i] * L[i] + R[i] * R[i]; return Math.sqrt(s / Math.max(1, 2 * (i1 - i0))); }

// 16-bit PCM WAV with TPDF dither
export function encodeWav(chans, sr = SR, seed = 99) {
  const n = chans[0].length, nc = chans.length, ab = new ArrayBuffer(44 + n * nc * 2), dv = new DataView(ab);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); dv.setUint32(4, 36 + n * nc * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, nc, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * nc * 2, true); dv.setUint16(32, nc * 2, true); dv.setUint16(34, 16, true); w(36, 'data'); dv.setUint32(40, n * nc * 2, true);
  const r = mulberry32(seed); let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) {
    const x = chans[c][i] * 32767 + (r() - r());
    dv.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(x))), true); o += 2;
  }
  return new Uint8Array(ab);
}
