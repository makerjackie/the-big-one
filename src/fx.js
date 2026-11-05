import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { Rng, onThrees } from './util.js';

// Drawn water FX: every particle is a pure function of film time (ballistic from its birth),
// sampled on threes like hand-drawn effects animation. Water is cel-shaded white with cyan shade
// and inked, so splashes read as drawn masses (not CG spray).
// Emitter: { t0, t1, n, origin(tb, r) -> [x,y,z], vel(tb, r) -> [vx,vy,vz], size: [a,b], life: [a,b],
//            g, drag, kind: 'water'|'mist'|'bubble'|'drop', stretch, grow }

const CAP = { water: 9000, mist: 1400, bubble: 1500 };

export function makeFx(ctx) {
  const root = new THREE.Group();
  const ico = new THREE.SphereGeometry(1, 18, 12);   // smooth normals: masses shade as one form
  const waterMat = celMaterial({
    color: '#ffffff', id: 60, gloss: 0.4, rim: 0.0, shadeMul: 1.0,
    pattern: `
      // white water: lit cream-white, shade a clean cyan-blue
      col = vInstColor;
      litBias = 0.42;
      litMul = vec3(1.0, 1.0, 1.03);
      shadeTint = vec3(0.6, 0.8, 0.98);
    `,
  });
  waterMat.uniforms.uShadeMul.value = 1;
  const mistMat = celMaterial({ color: '#ffffff', id: 0, gloss: 0.0, rim: 0.0, pattern: 'col = vInstColor; litBias = 0.02; idOut = 0.0; litMul = vec3(1.0, 1.0, 1.02); shadeTint = vec3(0.7, 0.75, 0.94);' });
  const bubbleMat = celMaterial({
    color: '#bff6ff', id: 101, gloss: 0.0,
    pattern: `
      vec3 V = normalize(cameraPosition - vWorld);
      float f = 1.0 - abs(dot(normalize(vNormalW), V));
      col = mix(vec3(0.35, 0.8, 0.95), vec3(0.95, 1.0, 1.0), smoothstep(0.55, 0.7, f));
      if(dot(normalize(vNormalW), normalize(vec3(-0.4, 0.8, 0.4))) > 0.85) col = vec3(1.0);
      litBias = 2.0;
    `,
  });
  const meshes = {
    water: new THREE.InstancedMesh(ico, waterMat, CAP.water),
    mist: new THREE.InstancedMesh(ico, mistMat, CAP.mist),
    bubble: new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), bubbleMat, CAP.bubble),
  };
  for (const k in meshes) {
    const m = meshes[k];
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    root.add(m);
  }
  // shade colours per kind via instance colour (cel tint is multiplied in the shader)
  const emitters = [];
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), Vv = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  const col = new THREE.Color();

  const api = {
    root,
    add(e) {
      // pre-roll per-particle randoms so frames are order independent
      const rng = new Rng(e.seed ?? emitters.length * 977 + 13);
      e.parts = Array.from({ length: e.n }, () => ({ u: rng.next(), r: [rng.next(), rng.next(), rng.next(), rng.next(), rng.next(), rng.next()] }));
      emitters.push(e);
      return e;
    },
    update(t) {
      const tq = onThrees(t) + 1 / 48;
      const cnt = { water: 0, mist: 0, bubble: 0 };
      for (const e of emitters) {
        if (tq < e.t0 || tq > e.t1 + (e.life[1] ?? 2)) continue;
        const kind = !e.kind || e.kind === 'drop' ? 'water' : e.kind;
        const mesh = meshes[kind];
        for (const p of e.parts) {
          const tb = e.t0 + (e.t1 - e.t0) * p.u;
          const age = tq - tb;
          if (age < 0) continue;
          const life = e.life[0] + (e.life[1] - e.life[0]) * p.r[0];
          if (age > life) continue;
          if (cnt[kind] >= CAP[kind]) break;
          const o = e.origin(tb, p.r);
          const v = e.vel(tb, p.r);
          const drag = e.drag ?? 0;
          const k = drag > 0 ? (1 - Math.exp(-drag * age)) / drag : age;
          const g = e.g ?? -9.8;
          P.set(o[0] + v[0] * k, o[1] + v[1] * k + 0.5 * g * age * age, o[2] + v[2] * k);
          if (e.floor !== undefined && P.y < e.floor) continue;
          const u = age / life;
          const grow = e.grow ?? 1;
          let sz = (e.size[0] + (e.size[1] - e.size[0]) * p.r[1]);
          sz *= kind === 'bubble' ? (0.6 + 0.6 * u) : Math.min(1, u * 6 + 0.35) * (1 + grow * u) * (1 - Math.pow(u, 3));
          if (sz <= 0.001) continue;
          // stretch along velocity
          Vv.set(v[0] * Math.exp(-drag * age), v[1] * Math.exp(-drag * age) + g * age, v[2] * Math.exp(-drag * age));
          const sp = Vv.length();
          const st = e.stretch ? 1 + Math.min(e.stretch, sp * 0.06 * e.stretch) : 1;
          if (sp > 1e-3 && st > 1.01) Q.setFromUnitVectors(Y, Vv.normalize()); else Q.identity();
          S.set(sz, sz * st, sz);
          M.compose(P, Q, S);
          const i = cnt[kind]++;
          mesh.setMatrixAt(i, M);
          const c = e.color ?? [1, 1, 1];
          col.setRGB(c[0], c[1], c[2]);
          if (e.heightTint) {
            // big masses: sea-blue at the root, white at the crest, a little variation per blob
            const [y0, y1] = e.heightTint, k = Math.min(1, Math.max(0, (P.y - y0) / (y1 - y0))) ** 0.8, v = 0.94 + 0.06 * p.r[5];
            col.setRGB((0.66 + 0.34 * k) * v, (0.84 + 0.16 * k) * v, (0.98 + 0.02 * k) * v);
          }
          mesh.setColorAt(i, col);
        }
      }
      for (const k in meshes) {
        meshes[k].count = cnt[k];
        meshes[k].instanceMatrix.needsUpdate = true;
        if (meshes[k].instanceColor) meshes[k].instanceColor.needsUpdate = true;
      }
    },
    clear() { emitters.length = 0; },
  };
  void ctx;
  return api;
}
