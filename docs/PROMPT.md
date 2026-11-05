# 提示词：让 AI 用纯代码做一部动画短片

把下面这段复制给 Claude Code（建议 Opus 5.5），把【】里的内容换成你自己的。它总结了《THE BIG ONE》这次做成的全部做法，包括质量检查的流程。

---

## 中文版

```text
帮我用纯代码做一部动画短片，不用任何图像模型、视频模型或音频素材。

【故事】一句话：________（例：戴草帽的小机器人出海钓鱼，钓上来一头 220 米的远古鲸鲨，最后它把吹飞的草帽还了回来）
【时长】约 ___ 秒（30-60 秒比较合适）
【画风】日系手绘动画感：明亮夏日、深蓝天空、大积云、赛璐珞两色阴影、描线、背景水彩笔触（可以换成你想要的风格）
【声音】要配乐和音效，不要对白
【参考】可以先读 https://github.com/0xCodez/leviathan 学它的渲染管线和建模方法，但故事和角色都要原创

技术要求：
1. three.js（WebGL2），最后用 esbuild 打包成一个可以离线双击播放的 HTML；再用 puppeteer + ffmpeg 逐帧导出 1080p MP4。
2. 每一帧必须是时间的纯函数 renderAt(t)，随机数用固定种子，不要累积状态。播放时用音频时钟驱动画面。
3. 渲染管线：MRT 输出颜色和法线/深度/材质 ID → 背景水彩笔触 → 按材质 ID、深度、法线描线 → 大气 → 泛光 → 调色和胶片颗粒。角色用两色赛璐珞材质。
4. 角色一拍二、特效一拍三，像手绘动画。
5. 先写分镜：节拍表（cue 时间点）和镜头表，导演模块按时间给出相机、姿势、表情、特效。
6. 主要角色和大型生物要认真建模：在静止姿态里用截面曲线 + 雕刻做出真实形体（骨骼起伏、五官、鳍/四肢、可动的嘴和眼睑），再在 GPU 上沿骨骼弯曲；皮肤花纹在着色器里画，用凹凸法线让明暗交界线有变化。不要用一根管子或几个球糊弄。
7. 动作要有生命感：预备动作、头部滞后、身体扭转、跟随动作、落地压扁回弹。任何物体都不能瞬移。
8. 声音交给一个并行的子 Agent：按节拍表用纯 JS 合成配乐和音效，输出立体声。

质量要求（每一轮都要做）：
- 出一张全片接触表，自己当美术总监逐张挑刺，关键镜头看全分辨率，可疑处放大看。
- 写一个跳帧检测脚本，逐帧找某块区域突然大变的地方（排除切镜），揪出瞬移和穿帮。
- 远景细节按"每像素多少米"淡出，避免闪烁和噪点；水花同一团只描外轮廓。
- 检查性能，启动时预编译着色器。
- 每轮改完重新渲染 MP4，再从成片里抽帧确认。

交付：单个 HTML、1080p MP4、接触表，并告诉我哪些地方还不满意。
```

---

## English

```text
Make me an animated short film entirely in code: no image models, no video models, no audio assets.

[Story] One line: ________ (e.g. a little robot in a straw hat goes fishing, hooks a 220 m ancient whale shark, and gets back the hat the wind blew away)
[Length] about ___ seconds (30-60 works well)
[Look] hand-drawn anime feel: bright summer, deep blue sky, towering cumulus, two-tone cel shading, ink lines, painterly backgrounds (swap for your own style)
[Sound] a score and sound effects, no dialogue
[Reference] you may study https://github.com/0xCodez/leviathan for its render pipeline and modelling approach, but the story and characters must be original

Technical:
1. three.js (WebGL2), bundled with esbuild into one HTML that plays offline; export a 1080p MP4 frame by frame with puppeteer + ffmpeg.
2. Every frame is a pure function of time, renderAt(t): seeded randomness, no accumulated state. During playback the audio clock drives the picture.
3. Pipeline: MRT colour + normal/depth/material id → painterly background pass → ink lines from material id, depth and normal breaks → atmosphere → bloom → grade and grain. Characters use a two-tone cel material.
4. Characters on twos, effects on threes, like hand-drawn animation.
5. Write the shot list first: story cues and shots; a director module returns camera, poses, expressions and effects for any time.
6. Model the main characters and creatures properly: build the real form in a rest pose from section curves plus sculpting (bony ridges, face, fins/limbs, a jaw and eyelids that move), then bend it along a skeleton on the GPU; paint the skin in the shader and break the terminator with bumped normals. No single tube or stack of spheres.
7. Motion must feel alive: anticipation, the head trailing, twisting, follow-through, squash and stretch on landing. Nothing may teleport.
8. Give the sound to a parallel sub-agent: synthesize the score and effects in pure JS against the cue sheet, stereo out.

Quality, every round:
- Make a contact sheet of the whole film and critique every frame like an art director; view key shots at full resolution and zoom into anything suspicious.
- Write a pop detector that finds frames where part of the picture suddenly jumps (excluding cuts) to catch teleports and glitches.
- Fade fine detail by metres-per-pixel so distant surfaces don't sparkle; ink a splash only at its outer silhouette.
- Check performance and precompile all shaders at startup.
- Re-render the MP4 after every round and check frames from the final file.

Deliver: one HTML, a 1080p MP4, a contact sheet, and a list of what you are still not happy with.
```

---

## 小提示

- **故事要短、有一个反转**：39 秒只够讲一件事。
- **先要第一版，再挑刺**：第一版 30 多分钟就能出片，真正的质量来自后面几轮反馈。反馈说感觉就行（"粗糙""没有活物感""这里一大块白"），让 AI 自己找原因。
- **让它给你截图**：每一轮都要求它出接触表和关键帧，你看图说话最快。
- **要真实的数字**：发视频时说的帧数、时长、Agent 数，都让它从项目里实际统计。
