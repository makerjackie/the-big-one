import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// KOBO, the little robot fisherman (~1.3 m sitting). Local frame: +x faces forward, +y up, +z right.
// Expressions are drawn in the head shader: a big camera-lens eye with lids, pupil, highlights, blush.

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
const _m = new THREE.Matrix4();
const sgnPow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

function limb(mesh, p0, p1) {   // orient a unit-height Y cylinder between two points
  _a.subVectors(p1, p0);
  const len = _a.length();
  mesh.position.copy(p0).addScaledVector(_a, 0.5);
  _q.setFromUnitVectors(_up, _a.normalize());
  mesh.quaternion.copy(_q);
  mesh.scale.set(1, len, 1);
}

// two-bone IK: returns the elbow given shoulder S, hand H, bone lengths, and a pole hint
function ik(S, H, la, lb, pole) {
  const d = _a.subVectors(H, S); let L = d.length();
  L = Math.min(L, la + lb - 1e-3);
  const dir = d.normalize().clone();
  const a = (la * la - lb * lb + L * L) / (2 * L);
  const h = Math.sqrt(Math.max(0, la * la - a * a));
  const pp = pole.clone().sub(S); pp.addScaledVector(dir, -pp.dot(dir)); pp.normalize();
  return S.clone().addScaledVector(dir, a).addScaledVector(pp, h);
}

