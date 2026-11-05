// Render stills: node tools/snap.mjs [--scale 1] [--w 960 --h 519] [--out out/snaps] [--sheet name] t1 t2 ...  (or s:<shot name>)
import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SHOTS } from '../src/shots.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = { scale: 1, w: 1920, h: 1038, out: 'out/snaps', extra: '' };
const times = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) { opt[a.slice(2)] = args[++i]; continue; }
  if (a.startsWith('s:')) { const s = SHOTS.find((x) => x.name === a.slice(2) || x.id === a.slice(2)); times.push(+(s.t0 + (s.t1 - s.t0) * 0.5).toFixed(3)); continue; }
  if (a.startsWith('S:')) { const s = SHOTS.find((x) => x.name === a.slice(2) || x.id === a.slice(2)); for (const f of [0.08, 0.5, 0.92]) times.push(+(s.t0 + (s.t1 - s.t0) * f).toFixed(3)); continue; }
  times.push(+a);
}
const outDir = path.join(root, opt.out);
fs.mkdirSync(outDir, { recursive: true });
const browser = await launch(['--enable-webgl', `--window-size=${opt.w},${opt.h}`]);
const page = await browser.newPage();
await page.setViewport({ width: +opt.w, height: +opt.h });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.text()); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
const url = pathToFileURL(path.join(root, 'dist/the_big_one.html')).href + `?still=1&w=${opt.w}&h=${opt.h}&scale=${opt.scale}${opt.extra}`;
await page.goto(url);
await page.waitForFunction('window.__ready === true', { timeout: 60000 }).catch(() => {});
if (errs.length) console.log(errs.slice(0, 12).join('\n'));
const files = [];
for (const t of times) {
  const t0 = Date.now();
  const data = await page.evaluate(async (t) => {
    window.renderAt(t);
    const c = document.getElementById('film'), tc = document.getElementById('titles');
    const o = document.createElement('canvas'); o.width = c.width; o.height = c.height;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); x.drawImage(tc, 0, 0);
    return o.toDataURL('image/jpeg', 0.9);
  }, t);
  const f = path.join(outDir, `t${t.toFixed(2).padStart(6, '0')}.jpg`);
  fs.writeFileSync(f, Buffer.from(data.split(',')[1], 'base64'));
  files.push(f);
  console.log(f, `${Date.now() - t0} ms`);
}
if (errs.length) console.log(errs.slice(12, 30).join('\n'));
await browser.close();
if (opt.sheet && files.length > 1) {
  const { execFileSync } = await import('node:child_process');
  const cols = Math.min(3, files.length);
  const inputs = files.flatMap((f) => ['-i', f]);
  const sheet = path.join(outDir, `${opt.sheet}.jpg`);
  const n = files.length, rows = Math.ceil(n / cols);
  const pads = [];
  for (let i = n; i < rows * cols; i++) pads.push(`color=black:s=${opt.w}x${opt.h}:d=1[p${i}]`);
  const lab = files.map((_, i) => `[${i}:v]`).join('') + Array.from({ length: rows * cols - n }, (_, k) => `[p${n + k}]`).join('');
  const layout = Array.from({ length: rows * cols }, (_, i) => `${(i % cols) === 0 ? '0' : Array.from({ length: i % cols }, () => 'w0').join('+')}_${Math.floor(i / cols) === 0 ? '0' : Array.from({ length: Math.floor(i / cols) }, () => 'h0').join('+')}`).join('|');
  const fc = (pads.length ? pads.join(';') + ';' : '') + `${lab}xstack=inputs=${rows * cols}:layout=${layout},scale=${Math.min(2400, cols * opt.w)}:-2`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', fc, '-frames:v', '1', sheet]);
  console.log('sheet', sheet);
}
