import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { onTwos } from './util.js';

// A few cel-shaded seagulls wheeling over the boat (drawn on twos).
// Gull frame: +z forward, +y up, +x right wing. Each wing has an inner (arm) and outer (hand)
// panel hinged at the wrist, so a flap bends through the wing and a glide reads as the gull "M".

// parametric surface: u wraps around a cross-section, v runs along an axis (poles may collapse)
function surface(fn, nu, nv) {
  const pos = new Float32Array(nu * (nv + 1) * 3), uv = new Float32Array(nu * (nv + 1) * 2), idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i < nu; i++) {
    fn(i / nu, j / nv, p);
    const k = j * nu + i;
    pos[k * 3] = p.x; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = p.z;
    uv[k * 2] = i / nu; uv[k * 2 + 1] = j / nv;
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const i1 = (i + 1) % nu;
    const a = j * nu + i, b = j * nu + i1, c = (j + 1) * nu + i, d = (j + 1) * nu + i1;
    idx.push(a, d, b, a, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// smooth 1-D profile through [x, value] keys
function prof(keys) {
  const c = new THREE.SplineCurve(keys.map(([a, b]) => new THREE.Vector2(a, b)));
  const pts = c.getSpacedPoints(200);
  return (x) => {
    let i = 0; while (i < pts.length - 2 && pts[i + 1].x < x) i++;
    const a = pts[i], b = pts[i + 1], t = Math.min(1, Math.max(0, (x - a.x) / ((b.x - a.x) || 1)));
    return a.y + (b.y - a.y) * t;
  };
}

// lofted body + head along z (tail at -z, crown of the head at +z)
function bodyGeo() {
  const Z0 = -0.36, Z1 = 0.375;
  const R = prof([[-0.36, 0.0], [-0.33, 0.03], [-0.2, 0.068], [-0.05, 0.094], [0.08, 0.09], [0.17, 0.064], [0.24, 0.063], [0.3, 0.057], [0.35, 0.036], [0.375, 0.0]]);
  const Y = prof([[-0.36, 0.022], [-0.2, 0.004], [0.0, -0.006], [0.14, 0.006], [0.22, 0.036], [0.3, 0.05], [0.375, 0.048]]);
  return surface((u, v, o) => {
    const th = u * Math.PI * 2, z = Z0 + (Z1 - Z0) * v;
    const r = Math.max(0, R(z));
    const belly = Math.sin(th) > 0 ? 1.08 : 0.94;   // fuller underneath
    o.set(Math.cos(th) * r * 0.88, Y(z) - Math.sin(th) * r * belly, z);
  }, 22, 34);
}
// beak: tapering, the tip hooks down
function beakGeo() {
  return surface((u, v, o) => {
    const th = u * Math.PI * 2;
    const r = 0.023 * Math.pow(1 - v, 0.75) + 0.0015;
    o.set(Math.cos(th) * r * 0.78, 0.042 - 0.016 * v * v - Math.sin(th) * r, 0.345 + 0.12 * v);
  }, 10, 10);
}
// wing panel along +x; the airfoil loop: thicker at the leading edge, a little camber
function wingGeo(L, chord, lead, thick, camb) {
  return surface((u, v, o) => {
    const th = u * Math.PI * 2, c = chord(v), mid = lead(v) - c / 2;
    const s = Math.sin(th), co = Math.cos(th);
    const t = thick(v) * (0.6 + 0.4 * s);
    o.set(v * L, camb * c * (1 - s * s) * 4 - co * t, mid + (c / 2) * s);
  }, 14, 16);
}

export function makeGulls(scene) {
  const white = celMaterial({ color: '#ffffff', id: 70, gloss: 0.3, pattern: `
      litMul = vec3(1.0);
      // grey mantle on the back between the wings
      if(vLocal.y > 0.03 + max(0.0, vLocal.z) * 0.2 && vLocal.z > -0.24 && vLocal.z < 0.12) col = vec3(0.7, 0.75, 0.84);
      // eye: black with a glint
      if(length(vec2(vLocal.y - 0.07, vLocal.z - 0.3)) < 0.016 && abs(vLocal.x) > 0.02){ col = vec3(0.06, 0.06, 0.12); idOut = 75.0;
        if(length(vec2(vLocal.y - 0.076, vLocal.z - 0.306)) < 0.006) col = vec3(1.0); }
    ` });
  const wingMaterial = (outer) => celMaterial({ color: '#aeb8cd', id: 71, gloss: 0.15, side: THREE.DoubleSide, uniforms: { uOuter: { value: outer } }, pattern: `
      float th = vUv.x * 6.2832;
      float cf = (1.0 - sin(th)) * 0.5;          // 0 leading edge .. 1 trailing edge
      bool under = cos(th) > 0.0;
      if(under) { col = vec3(0.9, 0.92, 0.96); litMul = vec3(1.0); }
      if(cf > 0.8) col = vec3(0.97, 0.97, 0.99);   // white trailing edge
      if(uOuter > 0.5){
        float tipB = 0.48 + 0.18 * cf;              // black wingtip, ragged boundary
        if(vUv.y > tipB){
          col = vec3(0.12, 0.12, 0.18); idOut = 76.0;
          // white "mirror" spots near the tip
          if(length(vec2((vUv.y - 0.86) * 3.0, cf - 0.45)) < 0.2 && !under) col = vec3(0.97);
          if(under) col = vec3(0.2, 0.2, 0.27);
        }
      }
    ` });
  const wingMat = wingMaterial(0), outerMat = wingMaterial(1);
  const beak = celMaterial({ color: '#ffc531', id: 72, gloss: 0.8, pattern: 'if(vLocal.z > 0.42 && vLocal.y < 0.026) col = vec3(0.92, 0.18, 0.14);' });
  const tailMat = celMaterial({ color: '#ffffff', id: 73, gloss: 0.2, side: THREE.DoubleSide, pattern: 'litMul = vec3(1.0);' });
  const feetMat = celMaterial({ color: '#f2c4b4', id: 70, gloss: 0.2 });

  const bGeo = bodyGeo(), kGeo = beakGeo();
  const innerGeo = wingGeo(0.36, (v) => 0.25 - 0.04 * v, () => 0.115, (v) => 0.032 - 0.01 * v, 0.012);
  const outerGeo = wingGeo(0.56, (v) => 0.215 * (1 - Math.pow(v, 1.5)) + 0.02, (v) => 0.1 - 0.05 * v - 0.13 * v * v, (v) => 0.02 * (1 - v) + 0.003, 0.01);
  const tail = new THREE.Shape();
  tail.moveTo(-0.045, -0.3); tail.lineTo(0.045, -0.3); tail.lineTo(0.105, -0.49); tail.quadraticCurveTo(0.0, -0.53, -0.105, -0.49); tail.lineTo(-0.045, -0.3);
  const tailGeo = new THREE.ExtrudeGeometry(tail, { depth: 0.012, bevelEnabled: false, curveSegments: 6 }).rotateX(Math.PI / 2).translate(0, 0.022, 0);
  const footGeo = new THREE.SphereGeometry(1, 8, 6).scale(0.012, 0.009, 0.036);

  const gulls = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const body = new THREE.Group(); g.add(body);
    body.add(new THREE.Mesh(bGeo, white), new THREE.Mesh(kGeo, beak), new THREE.Mesh(tailGeo, tailMat));
    for (const s of [1, -1]) { const f = new THREE.Mesh(footGeo, feetMat); f.position.set(0.016 * s, -0.062, -0.2); f.rotation.x = 0.15; body.add(f); }
    // wings: [mirror] -> shoulder (flap) -> inner panel + wrist (bend) -> outer panel
    const wings = [1, -1].map((s) => {
      const mir = new THREE.Group(); mir.scale.x = s; mir.position.set(0, 0, 0); body.add(mir);
      const sh = new THREE.Group(); sh.position.set(0.05, 0.035, 0.04); mir.add(sh);
      sh.add(new THREE.Mesh(innerGeo, wingMat));
      const wr = new THREE.Group(); wr.position.set(0.355, 0, 0); sh.add(wr);
      wr.add(new THREE.Mesh(outerGeo, outerMat));
      return { sh, wr };
    });
    g.scale.setScalar(1.6);
    scene.add(g);
    gulls.push({ g, body, wings, r: 9 + i * 5, h: 9 + (i % 3) * 4, sp: 0.35 + 0.07 * i, ph: i * 1.7, flap: 4 + i * 0.6 });
  }
  return {
    update(st) {
      const on = st.gulls;
      for (const q of gulls) {
        q.g.visible = !!on;
        if (!on) continue;
        const t = onTwos(st.t);
        const a = q.ph + t * q.sp;
        const c = on.center ?? [0, 0, 0];
        q.g.position.set(c[0] + Math.cos(a) * q.r, c[1] + q.h + Math.sin(t * 0.8 + q.ph) * 0.8, c[2] + Math.sin(a) * q.r);
        q.g.rotation.set(0, -a, 0.35);   // facing along the circle, banked
        // flap with the hand lagging the arm; between bursts, glide in the gull "M"
        const ph = t * q.flap + q.ph;
        const amp = Math.sin(t * 0.5 + q.ph) > 0.2 ? 0.12 : 1;
        const f = Math.sin(ph), fl = Math.sin(ph - 0.9);
        for (const w of q.wings) {
          w.sh.rotation.set(0, 0.06, 0.2 + f * 0.55 * amp);
          w.wr.rotation.set(0, 0.22 - 0.12 * f * amp, -0.42 + fl * 0.5 * amp);
        }
        q.body.position.y = -f * 0.035 * amp;
        q.body.rotation.x = -0.06 + 0.04 * f * amp;
      }
    },
  };
}
