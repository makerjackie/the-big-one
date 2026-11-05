import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { Rng, onTwos } from './util.js';

// A shoal of small silver fish riding the bow wave of the Lord: hundreds of 1.5 m fish next to a
// 220 m giant sell its size. Deterministic: every fish is a function of film time.
const N = 260;

function fishGeo() {
  // a little torpedo with a forked tail, nose at +z
  const g = new THREE.BufferGeometry();
  const pos = [], idx = [];
  const ring = 6, R = 7;
  for (let i = 0; i <= R; i++) {
    const u = i / R, z = 0.75 - 1.5 * u;
    const r = 0.17 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.02)), 0.75);
    for (let j = 0; j < ring; j++) {
      const a = (j / ring) * Math.PI * 2;
      pos.push(Math.cos(a) * r * 0.55, Math.sin(a) * r, z);
    }
  }
  for (let i = 0; i < R; i++) for (let j = 0; j < ring; j++) {
    const a = i * ring + j, b = i * ring + (j + 1) % ring;
    idx.push(a, a + ring, b, b, a + ring, b + ring);
  }
  // forked tail
  const t0 = pos.length / 3;
  pos.push(0, 0, -0.7, 0, 0.3, -1.05, 0, 0.05, -0.85, 0, -0.3, -1.05);
  idx.push(t0, t0 + 1, t0 + 2, t0, t0 + 2, t0 + 3);
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function makeSchool(scene) {
  const mat = celMaterial({
    color: '#cfe2f2', id: 102, gloss: 1.0, side: THREE.DoubleSide,
    pattern: `
      // silver flank, a dark blue back and a yellow stripe
      col = mix(vec3(0.85, 0.92, 0.98), vec3(0.16, 0.3, 0.55), smoothstep(0.02, 0.1, vLocal.y));
      if(abs(vLocal.y - 0.01) < 0.025 && vLocal.z > -0.6) col = vec3(1.0, 0.86, 0.35);
      litBias = 0.2;
    `,
  });
  const mesh = new THREE.InstancedMesh(fishGeo(), mat, N);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const rng = new Rng(9177);
  const F = Array.from({ length: N }, () => ({
    // position in a squashed ball, its own little orbit and wiggle
    p: new THREE.Vector3(rng.range(-1, 1), rng.range(-1, 1) * 0.55, rng.range(-1, 1)).multiplyScalar(rng.range(0.3, 1)),
    ph: rng.range(0, 6.28), w: rng.range(0.7, 1.3), s: rng.range(0.8, 1.3),
  }));
  const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), P = new THREE.Vector3(), S = new THREE.Vector3(), D = new THREE.Vector3(), Z = new THREE.Vector3(0, 0, 1);
  return {
    update(st) {
      const sc = st.school;
      mesh.visible = !!sc;
      if (!sc) return;
      const t = onTwos(st.t);
      const c = sc.center, dir = D.fromArray(sc.dir).normalize(), size = sc.size ?? 18;
      for (let i = 0; i < N; i++) {
        const f = F[i];
        const a = t * f.w * 1.3 + f.ph;
        P.set(c[0] + f.p.x * size + Math.sin(a) * 2.2, c[1] + f.p.y * size + Math.sin(a * 1.7) * 0.8, c[2] + f.p.z * size + Math.cos(a) * 2.2);
        // swim along the shoal heading, a little off it as they weave
        const head = dir.clone().add(new THREE.Vector3(Math.cos(a) * 0.35, Math.cos(a * 1.7) * 0.15, -Math.sin(a) * 0.35)).normalize();
        Q.setFromUnitVectors(Z, head);
        S.setScalar(f.s * (sc.fish ?? 1.5));
        M.compose(P, Q, S);
        mesh.setMatrixAt(i, M);
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
