# THE BIG ONE

![THE BIG ONE](docs/cover.jpg)

**A 39-second anime short made 100% in code by Claude Opus 5.5.** No image models, no video models, no audio files: every frame is rendered by three.js and the score is synthesized in JavaScript. The whole film is one 716 KB HTML file that plays offline.

**一部 100% 用代码做的 39 秒动画短片，由 Claude Opus 5.5 编写。** 没有图像模型、视频模型，也没有音频文件：每一帧都由 three.js 实时渲染，配乐和音效用 JavaScript 合成。整部片子是一个 716 KB 的 HTML，离线双击就能播。

> A little robot goes fishing in a straw hat and hooks a 220-metre ancient whale shark... which gives back the hat the wind blew away.
>
> 戴草帽的小机器人出海钓鱼，钓上来一头 220 米的远古鲸鲨……最后它把被吹飞的草帽还了回来。

## Watch / 观看

- **Play it**: download [`the_big_one.html`](the_big_one.html) and open it in Chrome / Edge / Safari, then press ▶ PLAY. Space pauses, ← → seek, F fullscreen, `?scale=2` supersamples.
- **Video**: 1920×1040 MP4 in the [Releases](https://github.com/makerjackie/the-big-one/releases).

## Numbers / 数据

- 13 shots, 936 frames at 24 fps, 1920×1040
- ~5,800 lines of code in 26 source files
- 3 agents: a director agent (rendering, modeling, animation) plus two in parallel (score & sound, props)
- First cut (with music) in about half an hour; three rounds of notes after that, a little over 2 hours of agent work in total

## How it was made / 怎么做的

- [docs/PLAYBOOK.md](docs/PLAYBOOK.md): what worked, what broke and how it was fixed (中文复盘)
- [docs/PROMPT.md](docs/PROMPT.md): **a prompt you can give Claude Code to make your own short** (中文 / English)

In one paragraph: every frame is a pure function of time (`renderAt(t)`); the look comes from a post pipeline (MRT colour + normal/depth/material id → painterly Kuwahara pass → ink lines → atmosphere → bloom → grade); characters are drawn on twos and effects on threes; the whale shark is sculpted once in a rest pose and bent along a spine on the GPU; the audio clock drives the picture.

## Build / 构建

```bash
npm install
npm run build          # dist/the_big_one.html (npm run build:min for the small one)
npm run serve          # http://localhost:5178
npm run snap -- 22.8 27.0     # stills at film times → out/snaps
npm run audio          # out/score.wav
npm run render         # dist/the_big_one.mp4 (needs ffmpeg and out/score.wav)
npm run covers         # platform covers rendered from the film → release/covers
npm run pops           # find frames where something suddenly jumps
```

The render tools drive headless Chrome; set `CHROME=/path/to/chrome` if it isn't found.

## Layout / 结构

| File | What |
|---|---|
| `src/shots.js` | story cues and the shot list |
| `src/director.js` | cameras, poses, expressions and effects for any time |
| `src/engine.js` | the render pipeline: paint, ink, atmosphere, bloom, grade |
| `src/materials.js`, `src/glsl.js` | cel material and shared GLSL |
| `src/lord.js` | the whale shark: sculpted rest-space body, GPU spine skinning, hide shader |
| `src/robot.js`, `src/boat.js`, `src/gulls.js`, `src/school.js` | characters and props |
| `src/sky.js`, `src/ocean.js`, `src/fx.js` | sky and clouds, the drawn sea, water effects |
| `src/audio*.js` | the synthesized score and sound effects |
| `src/player.js`, `src/template.html` | the offline player page |
| `tools/` | build, stills, MP4 render, covers, pop detector, perf |

## Credits / 致谢

Rendering approach, cloud layout and the spine-skinned creature technique were learned from [0xCodez/leviathan](https://github.com/0xCodez/leviathan) (MIT, © 2026 Beyond Dev); see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Story, characters, models, music and all other code are original.

Made by [MakerJackie](https://makerjackie.com) with Claude Opus 5.5.

## License

MIT