// ---------------------------------------------------------------- geometry helpers
// Parametric surface: u runs around (wraps), v runs from one end to the other.
// fn(u, v, out) writes a point. Collapsed end rows (poles) get one shared normal.
function surface(fn, nu, nv, wrap = true) {
  const cols = wrap ? nu : nu + 1;
  const pos = new Float32Array(cols * (nv + 1) * 3), uv = new Float32Array(cols * (nv + 1) * 2), idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i < cols; i++) {
    fn(i / nu, j / nv, p);
    const k = j * cols + i;
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = wrap ? (i + 1) % nu : i + 1;
    const a = j * cols + i, b = j * cols + i1, c = (j + 1) * cols + i, d = (j + 1) * cols + i1;
    idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  for (const j of [0, nv]) {
    const k0 = j * cols;
    let same = true;
    for (let i = 1; i < cols && same; i++) for (let c = 0; c < 3; c++) if (Math.abs(pos[(k0 + i) * 3 + c] - pos[k0 * 3 + c]) > 1e-6) same = false;
    if (!same) continue;
    const s = new THREE.Vector3();
    for (let i = 0; i < cols; i++) { s.x += n.getX(k0 + i); s.y += n.getY(k0 + i); s.z += n.getZ(k0 + i); }
    s.normalize();
    for (let i = 0; i < cols; i++) n.setXYZ(k0 + i, s.x, s.y, s.z);
  }
  return g;
}
// superellipsoid: half sizes a (x), b (y), c (z); p = squareness around, q = squareness top to bottom
function superEllipsoid(a, b, c, p = 2, q = 2, nu = 32, nv = 20, warp = null) {
  return surface((u, v, o) => {
    const th = u * Math.PI * 2, ph = (v - 0.5) * Math.PI;
    const cp = sgnPow(Math.cos(ph), 2 / q), sp = sgnPow(Math.sin(ph), 2 / q);
    o.set(a * cp * sgnPow(Math.cos(th), 2 / p), b * sp, c * cp * sgnPow(Math.sin(th), 2 / p));
    if (warp) warp(o, u, v);
  }, nu, nv);
}
// lathe from a smoothed (r, y) profile. Walk the profile counter-clockwise (material on the left).
function lathe(profile, nu = 32, nv = 48, warp = null, sx = 1, sz = 1) {
  const pts = new THREE.SplineCurve(profile.map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(nv);
  return surface((u, v, o) => {
    const th = u * Math.PI * 2, pp = pts[Math.round(v * nv)];
    o.set(pp.x * Math.cos(th) * sx, pp.y, pp.x * Math.sin(th) * sz);
    if (warp) warp(o, th, pp.x);
  }, nu, nv);
}
// a corrugated hose of unit length along y (-0.5..0.5), unit radius
function hoseGeo(ribs = 6, depth = 0.11) {
  return surface((u, v, o) => {
    const th = u * Math.PI * 2;
    const r = 1 - depth * Math.pow(Math.abs(Math.cos(Math.PI * v * ribs)), 10);
    o.set(Math.cos(th) * r, v - 0.5, Math.sin(th) * r);
  }, 18, ribs * 8, true);
}
class Helix extends THREE.Curve {
  constructor(r, h, turns) { super(); this.r = r; this.h = h; this.turns = turns; }
  getPoint(t, o = new THREE.Vector3()) { const a = t * this.turns * Math.PI * 2; return o.set(Math.cos(a) * this.r, t * this.h, Math.sin(a) * this.r); }
}

// head shape (shared by the mesh, the lens bezel and the chin strap)
const HEAD = { a: 0.3, b: 0.27, c: 0.31, p: 2.5, q: 2.3, y: 0.24 };
function headRadius(d) {   // distance from the head centre to its surface along unit direction d
  const F = Math.pow(Math.pow(Math.abs(d.x / HEAD.a), HEAD.p) + Math.pow(Math.abs(d.z / HEAD.c), HEAD.p), HEAD.q / HEAD.p) + Math.pow(Math.abs(d.y / HEAD.b), HEAD.q);
  return Math.pow(F, -1 / HEAD.q);
}

const INK = 'vec3(0.17, 0.19, 0.32)';

export function makeRobot(ctx) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);          // leans from the hips
  const headPivot = new THREE.Group(); body.add(headPivot);
  headPivot.position.set(0, 0.62, 0);
  const add = (parent, geo, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  // ---- materials
  const dark = celMaterial({ color: '#4b4d63', id: 20, gloss: 0.5 });
  const hose = celMaterial({ color: '#4b4d63', id: 22, gloss: 0.6, pattern: `
      float rb = fract(vLocal.y * 6.0 + 0.5);
      if(abs(rb - 0.5) > 0.4) col *= 0.62;
      else if(abs(rb - 0.5) < 0.12) col = mix(col, vec3(0.75, 0.78, 0.9), 0.25);
    ` });
  const orange = celMaterial({
    color: '#ff8a3a', id: 21, gloss: 0.7,
    pattern: `
      vec3 p = vLocal; vec3 n = normalize(vLocalN);
      // rubber waist seal
      if(p.y > 0.085 && p.y < 0.128){ col = vec3(0.3, 0.31, 0.43); idOut = 82.0; gloss = 0.3; }
      // shell seams: a shoulder yoke and the side split
      if(abs(p.y - 0.565) < 0.0055) col *= 0.72;
      if(abs(n.z) > 0.55 && abs(p.x + 0.035) < 0.005 && p.y > 0.128) col *= 0.72;
      // little rivets along the waist
      float rk = fract(atan(p.z, p.x) * 1.9099 + 0.5);
      if(abs(p.y - 0.152) < 0.011 && abs(rk - 0.5) < 0.05) col *= 0.74;
      // fisherman's badge on both flanks: a little fish on a cream disc
      if(abs(n.z) > 0.5){
        vec2 bq = vec2(p.x + 0.1, p.y - 0.27) / 0.072;
        float br = length(bq);
        if(br < 1.0){
          col = br > 0.84 ? vec3(0.3, 0.31, 0.43) : vec3(1.0, 0.95, 0.84); idOut = 39.0; gloss = 0.5;
          vec2 fq = vec2(bq.x - 0.08, bq.y);
          float fish = step(length(fq / vec2(0.46, 0.28)), 1.0) + step(abs(fq.y), (-0.32 - fq.x) * 1.05 + 0.04) * step(-0.72, fq.x) * step(fq.x, -0.32);
          if(fish > 0.5 && br < 0.84) col = vec3(0.93, 0.33, 0.2);
          if(length(fq - vec2(0.24, 0.07)) < 0.07) col = vec3(1.0, 0.95, 0.84);
        }
      }
      // cream chest plate
      vec2 q = vec2(p.z, p.y - 0.355);
      vec2 dq = abs(q) - vec2(0.165, 0.165) + 0.07;
      float sd = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0) - 0.07;
      if(p.x > 0.05 && n.x > 0.2 && sd < 0.0){
        col = vec3(1.0, 0.95, 0.84); idOut = 31.0; gloss = 0.5;
        if(sd > -0.012) col *= 0.93;
        // pressure gauge
        vec2 g = q - vec2(0.0, 0.05);
        float r = length(g);
        float an = atan(g.x, g.y);
        if(r < 0.07){
          idOut = 83.0; col = ${INK}; gloss = 1.0;
          if(r < 0.055){
            col = vec3(0.93, 1.0, 0.95); emis = col * 0.06;
            if(r > 0.039 && abs(an) < 2.3 && abs(fract(an / 0.575 + 0.5) - 0.5) < 0.1) col = ${INK};
            if(r > 0.036 && an > 1.3 && an < 2.3) col = vec3(0.95, 0.27, 0.22);
            vec2 nd = vec2(sin(-0.55), cos(-0.55));
            float al = dot(g, nd), off = abs(g.x * nd.y - g.y * nd.x);
            if(al > -0.01 && al < 0.042 && off < 0.0065 * (1.0 - al / 0.055)) col = vec3(0.92, 0.2, 0.17);
            if(r < 0.011) col = ${INK};
            if(length(g - vec2(0.022, 0.026)) < 0.009) { col = vec3(1.0); emis = vec3(0.2); }
          }
        }
        // speaker grille and three buttons
        if(abs(q.y + 0.085) < 0.014 && abs(q.x) < 0.085 && fract(q.x * 23.5) < 0.42) col = vec3(0.3, 0.31, 0.43);
        for(int i = 0; i < 3; i++){
          vec2 bc = vec2(-0.05 + 0.05 * float(i), -0.13);
          if(length(q - bc) < 0.016){ col = i == 0 ? vec3(0.95, 0.28, 0.22) : (i == 1 ? vec3(1.0, 0.82, 0.2) : vec3(0.3, 0.8, 0.75)); idOut = 84.0; }
        }
        vec2 sc = abs(q) - vec2(0.128, 0.128);
        if(length(sc) < 0.011) col = vec3(0.72, 0.68, 0.6);
      }
    `,
  });
  const capMat = celMaterial({ color: '#ff8a3a', id: 34, gloss: 0.8, pattern: `
      if(length(vLocal.xz) < 0.011) col = vec3(0.62, 0.58, 0.6);
      if(vLocal.y < 0.01) col *= 0.84;
    ` });
  const foreMat = celMaterial({ color: '#ff8a3a', id: 35, gloss: 0.7, pattern: `
      if(vLocal.y > 0.12 && vLocal.y < 0.24) col = vec3(1.0, 0.95, 0.84);
      if(vLocal.y < -0.38) col *= 0.82;
    ` });
  const handMat = celMaterial({ color: '#f7f3ea', id: 36, gloss: 0.6, pattern: `
      // finger creases across the knuckles
      if(vLocalN.y > 0.25 && vLocal.y > 0.03 && abs(abs(vLocal.z) - 0.026) < 0.0045) col *= 0.72;
    ` });
  const packMat = celMaterial({ color: '#f5f1e6', id: 29, gloss: 0.6, pattern: `
      if(vLocalN.x < -0.7){
        vec2 q = vLocal.zy;
        if(abs(q.x) < 0.12 && q.y < -0.02 && q.y > -0.12 && fract(q.y * 30.0) < 0.45) col = vec3(0.3, 0.31, 0.43);
      }
      if(abs(vLocal.y - 0.07) < 0.004) col *= 0.8;
    ` });
  const yellow = celMaterial({ color: '#ffcf2e', id: 30, gloss: 0.85 });
  const shaftMat = celMaterial({ color: '#ffcf2e', id: 30, gloss: 0.85, pattern: 'if(vLocal.y > 0.158) col = vec3(1.0, 0.72, 0.2);' });
  const sole = celMaterial({ color: '#3a3b4f', id: 37, gloss: 0.3, pattern: 'if(vLocal.y < -0.012) col *= 0.8;' });
  const red = celMaterial({ color: '#ff3b3b', id: 25, gloss: 0.9 });
  const metal = celMaterial({ color: '#c9ccd8', id: 81, gloss: 1.0 });
  const brass = celMaterial({ color: '#f2c14e', id: 80, gloss: 1.0 });

  // ---- hips and torso
  add(body, superEllipsoid(0.22, 0.11, 0.24, 2.6, 2.4, 28, 16), dark, 0, 0.085, 0);
  const torsoGeo = surface((u, v, o) => {
    const th = u * Math.PI * 2, ph = (v - 0.5) * Math.PI;
    const cp = sgnPow(Math.cos(ph), 2 / 2.3), sp = sgnPow(Math.sin(ph), 2 / 2.3);
    const tap = 1 - 0.1 * sp - 0.04 * sp * sp;
    o.set(0.285 * cp * sgnPow(Math.cos(th), 2 / 2.7) * tap, 0.35 + 0.31 * sp, 0.3 * cp * sgnPow(Math.sin(th), 2 / 2.7) * tap);
    if (o.x > 0) o.x *= 1 + 0.07 * Math.max(0, 0.3 - sp);   // a little round belly
  }, 56, 36);
  add(body, torsoGeo, orange);
  add(body, new THREE.CylinderGeometry(0.085, 0.095, 0.14, 20), hose, 0, 0.67, 0);
  add(body, new THREE.TorusGeometry(0.13, 0.03, 10, 36).rotateX(Math.PI / 2), dark, 0, 0.645, 0);
  // shoulder sockets and caps ride on the body
  for (const s of [1, -1]) {
    add(body, new THREE.SphereGeometry(0.058, 16, 12), dark, 0.02, 0.5, 0.29 * s);
    const cap = add(body, new THREE.SphereGeometry(0.118, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.72, 1), capMat, 0.02, 0.525, 0.268 * s);
    cap.rotation.x = s * (Math.PI / 2 - 0.42);
  }
  // backpack battery, status lamp and a wind-up key that turns while he fishes
  const pack = add(body, new RoundedBoxGeometry(0.2, 0.32, 0.36, 3, 0.05), packMat, -0.275, 0.38, 0);
  pack.rotation.z = -0.08;
  add(body, new THREE.CylinderGeometry(0.062, 0.062, 0.24, 22).rotateX(Math.PI / 2), orange, -0.31, 0.545, 0);
  for (const s of [1, -1]) add(body, new THREE.CylinderGeometry(0.066, 0.066, 0.025, 22).rotateX(Math.PI / 2), metal, -0.31, 0.545, 0.13 * s);
  add(body, new THREE.SphereGeometry(0.028, 12, 8), celMaterial({ color: '#7dff9a', id: 32, emissive: '#2a7a3a' }), -0.33, 0.29, 0.155);
  const keyG = new THREE.Group(); keyG.position.set(-0.385, 0.4, 0); body.add(keyG);
  add(keyG, new THREE.CylinderGeometry(0.014, 0.014, 0.1, 10).rotateZ(Math.PI / 2), brass, -0.04, 0, 0);
  add(keyG, new THREE.CylinderGeometry(0.03, 0.03, 0.012, 16).rotateZ(Math.PI / 2), brass, -0.005, 0, 0);
  for (const s of [1, -1]) add(keyG, new THREE.TorusGeometry(0.042, 0.013, 8, 20).rotateY(Math.PI / 2).scale(1, 0.85, 1), brass, -0.1, 0, 0.05 * s);
  add(keyG, new THREE.SphereGeometry(0.022, 12, 8), brass, -0.1, 0, 0);

  // ---- head with the drawn face
  const face = {
    uEyeOpen: { value: 1 }, uPupil: { value: 1 }, uEyeMode: { value: 0 }, uBlush: { value: 0.6 }, uLook: { value: new THREE.Vector2(0, 0) }, uSweat: { value: 0 },
  };
  const headMat = celMaterial({
    color: '#f6f3ea', id: 23, gloss: 0.8, uniforms: face,
    pattern: `
      vec3 n = normalize(vLocal);
      // face coords: looking down +x; u to the right (+z), v up
      vec2 f = vec2(n.z, n.y - 0.02) / max(n.x, 0.05);
      float front = step(0.2, n.x);
      // big lens eye
      vec2 e = f - vec2(0.0, 0.0);
      float r = length(e);
      if(front > 0.5 && r < 0.56){
        idOut = 24.0;
        if(r > 0.47){ col = ${INK}; gloss = 1.0; }          // lens ring
        else {
          vec2 lp = e - uLook * 0.12;
          float lr = length(lp);
          vec3 glass = mix(vec3(0.1, 0.55, 0.85), vec3(0.45, 0.95, 1.0), smoothstep(-0.4, 0.4, e.y));
          col = glass;
          if(lr > 0.3 && lr < 0.34) col = vec3(0.08, 0.32, 0.6);              // iris ring
          if(lr < 0.17 * uPupil) col = vec3(0.04, 0.06, 0.16);               // pupil
          emis = col * 0.25;
          // anime highlights, fixed to the face
          if(length(e - vec2(-0.16, 0.17)) < 0.09 || length(e - vec2(0.13, -0.14)) < 0.04){ col = vec3(1.0); emis = vec3(0.4); }
          // lids: cream shutters closing from the top (and a little from below)
          float top = mix(-0.06, 0.5, uEyeOpen);
          float bot = mix(-0.08, -0.5, min(1.0, uEyeOpen * 1.6));
          if(uEyeMode > 0.5){ top = -0.6; bot = -0.6; }
          if(e.y > top || e.y < bot){ col = vec3(0.96, 0.93, 0.86); emis = vec3(0.0); gloss = 0.3; }
          if(abs(e.y - top) < 0.03 || abs(e.y - bot) < 0.025) col = ${INK};
          // happy eye: a ^ arc
          if(uEyeMode > 0.5){
            float d = abs(length(e - vec2(0.0, -0.22)) - 0.3);
            if(d < 0.045 && e.y > -0.12) col = ${INK};
          }
        }
      }
      // blush
      float bl = min(length((f - vec2(0.5, -0.38)) * vec2(1.0, 1.6)), length((f - vec2(-0.5, -0.38)) * vec2(1.0, 1.6)));
      if(front > 0.5 && bl < 0.13) col = mix(col, vec3(1.0, 0.55, 0.55), uBlush);
      // mouth grille: three little slots
      if(front > 0.5 && f.y < -0.62 && f.y > -0.7 && abs(f.x) < 0.2 && fract(f.x * 12.5 + 0.5) < 0.6) col = vec3(0.2, 0.22, 0.35);
      // face plate seam and a vent on the back of the head
      if(abs(n.x - 0.2) < 0.011) col *= 0.8;
      if(n.x < -0.55 && abs(n.z) < 0.28 && n.y > -0.2 && n.y < 0.22 && fract((n.y + 0.2) * 12.0) < 0.38) col = vec3(0.3, 0.31, 0.43);
      // sweat drop (painted on the temple)
      vec2 sd = f - vec2(-0.78, 0.35);
      float drop = length(sd * vec2(1.0, 0.75)) - 0.12 + max(0.0, sd.y) * 0.5;
      if(uSweat > 0.0 && front > 0.5 && drop < 0.0){ col = vec3(0.6, 0.9, 1.0); idOut = 33.0; if(length(sd - vec2(-0.03, 0.02)) < 0.035) col = vec3(1.0); }
    `,
  });
  const head = add(headPivot, superEllipsoid(HEAD.a, HEAD.b, HEAD.c, HEAD.p, HEAD.q, 72, 48), headMat, 0, HEAD.y, 0);
  // raised lens bezel around the painted eye
  {
    const pts = [];
    const rho = 0.525;
    for (let i = 0; i < 64; i++) {
      const th = (i / 64) * Math.PI * 2;
      const Z = rho * Math.cos(th);
      let Y = rho * Math.sin(th);
      for (let k = 0; k < 4; k++) Y = rho * Math.sin(th) + 0.02 * Math.sqrt(1 + Y * Y + Z * Z);
      const d = V(1, Y, Z).normalize();
      pts.push(d.multiplyScalar(headRadius(d) + 0.004));
    }
    add(head, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 96, 0.017, 10, true), celMaterial({ color: '#2b2f4a', id: 38, gloss: 1.0 }));
  }
  // ear caps with a speaker grille
  const earMat = celMaterial({ color: '#ff8a3a', id: 26, gloss: 0.7 });
  const grille = celMaterial({ color: '#3c3e55', id: 85, gloss: 0.6, pattern: `
      float rr = length(vLocal.xz);
      if(fract(rr * 70.0) < 0.35 && rr > 0.015) col *= 0.7;
      if(rr < 0.016) col = vec3(1.0, 0.54, 0.23);
    ` });
  for (const s of [1, -1]) {
    add(headPivot, new THREE.CylinderGeometry(0.098, 0.104, 0.07, 28).rotateX(Math.PI / 2), earMat, 0, 0.24, 0.3 * s);
    add(headPivot, new THREE.CylinderGeometry(0.062, 0.066, 0.03, 24).rotateX(Math.PI / 2), grille, 0, 0.24, 0.343 * s);
  }
  // spring antenna (pokes through the top of the hat as a red pompom)
  const antG = new THREE.Group(); antG.position.set(-0.02, 0.5, 0); antG.rotation.z = 0.08; headPivot.add(antG);
  add(antG, new THREE.CylinderGeometry(0.028, 0.036, 0.04, 16), dark, 0, 0.01, 0);
  add(antG, new THREE.TubeGeometry(new Helix(0.019, 0.12, 5.5), 110, 0.0058, 6), metal, 0, 0.025, 0);
  add(antG, new THREE.CylinderGeometry(0.008, 0.009, 0.12, 8), metal, 0, 0.2, 0);
  const antBall = add(antG, new THREE.SphereGeometry(0.046, 16, 12), red, 0, 0.268, 0);

  // ---- straw hat (its own group so it can blow away)
  const hat = new THREE.Group();
  const straw = celMaterial({
    color: '#f2cf6f', id: 27, gloss: 0.1,
    pattern: `
      float rr = length(vLocal.xz);
      float an = atan(vLocal.z, vLocal.x);
      // fine basket weave running diagonally round the cone
      float wa = an * rr * 34.0, wb = rr * 34.0;
      float weave = abs(step(0.5, fract(wa + wb)) - step(0.5, fract(wa - wb)));
      col *= 0.955 + 0.045 * weave;
      // a few stitched rows and the bamboo ribs radiating from the crown
      float rows = min(min(abs(rr - 0.2), abs(rr - 0.37)), abs(rr - 0.5));
      if(rows < 0.0035) col *= 0.86;
      if(vLocalN.y > 0.0 && abs(fract(an * 2.5465) - 0.5) > 0.485 && rr > 0.06 && rr < 0.6) col *= 0.86;
      // bound rim
      if(rr > 0.617) col = vec3(0.8, 0.53, 0.27);
      // underside: sun glowing warm through the straw instead of a cold shadow
      if(vLocalN.y < -0.2) { shadeTint = vec3(0.86, 0.6, 0.48); litBias = 0.25; shadeMul = 1.0; }
    `,
  });
  const brimWarp = (o, th, r) => {
    const k = Math.max(0, (r - 0.34) / 0.3);
    o.y += k * k * (0.014 * Math.sin(3 * th + 0.6) + 0.006 * Math.sin(7 * th + 1.3) - 0.008);
  };
  const HAT_PROFILE = [
    [0.0, 0.228], [0.1, 0.152], [0.2, 0.072], [0.265, 0.022], [0.32, -0.012], [0.45, -0.045], [0.56, -0.079], [0.614, -0.099],
    [0.633, -0.098], [0.642, -0.087], [0.632, -0.076], [0.56, -0.057], [0.45, -0.024], [0.34, 0.012], [0.29, 0.042],
    [0.2, 0.126], [0.1, 0.2], [0.04, 0.244], [0.0, 0.258],
  ];
  add(hat, lathe(HAT_PROFILE, 64, 90, brimWarp), straw);
  const bandMat = celMaterial({ color: '#e0352b', id: 28, gloss: 0.5 });
  {
    // a ribbon band hugging the crown: offset the crown profile out (and in, hidden) along its normal
    const hp = new THREE.SplineCurve(HAT_PROFILE.map(([r, y]) => new THREE.Vector2(r, y))).getSpacedPoints(400);
    let rim = 0; hp.forEach((p, i) => { if (p.x > hp[rim].x) rim = i; });
    const out = [], inn = [];
    for (let i = rim + 1; i < hp.length - 1; i++) {
      const p = hp[i]; if (p.y < 0.036 || p.y > 0.094) continue;
      const t = hp[i + 1].clone().sub(hp[i - 1]).normalize();
      const n = new THREE.Vector2(t.y, -t.x);
      out.push([p.x + n.x * 0.009, p.y + n.y * 0.009]); inn.push([p.x - n.x * 0.008, p.y - n.y * 0.008]);
    }
    const step = Math.max(1, Math.floor(out.length / 8));
    const o2 = out.filter((_, i) => i % step === 0 || i === out.length - 1), i2 = inn.filter((_, i) => i % step === 0 || i === inn.length - 1);
    add(hat, lathe([i2[0], ...o2, ...i2.slice().reverse()], 56, 40), bandMat);
  }
  // bow at the back of the band
  {
    const bow = new THREE.Group(); hat.add(bow);
    const th = Math.PI + 0.55;
    bow.position.set(Math.cos(th) * 0.285, 0.068, Math.sin(th) * 0.285);
    bow.rotation.y = -th; bow.rotateZ(0.78);   // lie on the sloped band, facing out
    for (const s of [1, -1]) {
      const lp = add(bow, new THREE.SphereGeometry(1, 14, 10).scale(0.016, 0.026, 0.05), bandMat, 0.012, 0, 0.045 * s);
      lp.rotation.x = 0.5 * s;
      const tl = add(bow, new THREE.BoxGeometry(0.008, 0.09, 0.026), bandMat, 0.01, -0.05, 0.02 * s);
      tl.rotation.x = -0.35 * s;
    }
    add(bow, new THREE.SphereGeometry(0.02, 12, 8), bandMat, 0.014, 0, 0);
  }
  const hatOnHead = new THREE.Group(); headPivot.add(hatOnHead);
  hatOnHead.position.set(-0.02, 0.48, 0); hatOnHead.rotation.set(0.0, 0, 0.08);
  hatOnHead.add(hat);
  // chin strap: hugs the head, so it only shows while the hat is worn
  {
    const toHat = new THREE.Matrix4().compose(hatOnHead.position, new THREE.Quaternion().setFromEuler(hatOnHead.rotation), V(1, 1, 1)).invert();
    const half = [[0.03, 0.47, 0.235], [0.085, 0.4, 0.29], [0.118, 0.3, 0.32], [0.132, 0.2, 0.322], [0.15, 0.1, 0.283], [0.168, 0.025, 0.175], [0.175, -0.02, 0.0]];
    const pts = [...half.map(([x, y, z]) => V(x, y, z)), ...half.slice(0, -1).reverse().map(([x, y, z]) => V(x, y, -z))].map((p) => p.applyMatrix4(toHat));
    const strap = add(hat, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0075, 6), bandMat);
    const upd = hat.updateMatrixWorld.bind(hat);
    hat.updateMatrixWorld = (force) => { strap.visible = hat.parent === hatOnHead; upd(force); };
  }

  // ---- limbs
  const hoseUnit = hoseGeo();
  const foreGeo = new THREE.CylinderGeometry(0.066, 0.05, 1, 22, 1, true);
  // mitten fist: built along +y (the forearm direction), thumb on +z, palm toward -x*s
  const mitten = (s) => {
    const g = new THREE.Group(); root.add(g);
    add(g, superEllipsoid(0.064, 0.07, 0.078, 2.7, 2.5, 24, 16), handMat, 0, 0.045, 0);
    const th = add(g, new THREE.CapsuleGeometry(0.027, 0.04, 6, 12), handMat, -0.03 * s, 0.06, 0.068);
    th.rotation.set(-0.35, 0, 0.3 * s);
    add(g, new THREE.TorusGeometry(0.058, 0.017, 8, 22).rotateX(Math.PI / 2), foreMat, 0, -0.022, 0);
    return g;
  };
  const mk = (geo, r, mat) => { const m = new THREE.Mesh(geo, mat); m.userData.r = r; root.add(m); return m; };
  const arms = [1, -1].map((s) => ({
    s, up: mk(hoseUnit, 0.048, hose), fore: mk(foreGeo, 1, foreMat),
    elbow: add(root, new THREE.SphereGeometry(0.06, 16, 12), dark),
    hand: mitten(s),
  }));
  const shaftGeo = lathe([[0.0, -0.02], [0.076, -0.02], [0.08, 0.15], [0.09, 0.166], [0.098, 0.186], [0.093, 0.205], [0.076, 0.211], [0.06, 0.204], [0.0, 0.196]], 28, 30);
  const footGeo = superEllipsoid(0.148, 0.074, 0.103, 2.6, 2.4, 28, 16, (o) => { if (o.x > 0.04) o.y += 0.02 * ((o.x - 0.04) / 0.11) ** 2; });
  const soleGeo = superEllipsoid(0.158, 0.026, 0.11, 3.2, 3, 28, 10);
  const legs = [1, -1].map((s) => ({
    s, thigh: mk(hoseUnit, 0.058, hose), shin: mk(hoseUnit, 0.052, hose),
    knee: add(root, new THREE.SphereGeometry(0.062, 16, 12), dark),
    cap: add(root, new THREE.SphereGeometry(0.088, 22, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1), capMat),
    hip: add(root, new THREE.SphereGeometry(0.07, 16, 12), dark, 0.08, 0.05, 0.13 * s),
    shaft: add(root, shaftGeo, shaftMat),
    boot: (() => { const b = new THREE.Group(); root.add(b);
      add(b, footGeo, yellow, 0.065, -0.035, 0);
      add(b, soleGeo, sole, 0.068, -0.1, 0);
      return b; })(),
  }));
  const setLimb = (m, p0, p1) => { limb(m, p0, p1); const r = m.userData.r; m.scale.x = r; m.scale.z = r; };

  const tmp = new THREE.Matrix4();
  const fx = new THREE.Vector3(), fy = new THREE.Vector3(), fz = new THREE.Vector3(), REF = V(0.35, 1, 0).normalize();
  const P = {
    lean: 0, twist: 0, headPitch: 0, headYaw: 0, headRoll: 0, bob: 0,
    handR: V(0.42, 0.42, 0.06), handL: V(0.3, 0.36, -0.12), kick: 0,
  };
  const api = {
    root, hat, hatOnHead, face, head, headPivot,
    hatAttached: true,
    // pose: lean (fwd tilt rad), headPitch/Yaw/Roll, hands in root space, legs swing
    pose(p) {
      Object.assign(P, p);
      body.position.set(0, P.bob, 0);
      body.rotation.set(0, P.twist, -P.lean, 'YXZ');
      headPivot.rotation.set(P.headRoll, P.headYaw, P.headPitch, 'YXZ');
      keyG.rotation.x = P.kick * 0.6;
      body.updateMatrixWorld(true);
      // shoulders ride on the body
      for (const a of arms) {
        const S = V(0.02, 0.5, 0.29 * a.s).applyMatrix4(tmp.copy(body.matrix));
        const H = (a.s > 0 ? P.handR : P.handL).clone();
        const pole = S.clone().add(V(-0.3, -0.5, 0.5 * a.s));
        const E = ik(S, H, 0.25, 0.25, pole);
        a.elbow.position.copy(E);
        setLimb(a.up, S, E); setLimb(a.fore, E, H);
        // hand frame: +y along the forearm, thumb (+z) toward up
        fy.subVectors(H, E).normalize();
        fz.copy(REF).addScaledVector(fy, -REF.dot(fy)).normalize();
        fx.crossVectors(fy, fz);
        a.hand.quaternion.setFromRotationMatrix(_m.makeBasis(fx, fy, fz));
        a.hand.position.copy(H);
      }
      for (const l of legs) {
        const hip = V(0.08, 0.05, 0.13 * l.s);
        const sw = Math.sin(P.kick + (l.s > 0 ? 0 : 1.7)) * 0.08;
        const knee = V(0.38, 0.03, 0.16 * l.s);
        const ankle = V(0.44 + sw, -0.33, 0.17 * l.s);
        l.knee.position.copy(knee);
        const bis = V(0, 0, 0).subVectors(knee, hip).normalize().add(_b.subVectors(knee, ankle).normalize()).normalize();
        l.cap.position.copy(knee); l.cap.quaternion.setFromUnitVectors(_up, bis);
        setLimb(l.thigh, hip, knee); setLimb(l.shin, knee, ankle);
        l.shaft.position.copy(ankle);
        l.shaft.quaternion.setFromUnitVectors(_up, _b.subVectors(knee, ankle).normalize());
        l.boot.position.copy(ankle);
        l.boot.rotation.set(0, 0, Math.atan2(ankle.x - knee.x, knee.y - ankle.y) * 0.6);
      }
    },
    setFace(o) { for (const k in o) { if (face[k]) { if (face[k].value?.set && Array.isArray(o[k])) face[k].value.set(...o[k]); else face[k].value = o[k]; } } },
    headWorld(v) { return v.set(0, 0.24, 0).applyMatrix4(head.parent.matrixWorld); },
  };
  void antBall; void ctx;
  api.pose({});
  return api;
}
