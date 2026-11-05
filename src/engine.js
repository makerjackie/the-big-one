import * as THREE from 'three';
import { G, NOISE } from './glsl.js';

// Frame pipeline (after LEVIATHAN's cel + painted-background production):
//   main MRT (colour + data) -> paint (Kuwahara gouache on painted pixels only)
//   -> ink (hand-inked lines on cel pixels) -> atmosphere (haze / underwater / god rays / flash)
//   -> overlay sprites -> bloom -> grade + speed lines + grain -> canvas.

const FS_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const PAINT_FS = /* glsl */ `
uniform sampler2D tColor, tData;
uniform vec2 uRes;
uniform float uRadius, uS;
varying vec2 vUv;
out vec4 o;
${NOISE}
// Anisotropic Kuwahara: 8 overlapping sectors of an elliptical brush aligned to a slowly
// turning stroke field. Flat areas get gouache strokes, edges survive.
void main(){
  vec4 c0 = texture(tColor, vUv);
  if(c0.a < 0.5){ o = vec4(c0.rgb, 0.0); return; }
  vec2 px = 1.0 / uRes;
  vec2 fc = gl_FragCoord.xy / uS;
  float ang = (fbm2(fc / 140.0) - 0.5) * 3.2 + 0.4;
  vec2 dA = vec2(cos(ang), sin(ang)), dB = vec2(-dA.y, dA.x);
  float rad = uRadius * uS;
  vec3 m[8]; vec3 s[8]; float n[8];
  for(int k = 0; k < 8; k++){ m[k] = c0.rgb; s[k] = c0.rgb * c0.rgb; n[k] = 1.0; }
  for(int r = 1; r <= 3; r++){
    float rr = rad * float(r) / 3.0;
    for(int k = 0; k < 16; k++){
      float a = float(k) * 0.39269908 + (r == 2 ? 0.19634954 : 0.0);
      vec2 off = (dA * cos(a) * 1.45 + dB * sin(a) * 0.8) * rr;
      vec4 t = texture(tColor, vUv + off * px);
      vec3 tc = t.rgb * t.a, tq = t.rgb * t.rgb * t.a;
      if(k / 2 * 2 == k){ int i0 = k / 2; m[i0] += tc; s[i0] += tq; n[i0] += t.a; }
      else { int i0 = (k - 1) / 2, i1 = ((k + 1) / 2) % 8;
        m[i0] += tc * 0.5; s[i0] += tq * 0.5; n[i0] += t.a * 0.5;
        m[i1] += tc * 0.5; s[i1] += tq * 0.5; n[i1] += t.a * 0.5; }
    }
  }
  vec3 acc = vec3(0.0); float wsum = 0.0;
  for(int k = 0; k < 8; k++){
    vec3 mu = m[k] / n[k];
    vec3 v = abs(s[k] / n[k] - mu * mu);
    float sd = sqrt(v.r + v.g + v.b);
    float w = 1.0 / (1.0 + pow(sd * 22.0, 8.0));
    acc += mu * w; wsum += w;
  }
  vec3 col = wsum > 1e-5 ? acc / wsum : c0.rgb;
  mat2 R = mat2(dA.x, dA.y, dB.x, dB.y);
  vec2 sp = R * fc;
  float bristle = vnoise(vec2(sp.x / 26.0, sp.y / 2.2));
  float paper = vnoise(fc / 2.5) * 0.5 + vnoise(fc / 9.0) * 0.5;
  col *= 0.975 + 0.05 * bristle;
  col *= 0.99 + 0.02 * paper;
  o = vec4(col, 1.0);
}
`;

