import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';

// The sea: a polar grid that follows the camera, displaced by one height field that is
// mirrored in JS (oceanHeight) so boats float on exactly what is drawn.
// Drawn as painted background (id 0): cobalt-to-turquoise tones, drawn white wave dashes,
// foam, wakes, the colossal shadow under the sea, and the luminous surface seen from below.

export const OCEAN = {
  uWT: { value: 0 },                                       // water time (on twos)
  uCalm: { value: 0 },                                     // 0..1 flatten the swell
  uSwellAmp: { value: 1 },
  uBulge: { value: new THREE.Vector4(0, 0, 0, 30) },      // x, z, amp, radius
  uRing: { value: new THREE.Vector4(0, 0, -99, 0) },      // x, z, start time, amp
  uRingB: { value: new THREE.Vector4(18, 14, 0.25, 0) },  // speed, width, decay
  uFoam: { value: Array.from({ length: 12 }, () => new THREE.Vector4(0, 0, 0, 0)) },   // x, z, radius, strength
  uRip: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },   // x, z, start, amp (drawn ripple rings)
  uWake: { value: new THREE.Vector4(0, 0, 0, 0) },        // x, z, heading, strength
  uWakeB: { value: new THREE.Vector4(60, 1, 0, 0) },      // length, width scale
  uShadow: { value: new THREE.Vector4(0, 0, 0, 0) },      // x, z, heading, strength
  uShadowB: { value: new THREE.Vector4(160, 40, 0, 0) },  // half length, half width
};

const WAVES = [   // dir x, dir z, wavelength, amplitude
  [1.0, 0.3, 38, 0.30], [0.6, -0.8, 21, 0.19], [-0.3, 1.0, 12.5, 0.11], [0.9, 0.9, 7.2, 0.06],
];
const WGLSL = WAVES.map(([x, z, L, A], i) => {
  const l = Math.hypot(x, z), k = (2 * Math.PI) / L, w = Math.sqrt(9.81 * k);
  return `h += ${A.toFixed(3)} * sin(dot(vec2(${(x / l).toFixed(4)}, ${(z / l).toFixed(4)}), p) * ${k.toFixed(5)} - ${w.toFixed(5)} * t + ${(i * 1.7).toFixed(2)});`;
}).join('\n  ');

const HEIGHT_GLSL = /* glsl */ `
uniform float uWT, uCalm, uSwellAmp;
uniform vec4 uBulge, uRing, uRingB;
float oceanH(vec2 p){
  float t = uWT;
  float h = 0.0;
  ${WGLSL}
  h *= (1.0 - uCalm) * uSwellAmp;
  vec2 bq = p - uBulge.xy;
  h += uBulge.z * exp(-dot(bq, bq) / (uBulge.w * uBulge.w));
  float age = t - uRing.z;
  if(age > 0.0 && uRing.w > 0.0){
    float r = length(p - uRing.xy);
    float x = (r - age * uRingB.x) / uRingB.y;
    float env = uRing.w * exp(-age * uRingB.z) * smoothstep(0.0, 0.5, age);
    h += env * (exp(-x * x) - 0.35 * exp(-(x + 1.7) * (x + 1.7)));
  }
  return h;
}
`;

export function oceanHeight(x, z) {
  const t = OCEAN.uWT.value;
  let h = 0;
  WAVES.forEach(([dx, dz, L, A], i) => {
    const l = Math.hypot(dx, dz), k = (2 * Math.PI) / L, w = Math.sqrt(9.81 * k);
    h += A * Math.sin(((dx / l) * x + (dz / l) * z) * k - w * t + i * 1.7);
  });
  h *= (1 - OCEAN.uCalm.value) * OCEAN.uSwellAmp.value;
  const B = OCEAN.uBulge.value;
  h += B.z * Math.exp(-((x - B.x) ** 2 + (z - B.y) ** 2) / (B.w * B.w));
  const Rg = OCEAN.uRing.value, RB = OCEAN.uRingB.value;
  const age = t - Rg.z;
  if (age > 0 && Rg.w > 0) {
    const r = Math.hypot(x - Rg.x, z - Rg.y);
    const q = (r - age * RB.x) / RB.y;
    const sx = Math.min(1, age / 0.5);
    const env = Rg.w * Math.exp(-age * RB.z) * sx * sx * (3 - 2 * sx);
    h += env * (Math.exp(-q * q) - 0.35 * Math.exp(-((q + 1.7) ** 2)));
  }
  return h;
}

