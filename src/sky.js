import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';
import { Rng } from './util.js';

const R = 9500;   // sky distance (beyond the 8 km painted-world range)

// Towering summer cumulus (nyudo-gumo) in sky degrees: rows of billows, cauliflower buds on
// the rims and a flat lavender base. Layout idea after LEVIATHAN's world-sky.js (MIT).
function cloudTower(rng, o) {
  const puffs = [];
  const R0 = o.r ?? 3.4;
  const rows = Math.max(1, Math.round(o.h / (R0 * 0.9)));
  const prof = o.prof ?? ((f) => 1 - 0.42 * f * f);
  for (let k = 0; k <= rows; k++) {
    const f = rows ? k / rows : 0;
    const y = o.base + R0 * 0.55 + f * (o.h - R0 * 1.35);
    const width = Math.max(R0 * 0.6, o.w * prof(f));
    const n = Math.max(1, Math.round(width / (R0 * 1.12)));
    for (let i = 0; i < n; i++) {
      const uu = n === 1 ? 0 : i / (n - 1) - 0.5;
      const x = o.az + (o.lean ?? 0) * f * o.h + uu * (width - R0) + rng.range(-0.3, 0.3) * R0;
      const r = R0 * rng.range(0.8, 1.15) * (1 - 0.2 * f);
      const z = (1 - f) * R0 * 1.6 + (0.5 - Math.abs(uu)) * R0 * 1.3 + rng.range(0, 0.5) * R0;
      puffs.push([x, y + rng.range(-0.3, 0.3) * R0, r, z]);
    }
  }
  const body = puffs.length;
  for (let i = 0; i < body * 1.6 && puffs.length < 110; i++) {
    const [x, y, r, z] = puffs[i % body];
    if (y < o.base + o.h * 0.25 || rng.next() < 0.35) continue;
    const a = rng.range(0.25, Math.PI - 0.25);
    puffs.push([x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.8, r * rng.range(0.32, 0.5), z + r * 0.35]);
  }
  const topY = o.base + o.h - R0 * 0.7;
  const topW = Math.max(R0, o.w * prof(1));
  const nc = Math.max(2, Math.round(topW / (R0 * 0.7)));
  for (let i = 0; i < nc; i++) {
    const uu = i / (nc - 1) - 0.5;
    puffs.push([o.az + (o.lean ?? 0) * o.h + uu * topW * 0.85, topY - Math.abs(uu) * R0 * 1.1 + rng.range(-0.2, 0.3) * R0, R0 * rng.range(0.5, 0.72), rng.range(-0.3, 0.2) * R0]);
  }
  const cut = o.cut ?? o.base + R0 * 0.3;
  return puffs.map((p) => [...p, cut]);
}

function makePuffs() {
  const rng = new Rng(7310);
  const towers = [];
  const add = (o) => { const p = cloudTower(rng, o); towers.push({ puffs: p, cut: p[0][4], haze: o.haze ?? 0 }); };
  // a wall of towering cumulus around the horizon: every view of the sea has a castle in it
  add({ az: -40, base: -3, w: 30, h: 38, r: 3.0, lean: 0.06 });
  add({ az: 22, base: -3, w: 26, h: 30, r: 2.8, lean: -0.05 });
  add({ az: -8, base: -1.5, w: 12, h: 11, r: 2.2 });
  add({ az: 58, base: -2, w: 18, h: 18, r: 2.4 });
  add({ az: -78, base: -2, w: 20, h: 21, r: 2.6 });
  add({ az: 95, base: -3, w: 28, h: 34, r: 2.9, lean: 0.04 });
  add({ az: 140, base: -1.5, w: 18, h: 15, r: 2.6, lean: 0.03 });
  add({ az: 180, base: -3, w: 30, h: 30, r: 2.8, lean: -0.04 });
  add({ az: 222, base: -2, w: 22, h: 24, r: 2.7 });
  add({ az: 262, base: -3, w: 30, h: 33, r: 2.9, lean: 0.05 });
  add({ az: -118, base: -2, w: 16, h: 14, r: 2.3 });
  // fair-weather cumulus higher up
  for (const [az, el, w] of [[-58, 16, 6], [-20, 21, 5], [8, 15, 5], [40, 24, 6], [-95, 30, 7], [120, 18, 6], [160, 22, 5], [200, 16, 6], [240, 25, 7], [300, 19, 6], [70, 36, 8], [-150, 40, 9], [10, 48, 8]]) {
    add({ az, base: el, w, h: w * 0.55, r: w * 0.24, cut: el + w * 0.06 });
  }
  return towers;
}

