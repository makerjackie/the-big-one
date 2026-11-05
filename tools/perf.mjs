import { launch } from './browser.mjs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const b = await launch();
const p = await b.newPage(); await p.setViewport({ width: 1920, height: 1038 });
await p.goto(pathToFileURL(path.join(root, 'dist/the_big_one.html')).href + '?still=1');
await p.waitForFunction('window.__ready === true');
const r = await p.evaluate(() => {
  const gl = document.getElementById('film').getContext('webgl2');
  const out = {};
  for (const t of [2, 5.8, 10.8, 13.8, 17.3, 20.5, 23.5, 26.5, 30.8, 33.2, 37.5]) {
    window.renderAt(t); gl.finish();
    const t0 = performance.now(); for (let i = 0; i < 6; i++) window.renderAt(t + i / 24); gl.finish();
    out[t] = ((performance.now() - t0) / 6).toFixed(1) + 'ms';
  }
  return out;
});
console.log(r, await p.evaluate(() => { const gl = document.getElementById('film').getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return gl.getParameter(e.UNMASKED_RENDERER_WEBGL); }));
await b.close();
