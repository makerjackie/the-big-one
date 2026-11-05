// Sound department — the soundtrack of THE BIG ONE.
// renderScore(SR) synthesizes the whole 39 s mix in pure JS (no samples, no Web Audio nodes),
// deterministic and identical in Node and the browser. Everything is locked to CUES.
//
//   music (audio-music.js) -> hall FDN ----------\
//   sfx   (audio-sfx.js)   -> open-air FDN -------+-> underwater muffle -> carved gaps -> sum
//   under (in the water)   -> deep FDN -----------/        (music + sfx only)
//   free  (the air bell)   -> hall FDN, never carved -----------------------------------> sum
//   sum -> high-pass, mono lows, tone EQ -> glue compressor -> look-ahead limiter -> -1 dBFS peak
import { CUES, DURATION, SHOTS } from './shots.js';
import { setSR, SR, Biquad, group, peakOf, rmsOf, dbToGain, gainToDb, encodeWav } from './audio-dsp.js';
import { fdnReverb, activeRange, glue, limit, monoLows, sweepLP, carve, eq, highpass } from './audio-master.js';
import { buildMusic } from './audio-music.js';
import { buildSfx } from './audio-sfx.js';

export const PEAK_DB = -1.0;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// cutoff curve (Hz) for the underwater perspective: per sample-block lookup with a short glide
function muffleCurve(hzUnder, rate = 1000) {
  const n = Math.ceil(DURATION * rate) + 2, a = new Float32Array(n), k = 1 - Math.exp(-1 / (0.012 * rate));
  let y = Math.log(20000);
  for (let i = 0; i < n; i++) {
    const t = i / rate, s = SHOTS.find((x) => t >= x.t0 && t < x.t1) || SHOTS[SHOTS.length - 1];
    y += (Math.log(s.set === 'under' ? hzUnder : 20000) - y) * k; a[i] = y;
  }
  return (t) => Math.exp(a[Math.min(n - 1, Math.round(t * rate))]);
}
const mixInto = (dst, src, g = 1) => { for (let i = 0; i < dst.L.length; i++) { dst.L[i] += src.L[i] * g; dst.R[i] += src.R[i] * g; } };

