// Find pops: frames where some part of the picture changes far more than in the six frames before
// (cuts excluded, safe with animation on twos/threes). node tools/pops.mjs
import { launch } from './browser.mjs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHOTS, FPS, DURATION } from '../src/shots.js';
const b = await launch();
const p = await b.newPage(); await p.setViewport({ width: 480, height: 260 });
await p.goto(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../dist/the_big_one.html')).href + '?still=1&w=480&h=260');
await p.waitForFunction('window.__ready === true');
const N = Math.round(DURATION * FPS);
const diffs = await p.evaluate(async (N, FPS) => {
  const c = document.getElementById('film'), tc = document.getElementById('titles');
  const o = document.createElement('canvas'); o.width = 240; o.height = 130; const x = o.getContext('2d', { willReadFrequently: true });
  let prev = null; const out = [];
  for (let f = 0; f < N; f++) {
    renderAt((f + 0.5) / FPS);
    x.drawImage(c, 0, 0, 240, 130); x.drawImage(tc, 0, 0, 240, 130);
    const d = x.getImageData(0, 0, 240, 130).data;
    if (prev) {
      // largest change in any 12x12 block: small things popping show up too
      let mx = 0;
      for (let by = 0; by < 130 - 12; by += 6) for (let bx = 0; bx < 240 - 12; bx += 6) {
        let s = 0;
        for (let yy = by; yy < by + 12; yy++) for (let xx = bx; xx < bx + 12; xx++) { const i = (yy * 240 + xx) * 4; s += Math.abs(d[i] - prev[i]) + Math.abs(d[i + 1] - prev[i + 1]) + Math.abs(d[i + 2] - prev[i + 2]); }
        mx = Math.max(mx, s / 432);
      }
      out.push(mx);
    } else out.push(0);
    prev = d;
  }
  return out;
}, N, FPS);
const cuts = SHOTS.map((s) => Math.round(s.t0 * FPS));
const rows = diffs.map((d, f) => ({ f, t: ((f + 0.5) / FPS).toFixed(2), d, cut: cuts.some((c) => Math.abs(c - f) <= 1) })).filter((r) => !r.cut);
// a pop: one frame changes far more than any of the six before it (twos/threes animation safe)
const spikes = rows.filter((r) => { const win = diffs.slice(Math.max(0, r.f - 6), r.f); const mx = Math.max(...win, 0.5); return r.d > 25 && r.d > mx * 1.7; });
console.log(spikes.map((r) => `${r.t}s d=${r.d.toFixed(1)}`).join('\n'));
await b.close();
