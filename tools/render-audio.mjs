// Renders the score of THE BIG ONE to out/score.wav and prints levels per shot.
//   node tools/render-audio.mjs [--stems]
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderScore, encodeWav } from '../src/audio.js';
import { SHOTS, DURATION } from '../src/shots.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SR = 48000, stems = process.argv.includes('--stems');
const t0 = performance.now();
const res = renderScore(SR, { report: true, stems });
const ms = performance.now() - t0;
const { L, R, report } = res;
mkdirSync(join(root, 'out'), { recursive: true });
writeFileSync(join(root, 'out', 'score.wav'), encodeWav([L, R], SR));
if (stems) for (const [k, b] of Object.entries(res.stems)) writeFileSync(join(root, 'out', `stem-${k}.wav`), encodeWav([b.L, b.R], SR));

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -120);
const fmt = (x) => (x <= -119 ? '  -inf' : x.toFixed(1).padStart(6));
let dc = 0; for (let i = 0; i < L.length; i++) dc += L[i] + R[i]; dc /= 2 * L.length;
console.log(`render: ${ms.toFixed(0)} ms  (${JSON.stringify(report.timingsMs)})`);
console.log(`length: ${L.length} samples = ${(L.length / SR).toFixed(3)} s (DURATION ${DURATION})  peak ${report.peakDb} dBFS  RMS ${report.rmsDb} dBFS  DC ${dc.toExponential(1)}  glue GR ${report.glueGrDb} dB  limiter GR ${report.limiterGrDb} dB`);
console.log('\nshot           t0     t1    peak dBFS  RMS dBFS  max 100ms RMS');
for (const s of SHOTS) {
  const i0 = Math.round(s.t0 * SR), i1 = Math.min(L.length, Math.round(s.t1 * SR));
  let p = 0, e = 0; for (let i = i0; i < i1; i++) { p = Math.max(p, Math.abs(L[i]), Math.abs(R[i])); e += L[i] * L[i] + R[i] * R[i]; }
  const w = Math.round(0.1 * SR); let mx = 0;
  for (let a = i0; a + w <= i1; a += w) { let q = 0; for (let i = a; i < a + w; i++) q += L[i] * L[i] + R[i] * R[i]; mx = Math.max(mx, q / (2 * w)); }
  console.log(`${s.id} ${s.name.padEnd(8)} ${s.t0.toFixed(1).padStart(5)} ${s.t1.toFixed(1).padStart(6)}   ${fmt(db(p))}    ${fmt(db(Math.sqrt(e / (2 * (i1 - i0)))))}    ${fmt(db(Math.sqrt(mx)))}`);
}
if (process.argv.includes('--cues')) { console.log('\ncues:'); for (const [t, k, l] of report.cues) console.log(`  ${t.toFixed(2).padStart(6)}  ${k.padEnd(5)} ${l}`); }
console.log(`\nwrote ${join(root, 'out', 'score.wav')}`);
