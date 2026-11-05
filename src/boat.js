import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { oceanHeight } from './ocean.js';
import { smooth } from './util.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// A little red fishing boat (~6.4 m). Local frame: +x bow, +y up, +z starboard; waterline y = 0.

const XS = -3.0, XB = 3.4, XM = 0.3, WMAX = 1.15;
export function halfWidth(x) {
  if (x >= XM) { const u = (x - XM) / (XB - XM); return WMAX * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.1 * u); }
  const u = (XM - x) / (XM - XS); return WMAX - 0.22 * u * u;
}
export const gunwale = (x) => 0.78 + 0.42 * smooth((x - 0.8) / 2.6);
const keel = (x) => -0.5 + 0.55 * smooth((x - 1.6) / 1.8);
export const DECK_Y = 0.42;
// hull surface: half-width at height y (matches the loft below), and its outward normal
const hullZ = (x, y) => halfWidth(x) * Math.pow(Math.min(1, Math.max(0, (y - keel(x)) / (gunwale(x) - keel(x)))), 1 / 4.8);
function hullN(x, y, s) {
  const e = 0.01;
  const fx = (hullZ(x + e, y) - hullZ(x - e, y)) / (2 * e), fy = (hullZ(x, y + e) - hullZ(x, y - e)) / (2 * e);
  return new THREE.Vector3(-fx, -fy, s).normalize();
}
// rotation taking local +z onto n without flipping the part upside down on the port side
const _qa = new THREE.Quaternion(), _yA = new THREE.Vector3(0, 1, 0), _zA = new THREE.Vector3(0, 0, 1), _zN = new THREE.Vector3(0, 0, -1);
function faceQ(n) {
  if (n.z >= 0) return new THREE.Quaternion().setFromUnitVectors(_zA, n);
  return new THREE.Quaternion().setFromUnitVectors(_zN, n).multiply(_qa.setFromAxisAngle(_yA, Math.PI));
}
const planN = (x, s) => { const e = 0.01, d = (halfWidth(x + e) - halfWidth(x - e)) / (2 * e); return new THREE.Vector3(-d, 0, s).normalize(); };

function hullGeo() {
  const NX = 64, NU = 28;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= NX; i++) {
    const x = XS + (XB - XS) * (i / NX);
    const w = Math.max(halfWidth(x), 0.004), top = gunwale(x), bot = keel(x);
    for (let k = 0; k <= NU; k++) {
      const u = (k / NU) * 2 - 1;
      const us = Math.sign(u) * Math.pow(Math.abs(u), 0.5);
      const y = bot + (top - bot) * Math.pow(Math.abs(u), 2.4);
      pos.push(x, y, w * us);
      uv.push(i / NX, k / NU);
    }
  }
  for (let i = 0; i < NX; i++) for (let k = 0; k < NU; k++) {
    const a = i * (NU + 1) + k, b = a + 1, c = a + NU + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // transom
  const base = pos.length / 3;
  for (let k = 0; k <= NU; k++) { pos.push(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); uv.push(0, k / NU); }
  pos.push(XS, gunwale(XS), 0); uv.push(0, 0.5);
  const cIdx = base + NU + 1;
  for (let k = 0; k < NU; k++) idx.push(base + k, base + k + 1, cIdx);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function deckGeo() {
  const shape = new THREE.Shape();
  const N = 40;
  for (let i = 0; i <= N; i++) { const x = XS + 0.06 + (XB - 0.25 - XS) * (i / N); const w = halfWidth(x) * 0.9; i === 0 ? shape.moveTo(x, -w) : shape.lineTo(x, -w); }
  for (let i = N; i >= 0; i--) { const x = XS + 0.06 + (XB - 0.25 - XS) * (i / N); shape.lineTo(x, halfWidth(x) * 0.9); }
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  g.translate(0, DECK_Y, 0);
  return g;
}

// rounded box, welded so the rounded edges shade smoothly; deform(v) may reshape it
function softBox(w, h, d, r, deform = null, seg = 4) {
  let g = new RoundedBoxGeometry(w, h, d, seg, r);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  if (deform) {
    const p = g.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); deform(v); p.setXYZ(i, v.x, v.y, v.z); }
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

// sweep a closed (s, u) profile along a path; side[i] is the outward horizontal, up is +y
function sweep(path, side, prof) {
  const P = prof.length, pos = [], idx = [], uv = [];
  path.forEach((p, i) => prof.forEach(([s, u], k) => { pos.push(p.x + side[i].x * s, p.y + u, p.z + side[i].z * s); uv.push(i / (path.length - 1), k / P); }));
  const t = path[1].clone().sub(path[0]);
  const flip = new THREE.Vector3().crossVectors(t, side[0]).y > 0;
  for (let i = 0; i < path.length - 1; i++) for (let k = 0; k < P; k++) {
    const a = i * P + k, b = i * P + (k + 1) % P, c = a + P, d = b + P;
    if (flip) idx.push(a, b, d, a, d, c); else idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
const roundRect = (s0, s1, u0, u1, r, n = 3) => {
  const out = [];
  const cs = [[s1 - r, u0 + r, -Math.PI / 2], [s1 - r, u1 - r, 0], [s0 + r, u1 - r, Math.PI / 2], [s0 + r, u0 + r, Math.PI]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * Math.PI / 2; out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  return out;
};
const tube = (pts, r, seg = 0, rad = 6, closed = false) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg || pts.length * 4, r, rad, closed);
const sag = (a, b, s, n = 16) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n; return a.clone().lerp(b, u).add(new THREE.Vector3(0, -s * 4 * u * (1 - u), 0)); });

// lathe from an (r, y) profile (walk it counter-clockwise: material on the left)
function lathe(profile, nu = 24) {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), nu);
}

