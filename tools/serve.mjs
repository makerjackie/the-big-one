import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist'); const port = +(process.argv[2] ?? 5178);
http.createServer((q, r) => { const f = path.join(dir, decodeURIComponent(q.url.split('?')[0]) === '/' ? 'the_big_one.html' : decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(dir) || !fs.existsSync(f)) { r.writeHead(404); return r.end(); }
  r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html; charset=utf-8' : f.endsWith('.mp4') ? 'video/mp4' : 'application/octet-stream' }); fs.createReadStream(f).pipe(r); }).listen(port, () => console.log('serving on ' + port));
