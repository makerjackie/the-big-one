// Sound department — rooms and master bus for THE BIG ONE (pure JS, in place, deterministic).
// FDN reverb instead of convolution so the whole render stays inside a few hundred ms of CPU.
// glue / limiter / monoLows / sweepLP / carve follow the LEVIATHAN master (MIT).
import { SR, SVF, Biquad, dbToGain, gainToDb } from './audio-dsp.js';

// first / last sample index where a bus carries signal
export function activeRange(L, R, eps = 1e-7) {
  let a = 0, b = L.length - 1;
  while (a < L.length && Math.abs(L[a]) < eps && Math.abs(R[a]) < eps) a++;
  while (b > a && Math.abs(L[b]) < eps && Math.abs(R[b]) < eps) b--;
  return [a, b + 1];
}

// ---- 8-line feedback delay network with input diffusion, per-line damping and pre-delay.
// Reads the send bus (inL/inR), ADDS the wet signal into outL/outR.
// o = { rt60, damp (Hz, HF damping corner), size, pre (s), wet, lo (Hz high-pass on the input), width }
export function fdnReverb(inL, inR, outL, outR, o = {}) {
  const n = inL.length;
  let [i0, i1] = activeRange(inL, inR);
  if (i1 <= i0) return;
  const rt = o.rt60 ?? 2, size = o.size ?? 1, wet = o.wet ?? 1, k = SR / 48000;
  i1 = Math.min(n, i1 + Math.round((rt * 1.2 + 0.2) * SR));
  const ms = [31.7, 37.3, 41.9, 47.3, 53.1, 59.3, 67.1, 73.7];
  const len = ms.map((m) => Math.round(m * 0.001 * SR * size)), lines = [], idx = new Int32Array(8), gains = new Float64Array(8), lpS = new Float64Array(8);
  let mask = 1; while (mask < Math.max(...len) + 2) mask <<= 1;
  for (let j = 0; j < 8; j++) { lines.push(new Float32Array(mask)); gains[j] = Math.pow(10, -3 * len[j] / (rt * SR)); }
  mask -= 1;
  const da = Math.exp(-2 * Math.PI * (o.damp ?? 5000) / SR);
  // pre-delay
  const pre = Math.max(1, Math.round((o.pre ?? 0.02) * SR)); let pm = 1; while (pm < pre + 2) pm <<= 1;
  const pL = new Float32Array(pm), pR = new Float32Array(pm); pm -= 1; let pw = 0;
  // input diffusers (Schroeder allpasses), two per channel
  const apLen = [Math.round(142 * k * size), Math.round(379 * k * size), Math.round(107 * k * size), Math.round(277 * k * size)];
  const ap = apLen.map((l) => ({ b: new Float32Array(l), i: 0, l }));
  const apRun = (a, x, g) => { const d = a.b[a.i], y = d - g * x; a.b[a.i] = x + g * y; a.i = a.i + 1 === a.l ? 0 : a.i + 1; return y; };
  const hpL = new SVF(o.lo ?? 120, 0.7), hpR = new SVF(o.lo ?? 120, 0.7), w = o.width ?? 1;
  const s8 = 1 / Math.sqrt(8), v = new Float64Array(8);
  let wp = 0;
  for (let i = i0; i < i1; i++) {
    // input
    hpL.run(inL[i]); hpR.run(inR[i]);
    pL[pw] = hpL.hp; pR[pw] = hpR.hp;
    const rd = (pw - pre) & pm, xl0 = pL[rd], xr0 = pR[rd]; pw = (pw + 1) & pm;
    const xl = apRun(ap[1], apRun(ap[0], xl0, 0.62), 0.62), xr = apRun(ap[3], apRun(ap[2], xr0, 0.62), 0.62);
    // read lines, damp
    for (let j = 0; j < 8; j++) { const y = lines[j][(wp - len[j]) & mask]; lpS[j] = y + (lpS[j] - y) * da; v[j] = lpS[j] * gains[j]; }
    // outputs (decorrelated taps)
    const oL = v[0] - v[2] + v[4] - v[6] + 0.5 * (v[1] - v[5]), oR = v[1] - v[3] + v[5] - v[7] + 0.5 * (v[2] - v[6]);
    const mid = (oL + oR) * 0.5, side = (oL - oR) * 0.5 * w;
    outL[i] += (mid + side) * wet * 0.35; outR[i] += (mid - side) * wet * 0.35;
    // Hadamard mix
    let a0 = v[0] + v[1], a1 = v[0] - v[1], a2 = v[2] + v[3], a3 = v[2] - v[3], a4 = v[4] + v[5], a5 = v[4] - v[5], a6 = v[6] + v[7], a7 = v[6] - v[7];
    let b0 = a0 + a2, b1 = a1 + a3, b2 = a0 - a2, b3 = a1 - a3, b4 = a4 + a6, b5 = a5 + a7, b6 = a4 - a6, b7 = a5 - a7;
    const m0 = (b0 + b4) * s8, m1 = (b1 + b5) * s8, m2 = (b2 + b6) * s8, m3 = (b3 + b7) * s8, m4 = (b0 - b4) * s8, m5 = (b1 - b5) * s8, m6 = (b2 - b6) * s8, m7 = (b3 - b7) * s8;
    lines[0][wp] = m0 + xl; lines[1][wp] = m1 + xr; lines[2][wp] = m2 + xl * 0.7; lines[3][wp] = m3 - xr * 0.7;
    lines[4][wp] = m4 - xl * 0.5; lines[5][wp] = m5 + xr * 0.5; lines[6][wp] = m6 + xl * 0.3; lines[7][wp] = m7 + xr * 0.3;
    wp = (wp + 1) & mask;
  }
}