const INK_FS = /* glsl */ `
uniform sampler2D tColor, tData;
uniform vec2 uRes;
uniform float uS, uWidth, uSeed;
uniform vec3 uInk;
varying vec2 vUv;
out vec4 o;
${NOISE}
bool inked(float id){ return id > 0.5 && id < 99.5; }
vec3 nrm(vec4 d){ vec2 xy = d.rg * 2.0 - 1.0; return vec3(xy, sqrt(max(0.0, 1.0 - dot(xy, xy)))); }
float edgeAt(vec2 uv, vec4 dC, vec3 nC, float w){
  vec2 px = w / uRes;
  float e = 0.0;
  for(int k = 0; k < 8; k++){
    float a = float(k) * 0.78539816;
    vec2 off = vec2(cos(a), sin(a)) * px;
    vec4 dN = texture(tData, uv + off);
    bool cC = inked(dC.a), cN = inked(dN.a);
    if(!cC && !cN) continue;
    float ee = 0.0;
    if(abs(dN.a - dC.a) > 0.5){
      if(cC && cN) ee = 1.0;
      else if(cC) ee = (dC.a > 59.5 && dC.a < 69.5) ? ((dN.b > dC.b * 1.25 + 4.0) ? 1.0 : 0.0) : ((dC.b < dN.b + 0.5) ? 1.0 : 0.0);
      else ee = (dN.a > 59.5 && dN.a < 69.5) ? ((dC.b > dN.b * 1.25 + 4.0) ? 1.0 : 0.0) : ((dN.b < dC.b + 0.5) ? 1.0 : 0.0);
    } else if(dC.a > 59.5 && dC.a < 69.5){
      // drawn water: one mass, ink only where it meets something else
      ee = 0.0;
    } else {
      float rel = abs(dN.b - dC.b) / max(min(dN.b, dC.b), 0.01);
      ee = smoothstep(0.02, 0.045, rel);
      float nd = dot(nC, nrm(dN));
      ee = max(ee, smoothstep(0.72, 0.5, nd) * 0.8);
    }
    e = max(e, ee);
  }
  return e;
}
void main(){
  vec4 col = texture(tColor, vUv);
  vec4 dC = texture(tData, vUv);
  vec3 nC = nrm(dC);
  vec2 fc = gl_FragCoord.xy / uS;
  float press = 0.72 + 0.56 * vnoise(fc / 34.0 + uSeed * 7.0);
  float w = uWidth * uS * press;
  float e = 0.5 * edgeAt(vUv, dC, nC, w) + 0.5 * edgeAt(vUv, dC, nC, w * 0.55);
  float alpha = e * (0.82 + 0.18 * vnoise(fc / 7.0 + uSeed));
  vec3 ink = mix(uInk, col.rgb * 0.3, 0.3);
  o = vec4(mix(col.rgb, ink, clamp(alpha, 0.0, 1.0)), 1.0);
}
`;