export function renderScore(sampleRate = 48000, opts = {}) {
  const T0 = now();
  setSR(sampleRate);
  const N = Math.ceil(DURATION * SR), C = CUES;
  const G = { music: group(N), free: group(N), sfx: group(N), under: group(N) };
  const report = [...buildMusic(C, G, N, DURATION)];
  const tMusic = now();
  report.push(...buildSfx(C, G, N, DURATION));
  const tSfx = now();

  // ---- rooms
  fdnReverb(G.music.send.L, G.music.send.R, G.music.dry.L, G.music.dry.R, { rt60: 2.3, damp: 5200, size: 1.25, pre: 0.025, lo: 160, wet: 0.85 });
  fdnReverb(G.free.send.L, G.free.send.R, G.free.dry.L, G.free.dry.R, { rt60: 2.6, damp: 7000, size: 1.25, pre: 0.03, lo: 300, wet: 0.9 });
  fdnReverb(G.sfx.send.L, G.sfx.send.R, G.sfx.dry.L, G.sfx.dry.R, { rt60: 1.2, damp: 4200, size: 0.9, pre: 0.035, lo: 200, wet: 0.7 });
  fdnReverb(G.under.send.L, G.under.send.R, G.under.dry.L, G.under.dry.R, { rt60: 2.6, damp: 900, size: 1.4, pre: 0.012, lo: 60, wet: 0.9 });
  const tRev = now();

  // ---- perspective: under the surface the score and the air go behind water
  const M = G.music.dry, X = G.sfx.dry;
  sweepLP(M.L, M.R, muffleCurve(650), 0.03);
  sweepLP(X.L, X.R, muffleCurve(420), 0.01);
  { const [a, b] = activeRange(G.under.dry.L, G.under.dry.R); eq(G.under.dry.L.subarray(a, b), G.under.dry.R.subarray(a, b), () => [Biquad.lp(1400, 0.6)]); }

  // ---- silence is carved after the reverbs so it is real
  const GAPS = [
    [C.rise - 0.16, C.rise - 0.006, -24, 0.05, 0.003],      // the held breath before the breach
    [C.splash - 0.13, C.splash - 0.006, -12, 0.03, 0.003],  // it hangs; then the crash
    [C.air + 0.015, C.land - 0.01, -24, 0.035, 0.003],      // airborne: nothing but the bell
  ];
  const MGAPS = [
    [C.bite + 0.55, C.jolt - 0.2, -18, 0.3, 0.02],          // the music has stopped
    [C.gulp - 0.1, C.topple - 0.03, -40, 0.06, 0.01],       // the gulp stands alone
  ];
  carve(M.L, M.R, [...GAPS, ...MGAPS]); carve(X.L, X.R, GAPS); carve(G.under.dry.L, G.under.dry.R, GAPS);

  // ---- sum
  const L = new Float32Array(N), R = new Float32Array(N), out = { L, R };
  mixInto(out, M, 1); mixInto(out, X, 1); mixInto(out, G.under.dry, 1); mixInto(out, G.free.dry, 1);
  const stems = opts.stems ? { music: M, sfx: X, under: G.under.dry } : null;

  // ---- master
  highpass(L, R, 24);
  monoLows(L, R, 110);
  eq(L, R, () => [Biquad.peak(320, 0.9, -1.5), Biquad.peak(2800, 1.0, 1.0), Biquad.hishelf(10000, -1.2)]);
  // glue sits at a fixed level relative to the loudest moment, so the quiet scenes stay quiet
  { const p = peakOf(L, R), k = dbToGain(-6) / Math.max(1e-9, p); for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; } }
  const glueGr = glue(L, R, { thr: -20, ratio: 2.2, knee: 10, att: 0.025, rel: 0.3, look: 0.005 });
  // drive the limiter ~2.5 dB into the biggest hits, then land the peak at PEAK_DB
  const ceil = dbToGain(PEAK_DB);
  { const p = peakOf(L, R), k = ceil * dbToGain(2.5) / Math.max(1e-9, p); for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; } }
  const limGr = limit(L, R, ceil * 0.999, 0.004, 0.12);
  { const p = peakOf(L, R), k = ceil / Math.max(1e-9, p); for (let i = 0; i < N; i++) { L[i] *= k; R[i] *= k; } }
  // fades: no click at the head, and the sea fades out over the last moments
  const fi = Math.round(0.02 * SR), f0 = Math.round((DURATION - 0.6) * SR);
  for (let i = 0; i < fi; i++) { const k = i / fi; L[i] *= k; R[i] *= k; }
  for (let i = f0; i < N; i++) { const u = (i - f0) / Math.max(1, N - 1 - f0), k = Math.cos(u * Math.PI / 2) ** 2; L[i] *= k; R[i] *= k; }
  L[N - 1] = 0; R[N - 1] = 0;
  const T1 = now();

  const res = { L, R };
  if (opts.report) {
    res.report = {
      sampleRate: SR, samples: N, peakDb: +gainToDb(peakOf(L, R)).toFixed(2), rmsDb: +gainToDb(rmsOf(L, R)).toFixed(2),
      glueGrDb: +glueGr.toFixed(2), limiterGrDb: +limGr.toFixed(2),
      cues: report.sort((a, b) => a[0] - b[0]),
      timingsMs: { music: Math.round(tMusic - T0), sfx: Math.round(tSfx - tMusic), reverbs: Math.round(tRev - tSfx), master: Math.round(T1 - tRev), total: Math.round(T1 - T0) },
    };
  }
  if (stems) res.stems = stems;
  return res;
}

export { encodeWav };