// Stereo-linked RMS compressor with soft knee and a little look-ahead: the glue.
export function glue(L, R, o = {}) {
  const thr = o.thr ?? -18, ratio = o.ratio ?? 2.5, knee = o.knee ?? 8, n = L.length;
  const ca = Math.exp(-1 / ((o.att ?? 0.03) * SR)), cr = Math.exp(-1 / ((o.rel ?? 0.3) * SR));
  const rc = Math.exp(-1 / (0.012 * SR)), la = Math.round((o.look ?? 0.005) * SR), gain = new Float32Array(n);
  let e = 1e-9, g = 0, maxGr = 0;
  for (let i = 0; i < n; i++) {
    const p = (L[i] * L[i] + R[i] * R[i]) * 0.5;
    e = p + (e - p) * rc;
    const db = 10 * Math.log10(e + 1e-12), over = db - thr;
    let red = 0;
    if (over > knee / 2) red = over * (1 - 1 / ratio);
    else if (over > -knee / 2) { const x = over + knee / 2; red = (1 - 1 / ratio) * x * x / (2 * knee); }
    g = red > g ? red + (g - red) * ca : red + (g - red) * cr;
    if (g > maxGr) maxGr = g;
    gain[i] = g;
  }
  for (let i = 0; i < n; i++) { const k = Math.pow(10, -gain[Math.min(n - 1, i + la)] / 20); L[i] *= k; R[i] *= k; }
  return maxGr;
}

// Look-ahead brickwall limiter (in place): |x| <= ceiling for every sample.
export function limit(L, R, ceiling, la = 0.004, rel = 0.12) {
  const n = L.length, W = Math.max(2, Math.round(la * SR)), req = new Float32Array(n);
  for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])); req[i] = p > ceiling ? ceiling / p : 1; }
  const g1 = new Float32Array(n), dq = new Int32Array(n + W + 1); let h = 0, tl = 0;
  for (let j = 0; j < n + W; j++) {
    if (j < n) { while (tl > h && req[dq[tl - 1]] >= req[j]) tl--; dq[tl++] = j; }
    const i = j - W; if (i < 0) continue;
    while (dq[h] < i) h++;
    g1[i] = req[dq[h]];
  }
  const rc = 1 - Math.exp(-1 / (rel * SR));
  let g = 1;
  for (let i = 0; i < n; i++) { const t = g1[i]; g = t < g ? t : g + (t - g) * rc; g1[i] = g; }
  let acc = 0, gr = 1; const box = new Float32Array(n);
  for (let i = 0; i < n; i++) { acc += g1[i]; if (i >= W) acc -= g1[i - W]; box[i] = acc / Math.min(i + 1, W); }
  for (let i = 0; i < n; i++) { const k = Math.min(box[i], g1[i]); L[i] *= k; R[i] *= k; if (k < gr) gr = k; }
  return gainToDb(gr);
}

// sum everything under fc to mono so the sub is solid and translates
export function monoLows(L, R, fc = 110) {
  const a = new SVF(fc, 0.707);
  for (let i = 0; i < L.length; i++) {
    const m = (L[i] + R[i]) * 0.5, s = (L[i] - R[i]) * 0.5;
    a.run(s); const sh = s - a.lp;
    L[i] = m + sh; R[i] = m - sh;
  }
}

// time-varying lowpass, cutoff fn(t) read every 32 samples, bypassed at >= 17 kHz
export function sweepLP(L, R, fn, leak = 0, q = 0.6) {
  const a = new SVF(18000, q), b = new SVF(18000, q), a2 = new SVF(18000, q), b2 = new SVF(18000, q);
  let w = 0;
  for (let i = 0; i < L.length; i++) {
    if ((i & 31) === 0) { const f = fn(i / SR); w = Math.max(0, Math.min(1, (17000 - f) / 6000)); a.set(f, q); b.set(f, q); a2.set(f, q); b2.set(f, q); }
    a2.run(a.run(L[i])); b2.run(b.run(R[i]));
    if (w > 0) { const x = L[i], y = R[i]; L[i] = x + (a2.lp + (x - a2.lp) * leak - x) * w; R[i] = y + (b2.lp + (y - b2.lp) * leak - y) * w; }
  }
}

// gaps: [[t0, t1, db, rampIn, rampOut]] carve the mix after the reverbs so the silence is real
export function carve(L, R, gaps) {
  for (const [t0, t1, db, ramp = 0.006, rampOut = ramp] of gaps) {
    const g = dbToGain(db), a = Math.round((t0 - ramp) * SR), b = Math.round(t0 * SR), c = Math.round(t1 * SR), d = Math.round((t1 + rampOut) * SR);
    for (let i = Math.max(0, a); i < Math.min(L.length, d); i++) {
      const k = i < b ? 1 + (g - 1) * (i - a) / Math.max(1, b - a) : i < c ? g : g + (1 - g) * (i - c) / Math.max(1, d - c);
      L[i] *= k; R[i] *= k;
    }
  }
}

// biquad chain per channel, in place: make = () => [Biquad, ...]
export function eq(L, R, make) {
  for (const x of [L, R]) { const c = make(); for (let i = 0; i < x.length; i++) { let v = x[i]; for (let k = 0; k < c.length; k++) v = c[k].run(v); x[i] = v; } }
}
export const highpass = (L, R, f) => eq(L, R, () => [Biquad.hp(f, 0.54), Biquad.hp(f, 1.31)]);
