// Sound department — the score for THE BIG ONE. Original music, D major.
//   Cozy theme  D5 E5 F#5 | E5 D5 B4    a lazy pentatonic tune for kalimba over ukulele and pad
//   Tow theme   A4 D5 E5 | G5 E5 | F5 D5 | E5 C5 E5 A5   D mixolydian over D - C - Bb - C
//   The Lord    D - Bb - C - D   (I - bVI - bVII - I), brass and choir, the size of a building
// Every time below is derived from CUES; tempos are chosen so the downbeats land on the cues.
import { SR, TAU, mtof, nm, nf, put, put2, list, clamp, smooth, pwl, Noise, SVF, mulberry32 } from './audio-dsp.js';
import { section, brassNote, stringNote, choirNote, choirFormants, padNote, pluck, bar, taiko, timpani, boom, crash, cymbalSwell, heart, shepard } from './audio-inst.js';

const cresc = (u) => u * u * (3 - 2 * u);
const dim = (u) => 1 - cresc(u);
const hairpin = (u) => Math.sin(Math.PI * clamp(u));
const fp = (u) => (u < 0.06 ? 1 - u / 0.06 * 0.7 : 0.3 + 0.7 * cresc((u - 0.06) / 0.94));

// the sub pedal: one solid sine line under the epic parts. ev: [t, midi, level, ramp]
function subLine(G, ev, n) {
  const out = new Float32Array(n), r0 = Math.round(Math.max(0, ev[0][0] - 0.1) * SR);
  let p = 0, f = mtof(ev[0][1]), a = 0, k = -1, c = 0, tf = 0, tl = 0;
  for (let i = r0; i < n; i++) {
    const t = i / SR;
    if (k + 1 < ev.length && ev[k + 1][0] <= t) { while (k + 1 < ev.length && ev[k + 1][0] <= t) k++; const [, m, l, ramp] = ev[k]; c = 1 - Math.exp(-1 / (Math.max(0.004, ramp) * SR)); tf = mtof(m); tl = l; }
    a += (tl - a) * c; f += (tf - f) * Math.min(1, c * 2);
    p += f / SR; p -= Math.floor(p);
    out[i] = (Math.sin(TAU * p) + 0.18 * Math.sin(2 * TAU * p)) * a;
  }
  put(G, 0, out, { gain: 0.32, send: 0 });
}