export function makeOcean(scene) {
  // polar grid: rings densest at the camera, out to 16 km
  const NR = 230, NA = 288, r0 = 0.35, rMax = 16000;
  const g = Math.pow(rMax / r0, 1 / (NR - 1));
  const pos = [0, 0, 0];
  for (let i = 0; i < NR; i++) {
    const r = r0 * Math.pow(g, i);
    for (let j = 0; j < NA; j++) { const a = (j / NA) * Math.PI * 2; pos.push(Math.cos(a) * r, 0, Math.sin(a) * r); }
  }
  const idx = [];
  for (let j = 0; j < NA; j++) idx.push(0, 1 + ((j + 1) % NA), 1 + j);
  for (let i = 0; i < NR - 1; i++) {
    for (let j = 0; j < NA; j++) {
      const a = 1 + i * NA + j, b = 1 + i * NA + ((j + 1) % NA), c = a + NA, d = b + NA;
      idx.push(a, b, c, b, d, c);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, ...OCEAN, uCenter: { value: new THREE.Vector2() } },
    vertexShader: `
      uniform vec2 uCenter;
      ${HEIGHT_GLSL}
      varying vec3 vWorld; varying float vDepth;
      void main(){
        vec2 p = position.xz + uCenter;
        vec3 wp = vec3(p.x, oceanH(p), p.y);
        vWorld = wp;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vDepth = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      ${COMMON}
      ${MRT_OUT}
      ${HEIGHT_GLSL}
      uniform vec4 uFoam[12];
      uniform vec4 uRip[6];
      uniform vec4 uWake, uWakeB, uShadow, uShadowB;
      varying vec3 vWorld; varying float vDepth;
      vec2 rot(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x + s * v.y, -s * v.x + c * v.y); }
      // drawn wave dashes: short white crescents scattered in cells, redrawn on threes
      float dashes(vec2 q, float seed){
        vec2 ci = floor(q), f = fract(q);
        float m = 0.0;
        for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
          vec2 c = ci + vec2(float(i), float(j));
          vec2 h = hash22(c + seed);
          if(h.x > 0.55) continue;
          vec2 o = vec2(float(i), float(j)) + 0.2 + 0.6 * h - f;
          float len = 0.25 + 0.35 * h.y;
          vec2 e = o / vec2(len, len * 0.16);
          float d = length(e);
          float cres = smoothstep(1.0, 0.86, d) * smoothstep(-0.3, 0.25, -o.y * 6.0 + e.x * e.x * 0.6);
          m = max(m, cres);
        }
        return m;
      }
      void main(){
        vec3 p = vWorld;
        float dist = length(cameraPosition - p);
        float eps = max(0.08, dist * 0.004);
        float hC = oceanH(p.xz);
        vec3 N = normalize(vec3(hC - oceanH(p.xz + vec2(eps, 0.0)), eps, hC - oceanH(p.xz + vec2(0.0, eps))));
        vec3 V = normalize(cameraPosition - p);
        float ft = uFxTime;
        bool below = cameraPosition.y < oceanH(cameraPosition.xz);
        if(below){
          // seen from below: a bright rippling ceiling with Snell's window
          vec3 wd = -V;
          float win = smoothstep(0.55, 0.75, wd.y);
          vec2 q = p.xz * 0.09 + vec2(ft * 0.2, ft * 0.13);
          float web = vnoise(q * 2.0) * vnoise(q * 2.7 + 3.0);
          vec3 c = mix(vec3(0.16, 0.6, 0.82), vec3(0.78, 0.98, 1.0), win);
          c += vec3(0.6, 1.0, 1.0) * smoothstep(0.3, 0.36, web) * 0.4;
          c = mix(c, vec3(1.0), smoothstep(0.97, 0.995, dot(wd, normalize(uSunDir * vec3(0.6, 1.0, 0.6)))) * 0.8);
          writeOut(c, vec3(0.0, 0.0, 1.0), vDepth, 0.0);
          return;
        }
        // ---- base tones
        vec3 deep = vec3(0.04, 0.2, 0.7), mid = vec3(0.1, 0.42, 0.9), light = vec3(0.42, 0.76, 0.98), turq = vec3(0.05, 0.55, 0.8);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        float far = smoothstep(150.0, 3500.0, dist);
        vec3 c = mix(mix(turq, deep, 0.55), deep, far * 0.6);
        // painted mottling: broad patches of lighter water, drifting slowly
        float m = fbm2(p.xz * vec2(0.012, 0.03) + vec2(ft * 0.03, 0.0));
        c = mix(c, mid, smoothstep(0.5, 0.56, m) * 0.75);
        float m2 = fbm2(p.xz * vec2(0.05, 0.12) + vec2(4.0, ft * 0.05));
        c = mix(c, mix(mid, light, 0.35), smoothstep(0.6, 0.64, m2) * 0.5 * (1.0 - far));
        // slopes that face the sky reflect it, posterised into a lighter tone
        float sky = dot(N, normalize(vec3(-V.x, 1.4, -V.z)));
        c = mix(c, mid * 1.05, smoothstep(0.985, 0.992, sky) * 0.55);
        // horizon sheen
        c = mix(c, mid * 1.15, smoothstep(0.3, 0.34, fres) * 0.6);
        c = mix(c, vec3(0.62, 0.84, 1.0), smoothstep(0.62, 0.66, fres) * 0.6 + smoothstep(0.9, 1.0, fres) * 0.3);
        // ---- giant shadow gliding under the sea
        if(uShadow.w > 0.0){
          vec2 s = rot(p.xz - uShadow.xy, uShadow.z);
          float u = s.x / uShadowB.x, v = s.y / uShadowB.y;
          float taper = mix(1.0, 0.25, smoothstep(-0.2, 1.0, -u));
          float sh = 1.0 - smoothstep(0.75, 1.05, length(vec2(u, v / max(taper, 0.2))));
          // pectoral fins
          vec2 fp = vec2(u - 0.35, abs(v) - 1.1);
          sh = max(sh, 1.0 - smoothstep(0.5, 0.75, length(fp / vec2(0.18, 0.7))));
          sh *= 0.8 + 0.2 * fbm2(p.xz * 0.03);
          c = mix(c, vec3(0.03, 0.12, 0.42), sh * uShadow.w);
        }
        // ---- drawn white wave dashes, two scales; fade to an average far away
        vec2 q1 = p.xz * vec2(0.22, 0.5) + vec2(ft * 0.25, 0.0);
        vec2 fw1 = fwidth(q1);
        float d1 = dashes(q1, 0.0) * (1.0 - smoothstep(0.12, 0.45, max(fw1.x, fw1.y)));
        vec2 q2 = p.xz * vec2(0.06, 0.14) + vec2(ft * 0.08, 7.0);
        vec2 fw2 = fwidth(q2);
        float d2 = dashes(q2, 3.0) * (1.0 - smoothstep(0.12, 0.45, max(fw2.x, fw2.y)));
        float dsh = max(d1 * smoothstep(0.42, 0.62, m2 + 0.2 * m), d2 * 0.9);
        c = mix(c, vec3(0.93, 0.98, 1.0), dsh * (1.0 - far * 0.5));
        // sun glitter
        vec3 Rf = reflect(-V, N);
        float gl = pow(max(dot(Rf, uSunDir), 0.0), 600.0) * step(0.6, hash12(floor(p.xz * 1.5 + ft * 3.0)));
        c += uSunColor * gl * 2.0;
        // ---- foam: around hulls, the breach, the splash
        float foam = 0.0;
        float fn = fbm2(p.xz * 0.35 + ft * 0.7);
        for(int i = 0; i < 12; i++){
          vec4 F = uFoam[i];
          if(F.w <= 0.0) continue;
          float r = length(p.xz - F.xy) / F.z;
          float f = (1.0 - smoothstep(0.75, 1.0, r + (fn - 0.5) * 0.5)) * F.w;
          // lacework inside: holes in the foam
          f *= mix(1.0, step(0.38, fbm2(p.xz * 0.6 / max(F.z * 0.05, 0.4) + ft)), smoothstep(0.2, 0.9, 1.0 - r));
          foam = max(foam, f);
        }
        // ripple rings
        for(int i = 0; i < 6; i++){
          vec4 R = uRip[i];
          float age = uWT - R.z;
          if(R.w <= 0.0 || age <= 0.0) continue;
          float r = length(p.xz - R.xy);
          float rad = age * 1.4 * R.w + 0.1;
          float lw = 0.05 + 0.03 * R.w;
          float ring = smoothstep(lw, 0.0, abs(r - rad)) + 0.6 * smoothstep(lw * 0.8, 0.0, abs(r - rad * 0.6));
          foam = max(foam, ring * exp(-age * 1.2));
        }
        // wake: a V of churned water behind a moving hull
        if(uWake.w > 0.0){
          vec2 s = rot(p.xz - uWake.xy, uWake.z);   // x forward, y lateral
          float back = -s.x;
          if(back > -2.0){
            float wsc = uWakeB.y;
            float vline = abs(abs(s.y) - (back * 0.36 + 1.6 * wsc));
            float arms = smoothstep(1.4 * wsc + back * 0.05, 0.0, vline) * smoothstep(uWakeB.x, 0.0, back);
            float churn = smoothstep(1.8 * wsc + back * 0.08, 0.0, abs(s.y)) * smoothstep(uWakeB.x * 0.7, 0.0, back) * smoothstep(-2.0, 0.5, back);
            float wn = fbm2(p.xz * 0.5 + ft * 1.3);
            foam = max(foam, max(arms * step(0.42, wn), churn * step(0.3, wn)) * uWake.w);
          }
        }
        // ring-wave crest foam
        float age = uWT - uRing.z;
        if(age > 0.0 && uRing.w > 0.0){
          float r = length(p.xz - uRing.xy);
          float x = (r - age * uRingB.x) / uRingB.y;
          float crest = smoothstep(0.6, 0.0, abs(x + 0.15)) * step(0.4, fbm2(p.xz * 0.15 + ft));
          foam = max(foam, crest * exp(-age * uRingB.z));
        }
        vec3 foamC = mix(vec3(0.72, 0.88, 0.98), vec3(1.0), smoothstep(-0.1, 0.4, dot(N, uSunDir) + fn - 0.4));
        c = mix(c, foamC, clamp(foam, 0.0, 1.0));
        writeOut(c, normalize(mat3(viewMatrix) * N), vDepth, 0.0);
      }`,
    side: THREE.DoubleSide,
    extensions: {},
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  scene.add(mesh);
  return {
    mesh,
    update(state, cam) {
      // snap the grid centre to whole metres so the drawn dashes don't swim
      mat.uniforms.uCenter.value.set(Math.round(cam.position.x), Math.round(cam.position.z));
    },
  };
}
