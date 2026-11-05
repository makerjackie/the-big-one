// Render platform covers straight from the film (no image generation): a real frame at the
// platform's aspect ratio, supersampled, with the title drawn in code in the film's own style.
// node tools/covers.mjs [--out release/covers]
import { launch } from './browser.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const a = process.argv.slice(2);
const OUT = path.join(root, a[a.indexOf('--out') + 1] && a.includes('--out') ? a[a.indexOf('--out') + 1] : 'release/covers');

const SIZES = [
  { key: '16x9', w: 1920, h: 1080, use: 'YouTube / B站 / 视频号横屏 / 抖音横屏' },
  { key: '16x9-720', w: 1280, h: 720, use: 'YouTube thumbnail (<2 MB)' },
  { key: '4x3', w: 1440, h: 1080, use: 'B站 / 抖音 横版封面' },
  { key: '3x4', w: 1080, h: 1440, use: '小红书 / 视频号 / 抖音 竖版封面' },
  { key: '9x16', w: 1080, h: 1920, use: 'TikTok / 抖音 / YouTube Shorts / 视频号' },
  { key: '1x1', w: 1080, h: 1080, use: 'X / Instagram / 通用' },
];

// the three cover directions; text per language; where the text sits (landscape / portrait)
const LOOKS = {
  A: {
    t: 22.8, land: 'topLeft', port: 'bottom',
    zh: { head: ['纯代码', '动画短片'], sub: '0 张 AI 生图 · Claude Opus 5.5 写的' },
    en: { head: ['100% CODE', 'ANIME SHORT'], sub: 'No image or video models · Claude Opus 5.5' },
  },
  B: {
    t: 26.3, land: 'bottomLeft', port: 'bottom',
    zh: { head: ['这只眼睛', '是代码写的'], sub: 'Opus 5.5 · 39 秒纯代码动画' },
    en: { head: ['THIS EYE', 'IS JUST CODE'], sub: 'A 39-second anime short by Claude Opus 5.5' },
  },
  C: {
    t: 36.55, land: 'topRight', port: 'top',
    zh: { head: ['AI 自己做的', '动画片'], sub: '三维 · 配乐 · 全部是代码' },
    en: { head: ['AN AI MADE', 'THIS CARTOON'], sub: 'Every frame and every sound is code' },
  },
};

fs.mkdirSync(OUT, { recursive: true });
const browser = await launch();
const manifest = [];
for (const S of SIZES) {
  const page = await browser.newPage();
  await page.setViewport({ width: Math.min(S.w, 1920), height: Math.min(S.h, 1920) });
  await page.goto(pathToFileURL(path.join(root, 'dist/the_big_one.html')).href + `?still=1&w=${S.w}&h=${S.h}&scale=2`);
  await page.waitForFunction('window.__ready === true', { timeout: 120000 });
  for (const [id, L] of Object.entries(LOOKS)) {
    for (const lang of ['zh', 'en']) {
      const place = S.w / S.h > 1.05 ? L.land : S.w / S.h < 0.95 ? L.port : (L.land.startsWith('top') ? 'top' : 'bottom');
      const data = await page.evaluate((t, txt, place, lang) => {
        window.renderAt(t);
        const c = document.getElementById('film');
        const W = c.width, H = c.height, u = Math.min(W, H) / 1080;
        const o = document.createElement('canvas'); o.width = W; o.height = H;
        const x = o.getContext('2d');
        x.drawImage(c, 0, 0);
        const top = place.startsWith('top'), left = place.endsWith('Left'), right = place.endsWith('Right');
        // a soft navy scrim behind the text for legibility
        const g = top ? x.createLinearGradient(0, 0, 0, H * 0.5) : x.createLinearGradient(0, H, 0, H * 0.5);
        g.addColorStop(0, 'rgba(10,18,60,0.55)'); g.addColorStop(1, 'rgba(10,18,60,0)');
        x.fillStyle = g; x.fillRect(0, 0, W, H);
        const font = lang === 'zh' ? '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif' : '"Arial Black", Impact, sans-serif';
        let headSize = (lang === 'zh' ? 128 : 112) * u * (W / H > 1.5 ? 1.0 : W / H > 1.05 ? 0.95 : 1.1);
        const pad = 70 * u;
        // shrink to fit: the longest line may use at most ~62% of a wide frame, 88% of a tall one
        x.font = `900 ${headSize}px ${font}`;
        const widest = Math.max(...txt.head.map((ln) => x.measureText(ln).width));
        const room = (W / H > 1.05 ? 0.62 : 0.88) * W;
        if (widest > room) headSize *= room / widest;
        const ax = left ? pad : right ? W - pad : W / 2;
        x.textAlign = left ? 'left' : right ? 'right' : 'center';
        x.textBaseline = 'alphabetic';
        x.lineJoin = 'round';
        const lines = txt.head, lh = headSize * 1.08;
        const subSize = (lang === 'zh' ? 40 : 36) * u;
        const block = lines.length * lh + subSize * 2.2;
        let y = top ? pad + headSize : H - pad - block + headSize;
        lines.forEach((ln, i) => {
          x.font = `900 ${headSize}px ${font}`;
          const tilt = (i % 2 ? 0.02 : -0.025);
          x.save(); x.translate(ax, y); x.rotate(tilt);
          x.fillStyle = 'rgba(14,20,70,0.5)'; x.fillText(ln, 8 * u, 10 * u);
          x.lineWidth = headSize * 0.16; x.strokeStyle = '#22203a'; x.strokeText(ln, 0, 0);
          x.fillStyle = i === 0 ? '#fff8ea' : '#ffd23a'; x.fillText(ln, 0, 0);
          x.restore();
          y += lh;
        });
        // subline in a pill
        x.font = `700 ${subSize}px ${lang === 'zh' ? font : '"Segoe UI", Arial, sans-serif'}`;
        const sw = x.measureText(txt.sub).width + subSize * 1.2, sh = subSize * 1.55;
        const sx = left ? ax : right ? ax - sw : ax - sw / 2, sy = y - lh + headSize * 0.45 + subSize * 0.4;
        x.fillStyle = 'rgba(34,32,58,0.82)';
        x.beginPath(); x.roundRect(sx, sy, sw, sh, sh / 2); x.fill();
        x.fillStyle = '#ffffff'; x.textBaseline = 'middle';
        x.textAlign = 'left'; x.fillText(txt.sub, sx + subSize * 0.6, sy + sh / 2 + 1);
        // the film's own title, small, in the opposite corner
        x.font = `900 ${46 * u}px "Arial Black", Impact, sans-serif`;
        x.textAlign = left ? 'right' : 'left'; x.textBaseline = 'alphabetic';
        const tx = left ? W - pad * 0.8 : pad * 0.8, ty = top ? H - pad * 0.7 : pad * 0.7 + 40 * u;
        x.lineWidth = 9 * u; x.strokeStyle = '#22203a'; x.strokeText('THE BIG ONE', tx, ty);
        x.fillStyle = '#fff8ea'; x.fillText('THE BIG ONE', tx, ty);
        return o.toDataURL('image/jpeg', 0.92);
      }, L.t, L[lang], place, lang);
      const name = `cover-${id}-${S.key}-${lang}.jpg`;
      fs.writeFileSync(path.join(OUT, name), Buffer.from(data.split(',')[1], 'base64'));
      manifest.push({ file: name, size: `${S.w}x${S.h}`, look: id, lang, use: S.use });
      console.log(name);
    }
  }
  await page.close();
}
await browser.close();
fs.writeFileSync(path.join(OUT, 'covers.json'), JSON.stringify(manifest, null, 2));