const ATMOS_FS = /* glsl */ `
uniform sampler2D tColor, tData;
uniform vec3 uCamPos;
uniform mat4 uInvProj, uCamWorld;
uniform float uTime, uFxTime, uUnder, uHaze, uFlash, uShafts;
uniform vec3 uHazeCol, uSunDir, uFlashCol;
uniform vec2 uSunUV;
varying vec2 vUv;
out vec4 o;
${NOISE}
vec3 viewDir(vec2 uv){
  vec4 vp = uInvProj * vec4(uv * 2.0 - 1.0, 1.0, 1.0);
  return normalize(mat3(uCamWorld) * normalize(vp.xyz / vp.w));
}
void main(){
  vec3 c = texture(tColor, vUv).rgb;
  vec4 d = texture(tData, vUv);
  float depth = d.b;
  vec3 wd = viewDir(vUv);
  if(uUnder > 0.5){
    // luminous cyan sea: fog by distance, brighter looking up, drawn god rays
    float dist = depth > 0.0 ? depth : 400.0;
    vec3 deep = vec3(0.05, 0.36, 0.62), mid = vec3(0.15, 0.62, 0.82), top = vec3(0.62, 0.95, 1.0);
    vec3 fogc = mix(deep, mid, smoothstep(-0.6, 0.2, wd.y));
    fogc = mix(fogc, top, smoothstep(0.3, 0.95, wd.y));
    float f = 1.0 - exp(-dist / 140.0);
    c = mix(c, fogc, clamp(f, 0.0, 1.0));
    // god rays: columns of light hanging from the surface, drawn as hard-edged bands
    vec2 q = wd.xz / max(wd.y + 1.15, 0.05);
    float ang = atan(q.y, q.x);
    float bands = vnoise(vec2(ang * 9.0, uFxTime * 0.25)) * vnoise(vec2(ang * 23.0 + 3.0, uFxTime * 0.4));
    float ray = smoothstep(0.22, 0.3, bands) * smoothstep(-0.4, 0.6, wd.y) * min(1.0, dist / 60.0);
    c += vec3(0.55, 0.95, 1.0) * ray * 0.22 * uShafts;
    // floating motes
    vec2 mp = vUv * vec2(90.0, 50.0) + vec2(0.0, uFxTime * 0.6);
    float mote = step(0.985, hash12(floor(mp))) * smoothstep(0.35, 0.0, length(fract(mp) - 0.5));
    c += vec3(0.8, 1.0, 1.0) * mote * 0.35;
  } else if(depth < 8000.0 && depth > 0.0){
    // aerial perspective: haze grows with distance, bluish white at the horizon
    float f = 1.0 - exp(-depth * uHaze);
    float low = smoothstep(0.25, -0.02, wd.y);
    c = mix(c, uHazeCol, clamp(f * (0.55 + 0.45 * low), 0.0, 0.85));
  }
  // light shafts from the sun (painted god rays above water)
  if(uUnder < 0.5 && uShafts > 0.0){
    vec2 dv = vUv - uSunUV;
    float a = atan(dv.y, dv.x);
    float s = vnoise(vec2(a * 12.0, 0.0)) * vnoise(vec2(a * 31.0, 5.0));
    float fall = smoothstep(1.2, 0.0, length(dv));
    c += uSunDir.y > 0.0 ? vec3(1.0, 0.97, 0.88) * smoothstep(0.18, 0.3, s) * fall * 0.12 * uShafts : vec3(0.0);
  }
  c = mix(c, uFlashCol, uFlash);
  o = vec4(c, 1.0);
}
`;