export function buildMusic(C, G, N, DURATION) {
  let seed = 100; const S = () => ++seed;
  const report = [], cue = (t, l) => report.push([+t.toFixed(3), 'MUSIC', l]);
  const M = G.music, F = G.free;
  const sec = { lo: section(N), hi: section(N), vn: section(N), vc: section(N), cf: section(N), cm: section(N), pad: section(N) };

  // ---------------------------------------------------------------- players
  const LB = (t, d, ns, v, o = {}) => list(ns).forEach((n, i) => brassNote(sec.lo, t + i * 0.006, d, nm(n), v, { n: 4, gain: 0.15, pan: -0.15, spread: 0.3, maxCut: 2600, drive: 3.6, ...o, seed: S() }));
  const HB = (t, d, ns, v, o = {}) => list(ns).forEach((n, i) => brassNote(sec.hi, t + i * 0.007, d, nm(n), v, { n: 4, gain: 0.1, pan: 0.2, spread: 0.4, maxCut: 6000, drive: 2.8, ...o, seed: S() }));
  const VN = (t, d, ns, v, o = {}) => list(ns).forEach((n) => stringNote(sec.vn, t, d, nm(n), v, { pan: -0.28, gain: 0.085, n: 4, ...o, seed: S() }));
  const VC = (t, d, ns, v, o = {}) => list(ns).forEach((n) => stringNote(sec.vc, t, d, nm(n), v, { pan: 0.25, gain: 0.12, bright: 5, n: 4, ...o, seed: S() }));
  const SPIC = (t, n, v, o = {}) => VC(t, 0.06, n, v, { att: 0.005, rel: 0.07, n: 3, vib: 0, gain: 0.17, bright: 7, ...o });
  const SPICH = (t, n, v, o = {}) => VN(t, 0.05, n, v, { att: 0.004, rel: 0.06, n: 3, vib: 0, gain: 0.1, bright: 6, ...o });
  const CF = (t, d, ns, v, o = {}) => list(ns).forEach((n) => choirNote(sec.cf, t, d, nm(n), v, { gain: 0.3, ...o, seed: S() }));
  const CM = (t, d, ns, v, o = {}) => list(ns).forEach((n) => choirNote(sec.cm, t, d, nm(n), v, { gain: 0.3, ...o, seed: S() }));
  const PAD = (t, d, ns, v, o = {}) => list(ns).forEach((n, i) => padNote(sec.pad, t, d, nm(n), v, { pan: (i % 2 ? 0.3 : -0.3), gain: 0.085, ...o, seed: S() }));
  // plucked and struck
  const KAL = (t, n, v = 0.8, o = {}) => put(M, t, bar('kalimba', nm(n), v, S()), { gain: 1.15 * (o.g ?? 1), pan: o.pan ?? 0.12, send: 0.32 });
  const GLK = (t, n, v = 0.6, o = {}) => put(M, t, bar('glock', nm(n), v, S()), { gain: 0.45 * (o.g ?? 1), pan: o.pan ?? -0.2, send: 0.45 });
  const XYL = (t, n, v = 0.8, o = {}) => put(M, t, bar('xylo', nm(n), v, S()), { gain: 0.42, pan: o.pan ?? 0.25, send: 0.3 });
  const UKE = (t, ns, v = 0.6, o = {}) => list(ns).forEach((n, i) => put(M, t + i * (o.spread ?? 0.011), pluck(nm(n), { t60: 0.9, bright: 0.45, damp: 0.55, pick: 0.2, gate: o.gate ?? 0.32, body: [[230, 1.4, 4], [520, 1.6, 3]], gain: 0.2 * v }, S()), { pan: -0.35 + i * 0.08, send: 0.28 }));
  const BASS = (t, n, v = 0.8, o = {}) => put(M, t, pluck(nm(n), { t60: 1.6, bright: 0.25, damp: 0.95, pick: 0.25, gate: o.gate ?? 0.5, gain: 0.8 * v }, S()), { pan: 0.04, send: 0.1 });
  const PIZZ = (t, n, v = 0.8, o = {}) => put(M, t, pluck(nm(n), { t60: 0.5, bright: 0.5, damp: 0.75, pick: 0.15, gate: o.gate ?? 0.22, gain: 0.5 * v }, S()), { pan: o.pan ?? 0, send: 0.35 });
  const HARP = (t, n, v = 0.7, o = {}) => put(M, t, pluck(nm(n), { t60: 2.6, bright: 0.3, damp: 0.5, pick: 0.45, attack: 0.003, gain: 0.38 * v }, S()), { pan: o.pan ?? -0.1, send: 0.45 });
  const SHK = (t, v = 0.5) => { const b = new Float32Array(Math.round(0.08 * SR)), nz = new Noise(S()), h = new SVF(7200, 0.8); for (let i = 0; i < b.length; i++) { const tt = i / SR; h.run(nz.white()); b[i] = h.hp * (tt < 0.006 ? tt / 0.006 : Math.exp(-(tt - 0.006) / 0.022)) * v * 0.16; } put(M, t, b, { pan: 0.35, send: 0.2 }); };
  // percussion
  const TK = (t, v, big = 1, pan = 0) => put(M, t, taiko(v, S(), big), { gain: 0.75, pan, send: 0.3 });
  const TP = (t, n, v, ring = 1) => put(M, t, timpani(nm(n), v, S(), ring), { pan: -0.2, send: 0.32, gain: 0.85 });
  const BM = (t, v, o = {}) => put(M, t, boom(o, S()), { gain: 0.8 * v, send: 0.06 });
  const CR = (t, v, ring = 3.4) => put(M, t, crash(v, S(), ring), { pan: 0.2, send: 0.45 });
  const CS = (tPeak, rise, ring, v) => put(M, tPeak - rise, cymbalSwell(rise, ring, v, S()), { pan: -0.15, send: 0.5 });
  const ROLL = (t0, t1, n, v0, v1, rate = 15) => { for (let t = t0; t < t1; t += 1 / rate) TP(t, n, v0 + (v1 - v0) * (t - t0) / (t1 - t0), 0.35); };
  const SUB = [];
  const sb = (t, n, l, ramp = 0.03) => SUB.push([t, nm(n), l, ramp]);

  // ============================================== I. DOZING (0 .. bite) — lazy summer
  const bt = (C.nod2 - C.nod1) / 2;                  // one beat = 0.6 s; nod1 is the downbeat of bar 3
  const BAR = 4 * bt, b0 = C.nod1 - 2 * BAR;          // bar 1 starts at 0.4
  const at = (barNo, beat) => b0 + (barNo - 1) * BAR + beat * bt;
  // title: a kalimba + glock arpeggio drifts up as the title fades in
  ['D5', 'F#5', 'A5', 'D6'].forEach((n, i) => { KAL(C.titleIn + i * 0.075, n, 0.55 + i * 0.05, { g: 0.7 }); GLK(C.titleIn + 0.02 + i * 0.075, n, 0.4); });
  cue(C.titleIn, 'title: kalimba/glock arpeggio');
  // chords: [bar, beat, pad notes, uke voicing, bass]
  const CH = [
    [1, 0, ['D3', 'A3', 'C#4', 'E4'], ['A3', 'D4', 'F#4', 'C#5'], 'D2'],
    [1, 2, null, null, 'A2'],
    [2, 0, ['G2', 'D3', 'B3', 'F#4'], ['B3', 'D4', 'F#4', 'G4'], 'G2'],
    [2, 2, null, null, 'D3'],
    [3, 0, ['F#3', 'A3', 'D4', 'E4'], ['A3', 'D4', 'F#4', 'A4'], 'F#2'],
    [3, 2, ['B2', 'F#3', 'A3', 'D4'], ['B3', 'D4', 'F#4', 'A4'], 'B2'],
    [4, 0, ['E3', 'G3', 'B3', 'D4'], ['B3', 'D4', 'E4', 'G4'], 'E2'],
    [4, 1, ['A2', 'D3', 'E3', 'G3'], null, 'A2'],
  ];
  const bite = C.bite;
  for (let k = 0; k < CH.length; k++) {
    const [b, be, pad, , bass] = CH[k], t = at(b, be);
    if (pad) { let nx = k + 1; while (nx < CH.length && !CH[nx][2]) nx++; const tEnd = nx < CH.length ? at(CH[nx][0], CH[nx][1]) : bite; PAD(t, tEnd - t + 0.05, pad, b === 1 && be === 0 ? 0.8 : 1, { att: b === 1 ? 1.2 : 0.35, rel: tEnd >= bite - 0.01 ? 0.05 : 0.45 }); }
    BASS(t, bass, b === 1 ? 0.6 : 0.8, { gate: Math.min(bt * 1.6, bite - t - 0.02) });
  }
  // ukulele on the off-beats (2 and 4, with a lazy "&"), shaker on eighths
  let uk = CH[0][3];
  for (let b = 1; b <= 4; b++) for (let e = 0; e < 8; e++) {
    const t = at(b, e / 2); if (t >= C.nibble - 0.05) continue;
    for (const c of CH) if (c[3] && at(c[0], c[1]) <= t + 1e-6) uk = c[3];
    if (e === 2 || e === 6) UKE(t, uk, b === 1 ? 0.6 : 0.8);
    if (e === 7 && b > 1) UKE(t, uk.slice(1).reverse(), 0.45, { gate: 0.18 });
    if (b > 1) SHK(t + (e % 2 ? 0.035 : 0), e % 2 ? 0.75 : 0.45);
  }
  // the cozy theme on kalimba
  const MEL = [
    [1, 3, 'A4'], [1, 3.5, 'B4'],
    [2, 0, 'D5'], [2, 0.5, 'E5'], [2, 1, 'F#5'], [2, 2, 'E5'], [2, 2.5, 'D5'], [2, 3, 'B4'],
    [3, 0.5, 'A4'], [3, 1, 'B4'], [3, 1.5, 'D5'], [3, 2.5, 'F#5'], [3, 3, 'E5'], [3, 3.5, 'D5'],
    [4, 0, 'E5'], [4, 1, 'D5'], [4, 1.5, 'E5'],
  ];
  MEL.forEach(([b, be, n], i) => { const t = at(b, be); KAL(t, n, 0.62 + 0.25 * ((i * 7) % 3) / 2); if (b === 4 && be === 1.5) GLK(t, n, 0.3, { g: 0.6 }); });
  // the robot snores: a sleepy low "boop" on each nod (a muted tuba sliding down)
  [[C.nod1, 'A2'], [C.nod2, 'F#2']].forEach(([t, n]) => LB(t, 0.3, n, 0.4, { n: 2, att: 0.05, rel: 0.12, maxCut: 650, drive: 1.2, gain: 0.28, scoop: 0.2, bend: (tt) => -1.6 * smooth(tt / 0.32), pan: 0 }));
  cue(C.nod1, 'nod: snore boop'); cue(C.nod2, 'nod: snore boop');
  // BITE: the music stops on a pizzicato sting
  ['D2', 'A2', 'D3', 'F#3', 'A3', 'D4'].forEach((n, i) => PIZZ(bite + i * 0.004, n, 1, { pan: -0.3 + i * 0.12, gate: 0.16 }));
  BASS(bite, 'D2', 1, { gate: 0.12 }); XYL(bite, 'D6', 0.7, { pan: 0.3 });
  cue(bite, 'bite: pizzicato sting, music stops');

  // ============================================== II. JOLT, REEL, TOW
  const jolt = C.jolt;
  // "!": xylophone glissando up into a bright stab
  const gl = ['D5', 'E5', 'F#5', 'A5', 'B5', 'D6', 'E6', 'F#6', 'A6'];
  gl.forEach((n, i) => XYL(jolt - 0.16 + i * 0.02, n, 0.45 + i * 0.05, { pan: -0.3 + i * 0.07 }));
  XYL(jolt + 0.02, 'D7', 1, { pan: 0.3 }); GLK(jolt + 0.02, 'A6', 0.9, { g: 1.2 });
  HB(jolt + 0.02, 0.08, ['D5', 'F#5', 'A5'], 0.6, { att: 0.008, rel: 0.12, maxCut: 5000 });
  PIZZ(jolt + 0.02, 'D3', 1); PIZZ(jolt + 0.02, 'A3', 1);
  cue(jolt, 'jolt: xylophone gliss + "!" stab');
  // reel -> tow: tremolo strings creep up, timpani roll, cymbal swell into the tow downbeat
  const reel = C.reel, tow = C.tow;
  VC(reel, tow - reel, ['D2', 'A2'], 0.7, { att: 0.15, rel: 0.02, trem: 14, swell: cresc });
  ['A4', 'Bb4', 'B4', 'C5'].forEach((n, i) => { const q = (tow - reel) / 4; VN(reel + i * q, q + 0.02, [n, nm(n) + 12], 0.45 + i * 0.12, { att: 0.04, rel: 0.02, trem: 15, bright: 6 }); });
  ROLL(reel + 0.4, tow - 0.03, 'A1', 0.15, 0.8, 16);
  CS(tow, 1.6, 0.2, 0.8);
  LB(reel + 1.0, tow - reel - 1.02, ['A1', 'E2', 'A2'], 0.6, { att: 0.3, swell: cresc, rel: 0.02, maxCut: 1200 });
  TK(tow - 0.45 * 2 / 3, 0.5, 1.2); TK(tow - 0.45 / 3, 0.65, 1.2);
  cue(reel, 'reel: tremolo build, timpani roll');
  // TOW: the adventure ostinato. 8 beats from tow to below.
  const tb = (C.below - tow) / 8, T = (beat) => tow + beat * tb;
  const PROG = [['D2', ['D3', 'A3', 'D4', 'F#4'], ['A4', 'D5', 'F#5', 'D5'], 'D1'], ['C2', ['C3', 'G3', 'C4', 'E4'], ['G4', 'C5', 'E5', 'C5'], 'C1'], ['Bb1', ['Bb2', 'F3', 'Bb3', 'D4'], ['F4', 'Bb4', 'D5', 'Bb4'], 'Bb0'], ['C2', ['C3', 'G3', 'C4', 'E4'], ['G4', 'C5', 'E5', 'G5'], 'C1']];
  for (let c = 0; c < 4; c++) {
    const [root, chord, arp, sub] = PROG[c], t = T(c * 2);
    sb(t, sub, 0.55, 0.02);
    LB(t, tb * 0.55, chord, c === 0 ? 1 : 0.85, { att: 0.012, rel: 0.18, scoop: 0.3 });
    LB(t + tb * 1.5, tb * 0.3, chord.slice(0, 2), 0.7, { att: 0.012, rel: 0.12 });
    for (let s = 0; s < 8; s++) {     // 16ths across two beats
      const ts = t + s * tb / 4;
      SPIC(ts, s % 4 === 2 ? nm(root) + 12 : root, s % 4 === 0 ? 1 : 0.6 + 0.05 * c);
      if (s % 2 === 0) SPICH(ts, arp[(s / 2) % 4], 0.62 + (s === 0 ? 0.3 : 0));
    }
    TK(t, 1, 1.4, -0.1); TK(t + tb * 1.5, 0.6, 1.1, 0.25); TK(t + tb * 1.75, 0.5, 1.0, 0.25);
    if (c % 2) TK(t + tb, 0.55, 1.2, -0.25);
  }
  BM(tow, 0.9, { f0: 115, f1: 38, tau: 0.7, dur: 2.2 }); CR(tow, 0.8, 2.6); TP(tow, 'D2', 1);
  // the tow theme on horns
  const TOW = [[0, 'A4', 0.75], [0.75, 'D5', 0.25], [1, 'E5', 1], [2, 'G5', 1.5], [3.5, 'E5', 0.5], [4, 'F5', 1.5], [5.5, 'D5', 0.5], [6, 'E5', 0.75], [6.75, 'C5', 0.25], [7, 'E5', 0.5], [7.5, 'G5', 0.5]];
  TOW.forEach(([b, n, d]) => HB(T(b), d * tb * 0.95, [n, nm(n) - 12], 0.85, { att: 0.02, rel: 0.12, n: 4 }));
  VN(T(0), tb * 8, ['D6'], 0.25, { att: 0.3, rel: 0.1, trem: 16, bright: 4 });
  // the last half beat lifts into the cut
  TK(T(7.5), 0.8, 1.2); TK(T(7.75), 0.9, 1.2);
  cue(tow, 'tow: ostinato, taiko, horn theme');

  // ============================================== III. BELOW — the muffled world
  const below = C.below, eye = C.eye, look = C.look, calm = C.calm;
  sb(below, 'D1', 0.5, 0.02); sb(calm - 0.6, 'D1', 0, 0.4);
  LB(below, 0.5, ['D2', 'A2', 'D3', 'F#3'], 0.95, { att: 0.01, rel: 0.6 }); BM(below, 0.9, { f0: 90, f1: 34, tau: 1.0, dur: 3 }); TP(below, 'D2', 1); TK(below, 1, 1.5);
  VC(below + 0.1, calm - below - 0.3, ['D2', 'A2'], 0.4, { att: 0.8, rel: 0.6, bright: 2.5 });
  CM(eye - 0.2, look - eye + 0.3, ['D3', 'A3', 'E4'], 0.5, { att: 0.7, rel: 0.4 });
  CM(look, calm - look - 0.2, ['D3', 'F3', 'Bb3', 'D4'], 0.55, { att: 0.35, rel: 0.6, swell: hairpin });
  LB(look, calm - look - 0.3, ['Bb1', 'F2'], 0.32, { att: 0.5, swell: hairpin, maxCut: 600, rel: 0.4 });
  cue(below, 'below: muffled hit, sub pedal, choir hum');

  // ============================================== IV. CALM — the held breath
  const rise = C.rise, bub = C.bubbles;
  const hb = (rise - calm) / 4;                                  // four slow heartbeats into the rise
  for (let k = 0; k < 4; k++) { const t = calm + k * hb, v = 0.35 + 0.12 * k; put(M, t, heart(nf('D1') * 1.4, v, S()), { gain: 0.55, send: 0.08 }); put(M, t + 0.19, heart(nf('D1') * 1.4, v * 0.6, S()), { gain: 0.55, send: 0.08 }); }
  VN(bub, rise - bub - 0.15, ['A5'], 0.18, { att: 0.8, rel: 0.05, n: 3, bright: 2, swell: cresc });
  ROLL(bub + 0.5, rise - 0.15, 'D2', 0.05, 0.45, 14);
  CS(rise - 0.12, 1.4, 0.05, 0.5);
  cue(calm, 'calm: heartbeat only');

  // ============================================== V. THE RISE — the Lord of the Sea
  const hat = C.hatOff, peak = C.peak, blink = C.blink;
  BM(rise, 1.2, { f0: 120, f1: 34, sweep: 0.14, tau: 1.8, dur: 4.5, drive: 2.6 }); TP(rise, 'D2', 1.1); TK(rise, 1, 1.7);
  CR(rise, 0.5, 4);
  const p1 = rise + 2.0, p2 = p1 + (peak - p1) / 2;                // Bb at 23.4, C at 24.0, D at the peak
  sb(rise, 'D1', 1, 0.01); sb(p1, 'Bb0', 0.9, 0.06); sb(p2, 'C1', 0.9, 0.06); sb(peak, 'D1', 1, 0.01); sb(blink - 0.3, 'D1', 0.35, 0.4);
  LB(rise, p1 - rise + 0.02, ['D2', 'A2', 'D3'], 0.85, { att: 0.03, swell: fp, rel: 0.05, n: 6 });
  HB(rise + 1.2, p1 - rise - 1.18, ['A3', 'D4', 'F#4'], 0.7, { att: 0.2, swell: cresc, rel: 0.05 });
  CM(rise + 0.05, p1 - rise, ['D3', 'A3', 'D4'], 0.9, { att: 0.6, swell: cresc, rel: 0.1 });
  CF(rise + 0.6, p1 - rise - 0.6, ['A4', 'D5'], 0.7, { att: 0.6, swell: cresc, rel: 0.1 });
  VC(rise, peak - rise, ['D2', 'D3'], 0.8, { att: 0.1, rel: 0.02, trem: 15, swell: cresc });
  [[p1, ['Bb1', 'F2', 'Bb2', 'D3'], ['F4', 'Bb4', 'D5'], ['Bb4', 'D5', 'F5'], ['Bb2', 'F3', 'Bb3', 'D4']], [p2, ['C2', 'G2', 'C3', 'E3'], ['G4', 'C5', 'E5'], ['C5', 'E5', 'G5'], ['C3', 'G3', 'C4', 'E4']]].forEach(([t, lo, hi, cf, cm], i) => {
    const d = (i ? peak : p2) - t;
    LB(t, d + 0.01, lo, 0.88 + i * 0.05, { att: 0.03, rel: 0.04, n: 6 }); HB(t, d + 0.01, hi, 0.82 + i * 0.06, { att: 0.03, rel: 0.04 });
    CF(t, d, cf, 0.85 + i * 0.07, { att: 0.08, rel: 0.1 }); CM(t, d, cm, 0.85, { att: 0.08, rel: 0.1 });
    VN(t, d + 0.02, hi.map((n) => nm(n) + 12), 0.6 + i * 0.1, { att: 0.05, rel: 0.02, trem: 15, bright: 6 });
    TP(t, i ? 'C2' : 'Bb1', 0.95); TK(t, 0.9, 1.6); BM(t, 0.55, { f0: 100, f1: 38, tau: 0.6, dur: 1.8 });
  });
  ROLL(rise + 0.25, p1 - 0.05, 'D2', 0.25, 0.75, 15);
  ROLL(p2 + 0.1, peak - 0.03, 'C2', 0.5, 0.95, 18);
  CS(peak, 1.5, 0.2, 1);
  put(M, p1 - 0.2, shepard(peak - p1 + 0.18, { base: 147, octaves: 1.5, gain: 0.07, curve: 1.6 }, S()), { send: 0.3, pan: 0.1 });
  // PEAK: D major, everything
  const hold = blink - peak - 0.15;
  LB(peak, hold, ['D2', 'A2', 'D3', 'F#3', 'A3'], 1, { att: 0.02, swell: (u) => 1 - 0.5 * u, rel: 0.5, n: 6 });
  HB(peak, hold, ['D4', 'F#4', 'A4'], 0.95, { att: 0.02, swell: (u) => 1 - 0.45 * u, rel: 0.5 });
  [[0, 'D5', 0.55], [0.55, 'E5', 0.25], [0.8, 'F#5', 0.25], [1.05, 'A5', hold - 1.05]].forEach(([o, n, d]) => HB(peak + o, d, [n], 0.95, { att: 0.02, rel: 0.4, n: 4, pan: 0.3, maxCut: 7000 }));
  CF(peak, hold + 0.05, ['A4', 'D5', 'F#5', 'A5'], 1, { att: 0.05, rel: 0.6, swell: (u) => 1 - 0.4 * u });
  CM(peak, hold + 0.05, ['D3', 'A3', 'D4', 'F#4'], 1, { att: 0.05, rel: 0.6, swell: (u) => 1 - 0.4 * u });
  VN(peak, hold, ['D5', 'F#5', 'A5', 'D6'], 0.9, { att: 0.03, rel: 0.4, trem: 16, bright: 6 });
  VC(peak, hold, ['D2', 'D3'], 0.95, { att: 0.03, rel: 0.4, trem: 16 });
  BM(peak, 1.15, { f0: 130, f1: 34, sweep: 0.1, tau: 1.4, dur: 4 }); CR(peak, 1, 4.5); TP(peak, 'D2', 1.2); TK(peak, 1, 1.8);
  ROLL(peak + 0.15, blink - 0.4, 'A1', 0.6, 0.2, 14);
  [1, 2, 3].forEach((k) => TK(peak + k * 0.5, 0.75 - k * 0.1, 1.6));
  cue(rise, 'rise: boom, brass + choir swell D-Bb-C'); cue(peak, 'peak: D major tutti, crash');
  // BLINK: a suspended chord hangs in the air (Dsus4)
  const gulp = C.gulp, sus = gulp - 0.16 - blink;
  VN(blink - 0.05, sus, ['A4', 'D5', 'G5', 'A5'], 0.55, { att: 0.25, rel: 0.08, trem: 12, bright: 4 });
  VC(blink - 0.05, sus, ['D2', 'A2', 'D3', 'G3'], 0.55, { att: 0.25, rel: 0.08 });
  CF(blink - 0.05, sus, ['D5', 'G5', 'A5'], 0.5, { att: 0.3, rel: 0.08 });
  HB(blink, sus - 0.05, ['G4', 'A4'], 0.32, { att: 0.3, rel: 0.08, maxCut: 1600 });
  GLK(blink, 'A6', 0.35, { g: 0.6 }); GLK(blink + 0.16, 'D7', 0.3, { g: 0.5 });
  sb(gulp - 0.2, 'D1', 0, 0.02);
  cue(blink, 'blink: suspended Dsus4'); cue(gulp, 'gulp: music drops out');

  // ============================================== VI. TOPPLE & SPLASH
  const top = C.topple, spl = C.splash;
  const dq = (spl - top) / 4;
  const FALL = [['D2', ['D3', 'A3', 'D4'], ['F#4', 'A4', 'D5'], 'D1'], ['C#2', ['C#3', 'E3', 'A3'], ['E4', 'A4', 'C#5'], 'C#1'], ['Bb1', ['Bb2', 'F3', 'Bb3'], ['D4', 'F4', 'Bb4'], 'Bb0'], ['A1', ['A2', 'E3', 'A3', 'C#4'], ['E4', 'G4', 'C#5'], 'A0']];
  FALL.forEach(([root, lo, hi, s], i) => {
    const t = top + i * dq, last = i === 3, d = last ? spl - t - 0.2 : dq * 0.9;
    sb(t, s, 0.8, 0.03);
    LB(t, d, [root, ...lo], 0.8 + i * 0.05, { att: 0.02, rel: last ? 0.02 : 0.15, swell: last ? cresc : undefined, n: 6 });
    HB(t, d, hi, 0.78 + i * 0.05, { att: 0.02, rel: last ? 0.02 : 0.15, swell: last ? cresc : undefined });
    TP(t, root, 0.9); TK(t, 0.75, 1.5);
  });
  sb(spl - 0.2, 'A0', 0, 0.01);
  // the trumpets fall: D5 C#5 Bb4 A4, and the violins pour down a scale
  ['D5', 'C#5', 'Bb4', 'A4'].forEach((n, i) => HB(top + i * dq, i === 3 ? spl - top - 3 * dq - 0.2 : dq * 0.95, [n, nm(n) + 12], 0.9, { att: 0.02, rel: 0.1, n: 4, pan: 0.3 }));
  const SC = ['D6', 'C#6', 'Bb5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C#5', 'Bb4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C#4'];
  SC.forEach((n, i) => SPICH(top + 0.1 + i * (spl - top - 0.35) / SC.length, n, 0.75, { gain: 0.11 }));
  CS(spl - 0.18, 1.6, 0.05, 0.8);
  // SPLASH: the whole orchestra lands with it
  sb(spl, 'D1', 1, 0.008); sb(spl + 1.0, 'D1', 0.5, 0.4); sb(C.wave - 0.1, 'A0', 0.6, 0.3);
  LB(spl, 0.8, ['D2', 'A2', 'D3', 'F#3', 'A3'], 1, { att: 0.012, rel: 0.7, scoop: 0.35, n: 6 });
  HB(spl, 0.7, ['A3', 'D4', 'F#4', 'A4', 'D5'], 0.95, { att: 0.014, rel: 0.6 });
  CF(spl, 0.6, ['A4', 'D5', 'F#5'], 1, { att: 0.03, rel: 0.6 }); CM(spl, 0.6, ['D3', 'A3', 'D4'], 1, { att: 0.03, rel: 0.6 });
  BM(spl, 1.25, { f0: 130, f1: 34, sweep: 0.1, tau: 1.5, dur: 4 }); TP(spl, 'D2', 1.2); TK(spl, 1, 1.8); CR(spl, 1, 4.5);
  VC(spl + 0.25, C.wave - spl - 0.2, ['D2', 'A2'], 0.6, { att: 0.3, rel: 0.1, trem: 14 });
  cue(top, 'topple: brass falling D-A/C#-Bb-A'); cue(spl, 'splash: tutti hit');

  // ============================================== VII. THE WAVE, AIR, LAND
  const wave = C.wave, air = C.air, land = C.land;
  const up = ['D4', 'E4', 'F#4', 'G4', 'A4', 'B4', 'C#5', 'D5', 'E5', 'F#5', 'G5', 'A5', 'B5', 'C#6', 'D6', 'E6'];
  up.forEach((n, i) => SPICH(wave + 0.05 + i * (air - wave - 0.12) / up.length, n, 0.55 + 0.4 * i / up.length, { gain: 0.11 }));
  VC(wave, air - wave - 0.02, ['A1', 'A2'], 0.85, { att: 0.2, rel: 0.02, trem: 16, swell: cresc });
  LB(wave + 0.3, air - wave - 0.32, ['A2', 'E3', 'A3', 'C#4'], 0.85, { att: 0.3, swell: cresc, rel: 0.02 });
  HB(wave + 0.6, air - wave - 0.62, ['E4', 'A4', 'C#5'], 0.85, { att: 0.3, swell: cresc, rel: 0.02 });
  CF(wave + 0.4, air - wave - 0.42, ['E5', 'A5'], 0.75, { att: 0.5, swell: cresc, rel: 0.02 });
  ROLL(wave + 0.2, air - 0.03, 'A1', 0.2, 0.95, 18);
  CS(air, 1.3, 0.04, 0.9);
  put(M, wave + 0.1, shepard(air - wave - 0.1, { base: 110, octaves: 2, gain: 0.09, curve: 1.8 }, S()), { send: 0.3 });
  sb(wave, 'A0', 0.7, 0.3); sb(air - 0.02, 'A0', 0, 0.008);
  // AIR: one bell in the silence (bypasses the carving)
  put(F, air + 0.02, bar('bell', nm('A6'), 0.9, S(), 0.8), { gain: 0.5, pan: 0.25, send: 0.7 });
  put(F, air + 0.02, bar('glock', nm('D7'), 0.7, S()), { gain: 0.25, pan: 0.3, send: 0.7 });
  cue(air, 'air: bell sparkle in silence');
  // LAND: a comic button
  PIZZ(land, 'D2', 1); PIZZ(land, 'D3', 1); BASS(land, 'D2', 1, { gate: 0.25 }); TP(land, 'D2', 0.8); TK(land, 0.7, 1.4);
  LB(land, 0.12, ['D2', 'A2', 'D3'], 0.65, { att: 0.008, rel: 0.15 });
  cue(land, 'land: pizz + brass button');
  // calm after: a soft pad, a few kalimba drops while the robot reels in
  const hatT = C.hat;
  PAD(land + 0.35, hatT - land - 0.3, ['D3', 'A3', 'E4', 'F#4'], 0.75, { att: 0.6, rel: 0.5 });
  KAL(land + 0.9, 'A5', 0.4, { g: 0.6 }); KAL(land + 1.3, 'F#5', 0.35, { g: 0.55 });

  // ============================================== VIII. THE HAT — the theme comes home
  const fin = C.fin, fb = (fin - hatT) / 4, Tb = (b) => hatT + b * fb;
  // the hat surfaces with a glock sparkle
  ['A5', 'D6', 'F#6', 'A6'].forEach((n, i) => GLK(hatT - 0.02 + i * 0.05, n, 0.5, { g: 0.7 }));
  const FCH = [[0, 2, ['G2', 'D3', 'B3', 'F#4'], ['B3', 'D4', 'F#4', 'G4'], 'G2', ['G4', 'B4', 'D5']], [2, 1, ['A2', 'D3', 'E3', 'G3'], ['A3', 'D4', 'E4', 'G4'], 'A2', ['A4', 'D5', 'E5']], [3, 1, ['A2', 'C#3', 'E3', 'G3'], ['A3', 'C#4', 'E4', 'G4'], 'A2', ['A4', 'C#5', 'E5']]];
  FCH.forEach(([b, d, pad, uke, bass, vn]) => {
    const t = Tb(b);
    PAD(t, d * fb + 0.05, pad, 1, { att: 0.15, rel: 0.25 });
    BASS(t, bass, 0.9, { gate: d * fb * 0.9 });
    VN(t, d * fb + 0.03, vn, 0.42, { att: 0.2, rel: 0.2, n: 4, bright: 3.2, vib: 8 });
    VC(t, d * fb + 0.03, [nm(bass) + 12], 0.4, { att: 0.2, rel: 0.2, bright: 3 });
    for (let e = 0; e < d * 2; e++) { const tt = t + e * fb / 2; if (e % 2) UKE(tt, uke, 0.75); SHK(tt + 0.02, e % 2 ? 0.7 : 0.4); }
  });
  const HMEL = [[0, 'B4'], [0.5, 'D5'], [1, 'E5'], [1.5, 'F#5'], [2, 'E5'], [2.5, 'A4'], [2.75, 'B4'], [3, 'C#5'], [3.5, 'E5']];
  HMEL.forEach(([b, n], i) => { KAL(Tb(b), n, 0.8); if (i % 2 === 0) put(M, Tb(b), bar('marimba', nm(n) - 12, 0.6, S()), { gain: 0.35, pan: -0.2, send: 0.3 }); });
  // the robot puts its hat on: a little celebratory glock
  GLK(C.hatOn, 'F#6', 0.4, { g: 0.6 }); GLK(C.hatOn + 0.08, 'A6', 0.45, { g: 0.6 });
  // FIN: the cadence lands on D, harp roll, bell, and rings out
  const ring = DURATION - fin;
  sb(fin - 0.05, 'D1', 0, 0.01); sb(fin, 'D1', 0.5, 0.05); sb(fin + 0.9, 'D1', 0, 0.6);
  KAL(fin, 'D5', 1); KAL(fin, 'A5', 0.7, { g: 0.7 }); GLK(fin, 'D6', 0.7);
  put(M, fin, bar('bell', nm('D6'), 0.6, S(), 0.7), { gain: 0.28, pan: -0.25, send: 0.6 });
  ['D3', 'A3', 'D4', 'F#4', 'A4', 'D5', 'F#5', 'A5', 'D6'].forEach((n, i) => HARP(fin + i * 0.045, n, 0.65 + i * 0.02, { pan: -0.4 + i * 0.1 }));
  BASS(fin, 'D2', 1, { gate: 1.6 }); BASS(fin, 'D3', 0.5, { gate: 1.6 });
  PAD(fin, ring, ['D3', 'A3', 'C#4', 'E4', 'F#4'], 1, { att: 0.1, rel: 0.6 });
  VN(fin, ring - 0.4, ['F#4', 'A4', 'D5'], 0.42, { att: 0.15, rel: 0.6, n: 4, bright: 3.2, swell: dim });
  VC(fin, ring - 0.4, ['D3'], 0.45, { att: 0.15, rel: 0.6, bright: 3, swell: dim });
  put(M, fin, timpani(nm('D2'), 0.45, S()), { gain: 0.7, send: 0.3 });
  cue(hatT, 'hat: cozy theme returns (IV-V-I)'); cue(fin, 'fin: D major cadence, harp roll');

  // ---------------------------------------------------------- render sections
  subLine(M, SUB.sort((a, b) => a[0] - b[0]), N);
  choirFormants(sec.cf, 'f', (t) => (t < C.rise ? ['oo', 'oo', 0] : t < C.peak - 0.3 ? ['oh', 'ah', clamp((t - C.rise) / 3)] : t < C.blink - 0.2 ? ['ah', 'ah', 0] : t < C.splash - 0.1 ? ['oo', 'oo', 0] : ['ah', 'oh', clamp((t - C.splash) / 1.2)]), 0.012, S());
  choirFormants(sec.cm, 'm', (t) => (t < C.rise ? ['oo', 'oo', 0] : t < C.peak - 0.3 ? ['oo', 'oh', clamp((t - C.rise) / 2)] : t < C.splash - 0.1 ? ['oh', 'ah', 0.6] : ['ah', 'oh', clamp((t - C.splash) / 1.2)]), 0.012, S());
  put2(M, 0, sec.lo, { gain: 1, send: 0.3 });
  put2(M, 0, sec.hi, { gain: 1, send: 0.38 });
  put2(M, 0, sec.vn, { gain: 1, send: 0.4 });
  put2(M, 0, sec.vc, { gain: 1, send: 0.3 });
  put2(M, 0, sec.cf, { gain: 1.0, send: 0.55 });
  put2(M, 0, sec.cm, { gain: 1.0, send: 0.5 });
  put2(M, 0, sec.pad, { gain: 1, send: 0.45 });
  return report;
}