export function makeSky(scene) {
  const group = new THREE.Group();
  scene.add(group);
  // Towers -> one float texture of billows + per-tower bounds. The dome shader shades the
  // union of billows per pixel, so each tower reads as ONE lit volume with a lavender
  // shadow side broken by cauliflower bubbles (approach after LEVIATHAN's sky, MIT).
  const towers = makePuffs();
  const MAXT = towers.length;
  const all = [], tb = [], ti = [];
  for (const t of towers) {
    const start = all.length;
    let a0 = 1e9, a1 = -1e9, e0 = 1e9, e1 = -1e9;
    const azC = t.puffs[0][0];
    for (const p of t.puffs.slice(0, 110)) {
      const da = ((p[0] - azC + 540) % 360) - 180;
      const ra = p[2] * 1.45 / Math.max(0.2, Math.cos(Math.min(80, Math.abs(p[1]) + p[2] * 1.45) * Math.PI / 180));
      a0 = Math.min(a0, da - ra); a1 = Math.max(a1, da + ra);
      e0 = Math.min(e0, p[1] - p[2] * 1.45); e1 = Math.max(e1, p[1] + p[2] * 1.45);
      all.push(p);
    }
    tb.push(new THREE.Vector4(azC + (a0 + a1) / 2, (a1 - a0) / 2, Math.max(e0, t.cut) - 0.5, e1));
    ti.push(new THREE.Vector4(start, all.length - start, t.haze, t.cut));
  }
  const data = new Float32Array(all.length * 4);
  all.forEach((p, i) => data.set([p[0], p[1], p[2], p[3]], i * 4));
  const ptex = new THREE.DataTexture(data, all.length, 1, THREE.RGBAFormat, THREE.FloatType);
  ptex.minFilter = ptex.magFilter = THREE.NearestFilter;
  ptex.needsUpdate = true;

  const domeMat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      ...G,
      uZenith: { value: new THREE.Color('#1336c4') }, uMid: { value: new THREE.Color('#2f77ec') }, uHorizon: { value: new THREE.Color('#bfe8ff') },
      uCloudLit: { value: new THREE.Color('#fffefa') }, uCloudMid: { value: new THREE.Color('#f3f5fd') },
      uCloudShade: { value: new THREE.Color('#a4a6e6') }, uCloudDeep: { value: new THREE.Color('#8183d2') },
      uPuffs: { value: ptex }, uTower: { value: tb }, uTowerI: { value: ti },
    },
    vertexShader: `
      varying vec3 vDir;
      void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      ${COMMON}
      ${MRT_OUT}
      uniform vec3 uZenith, uMid, uHorizon, uCloudLit, uCloudMid, uCloudShade, uCloudDeep;
      uniform sampler2D uPuffs;
      uniform vec4 uTower[${MAXT}];
      uniform vec4 uTowerI[${MAXT}];
      varying vec3 vDir;
      const float D2R = 0.0174532925;
      // scalloped sub-billows: outward tilt of the front-most bubble at p
      vec3 bubbles(vec2 p, float seed){
        vec2 ip = floor(p), bv = vec2(0.0); float bd = 1e9;
        for(int j = -1; j <= 1; j++) for(int i = -1; i <= 1; i++){
          vec2 c = ip + vec2(float(i), float(j));
          vec2 o = hash22(c + seed);
          float r = 0.62 + 0.5 * o.x;
          vec2 v = p - (c + 0.5 + (o - 0.5) * 0.76);
          float dd = dot(v, v) / (r * r) - o.y * 0.4;
          if(dd < bd){ bd = dd; bv = v / r; }
        }
        return vec3(bv, sqrt(max(1.0 - dot(bv, bv), 0.04)));
      }
      void main(){
        vec3 d = normalize(vDir);
        vec3 s = normalize(uSunDir);
        float e = max(d.y, -0.2);
        vec3 hor = uHorizon;
        vec3 col = mix(uHorizon, uMid, smoothstep(-0.01, 0.22, e));
        col = mix(col, uZenith, smoothstep(0.2, 0.85, e));
        // painterly streaks of thin cirrus
        float stc = fbm2(vec2(atan(d.x, -d.z) * 6.0, e * 40.0));
        col = mix(col, vec3(0.85, 0.92, 1.0), smoothstep(0.62, 0.8, stc) * smoothstep(0.05, 0.25, e) * 0.35);
        float toSun = dot(d, s);
        col += uSunColor * (pow(max(toSun, 0.0), 600.0) * 3.0 + pow(max(toSun, 0.0), 30.0) * 0.3 + pow(max(toSun, 0.0), 4.0) * 0.06);

        // ---- towering cumulus: union of billows; the front-most billow shades the pixel
        float elD = asin(clamp(d.y, -1.0, 1.0)) / D2R;
        float azD = atan(d.x, -d.z) / D2R;
        vec3 east = normalize(vec3(-d.z, 0.0, d.x) + vec3(1e-6, 0.0, 0.0));
        vec3 upT = normalize(vec3(0.0, 1.0, 0.0) - d * d.y + vec3(0.0, 1e-6, 0.0));
        vec3 L = normalize(vec3(dot(s, east) - 0.35, dot(s, upT) + 0.45, max(dot(s, -d), 0.0) * 0.28 + 0.1));
        float edgeN = fbm3(d * 24.0 + 3.1) - 0.5;
        float edgeN2 = vnoise3(d * 66.0) - 0.5;
        float ce = cos(elD * D2R);
        float best = -1e9, second = -1e9, maxE = -1.0;
        vec3 bn = vec3(0.0, 0.0, 1.0);
        float bHaze = 0.0, bBase = 0.0, bTop = 1.0, bR = 1.0;
        vec2 tC = vec2(0.0);
        for(int ti = 0; ti < ${MAXT}; ti++){
          vec4 tb = uTower[ti];
          float daz = mod(azD - tb.x + 540.0, 360.0) - 180.0;
          if(abs(daz) > tb.y || elD < tb.z || elD > tb.w) continue;
          vec4 tinf = uTowerI[ti];
          int st = int(tinf.x + 0.5), cnt = int(tinf.y + 0.5);
          float cut = tinf.w;
          for(int k = 0; k < 110; k++){
            if(k >= cnt) break;
            vec4 P = texelFetch(uPuffs, ivec2(st + k, 0), 0);
            float dx = (mod(azD - P.x + 540.0, 360.0) - 180.0) * ce;
            float dy = elD - P.y;
            float q2 = (dx * dx + dy * dy) / (P.z * P.z);
            if(q2 > 2.1) continue;
            float ee = 1.0 - q2 + (edgeN * 0.5 + edgeN2 * 0.16) * (0.55 + 2.2 / (P.z + 1.5));
            ee -= max(cut - elD, 0.0) * 0.9;           // flat cloud base
            maxE = max(maxE, ee);
            if(ee <= 0.0) continue;
            float hz = sqrt(ee) * P.z + P.w + edgeN * P.z * 0.45 + edgeN2 * P.z * 0.08;
            if(hz > best){ second = best; best = hz; bn = vec3(dx / P.z, dy / P.z, sqrt(ee)); bHaze = tinf.z; bBase = max(cut, tb.z); bTop = tb.w; bR = P.z;
              tC = vec2(daz / max(tb.y, 1.0), (elD - 0.5 * (tb.z + tb.w)) / max(0.5 * (tb.w - tb.z), 1.0)); }
            else if(hz > second) second = hz;
          }
        }
        float fwE = max(fwidth(maxE), 1e-4);
        if(maxE > -0.6){
          float cov = smoothstep(-fwE * 0.6, fwE * 0.9, maxE);
          vec2 bp = vec2(azD * ce, elD) + vec2(edgeN, -edgeN2) * bR * 0.5;
          vec3 b1 = bubbles(bp / (bR * 0.62), 3.0), b2 = bubbles(bp / (bR * 0.25), 11.0);
          vec3 nn = normalize(bn + vec3(edgeN * 0.2, edgeN * 0.25, 0.0) + vec3(b1.xy * 0.16, 0.0));
          vec3 tN = normalize(vec3(tC.x * 0.8, tC.y * 0.45 + 0.15, 0.5));     // the whole tower is one volume
          float lit = mix(dot(nn, L), dot(tN, L), 0.7) + 0.06;
          float bandN = (abs(vnoise3(d * 26.0) - 0.5) * 2.0 + 0.6 * abs(vnoise3(d * 61.0) - 0.5) * 2.0 - 0.72) * 2.2;
          float tLit = smoothstep(-0.025, 0.025, lit + bandN * 0.05);
          float tHi = smoothstep(0.5, 0.55, lit + bandN * 0.04);
          vec3 cc = mix(uCloudShade, uCloudMid, tLit);
          cc = mix(cc, uCloudLit, tHi);
          // deeper lavender in the shadow core and along the base, whitest tops
          float core = smoothstep(-0.14, -0.34, lit + bandN * 0.08);
          cc = mix(cc, uCloudDeep, core * 0.6);
          float hgt = clamp((elD - bBase) / max(bTop - bBase, 1.0), 0.0, 1.0);
          cc = mix(cc, mix(uCloudShade, uCloudDeep, 0.35), smoothstep(0.16, 0.0, hgt) * 0.6 * (1.0 - tHi));
          // drawn contour where a front billow overlaps the one behind
          float ov = 1.0 - smoothstep(0.0, 0.07 * bR + 0.08, best - second);
          cc = mix(cc, cc * vec3(0.88, 0.89, 0.97), ov * 0.4 * (1.0 - tLit * 0.75));
          // silver lining on thin edges toward the sun
          float thin = 1.0 - smoothstep(0.0, 0.25, maxE);
          cc = mix(cc, uCloudLit * 1.08, thin * smoothstep(0.2, 0.9, toSun) * 0.8);
          cc = mix(cc, hor, clamp(smoothstep(9.0, -0.5, elD) * 0.5 + bHaze, 0.0, 0.9));
          col = mix(col, cc, cov);
        }
        writeOut(col, vec3(0.0, 0.0, 1.0), 9500.0, 0.0);
      }`,
    side: THREE.BackSide, depthWrite: false, depthTest: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(R, 64, 32), domeMat);
  dome.renderOrder = -10; dome.frustumCulled = false;
  group.add(dome);
  return {
    group,
    update(state, cam) { group.visible = !state.under; dome.position.copy(cam.position); },
  };
}
