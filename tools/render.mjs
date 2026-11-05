// Render the film frame by frame (deterministic) and mux it with the synthesized score:
// node tools/render.mjs [--scale 2] [--out dist/the_big_one.mp4]
import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FPS, DURATION } from '../src/shots.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const opt = { scale: 2, out: 'dist/the_big_one.mp4', wav: 'out/score.wav' };
for (let i = 0; i < a.length; i += 2) opt[a[i].slice(2)] = a[i + 1];
const W = 1920, H = 1038, N = Math.round(DURATION * FPS);
const b = await launch();
const p = await b.newPage(); await p.setViewport({ width: W, height: H });
await p.goto(pathToFileURL(path.join(root, 'dist/the_big_one.html')).href + `?still=1&scale=${opt.scale}`);
await p.waitForFunction('window.__ready === true');
const hasWav = fs.existsSync(path.join(root, opt.wav));
const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-i', '-'];
if (hasWav) args.push('-i', path.join(root, opt.wav));
args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-vf', 'pad=1920:1040:0:1');
if (hasWav) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
args.push(path.join(root, opt.out));
const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = Date.now();
for (let f = 0; f < N; f++) {
  const data = await p.evaluate((t) => {
    window.renderAt(t);
    const c = document.getElementById('film'), tc = document.getElementById('titles');
    const o = window.__o || (window.__o = document.createElement('canvas')); o.width = c.width; o.height = c.height;
    const x = o.getContext('2d'); x.drawImage(c, 0, 0); x.drawImage(tc, 0, 0);
    return o.toDataURL('image/jpeg', 0.96);
  }, (f + 0.5) / FPS);
  if (!ff.stdin.write(Buffer.from(data.split(',')[1], 'base64'))) await new Promise((r) => ff.stdin.once('drain', r));
  if (f % 48 === 0) process.stdout.write(`frame ${f}/${N} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await b.close();
console.log('wrote', opt.out, hasWav ? '(with score)' : '(no score yet)', `${((Date.now() - t0) / 1000).toFixed(0)}s`);
