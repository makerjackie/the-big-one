// Bundle src/ (three.js included) into one self-contained offline HTML file.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = await build({
  entryPoints: [path.join(root, 'src/main.js')], bundle: true, format: 'iife', minify: process.argv.includes('--min'),
  write: false, target: 'es2020', legalComments: 'none', logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync(path.join(root, 'src/template.html'), 'utf8').replace('<script>/*BUNDLE*/</script>', () => `<script>${js}</script>`);
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist/the_big_one.html');
fs.writeFileSync(out, html);
console.log(`wrote ${out} ${(html.length / 1024).toFixed(0)} KB`);