export function makeBoat(ctx) {
  const root = new THREE.Group();
  const add = (geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); root.add(m); return m; };
  // static parts with plain materials are batched into one mesh per material
  const batches = new Map();
  const _o = new THREE.Object3D();
  const put = (geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, q = null) => {
    _o.position.set(x, y, z); if (q) _o.quaternion.copy(q); else _o.rotation.set(rx, ry, rz); _o.scale.set(1, 1, 1); _o.updateMatrix();
    let g = geo.clone().applyMatrix4(_o.matrix);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.clearGroups();
    if (!batches.has(mat)) batches.set(mat, []);
    batches.get(mat).push(g);
  };
  const along = (geo, mat, p0, p1) => {   // a unit-height Y geometry stretched between two points
    const d = p1.clone().sub(p0), L = d.length();
    const g = geo.clone().scale(1, L, 1);
    put(g, mat, (p0.x + p1.x) / 2, (p0.y + p1.y) / 2, (p0.z + p1.z) / 2, 0, 0, 0, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
  };
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

  // ------------------------------------------------------------------ materials
  // the boat's name, painted on both bows
  const nc = document.createElement('canvas'); nc.width = 512; nc.height = 128;
  const nx = nc.getContext('2d');
  nx.fillStyle = '#1f3380'; nx.fillRect(0, 0, 512, 128);
  nx.font = '900 84px "Arial Black", Impact, sans-serif'; nx.textAlign = 'center'; nx.textBaseline = 'middle';
  nx.fillStyle = '#fff8ea'; nx.fillText('KOBO-1', 256, 70);
  nx.fillStyle = '#ffd23a'; nx.fillRect(18, 14, 476, 6); nx.fillRect(18, 108, 476, 6);
  const nameTex = new THREE.CanvasTexture(nc); nameTex.colorSpace = THREE.NoColorSpace;
  // hull: red bottom, white topsides with a navy stripe; cream inside the bulwarks
  const hull = celMaterial({
    color: '#ffffff', id: 2, gloss: 0.5, side: THREE.DoubleSide, uniforms: { uName: { value: nameTex } },
    pattern: `
      float y = vLocal.y;
      if(gl_FrontFacing){
        col = y < 0.18 ? vec3(0.86, 0.16, 0.14) : vec3(0.97, 0.96, 0.93);
        // planking: faint seams that follow the strakes
        float pl = fract(y * 7.2 + 0.35);
        if(pl < 0.045 && y > 0.21) col *= 0.92;
        if(pl < 0.045 && y < 0.14) col *= 0.88;
        // butt joints staggered along each strake
        float sk = floor(y * 7.2 + 0.35);
        if(abs(fract(vLocal.x * 0.42 + sk * 0.37) - 0.5) > 0.493 && y > 0.21) col *= 0.92;
        col = mix(col, vec3(0.12, 0.2, 0.5), step(0.5, y) * step(y, 0.6));
        // painted name plate on the bow
        if(vLocal.x > 1.15 && vLocal.x < 2.45 && y > 0.22 && y < 0.47){
          vec2 q = vec2((vLocal.x - 1.15) / 1.3, (y - 0.22) / 0.25);
          if(vLocal.z < 0.0) q.x = 1.0 - q.x;
          col = texture(uName, q).rgb;
        }
        // waterline boot-top
        col = mix(col, vec3(0.1, 0.1, 0.16), step(0.15, y) * step(y, 0.2));
        // weathering streaks under the gunwale
        float st = step(0.78, vnoise(vec2(vLocal.x * 9.0, y * 1.2))) * step(0.2, y);
        col *= 1.0 - 0.06 * st;
      } else {
        col = vec3(0.93, 0.9, 0.82); litBias = -0.05;
        if(y < ${(DECK_Y + 0.06).toFixed(3)}) col *= 0.82;     // waterway along the deck
      }
    `,
  });
  const wood = celMaterial({ color: '#b9773f', id: 3, gloss: 0.3 });
  const deck = celMaterial({
    color: '#d39a5c', id: 4, gloss: 0.0, side: THREE.DoubleSide,
    pattern: `
      float pl = fract(vLocal.z * 5.5);
      col *= 0.92 + 0.08 * step(0.5, hash12(vec2(floor(vLocal.z * 5.5), floor(vLocal.x * 0.8))));
      col = mix(col, vec3(0.45, 0.28, 0.18), step(0.93, pl));
      // butt ends and nail heads
      if(abs(fract(vLocal.x * 0.8 + floor(vLocal.z * 5.5) * 0.5) - 0.5) > 0.494) col *= 0.75;
    `,
  });
  const metal = celMaterial({ color: '#e8e4dc', id: 8, gloss: 0.8 });
  const iron = celMaterial({ color: '#3d3c4f', id: 93, gloss: 0.6 });
  const rope = celMaterial({ color: '#e9d7a8', id: 15, gloss: 0.1, pattern: 'if(fract(vUv.x * 160.0 + vUv.y * 2.0) < 0.35) col *= 0.82;' });
  const ropeLine = celMaterial({ color: '#e9d7a8', id: 15, gloss: 0.1 });

  // ------------------------------------------------------------------ hull, rails, deck
  add(hullGeo(), hull);
  add(deckGeo(), deck);
  // cap rail: a flat wooden rail with rounded edges along both bulwarks and across the transom
  const capProf = roundRect(-0.045, 0.07, -0.012, 0.042, 0.018);
  for (const s of [1, -1]) {
    const path = [], side = [];
    for (let i = 0; i <= 70; i++) { const x = XS + (XB - XS) * (i / 70); path.push(V(x, gunwale(x), s * halfWidth(x))); side.push(planN(x, s)); }
    path.push(V(XB + 0.04, gunwale(XB), 0)); side.push(V(1, 0, 0));
    put(sweep(path, side, capProf), wood);
  }
  {
    const w = halfWidth(XS) + 0.05, y = gunwale(XS);
    put(sweep([V(XS, y, -w), V(XS, y, w)], [V(-1, 0, 0), V(-1, 0, 0)], capProf.map(([s, u]) => [s + 0.01, u])), wood);
  }
  // rubbing strake: a half-round wooden fender below the sheer
  for (const s of [1, -1]) {
    const pts = [];
    for (let i = 0; i <= 50; i++) { const x = XS + 0.03 + (XB - 0.08 - XS) * (i / 50); pts.push(V(x, 0.665, s * (hullZ(x, 0.665) + 0.008))); }
    put(tube(pts, 0.032, 120, 8), wood);
  }
  // frames on the inside of the bulwarks
  {
    const fr = new THREE.BoxGeometry(0.05, 1, 0.04);
    for (let x = -2.78; x < 2.95; x += 0.42) for (const s of [1, -1]) {
      const y0 = DECK_Y, y1 = gunwale(x) - 0.01;
      along(fr, wood, V(x, y0, s * (hullZ(x, y0 + 0.02) * 0.985 - 0.035)), V(x, y1, s * (hullZ(x, y1) - 0.035)));
    }
  }
  // stem post at the bow where the rails meet, and a keel band from stem to stern
  const stem = add(new THREE.CapsuleGeometry(0.06, 0.6, 4, 10), wood, XB - 0.02, gunwale(XB) - 0.2, 0);
  stem.rotation.z = -0.35;
  {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const y = gunwale(XB) - 0.15 - (gunwale(XB) - 0.15 - keel(XB)) * (i / 8); pts.push(V(XB + 0.015, y, 0)); }
    for (let i = 1; i <= 40; i++) { const x = XB - (XB - XS) * (i / 40); pts.push(V(x, keel(x) - 0.012, 0)); }
    put(tube(pts, 0.03, 160, 6), iron);
  }
  // skeg, propeller and rudder (seen when she flies off the wave)
  {
    const sk = new THREE.Shape();
    sk.moveTo(0.8, 0.0); sk.lineTo(-2.55, 0.0); sk.lineTo(-2.6, -0.2); sk.lineTo(-2.45, -0.21); sk.quadraticCurveTo(-0.6, -0.12, 0.8, 0.0);
    const skg = new THREE.ExtrudeGeometry(sk, { depth: 0.06, bevelEnabled: false }).translate(0, 0, -0.03);
    put(skg, celMaterial({ color: '#c42a22', id: 88, gloss: 0.4 }), 0, keel(-1) + 0.01, 0);
    const bronze = celMaterial({ color: '#e0a640', id: 87, gloss: 1.0 });
    put(new THREE.CylinderGeometry(0.022, 0.022, 0.3, 8).rotateZ(Math.PI / 2), bronze, -2.72, -0.66, 0);
    put(new THREE.SphereGeometry(0.04, 12, 8).scale(1.6, 1, 1), bronze, -2.86, -0.66, 0);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      const bl = new THREE.SphereGeometry(1, 10, 6).scale(0.014, 0.075, 0.055).translate(0, 0.07, 0).rotateY(0.6).rotateX(a);
      put(bl, bronze, -2.86, -0.66, 0);
    }
    const rd = new THREE.Shape();
    rd.moveTo(0, 0.08); rd.lineTo(-0.3, 0.06); rd.quadraticCurveTo(-0.36, -0.22, -0.3, -0.52); rd.lineTo(0, -0.55); rd.lineTo(0, 0.08);
    const rdg = new THREE.ExtrudeGeometry(rd, { depth: 0.04, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 1 }).translate(0, 0, -0.02);
    put(rdg, celMaterial({ color: '#c42a22', id: 88, gloss: 0.4 }), -3.02, -0.22, 0);
    put(new THREE.CylinderGeometry(0.02, 0.02, 0.62, 8), iron, -3.03, -0.14, 0);
  }

  // ------------------------------------------------------------------ wheelhouse
  const CAB = { x: -1.55, y: DECK_Y + 0.63, w: 1.3, h: 1.26, d: 1.52 };
  const cabin = celMaterial({
    color: '#f6f3ec', id: 5, gloss: 0.4,
    pattern: `
      vec3 p = vLocal; vec3 n = normalize(vLocalN);
      float t = clamp((p.y - 0.07) / 0.56, 0.0, 1.0);
      bool front = n.x > 0.6, side = abs(n.z) > 0.7, back = n.x < -0.6;
      // window band: blue frames, rounded panes of glass
      if(p.y > 0.1 && p.y < 0.55 && (front || side)){
        float u = front ? p.z / (1.0 - 0.07 * t) : p.x + 0.03;
        float hw = front ? 0.66 : 0.58;
        if(abs(u) < hw){
          col = vec3(0.18, 0.37, 0.78); idOut = 6.0; gloss = 0.6;
          float nP = front ? 3.0 : 2.0;
          float w = 2.0 * hw / nP;
          float k = floor((u + hw) / w);
          vec2 q = vec2(u + hw - (k + 0.5) * w, p.y - 0.325);
          vec2 d = abs(q) - vec2(w * 0.5 - 0.035, 0.19) + 0.05;
          float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.05;
          if(sd < 0.0){
            col = mix(vec3(0.1, 0.17, 0.38), vec3(0.3, 0.52, 0.84), smoothstep(-0.18, 0.2, q.y));
            float gl = fract((q.x * 0.8 + q.y) * 2.4 + k * 0.37 + (front ? 0.0 : 0.5));
            if(gl > 0.62 && gl < 0.75) col = mix(col, vec3(0.78, 0.93, 1.0), 0.75);
            if(gl > 0.82 && gl < 0.85) col = mix(col, vec3(0.78, 0.93, 1.0), 0.6);
            // a glimpse of the helm through the front glass
            if(front && k == 1.0 && length(q - vec2(0.0, -0.13)) < 0.1 && length(q - vec2(0.0, -0.13)) > 0.075) col = vec3(0.06, 0.09, 0.2);
            gloss = 1.0; idOut = 92.0; emis = vec3(0.02, 0.04, 0.08);
          }
        }
      }
      // painted band under the windows, a kick strip at the bottom
      if(abs(p.y - 0.02) < 0.028 && !back) col = vec3(0.18, 0.39, 0.78);
      if(p.y < -0.56) col *= 0.86;
      // door with a porthole on the aft face (starboard half)
      if(back){
        vec2 q = vec2(p.z - 0.33, p.y + 0.11);
        vec2 d = abs(q) - vec2(0.25, 0.5) + 0.07;
        float sd = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - 0.07;
        if(sd < 0.0){
          col = vec3(0.8, 0.56, 0.33); idOut = 89.0; gloss = 0.3;
          if(abs(sd + 0.04) < 0.006) col *= 0.82;
          float pr = length(q - vec2(0.0, 0.25));
          if(pr < 0.115){ col = vec3(0.9, 0.78, 0.42); gloss = 1.0; idOut = 6.0; }
          if(pr < 0.085){ col = mix(vec3(0.1, 0.17, 0.38), vec3(0.4, 0.65, 0.9), smoothstep(-0.06, 0.08, q.y - 0.25)); idOut = 92.0; gloss = 1.0; }
          if(length(q - vec2(-0.17, -0.06)) < 0.025) col = vec3(0.9, 0.78, 0.42);
        }
      }
    `,
  });
  add(softBox(CAB.w, CAB.h, CAB.d, 0.07, (v) => {
    const t = Math.min(1, Math.max(0, (v.y - 0.07) / 0.56));
    v.z *= 1 - 0.07 * t;
    if (v.x > 0) v.x += 0.1 * t * (v.x / (CAB.w / 2));
  }), cabin, CAB.x, CAB.y, 0);
  // roof: cambered, overhanging, blue on top with a white fascia
  const roofY = CAB.y + CAB.h / 2 + 0.05;
  add(softBox(1.66, 0.1, 1.88, 0.04, (v) => { if (v.y > 0) v.y += 0.04 * (1 - (v.z / 0.94) ** 2); }), celMaterial({
    color: '#2f63c7', id: 7, gloss: 0.6,
    pattern: 'if(normalize(vLocalN).y < 0.55){ col = vec3(0.97, 0.96, 0.93); idOut = 91.0; }',
  }), -1.47, roofY, 0);
  const roofTop = roofY + 0.09;
  // grab rails along the wheelhouse sides
  for (const s of [1, -1]) {
    const z = s * (CAB.d / 2 * 0.985 + 0.06);
    put(new THREE.CylinderGeometry(0.018, 0.018, 1.05, 8).rotateZ(Math.PI / 2), wood, -1.58, DECK_Y + 0.62, z);
    for (const x of [-2.05, -1.58, -1.1]) put(new THREE.CylinderGeometry(0.012, 0.012, 0.07, 6).rotateX(Math.PI / 2), metal, x, DECK_Y + 0.62, z - s * 0.035);
  }
  // glass fishing floats in rope nets, hung from the starboard rail
  {
    const glass = celMaterial({ color: '#7fe0c8', id: 97, gloss: 1.0, pattern: `
        vec3 q = normalize(vLocal);
        if(abs(fract(atan(q.z, q.x) * 1.2732) - 0.5) > 0.44 || abs(fract(q.y * 2.5) - 0.5) > 0.44) { col = vec3(0.86, 0.76, 0.5); gloss = 0.0; }
        else emis = vec3(0.05, 0.12, 0.1);
      ` });
    [[-1.98, 0.12, 0.13], [-1.75, 0.2, 0.11], [-1.32, 0.14, 0.12]].forEach(([x, drop, r]) => {
      const z = CAB.d / 2 * 0.985 + 0.07 + r * 0.6, y = DECK_Y + 0.62 - drop - r;
      add(new THREE.SphereGeometry(r, 18, 12), glass, x, y, z);
      put(new THREE.CylinderGeometry(0.006, 0.006, drop, 4), ropeLine, x, DECK_Y + 0.62 - drop / 2, z - r * 0.35);
    });
  }
  // life ring on the aft face (port half)
  const ring = add(new THREE.TorusGeometry(0.24, 0.068, 10, 28), celMaterial({
    color: '#ff7a2a', id: 12, gloss: 0.6,
    pattern: `
      float a = atan(vLocal.y, vLocal.x);
      col = fract(a / 1.5708 + 0.125) < 0.5 ? vec3(1.0, 0.45, 0.15) : vec3(0.98, 0.96, 0.92);
      if(abs(fract(a / 1.5708 + 0.125) - 0.75) < 0.04 || abs(fract(a / 1.5708 + 0.125) - 0.25) < 0.04) col = vec3(0.85, 0.78, 0.6);
    `,
  }), CAB.x - CAB.w / 2 - 0.075, DECK_Y + 0.78, -0.36);
  ring.rotation.y = Math.PI / 2;
  put(new THREE.BoxGeometry(0.1, 0.04, 0.05), iron, CAB.x - CAB.w / 2 - 0.035, DECK_Y + 1.1, -0.36);
  // funnel behind the wheelhouse: red with a black cap and a white band
  const funnelMat = celMaterial({ color: '#e33a2f', id: 17, gloss: 0.6, pattern: `
      if(vLocal.y > 0.2) col = vec3(0.13, 0.12, 0.18);
      else if(abs(vLocal.y - 0.02) < 0.06) col = vec3(0.98, 0.96, 0.92);
    ` });
  const funnel = add(new THREE.CylinderGeometry(0.16, 0.2, 0.62, 22).scale(1.2, 1, 1), funnelMat, -2.05, DECK_Y + 1.6, 0.42);
  funnel.rotation.z = 0.12;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.022, 8, 22).rotateX(Math.PI / 2).scale(1.2, 1, 1), iron);
  lip.position.y = 0.31; funnel.add(lip);
  // searchlight and horn on the roof
  const lampMat = celMaterial({ color: '#e8e4dc', id: 18, gloss: 0.8, pattern: 'if(vLocalN.x > 0.6) { col = vec3(1.0, 0.97, 0.8); emis = vec3(0.25, 0.22, 0.1); }' });
  add(new THREE.CylinderGeometry(0.11, 0.095, 0.2, 18).rotateZ(Math.PI / 2), lampMat, -0.98, roofTop + 0.13, -0.5);
  put(new THREE.TorusGeometry(0.11, 0.016, 6, 18).rotateY(Math.PI / 2), iron, -0.88, roofTop + 0.13, -0.5);
  put(new THREE.CylinderGeometry(0.03, 0.04, 0.1, 8), iron, -0.98, roofTop + 0.03, -0.5);
  put(new THREE.TorusGeometry(0.115, 0.012, 6, 12, Math.PI).rotateZ(Math.PI).rotateY(Math.PI / 2), iron, -0.98, roofTop + 0.13, -0.5);
  const hornMat = celMaterial({ color: '#ffd84a', id: 19, gloss: 0.9 });
  add(lathe([[0, -0.15], [0.03, -0.15], [0.032, 0.0], [0.05, 0.08], [0.095, 0.14], [0.1, 0.15], [0.07, 0.15], [0, 0.11]], 16), hornMat, -1.02, roofTop + 0.12, 0.5).rotation.z = -Math.PI / 2;
  put(new THREE.CylinderGeometry(0.025, 0.035, 0.12, 8), iron, -1.06, roofTop + 0.04, 0.5);

  // ------------------------------------------------------------------ mast, lights, rigging, bunting
  const MX = -1.75, mastTop = roofTop + 1.45;
  put(new THREE.CylinderGeometry(0.03, 0.042, mastTop - roofTop, 10), metal, MX, (mastTop + roofTop) / 2, 0);
  put(new THREE.CylinderGeometry(0.07, 0.08, 0.06, 12), iron, MX, roofTop + 0.02, 0);
  const yardY = roofTop + 1.05;
  put(new THREE.CylinderGeometry(0.02, 0.02, 1.1, 8).rotateX(Math.PI / 2), metal, MX, yardY, 0);
  // masthead lantern
  const lantern = celMaterial({ color: '#fff4c8', id: 9, emissive: '#5a4a10', gloss: 1.0 });
  put(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 14), iron, MX, mastTop + 0.01, 0);
  add(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 14), lantern, MX, mastTop + 0.065, 0);
  put(new THREE.ConeGeometry(0.068, 0.06, 14), iron, MX, mastTop + 0.14, 0);
  put(new THREE.SphereGeometry(0.02, 8, 6), iron, MX, mastTop + 0.18, 0);
  // port (red) and starboard (green) lights on the yard ends
  for (const s of [1, -1]) {
    add(new THREE.SphereGeometry(0.04, 12, 8).scale(1, 1.2, 1), celMaterial({ color: s > 0 ? '#5dff8a' : '#ff4a4a', id: 99, emissive: s > 0 ? '#1a6a30' : '#6a1a1a', gloss: 1 }), MX, yardY + 0.05, 0.55 * s);
    put(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10), iron, MX, yardY + 0.1, 0.55 * s);
  }
  // shrouds from the yard down to the roof edges, a stay to the funnel, a stern pole with a line of bunting
  for (const s of [1, -1]) put(tube([V(MX, yardY, 0.5 * s), V(MX + 0.05, roofTop - 0.02, 0.86 * s)], 0.007, 4, 4), iron);
  const poleX = XS + 0.06, poleTop = gunwale(XS) + 1.25;
  put(new THREE.CylinderGeometry(0.016, 0.022, 1.25, 8), metal, poleX, gunwale(XS) + 0.625, 0);
  put(new THREE.SphereGeometry(0.03, 8, 6), metal, poleX, poleTop, 0);
  const lineA = V(MX - 0.03, mastTop - 0.05, 0), lineB = V(poleX, poleTop - 0.02, 0);
  const bline = sag(lineA, lineB, 0.12, 24);
  put(tube(bline, 0.006, 48, 4), iron);
  {
    const N = 11, pos = [], uv = [], nrm = [];
    for (let i = 0; i < N; i++) {
      const u0 = (i + 0.2) / N, u1 = (i + 0.8) / N, um = (u0 + u1) / 2;
      const at = (u) => lineA.clone().lerp(lineB, u).add(V(0, -0.12 * 4 * u * (1 - u), 0));
      const a = at(u0), b = at(u1), c = at(um).add(V(0, -0.15, 0));
      pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      const ci = (i % 5) / 5 + 0.1;
      uv.push(ci, 0, ci, 0, ci, 1);
      nrm.push(0, 0, 1, 0, 0, 1, 0, 0, 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    add(g, celMaterial({
      color: '#ffffff', id: 90, side: THREE.DoubleSide, gloss: 0.0,
      vertex: 'pos.z += sin(uFxTime * 8.0 + pos.x * 6.0) * 0.05 * uv.y; pos.x -= 0.03 * uv.y;',
      pattern: `
        float c = floor(vUv.x * 5.0);
        col = c < 0.5 ? vec3(0.95, 0.22, 0.18) : c < 1.5 ? vec3(1.0, 0.84, 0.2) : c < 2.5 ? vec3(0.2, 0.45, 0.9) : c < 3.5 ? vec3(0.98, 0.97, 0.94) : vec3(0.25, 0.75, 0.45);
        litBias = 0.3;
      `,
    })).frustumCulled = false;
  }
  // the flag, flying aft from the yard
  add(new THREE.PlaneGeometry(0.62, 0.32, 10, 2).translate(-0.31, 0, 0), celMaterial({
    color: '#e33a2f', id: 10, side: THREE.DoubleSide,
    vertex: 'pos.z += sin(pos.x * 6.0 + uFxTime * 9.0) * 0.06 * (-pos.x); pos.y -= 0.05 * (-pos.x) * (-pos.x);',
    pattern: 'col = vUv.y > 0.5 ? vec3(0.9, 0.2, 0.16) : vec3(0.98, 0.97, 0.94);',
  }), MX - 0.04, yardY + 0.22, 0);
  put(new THREE.CylinderGeometry(0.008, 0.008, 0.4, 4), metal, MX - 0.04, yardY + 0.2, 0);

  // ------------------------------------------------------------------ tyre fenders on ropes
  const tyre = celMaterial({ color: '#2b2a33', id: 11, gloss: 0.3, pattern: `
      float rr = length(vLocal.xy);
      float a = atan(vLocal.y, vLocal.x);
      if(rr > 0.165 && abs(fract(a * 3.8197) - 0.5) < 0.16) col *= 0.55;
      if(abs(rr - 0.115) < 0.006) col = col * 1.6 + 0.05;
    ` });
  for (const s of [1, -1]) for (const x of [-1.85, -0.15]) {
    const yc = gunwale(x) - 0.3;
    const n = hullN(x, yc, s);
    const c = V(x, yc, s * hullZ(x, yc)).addScaledVector(n, 0.065);
    const m = add(new THREE.TorusGeometry(0.15, 0.062, 10, 20), tyre, c.x, c.y, c.z);
    m.quaternion.copy(faceQ(n));
    const top = c.clone().add(V(0, 0.15, 0));
    put(tube([V(x - 0.03, gunwale(x) + 0.03, s * (halfWidth(x) + 0.03)), V(x - 0.02, gunwale(x) - 0.04, s * (halfWidth(x) + 0.07)), top.clone().add(V(0, 0.02, 0))], 0.013, 10, 5), ropeLine);
  }
  // anchors hanging at the bows, with a hawse and a bit of chain
  {
    const ag = [];
    const T = (g, x, y, z, rx = 0, ry = 0, rz = 0) => { _o.position.set(x, y, z); _o.rotation.set(rx, ry, rz); _o.scale.set(1, 1, 1); _o.updateMatrix(); ag.push(g.clone().applyMatrix4(_o.matrix)); };
    T(new THREE.TorusGeometry(0.04, 0.012, 6, 14), 0, 0, 0);
    T(new THREE.CylinderGeometry(0.02, 0.024, 0.4, 8), 0, -0.24, 0);
    T(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 8).rotateZ(Math.PI / 2), 0, -0.1, 0);
    for (const s of [1, -1]) T(new THREE.SphereGeometry(0.022, 8, 6), 0.11 * s, -0.1, 0);
    T(new THREE.TorusGeometry(0.15, 0.022, 6, 18, Math.PI), 0, -0.3, 0, 0, 0, Math.PI);
    for (const s of [1, -1]) T(new THREE.ConeGeometry(0.045, 0.09, 4).scale(1, 1, 0.45), 0.15 * s, -0.27, 0, 0, 0, -0.5 * s);
    for (const g of ag) { for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]); }
    const anchorGeo = mergeGeometries(ag);
    for (const s of [1, -1]) {
      const x = 2.72, yh = gunwale(x) - 0.13;
      const nh = hullN(x, yh, s);
      put(new THREE.TorusGeometry(0.05, 0.018, 8, 16), iron, x, yh, s * hullZ(x, yh) + nh.z * 0.004, 0, 0, 0, faceQ(nh));
      for (let k = 0; k < 2; k++) {
        const yk = yh - 0.06 - k * 0.055, nk = hullN(x, yk, s);
        const p = V(x, yk, s * hullZ(x, yk)).addScaledVector(nk, 0.025);
        put(new THREE.TorusGeometry(0.025, 0.008, 5, 10).scale(1, 1.5, 1), iron, p.x, p.y, p.z, 0, k ? Math.PI / 2 : 0, 0);
      }
      const ya = yh - 0.2, na = hullN(x, ya, s);
      const pa = V(x, ya, s * hullZ(x, ya)).addScaledVector(na, 0.035);
      put(anchorGeo, iron, pa.x, pa.y, pa.z, 0, 0, 0, faceQ(na));
    }
  }
  // mooring bitts at bow and stern
  {
    const bitt = (x, z) => {
      put(new THREE.BoxGeometry(0.14, 0.03, 0.1), iron, x, DECK_Y + 0.015, z);
      put(new THREE.CylinderGeometry(0.035, 0.04, 0.15, 10), iron, x, DECK_Y + 0.09, z);
      put(new THREE.CylinderGeometry(0.052, 0.052, 0.025, 12), iron, x, DECK_Y + 0.17, z);
    };
    bitt(2.62, 0.13); bitt(2.62, -0.13); bitt(-2.78, 0.72); bitt(-2.78, -0.72);
    put(new THREE.CylinderGeometry(0.012, 0.012, 0.26, 6).rotateX(Math.PI / 2), iron, 2.62, DECK_Y + 0.11, 0);
  }

  // ------------------------------------------------------------------ deck gear
  // wooden crate at the bow (the robot's seat)
  add(softBox(0.62, 0.5, 0.8, 0.03, null, 3), celMaterial({
    color: '#c58a4e', id: 13, gloss: 0.0,
    pattern: `
      vec3 a = abs(vLocal); vec3 n = abs(normalize(vLocalN));
      float gap = n.y > 0.5 ? step(0.9, fract(vLocal.z * 5.0 + 0.5)) : step(0.88, fract(vLocal.y * 6.0 + 0.5));
      col *= 0.93 + 0.07 * hash12(floor(vec2(vLocal.y * 6.0 + 0.5, (vLocal.x + vLocal.z) * 2.0)));
      col = mix(col, col * 0.6, gap);
      float edge = n.x > n.z ? a.z : a.x, lim = n.x > n.z ? 0.33 : 0.24;
      if(n.y < 0.5 && edge > lim) col = vec3(0.86, 0.62, 0.36);
    `,
  }), 1.55, DECK_Y + 0.25, 0);
  // bucket with a rim, handle and some water
  const bucketMat = celMaterial({ color: '#3f8de0', id: 14, side: THREE.DoubleSide, gloss: 0.6, pattern: 'if(!gl_FrontFacing) col *= 0.75; if(vLocal.y > 0.12) col *= 1.08;' });
  add(new THREE.CylinderGeometry(0.2, 0.16, 0.32, 20, 1, true), bucketMat, 0.9, DECK_Y + 0.16, 0.5);
  put(new THREE.TorusGeometry(0.2, 0.016, 6, 22).rotateX(Math.PI / 2), celMaterial({ color: '#3f8de0', id: 14, gloss: 0.6 }), 0.9, DECK_Y + 0.32, 0.5);
  put(new THREE.TorusGeometry(0.2, 0.008, 4, 16, Math.PI), metal, 0.9, DECK_Y + 0.32, 0.5, 0, 0.5, 0);
  add(new THREE.CircleGeometry(0.19, 20).rotateX(-Math.PI / 2), celMaterial({ color: '#8fd8f0', id: 101, gloss: 1.0, pattern: 'emis = vec3(0.05, 0.1, 0.12); if(fract(length(vLocal.xz) * 18.0) < 0.15) col *= 1.12;' }), 0.9, DECK_Y + 0.25, 0.5);
  // fish-hold hatch
  const hatchMat = celMaterial({ color: '#c88a4c', id: 86, gloss: 0.1, pattern: `
      if(normalize(vLocalN).y > 0.5 && abs(fract(vLocal.z * 7.0) - 0.5) > 0.46) col *= 0.7;
    ` });
  add(softBox(0.74, 0.1, 0.74, 0.02, null, 2), wood, 0.05, DECK_Y + 0.05, 0);
  add(softBox(0.66, 0.06, 0.66, 0.025, null, 2), hatchMat, 0.05, DECK_Y + 0.12, 0);
  for (const s of [1, -1]) put(new THREE.TorusGeometry(0.035, 0.007, 4, 10, Math.PI), metal, 0.05 + 0.22 * s, DECK_Y + 0.15, 0, 0, Math.PI / 2, 0);
  // flemish rope coil and its loose end
  {
    const pts = [];
    for (let i = 0; i <= 200; i++) { const t = i / 200, a = t * Math.PI * 2 * 4.2, r = 0.05 + 0.19 * t; pts.push(V(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const e = pts[pts.length - 1];
    pts.push(e.clone().add(V(0.08, 0, 0.08)), e.clone().add(V(0.16, 0, 0.22)), e.clone().add(V(0.15, 0, 0.36)));
    const coil = add(tube(pts, 0.022, 600, 6), rope, 0.5, DECK_Y + 0.022, -0.58);
    void coil;
  }
  // line hauler / winch in front of the wheelhouse
  {
    const wx = -0.6, wz = 0.55;
    put(new THREE.CylinderGeometry(0.05, 0.075, 0.3, 12), celMaterial({ color: '#7d8aa3', id: 94, gloss: 0.5 }), wx, DECK_Y + 0.15, wz);
    const red = celMaterial({ color: '#e33a2f', id: 98, gloss: 0.7 });
    for (const s of [1, -1]) put(new THREE.CylinderGeometry(0.13, 0.13, 0.025, 20).rotateX(Math.PI / 2), red, wx, DECK_Y + 0.38, wz + 0.1 * s);
    add(new THREE.CylinderGeometry(0.085, 0.085, 0.18, 18).rotateX(Math.PI / 2), celMaterial({ color: '#e9d7a8', id: 16, gloss: 0.1, pattern: 'if(fract(vLocal.z * 40.0 + atan(vLocal.y, vLocal.x) * 0.16) < 0.3) col *= 0.8;' }), wx, DECK_Y + 0.38, wz);
    add(softBox(0.16, 0.14, 0.12, 0.03, null, 2), celMaterial({ color: '#5d8fb8', id: 94, gloss: 0.6 }), wx, DECK_Y + 0.36, wz - 0.22);
    put(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 6).rotateX(Math.PI / 2), iron, wx, DECK_Y + 0.38, wz - 0.06);
  }
  // aft deck: stacked fish boxes (starboard) and a pile of net with floats (port)
  {
    const boxMat = celMaterial({ color: '#46a6e8', id: 94, gloss: 0.5, pattern: `
        vec3 n = normalize(vLocalN);
        if(n.y > 0.7 && abs(vLocal.x) < 0.21 && abs(vLocal.z) < 0.14) col = vec3(0.16, 0.36, 0.6);
        if(n.y < 0.7 && abs(fract(vLocal.y * 22.0) - 0.5) > 0.38) col *= 0.82;
      ` });
    add(softBox(0.5, 0.15, 0.36, 0.03, null, 2), boxMat, -2.7, DECK_Y + 0.075, 0.45);
    add(softBox(0.5, 0.15, 0.36, 0.03, null, 2), boxMat, -2.68, DECK_Y + 0.225, 0.43).rotation.y = 0.12;
    const net = celMaterial({ color: '#3f8f73', id: 95, gloss: 0.1, pattern: `
        vec2 q = vLocal.xz * 22.0 + vLocal.y * 9.0;
        if(abs(fract(q.x + q.y) - 0.5) > 0.42 || abs(fract(q.x - q.y) - 0.5) > 0.42) col *= 0.68;
      ` });
    const pile = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
    const pp = pile.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const x = pp.getX(i), y = pp.getY(i), z = pp.getZ(i);
      const a = Math.atan2(z, x);
      const k = 1 + 0.12 * Math.sin(a * 3 + y * 4) + 0.08 * Math.sin(a * 7 + 1.3) * y;
      pp.setXYZ(i, x * 0.34 * k, y * 0.2 * (1 + 0.15 * Math.sin(a * 2 + 0.5)), z * 0.28 * k);
    }
    pile.computeVertexNormals();
    add(pile, net, -2.6, DECK_Y, -0.42);
    const floatMat = celMaterial({ color: '#ff8a2a', id: 96, gloss: 0.9 });
    [[-2.7, 0.14, -0.5], [-2.48, 0.13, -0.34], [-2.62, 0.18, -0.28], [-2.42, 0.08, -0.6]].forEach(([x, y, z], i) => add(new THREE.SphereGeometry(i === 3 ? 0.05 : 0.06, 14, 10), i === 2 ? celMaterial({ color: '#ffd23a', id: 96, gloss: 0.9 }) : floatMat, x, DECK_Y + y, z));
  }

  for (const [mat, list] of batches) add(mergeGeometries(list), mat);

  const seat = new THREE.Vector3(1.5, DECK_Y + 0.5, 0);
  const st = { x: 0, z: 0, heading: 0, lift: 0, extraPitch: 0, extraRoll: 0 };
  void ctx;
  return {
    root, seat,
    // float on the drawn sea: sample the height field at bow, stern, port, starboard
    place(x, z, heading, o = {}) {
      st.x = x; st.z = z; st.heading = heading;
      const c = Math.cos(heading), s = Math.sin(heading);
      const P = (lx, lz) => oceanHeight(x + c * lx - s * lz, z + s * lx + c * lz);
      const hb = P(2.4, 0), hs = P(-2.4, 0), hp = P(0, -1.0), hsb = P(0, 1.0);
      const y = (hb + hs + hp + hsb) / 4;
      const pitch = Math.atan2(hb - hs, 4.8) * (o.pitchMul ?? 1) + (o.pitch ?? 0);
      const roll = Math.atan2(hsb - hp, 2.0) * 0.8 + (o.roll ?? 0);
      root.position.set(x, y + (o.lift ?? 0) - 0.02, z);
      root.rotation.set(0, 0, 0);
      root.rotation.order = 'YZX';
      root.rotation.y = -heading;
      root.rotation.z = pitch;
      root.rotation.x = roll;
      root.updateMatrixWorld(true);
    },
  };
}