const BRIGHT_FS = /* glsl */ `
uniform sampler2D tColor; uniform float uThreshold;
varying vec2 vUv; out vec4 o;
void main(){ vec3 c = texture(tColor, vUv).rgb; float l = max(c.r, max(c.g, c.b)); o = vec4(c * smoothstep(uThreshold, uThreshold + 0.4, l), 1.0); }
`;
const BLUR_FS = /* glsl */ `
uniform sampler2D tColor; uniform vec2 uDir;
varying vec2 vUv; out vec4 o;
void main(){
  vec3 s = texture(tColor, vUv).rgb * 0.227;
  s += texture(tColor, vUv + uDir * 1.385).rgb * 0.316; s += texture(tColor, vUv - uDir * 1.385).rgb * 0.316;
  s += texture(tColor, vUv + uDir * 3.231).rgb * 0.070; s += texture(tColor, vUv - uDir * 3.231).rgb * 0.070;
  o = vec4(s, 1.0);
}
`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tColor, tBloom1, tBloom2;
uniform vec2 uRes;
uniform float uS, uFrame, uBloom, uVignette, uGrain, uFade, uSpeed, uSat, uExposure, uGamma, uVibrance, uLetter;
uniform vec3 uLift, uGain, uFadeColor;
uniform vec2 uSpeedC;
varying vec2 vUv;
out vec4 o;
${NOISE}
void main(){
  vec2 px = 1.0 / uRes;
  vec3 c;
  if(uS > 1.5){
    c = (texture(tColor, vUv + px * vec2(-0.5, -0.5)).rgb + texture(tColor, vUv + px * vec2(0.5, -0.5)).rgb +
         texture(tColor, vUv + px * vec2(-0.5, 0.5)).rgb + texture(tColor, vUv + px * vec2(0.5, 0.5)).rgb) * 0.25;
  } else c = texture(tColor, vUv).rgb;
  vec3 b = texture(tBloom1, vUv).rgb * 0.6 + texture(tBloom2, vUv).rgb * 0.8;
  c += b * uBloom;
  c = c / (1.0 + max(c - 1.0, 0.0) * 0.6);
  c *= uExposure;
  c = pow(max(c, 0.0), vec3(uGamma));
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  float chroma = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c = mix(vec3(l), c, uSat * (1.0 + uVibrance * (1.0 - chroma)));
  c = uLift + c * (uGain - uLift);
  vec2 q = vUv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 1.6;
  // anime speed lines: white radial streaks toward the frame edge, redrawn on threes
  if(uSpeed > 0.0){
    vec2 dv = (vUv - uSpeedC) * vec2(uRes.x / uRes.y, 1.0);
    float a = atan(dv.y, dv.x), r = length(dv);
    float fr = floor(uFrame / 3.0);
    float lane = floor(a * 70.0);
    float on = step(0.62, hash12(vec2(lane, fr)));
    float w = abs(fract(a * 70.0) - 0.5);
    float line = on * smoothstep(0.18, 0.05, w) * smoothstep(0.35 + 0.25 * hash12(vec2(lane, fr + 7.0)), 0.95, r);
    c = mix(c, vec3(1.0), line * uSpeed * 0.75);
  }
  float g = hash12(gl_FragCoord.xy + uFrame * 17.31) - 0.5;
  c += g * uGrain;
  c = mix(c, uFadeColor, uFade);
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`;

function fsMat(fs, uniforms) {
  return new THREE.ShaderMaterial({ glslVersion: THREE.GLSL3, vertexShader: FS_VERT, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false });
}

export class Engine {
  constructor(canvas, W, H, S) {
    this.W = W; this.H = H; this.S = S;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    r.setPixelRatio(1);
    r.setSize(W, H, false);
    r.autoClear = false;
    r.outputColorSpace = THREE.LinearSRGBColorSpace;
    const IW = this.IW = Math.round(W * S), IH = this.IH = Math.round(H * S);
    const half = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
    this.rtMain = new THREE.WebGLRenderTarget(IW, IH, {
      count: 2, type: THREE.HalfFloatType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthTexture: new THREE.DepthTexture(IW, IH, THREE.FloatType),
    });
    this.rtMain.textures[0].minFilter = this.rtMain.textures[0].magFilter = THREE.LinearFilter;
    this.rtA = new THREE.WebGLRenderTarget(IW, IH, half);
    this.rtB = new THREE.WebGLRenderTarget(IW, IH, half);
    const bw = Math.round(IW / 4), bh = Math.round(IH / 4);
    this.rtBl = [0, 1, 2, 3].map((i) => new THREE.WebGLRenderTarget(i < 2 ? bw : bw >> 1, i < 2 ? bh : bh >> 1, half));
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene = new THREE.Scene(); this.quadScene.add(this.quad);
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const res = new THREE.Vector2(IW, IH);
    this.mPaint = fsMat(PAINT_FS, { tColor: { value: null }, tData: { value: null }, uRes: { value: res }, uRadius: { value: 4 }, uS: { value: S } });
    this.mInk = fsMat(INK_FS, { tColor: { value: null }, tData: { value: null }, uRes: { value: res }, uS: { value: S }, uWidth: { value: 1.2 }, uSeed: { value: 0 }, uInk: { value: new THREE.Color('#22203a') } });
    this.mAtmos = fsMat(ATMOS_FS, {
      tColor: { value: null }, tData: { value: null }, uCamPos: { value: new THREE.Vector3() }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() },
      uTime: G.uTime, uFxTime: G.uFxTime, uUnder: G.uUnder, uSunDir: G.uSunDir,
      uHaze: { value: 0.00035 }, uHazeCol: { value: new THREE.Color('#d8eeff') }, uFlash: { value: 0 }, uFlashCol: { value: new THREE.Color('#ffffff') },
      uShafts: { value: 0 }, uSunUV: { value: new THREE.Vector2(0.5, 0.5) },
    });
    this.mBright = fsMat(BRIGHT_FS, { tColor: { value: null }, uThreshold: { value: 1.0 } });
    this.mBlur = fsMat(BLUR_FS, { tColor: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.mFinal = fsMat(FINAL_FS, {
      tColor: { value: null }, tBloom1: { value: null }, tBloom2: { value: null }, uRes: { value: res }, uS: { value: S },
      uFrame: { value: 0 }, uBloom: { value: 0.8 }, uVignette: { value: 0.14 }, uGrain: { value: 0.022 }, uFade: { value: 0 },
      uExposure: { value: 1.08 }, uGamma: { value: 0.88 }, uVibrance: { value: 0.3 }, uSat: { value: 1.05 }, uLetter: { value: 0 },
      uLift: { value: new THREE.Color('#120e22') }, uGain: { value: new THREE.Color('#fffaf2') },
      uFadeColor: { value: new THREE.Color('#000000') }, uSpeed: { value: 0 }, uSpeedC: { value: new THREE.Vector2(0.5, 0.5) },
    });
    this._v = new THREE.Vector3();
  }

  pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, overlay, cam, opt) {
    const r = this.renderer;
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    r.setRenderTarget(this.rtMain);
    r.setClearColor(0x000000, 0);
    r.clear(true, true, false);
    r.render(scene, cam);

    this.mPaint.uniforms.tColor.value = this.rtMain.textures[0];
    this.mPaint.uniforms.tData.value = this.rtMain.textures[1];
    this.mPaint.uniforms.uRadius.value = opt.paintRadius ?? 4;
    this.pass(this.mPaint, this.rtA);
    const ink = this.mInk.uniforms;
    ink.tColor.value = this.rtA.texture; ink.tData.value = this.rtMain.textures[1];
    ink.uSeed.value = opt.inkSeed ?? 0; ink.uWidth.value = opt.inkWidth ?? 1.2;
    this.pass(this.mInk, this.rtB);

    const a = this.mAtmos.uniforms;
    a.tColor.value = this.rtB.texture; a.tData.value = this.rtMain.textures[1];
    a.uCamPos.value.setFromMatrixPosition(cam.matrixWorld);
    a.uInvProj.value.copy(cam.projectionMatrixInverse); a.uCamWorld.value.copy(cam.matrixWorld);
    a.uHaze.value = opt.haze ?? 0.00035;
    a.uFlash.value = opt.flash ?? 0;
    a.uShafts.value = opt.shafts ?? 0;
    const sp = this._v.copy(G.uSunDir.value).multiplyScalar(5000).add(a.uCamPos.value).project(cam);
    a.uSunUV.value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
    this.pass(this.mAtmos, this.rtA);
    if (overlay) { r.setRenderTarget(this.rtA); r.render(overlay, cam); }

    this.mBright.uniforms.tColor.value = this.rtA.texture;
    this.pass(this.mBright, this.rtBl[0]);
    const blur = (src, dst, dx, dy, tw, th) => { this.mBlur.uniforms.tColor.value = src.texture; this.mBlur.uniforms.uDir.value.set(dx / tw, dy / th); this.pass(this.mBlur, dst); };
    const [b0, b1, b2, b3] = this.rtBl;
    blur(b0, b1, 1, 0, b0.width, b0.height); blur(b1, b0, 0, 1, b0.width, b0.height);
    blur(b0, b2, 1, 0, b0.width, b0.height); blur(b2, b3, 0, 1, b2.width, b2.height);
    blur(b3, b2, 2, 0, b2.width, b2.height); blur(b2, b3, 0, 2, b2.width, b2.height);
    const f = this.mFinal.uniforms;
    f.tColor.value = this.rtA.texture; f.tBloom1.value = b0.texture; f.tBloom2.value = b3.texture;
    f.uFrame.value = opt.frame ?? 0;
    f.uFade.value = opt.fade ?? 0;
    f.uFadeColor.value.set(opt.fadeColor ?? '#000000');
    f.uSpeed.value = opt.speed ?? 0;
    if (opt.speedC) f.uSpeedC.value.set(opt.speedC[0], opt.speedC[1]);
    f.uBloom.value = opt.bloom ?? 0.8;
    r.setRenderTarget(null);
    r.setViewport(0, 0, this.W, this.H);
    this.quad.material = this.mFinal;
    r.render(this.quadScene, this.quadCam);
  }
}
