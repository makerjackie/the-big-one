import * as THREE from 'three';
import { G, COMMON, MRT_OUT } from './glsl.js';
import { Rng } from './util.js';

// The Lord of the Sea: an ancient, 220 m whale shark.
// Modelled once, straight, in REST SPACE and bent along a spine on the GPU (after LEVIATHAN's
// lev-spine/lev-body, MIT): x = right flank, y = dorsal, z = metres from the snout (0) to the
// tail (L); the caudal fin runs on past L. One sculpted loft carries the flat shovel head, the
// three ridges each side, gill slits, eye sockets and a lip line split so the jaw really opens;
// on top sit the mouth lining, eyeballs, barnacle crusts, remoras and the fins. The hide is
// painted in the fragment stage and lit in two hard tones through a bumped normal.

export const LORD_LEN = 220;
const L = LORD_LEN;
const NB = 48;                       // spine bones

const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
function curve(keys) {   // Hermite through [t, v]
  const n = keys.length;
  const m = keys.map((k, i) => { const a = keys[Math.max(0, i - 1)], b = keys[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / (b[0] - a[0] || 1); });
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 0; while (t > keys[i + 1][0]) i++;
    const h = keys[i + 1][0] - keys[i][0], u = (t - keys[i][0]) / h, u2 = u * u, u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * keys[i][1] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * keys[i + 1][1] + (u3 - u2) * h * m[i + 1];
  };
}

// ---- body plan, in fractions of L (t = 0 snout .. 1 tail stock)
const K = {
  rx: curve([[0, 0.058], [0.012, 0.066], [0.03, 0.078], [0.06, 0.086], [0.12, 0.092], [0.2, 0.095], [0.3, 0.093], [0.4, 0.085], [0.5, 0.071], [0.6, 0.054], [0.7, 0.037], [0.8, 0.025], [0.9, 0.019], [1, 0.016]]),
  yt: curve([[0, 0.012], [0.012, 0.016], [0.03, 0.03], [0.06, 0.044], [0.12, 0.06], [0.2, 0.073], [0.3, 0.081], [0.4, 0.08], [0.5, 0.07], [0.6, 0.056], [0.7, 0.04], [0.8, 0.029], [0.9, 0.023], [1, 0.019]]),
  yb: curve([[0, -0.014], [0.012, -0.017], [0.03, -0.026], [0.06, -0.039], [0.12, -0.056], [0.2, -0.068], [0.3, -0.071], [0.4, -0.067], [0.5, -0.058], [0.6, -0.045], [0.7, -0.032], [0.8, -0.024], [0.9, -0.019], [1, -0.015]]),
  yl: curve([[0, -0.003], [0.06, -0.005], [0.15, -0.004], [0.4, 0], [1, 0]]),
};
const ZC = 0.058 * L;                 // mouth corner
const HINGE = [K.yl(0.058) * L, ZC + 0.014 * L];
const EYE = { t: 0.074, phi: 0.36, R: 3.2 };
const GILL_T = [0.132, 0.144, 0.156, 0.168, 0.18];
const C0 = 0.022;                     // the snout rounds off over the first 2.2 %

export function section(z) {
  const t = Math.max(0, z / L);
  const cap = t < C0 ? Math.sqrt(Math.max(0, 1 - ((C0 - t) / C0) ** 2)) : 1;
  const cy = K.yl(t) * L, yt = K.yt(t) * L, yb = K.yb(t) * L;
  const e = 0.6 + 0.25 * ss(0.04, 0.3, t) + 0.05 * ss(0.6, 0.95, t);
  return { rx: K.rx(t) * L * cap, top: (yt - cy) * cap, bot: (cy - yb) * cap, cy, e, t };
}
const wrap = (a) => { a %= Math.PI * 2; return a < 0 ? a + Math.PI * 2 : a; };
const upOf = (phi) => Math.abs(wrap(phi) - Math.PI / 2);
const latOf = (phi) => { const p = wrap(phi); return Math.min(p, Math.abs(p - Math.PI), Math.PI * 2 - p); };

// sculpting on top of the sections: metres along the (cos, sin) direction
function sculpt(z, phi) {
  const t = z / L, p = wrap(phi), isUp = p <= Math.PI, up = upOf(p), lat = latOf(p);
  let d = 0;
  if (isUp) {
    // three ridges each side, running back from behind the head
    const env = ss(0.07, 0.17, t) * (1 - 0.35 * ss(0.75, 0.95, t));
    d += 1.6 * env * gauss(up - 0.45, 0.05) + 1.8 * env * gauss(up - 0.9, 0.055) + 1.3 * env * gauss(up - 1.3, 0.06);
    d += 1.2 * Math.exp(-up / 0.05) * ss(0.05, 0.16, t);                         // dorsal midline
    // brow over each eye; the socket sinks below it
    const de = (t - EYE.t) * L, dp = Math.min(Math.abs(p - EYE.phi), Math.abs(p - (Math.PI - EYE.phi))) * 16;
    d += 2.0 * gauss(de, 4.5) * gauss(dp - 3.4, 2.4);
    d -= 1.6 * gauss(Math.hypot(de, dp), 3.6);
    // a knobbly crown
    d += 0.9 * gauss(t - 0.035, 0.02) * gauss(up, 0.7) * (0.5 + 0.5 * Math.sin(z * 0.9 + p * 9));
  }
  // caudal keels on the tail stock
  d += 3.4 * ss(0.76, 0.95, t) * gauss(lat, 0.14);
  // lips: a thick rolled fold all round the mouth
  d += 1.1 * gauss(lat, 0.075) * ss(ZC + 0.01 * L, ZC - 0.004 * L, z);
  // gill slits: five grooves with a lip of skin behind each
  const span = ss(0.62, 0.45, lat);
  if (span > 0) for (const gt of GILL_T) {
    const gz = z - gt * L;
    d -= 0.9 * gauss(gz, 0.45) * span;
    d += 0.35 * gauss(gz - 0.9, 0.6) * span;
  }
  // pectoral shoulders swell out of the lower flanks
  if (!isUp) d += 2.6 * gauss(t - 0.215, 0.028) * (gauss(p - (Math.PI * 2 - 0.5), 0.3) + gauss(p - (Math.PI + 0.5), 0.3));
  return d;
}
const bellyOf = (phi) => { const p = wrap(phi); return p <= Math.PI ? Math.abs(p - Math.PI / 2) / Math.PI : 0.5 + (1 - Math.abs(p - 1.5 * Math.PI) / (Math.PI / 2)) * 0.5; };
function jawWeight(z, phi, lower) {
  if (!lower) return -(1 - ss(ZC - 0.006 * L, ZC + 0.016 * L, z));
  const a = 1 - Math.abs(wrap(phi) - 1.5 * Math.PI) / (Math.PI / 2);          // 1 under the chin
  const back = 0.026 * L * Math.pow(Math.max(0, a), 0.8);
  return 1 - ss(ZC - 0.004 * L + back * 0.3, ZC + 0.014 * L + back, z);
}
// a point on the sculpted hide (rest space)
function restPoint(z, phi) {
  const S = section(z), c = Math.cos(phi), s = Math.sin(phi);
  const x0 = S.rx * Math.sign(c) * Math.abs(c) ** S.e, y0 = (s >= 0 ? S.top : S.bot) * Math.sign(s) * Math.abs(s) ** S.e;
  const d = sculpt(z, phi);
  return new THREE.Vector3(x0 + c * d, y0 + s * d + S.cy, z);
}
function restNormal(z, phi) {
  const e = 0.004, ez = 0.25;
  const a = restPoint(z, phi + e).sub(restPoint(z, phi - e));
  const b = restPoint(z + ez, phi).sub(restPoint(z - ez, phi));
  return a.cross(b).normalize();
}

// ---------------------------------------------------------------- geometry accumulator
class Geo {
  constructor() { this.p = []; this.uv = []; this.info = []; this.idx = []; this.count = 0; }
  v(x, y, z, u, v2, jaw, part, around, belly) { this.p.push(x, y, z); this.uv.push(u, v2); this.info.push(jaw, part, around, belly); return this.count++; }
  tri(a, b, c) { this.idx.push(a, b, c); }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 4));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }
}

// closed tube along a rest-space polyline
function addTube(g, pts, radii, o = {}) {
  const seg = o.seg ?? 8, n = pts.length, first = g.count, fl = o.flat ?? 1;
  const T = new THREE.Vector3(), Up = o.up ?? new THREE.Vector3(0, 1, 0), S = new THREE.Vector3(), U = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize();
    S.crossVectors(Up, T).normalize(); U.crossVectors(T, S).normalize();
    for (let j = 0; j < seg; j++) {
      const th = (j / seg) * Math.PI * 2, c = Math.cos(th), s = Math.sin(th), r = radii[i];
      g.v(pts[i][0] + (S.x * c + U.x * s * fl) * r, pts[i][1] + (S.y * c + U.y * s * fl) * r, pts[i][2] + (S.z * c + U.z * s * fl) * r,
        i / (n - 1), j / seg, o.jaw ?? 0, o.part ?? 0, o.around ?? 0, o.belly ?? (0.5 - 0.5 * s));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = first + i * seg + j, b = first + i * seg + (j + 1) % seg;
    g.quad(a, b, b + seg, a + seg);
  }
  const last = first + (n - 1) * seg;
  for (let j = 1; j < seg - 1; j++) { g.tri(first, first + j + 1, first + j); g.tri(last, last + j, last + j + 1); }
}

// a fin blade grown from a root: base (rest point), dir (the span), back (the chord), side (thickness)
function addFin(g, o) {
  const R = o.rings ?? 18, Cn = o.chordN ?? 12, first = g.count;
  const { base, dir, back, side } = o;
  // wind so the +side surface faces +side
  const cx = dir[1] * back[2] - dir[2] * back[1], cy = dir[2] * back[0] - dir[0] * back[2], cz = dir[0] * back[1] - dir[1] * back[0];
  const flip = cx * side[0] + cy * side[1] + cz * side[2] < 0;
  for (let i = 0; i <= R; i++) {
    const f = i / R;
    const ch = o.chord(f), le = o.lean(f), th = o.thick * Math.pow(1 - f, 0.8) + 0.08;
    for (let k = 0; k < Cn * 2; k++) {
      const top = k < Cn, u = top ? k / (Cn - 1) : 1 - (k - Cn) / (Cn - 1);
      const uu = 0.5 - 0.5 * Math.cos(Math.PI * u);
      const w = th * Math.pow(Math.sin(Math.PI * Math.min(0.999, Math.max(0.001, uu * 0.96 + 0.02))), 0.65) * (top ? 1 : -1);
      const along = le + ch * uu - (o.notch ? o.notch(f, uu) : 0);
      const x = base[0] + dir[0] * o.span * f + back[0] * along + side[0] * w;
      const y = base[1] + dir[1] * o.span * f + back[1] * along + side[1] * w;
      const z = base[2] + dir[2] * o.span * f + back[2] * along + side[2] * w;
      g.v(x, y, z, f, uu, o.jaw ?? 0, 6, (o.around ?? 0) + along, top ? (o.topBelly ?? 0.2) : (o.botBelly ?? 0.8));
    }
  }
  const ring = Cn * 2;
  for (let i = 0; i < R; i++) for (let k = 0; k < ring; k++) {
    const a = first + i * ring + k, b = first + i * ring + (k + 1) % ring;
    if (flip) g.quad(a, b, b + ring, a + ring); else g.quad(a, a + ring, b + ring, b);
  }
  const last = first + R * ring;
  for (let k = 1; k < ring - 1; k++) { if (flip) g.tri(last, last + k + 1, last + k); else g.tri(last, last + k, last + k + 1); }
}

function buildBody() {
  const g = new Geo();
  // ---- rings: tight at the snout and around the head, looser down the body
  const zs = [];
  let z = 0.0006 * L;
  while (z < L) { zs.push(z); const t = z / L; z += L * (t < 0.03 ? 0.0011 : t < 0.2 ? 0.0024 : 0.0045); }
  zs.push(L);
  const Nu = 120, Nl = 90, NA = 240;
  const rows = [];
  for (let i = 0; i < zs.length; i++) {
    const zz = zs[i], slit = zz < ZC;
    const col = new Array(Nu + Nl + 2);
    // arc length from the dorsal line: the "around" coordinate in metres
    const pts = [];
    for (let k = 0; k <= NA; k++) pts.push(restPoint(zz, Math.PI / 2 + (k / NA) * Math.PI * 2));
    const arc = [0]; for (let k = 1; k <= NA; k++) arc.push(arc[k - 1] + pts[k].distanceTo(pts[k - 1]));
    const tot = arc[NA];
    const around = (phi) => { const u = wrap(phi - Math.PI / 2) / (Math.PI * 2) * NA; const k = Math.min(NA - 1, Math.floor(u)); const a = arc[k] + (arc[k + 1] - arc[k]) * (u - k); return a > tot / 2 ? a - tot : a; };
    const addV = (phi, lower) => {
      const P = restPoint(zz, phi);
      return g.v(P.x, P.y, P.z, zz / L, phi, jawWeight(zz, phi, lower), 0, -around(phi), bellyOf(phi));
    };
    for (let j = 0; j <= Nu; j++) col[j] = addV(Math.PI * j / Nu, false);
    for (let j = 0; j <= Nl; j++) {
      if (!slit && (j === 0 || j === Nl)) continue;
      col[Nu + 1 + j] = addV(Math.PI + Math.PI * j / Nl, true);
    }
    if (!slit) { col[Nu + 1] = col[Nu]; col[Nu + 1 + Nl] = col[0]; }
    rows.push(col);
  }
  for (let i = 0; i < rows.length - 1; i++) {
    const A = rows[i], B = rows[i + 1];
    for (let j = 0; j < Nu; j++) g.quad(A[j], A[j + 1], B[j + 1], B[j]);
    for (let j = 0; j < Nl; j++) g.quad(A[Nu + 1 + j], A[Nu + 2 + j], B[Nu + 2 + j], B[Nu + 1 + j]);
  }
  { // snout caps: upper and lower halves to their own centres so the jaw splits
    const A = rows[0], S = section(zs[0]);
    const cu = g.v(0, S.cy + S.top * 0.3, zs[0] - 0.05, 0, 0, -1, 0, 0, 0.0);
    const cl = g.v(0, S.cy - S.bot * 0.3, zs[0] - 0.05, 0, 0, 1, 0, 0, 1.0);
    for (let j = 0; j < Nu; j++) g.tri(cu, A[j + 1], A[j]);
    for (let j = 0; j < Nl; j++) g.tri(cl, A[Nu + 2 + j], A[Nu + 1 + j]);
  }
  { // tail end cap (inside the caudal fin root)
    const A = rows[rows.length - 1], c = g.v(0, 0, L + 0.3, 1, 0, 0, 0, 0, 0.5);
    for (let j = 0; j < Nu; j++) g.tri(c, A[j], A[j + 1]);
    for (let j = 0; j < Nl; j++) g.tri(c, A[Nu + 1 + j], A[Nu + 2 + j]);
  }

  // ---- mouth lining: palate above, floor below, closing into the throat
  const ZB = ZC + 0.032 * L, ZT = 0.003 * L, ring = 70, across = 26;
  for (const lower of [false, true]) {
    const start = g.count;
    for (let i = 0; i <= ring; i++) {
      const u = i / ring, zz = ZT + (ZB - ZT) * u, S = section(zz);
      const front = ss(ZC + 0.024 * L, ZC - 0.004 * L, zz);
      const throat = 0.022 * L;
      const hw = throat + (S.rx * 0.95 - throat) * front;
      const hmax = (lower ? S.bot : S.top) * 0.78;
      const h = 0.012 * L + (hmax - 0.012 * L) * front;
      for (let j = 0; j <= across; j++) {
        const k = -1 + 2 * j / across, arch = Math.pow(Math.max(0, 1 - k * k), 0.55);
        const jw = lower ? jawWeight(zz, Math.PI * 1.5 - k * 1.2, true) : jawWeight(zz, Math.PI / 2, false);
        g.v(k * hw, S.cy + (lower ? -1 : 1) * h * arch, zz, u, j / across, jw, 2, 0, 0.5);
      }
    }
    const W = across + 1;
    for (let i = 0; i < ring; i++) for (let j = 0; j < across; j++) {
      const a = start + i * W + j, b = a + 1, c = a + W, d = c + 1;
      if (lower) g.quad(a, c, d, b); else g.quad(a, b, d, c);
    }
  }
  { // throat wall
    const S = section(ZB), c = g.v(0, S.cy, ZB + 0.5, 1, 0.5, 0, 2, 0, 0.5), first = g.count, n = 20, r = 0.022 * L;
    for (let j = 0; j < n; j++) { const a = (j / n) * Math.PI * 2; g.v(Math.cos(a) * r, S.cy + Math.sin(a) * r * 0.7, ZB, 1, 0.5, 0, 2, 0, 0.5); }
    for (let j = 0; j < n; j++) g.tri(c, first + (j + 1) % n, first + j);
  }

  // ---- eyeballs, set into the sockets under the brow. uv = (toward snout, up) on the ball
  for (const sd of [1, -1]) {
    const phi = sd > 0 ? EYE.phi : Math.PI - EYE.phi, ze = EYE.t * L;
    const P = restPoint(ze, phi), o = restNormal(ze, phi);
    const c = P.clone().addScaledVector(o, -EYE.R * 0.45);
    const fwd = new THREE.Vector3(0, 0, -1).addScaledVector(o, o.z).normalize();
    const upE = new THREE.Vector3(0, 1, 0).addScaledVector(o, -o.y).normalize();
    const N = 18, M = 26, first = g.count;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI;
      for (let j = 0; j < M; j++) {
        const b = (j / M) * Math.PI * 2;
        const d = o.clone().multiplyScalar(Math.cos(a)).addScaledVector(fwd, Math.sin(a) * Math.cos(b)).addScaledVector(upE, Math.sin(a) * Math.sin(b));
        g.v(c.x + d.x * EYE.R, c.y + d.y * EYE.R, c.z + d.z * EYE.R, d.dot(fwd), d.dot(upE), 0, 5, d.dot(o), 0);
      }
    }
    for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
      const a = first + i * M + j, b = first + i * M + (j + 1) % M;
      if (sd > 0) g.quad(a, a + M, b + M, b); else g.quad(a, b, b + M, a + M);
    }
  }

  // ---- fins that bend with the body: two dorsals, pelvics, anal and the great caudal fin
  const top = (zz) => { const S = section(zz); return S.cy + S.top; };
  const bot = (zz) => { const S = section(zz); return S.cy - S.bot; };
  const X = [1, 0, 0], Z = [0, 0, 1];
  const nrm = (v) => { const l = Math.hypot(...v); return v.map((c) => c / l); };
  addFin(g, {   // first dorsal: tall, swept, falcate
    base: [0, top(0.43 * L) - 2.5, 0.405 * L], dir: nrm([0, 1, 0.42]), back: Z, side: X, span: 0.135 * L, thick: 1.9,
    chord: (f) => 0.125 * L * Math.pow(1 - f, 0.85) + 1.2, lean: (f) => 0.01 * L * f * f,
    notch: (f, u) => 0.035 * L * u * u * Math.sin(Math.PI * Math.min(1, f * 1.1)) ** 1.2,
  });
  addFin(g, {   // second dorsal
    base: [0, top(0.71 * L) - 1, 0.69 * L], dir: nrm([0, 1, 0.5]), back: Z, side: X, span: 0.045 * L, thick: 0.9,
    chord: (f) => 0.05 * L * Math.pow(1 - f, 0.8) + 0.6, lean: () => 0, notch: (f, u) => 0.012 * L * u * u * Math.sin(Math.PI * f),
  });
  for (const sd of [1, -1]) addFin(g, {   // pelvics
    base: [sd * 0.025 * L, bot(0.56 * L) + 1.5, 0.545 * L], dir: nrm([sd * 0.55, -0.75, 0.4]), back: Z, side: nrm([0.8, 0.55 * sd, 0]), span: 0.055 * L, thick: 1.0,
    chord: (f) => 0.05 * L * Math.pow(1 - f, 0.8) + 0.6, lean: () => 0, notch: (f, u) => 0.01 * L * u * u * Math.sin(Math.PI * f), flip: sd < 0, topBelly: 0.85, botBelly: 0.85,
  });
  addFin(g, {   // anal
    base: [0, bot(0.725 * L) + 1, 0.71 * L], dir: nrm([0, -1, 0.5]), back: Z, side: X, span: 0.04 * L, thick: 0.8,
    chord: (f) => 0.045 * L * Math.pow(1 - f, 0.8) + 0.5, lean: () => 0, flip: true, topBelly: 0.85, botBelly: 0.85,
  });
  // caudal: a heterocercal crescent, upper lobe long and swept, lower lobe shorter
  addFin(g, {
    base: [0, 1.0, 0.955 * L], dir: nrm([0, 0.72, 0.69]), back: Z, side: X, span: 0.27 * L, thick: 2.6,
    chord: (f) => 0.07 * L * Math.pow(1 - f, 0.9) + 0.8, lean: (f) => 0.018 * L * f, rings: 26,
    notch: (f, u) => 0.02 * L * u * u * Math.sin(Math.PI * Math.min(1, f * 1.2)),
  });
  addFin(g, {
    base: [0, -1.0, 0.96 * L], dir: nrm([0, -0.66, 0.75]), back: Z, side: X, span: 0.17 * L, thick: 2.2,
    chord: (f) => 0.06 * L * Math.pow(1 - f, 0.85) + 0.7, lean: (f) => 0.012 * L * f, rings: 20, flip: true,
    notch: (f, u) => 0.016 * L * u * u * Math.sin(Math.PI * f), topBelly: 0.5, botBelly: 0.5,
  });

  // ---- barnacle crusts: clumps on the crown, the brow, the snout and at the dorsal's root
  const rng = new Rng(4127);
  const clumps = [[0.03, 1.57, 1.0, 26], [0.05, 1.0, 0.8, 18], [0.05, 2.14, 0.8, 18], [0.012, 1.3, 0.7, 14], [0.012, 1.85, 0.7, 14], [0.1, 1.57, 0.6, 14],
    [0.085, 0.75, 0.5, 10], [0.085, 2.4, 0.5, 10], [0.4, 1.57, 0.4, 16], [0.25, 0.95, 0.6, 12], [0.3, 2.3, 0.6, 10], [0.012, 4.2, 0.6, 10], [0.012, 5.2, 0.6, 10]];
  for (const [ct, cp, spread, n] of clumps) {
    for (let i = 0; i < n; i++) {
      const tt = ct + rng.range(-1, 1) * 0.012 * spread, ph = cp + rng.range(-1, 1) * 0.28 * spread;
      const zz = tt * L;
      if (Math.abs(tt - EYE.t) < 0.02 && Math.min(Math.abs(ph - EYE.phi), Math.abs(ph - Math.PI + EYE.phi)) < 0.4) continue;
      const P = restPoint(zz, ph), nn = restNormal(zz, ph);
      const r = rng.range(0.22, 0.65) * (rng.next() < 0.15 ? 1.6 : 1), hgt = r * rng.range(0.7, 1.1);
      const at = (k) => [P.x + nn.x * hgt * k, P.y + nn.y * hgt * k, P.z + nn.z * hgt * k];
      const pts = [at(-0.25), at(0.3), at(0.75), at(1.0)];
      const lower = wrap(ph) > Math.PI;
      addTube(g, pts, [r * 1.15, r * 0.95, r * 0.62, r * 0.48], { seg: 11, part: 3, up: Math.abs(nn.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0), jaw: zz < ZC + 4 ? jawWeight(zz, ph, lower) : 0, belly: i % 2 });
    }
  }
  // ---- remoras hitching a ride under the flanks
  for (const [rt, rp, len] of [[0.235, Math.PI * 2 - 0.85, 5.5], [0.3, Math.PI + 0.95, 4.8], [0.34, Math.PI * 1.5 + 0.25, 5.0], [0.27, Math.PI * 2 - 1.15, 4.2]]) {
    const zz = rt * L, P = restPoint(zz, rp), nn = restNormal(zz, rp);
    const pts = [], rr = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10, off = 0.55 + 0.25 * Math.sin(Math.PI * u);
      pts.push([P.x + nn.x * off, P.y + nn.y * off, P.z - len * 0.5 + len * u]);
      rr.push(len * 0.11 * Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.05 + 0.03)), 0.6) + 0.05);
    }
    addTube(g, pts, rr, { seg: 10, part: 4, flat: 0.75, up: nn });
  }
  return g.build();
}

// pectoral fin (rigid mesh): root at the origin, span along +x, chord along +z, thickness y
function buildPectoral() {
  const g = new Geo();
  const span = 0.2 * L, c0 = 0.075 * L;
  addFin(g, {
    base: [0, 0, -c0 * 0.15], dir: [1, 0, 0], back: [0, 0, 1], side: [0, 1, 0], span, thick: 2.2, rings: 22, chordN: 12,
    chord: (f) => c0 * Math.pow(1 - f, 0.75) * (1 + 0.15 * Math.sin(Math.PI * f)) + 1.0,
    lean: (f) => 0.07 * L * f * f, notch: (f, u) => 0.02 * L * u * u * Math.sin(Math.PI * f), topBelly: 0.2, botBelly: 0.9,
  });
  return g.build();
}

// ---------------------------------------------------------------- material
const VS = /* glsl */ `
attribute vec4 aInfo;
uniform vec3 uSP[${NB}], uSB[${NB}], uSN[${NB}];
uniform float uLen, uRigid, uWag, uWagZ;
uniform vec2 uJaw, uHinge;
varying vec3 vWorld, vNormalW, vNormalV, vRest;
varying vec4 vInfo;
varying float vDepth;
varying vec2 vUv;
void spineAt(float s, out vec3 p, out vec3 b, out vec3 n){
  float last = ${NB - 1}.0;
  float f = clamp(s, 0.0, 1.0) * last;
  int i = int(min(floor(f), last - 1.0));
  float t = f - float(i);
  vec3 p0 = uSP[max(i - 1, 0)], p1 = uSP[i], p2 = uSP[i + 1], p3 = uSP[min(i + 2, ${NB - 1})];
  p = 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t);
  b = normalize(mix(uSB[i], uSB[i + 1], t));
  n = normalize(mix(uSN[i], uSN[i + 1], t));
  n = normalize(n - b * dot(b, n));
}
void main(){
  vec3 p = position, nr = normal;
  float jw = aInfo.x;
  if(abs(jw) > 1e-4){
    float ang = jw > 0.0 ? -uJaw.x * jw : -uJaw.y * jw;
    float c = cos(ang), s = sin(ang);
    vec2 r = p.yz - uHinge;
    p.yz = uHinge + vec2(c * r.x - s * r.y, s * r.x + c * r.y);
    nr.yz = vec2(c * nr.y - s * nr.z, s * nr.y + c * nr.z);
  }
  vec3 wp, wn;
  if(uRigid > 0.5){
    wp = (modelMatrix * vec4(p, 1.0)).xyz;
    wn = normalize(mat3(modelMatrix) * nr);
  } else {
    // the tail sweeps from side to side in rest space before the spine bends it
    if(p.z > uWagZ){
      float k = (p.z - uWagZ) / (uLen * 1.25 - uWagZ);
      float a = uWag * k * (1.4 - 0.4 * k);
      float c = cos(a), s = sin(a);
      vec2 r = vec2(p.x, p.z - uWagZ);
      p.x = c * r.x - s * r.y; p.z = uWagZ + s * r.x + c * r.y;
      nr.xz = vec2(c * nr.x - s * nr.z, s * nr.x + c * nr.z);
    }
    float zc = clamp(p.z, 0.0, uLen);
    vec3 b, n, sp;
    spineAt(zc / uLen, sp, b, n);
    vec3 T = cross(n, b);
    wp = sp + b * p.x + n * p.y + T * (p.z - zc);
    wn = normalize(b * nr.x + n * nr.y + T * nr.z);
  }
  vWorld = wp; vNormalW = wn;
  vNormalV = normalize(mat3(viewMatrix) * wn);
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vDepth = -mv.z;
  vUv = uv; vRest = position; vInfo = aInfo;
  gl_Position = projectionMatrix * mv;
}
`;

const FS = /* glsl */ `
${COMMON}
${MRT_OUT}
uniform float uLen, uEyeOpen, uEyePupil, uWet, uRun, uFoamLine;
uniform vec2 uEyeLook;
varying vec3 vWorld, vNormalW, vNormalV, vRest;
varying vec4 vInfo;
varying float vDepth;
varying vec2 vUv;
vec3 voro(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0, id = 0.0;
  for(int y = -1; y <= 1; y++) for(int x = -1; x <= 1; x++){
    vec2 gg = vec2(float(x), float(y));
    vec2 o = hash22(i + gg);
    vec2 r = gg + o - f;
    float d = dot(r, r);
    if(d < d1){ d2 = d1; d1 = d; id = hash12(i + gg + 3.7); } else if(d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2), id);
}
vec3 bump(vec3 N, float h, float k){
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  float hx = dFdx(h) * k, hy = dFdy(h) * k;
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (hx * r1 + hy * r2);
  return normalize(abs(det) * N - g);
}
const float ZC = ${ZC.toFixed(3)};
void main(){
  vec3 N = normalize(vNormalW), NV = normalize(vNormalV);
  vec3 V = normalize(cameraPosition - vWorld);
  float part = floor(vInfo.y + 0.5);
  if(part > 5.5 && part < 6.5 && dot(N, V) < 0.0){ N = -N; NV = -NV; }   // thin fins seen from behind
  vec2 m = vec2(vRest.z, vInfo.z);                 // metres along, metres around (signed from the back)
  float t = vRest.z / uLen;
  float mpp = max(length(dFdx(m)), length(dFdy(m)));
  float lod1 = smoothstep(0.6, 0.2, mpp), lod2 = smoothstep(0.1, 0.04, mpp);
  float id = 40.0, h = 0.0, gloss = 0.9, occ = 1.0;
  vec3 col = vec3(1.0), shade = vec3(-1.0), emis = vec3(0.0);
  vec3 backC = vec3(0.15, 0.27, 0.48), flankC = vec3(0.24, 0.42, 0.66), bellyC = vec3(0.92, 0.91, 0.86), pale = vec3(0.87, 0.93, 0.97);

  if(part < 0.5 || (part > 5.5 && part < 6.5)){
    // ------------------------------------------------ hide
    bool fin = part > 5.5;
    float wob = fbm2(m * 0.03 + 3.1) - 0.5;
    float belly = vInfo.w + wob * 0.12;
    float bl = fin ? step(0.5, vInfo.w) : smoothstep(0.6, 0.64, belly);
    vec3 base = mix(backC, flankC, smoothstep(0.18, 0.5, belly + 0.15 * wob));
    base = mix(base, base * vec3(0.8, 0.84, 0.95), step(0.55, fbm2(m * 0.025 + 11.0)) * 0.8);
    col = base;
    if(fin){
      vec3 v = voro(vec2(vRest.x + vRest.z, vRest.y + vRest.z * 0.5) / 2.2);
      col = mix(col, pale, step(v.x, 0.22) * step(0.35, v.z) * lod1);
      col = mix(col, mix(col, pale, 0.6), smoothstep(0.88, 0.97, vUv.y));
      col = mix(col, bellyC * 0.95, bl * 0.85);
      h = fbm2(vRest.yz * 0.3) * 0.8;
    } else {
      // whale-shark checkerboard on the flank: pale stripes across and along, a spot in each cell
      float body = smoothstep(0.13, 0.19, t) * (1.0 - smoothstep(0.82, 0.92, t));
      vec2 gc = vec2(m.x / 5.6 + 0.12 * sin(m.y * 0.11), m.y / 5.0 + 0.1 * sin(m.x * 0.07));
      vec2 gi = floor(gc), gf = fract(gc) - 0.5;
      vec2 fwg = fwidth(gc) * 1.2;
      float lineA = 1.0 - smoothstep(0.022, 0.022 + fwg.x, 0.5 - abs(gf.x));
      float lineB = 1.0 - smoothstep(0.022, 0.022 + fwg.y, 0.5 - abs(gf.y));
      float flank = smoothstep(0.1, 0.2, belly) * (1.0 - smoothstep(0.52, 0.6, belly));
      col = mix(col, mix(col, pale, 0.38), max(lineA, lineB * 0.8) * body * flank * smoothstep(0.1, 0.045, mpp));
      vec2 jit = hash22(gi) - 0.5;
      float spot = (length(gf - jit * 0.18) - (0.17 + 0.06 * hash12(gi + 5.0))) * 5.3;
      // random spots on the head and the high back: two fixed layers, fine on the head, coarse behind
      vec3 vrA = voro(m / 1.15 + 17.0), vrB = voro(m / 3.0 + 29.0);
      float rA = (vrA.x - (0.2 + 0.1 * vrA.z) * smoothstep(0.14, 0.09, t) * smoothstep(0.14, 0.06, mpp)) * 1.15;
      float rB = (vrB.x - (0.24 + 0.1 * vrB.z) * smoothstep(0.09, 0.15, t) * smoothstep(0.45, 0.2, mpp)) * 3.0;
      float sp = mix(min(rA, rB), spot, step(0.5, body * flank));
      col = mix(col, pale, step(sp, 0.0) * (1.0 - bl) * step(0.004, t) * lod1);
      // pale belly with faint mottling
      vec3 bc = mix(bellyC, bellyC * vec3(0.88, 0.9, 0.96), step(0.6, fbm2(m * vec2(0.03, 0.05) + 31.0)) * 0.7);
      col = mix(col, bc, bl);
      // skin relief: lumps and long wrinkles break the terminator
      float lump = fbm2(m * 0.05 + 2.0), lump2 = fbm2(m * vec2(0.18, 0.26) + 7.0);
      h = lump * 2.6 + lump2 * 1.0 * lod2;
      float rid = 1.0 - abs(2.0 * fbm2(m * vec2(0.025, 0.07) + 50.0) - 1.0);
      float fold = step(0.95, rid) * (1.0 - bl) * lod2;
      col = mix(col, col * vec3(0.66, 0.7, 0.84), fold * lod1);
      h -= fold * 1.2 * lod1;
      // gill slits: dark grooves with a pale lip behind
      float ph = vUv.y;
      float lat = min(min(ph, abs(ph - 3.14159265)), 6.2831853 - ph);
      for(int i = 0; i < 5; i++){
        float gl = 0.52 - float(i) * 0.04;
        float dz = vRest.z - (0.132 + float(i) * 0.012) * uLen + 1.4 * lat * lat;
        float w = 0.24 * (1.0 - smoothstep(gl * 0.55, gl, lat));
        if(abs(dz) < w && t < 0.19){ col = mix(col, vec3(0.08, 0.1, 0.24), 0.7); if(abs(dz) < w * 0.45) id = 45.0; }
        else if(dz > w && dz < w + 0.7 && lat < gl && t < 0.19) col = mix(col, pale, 0.2);
      }
      // the lips: a pale rolled rim round the mouth
      if(vRest.z < ZC + 0.3 && lat < 0.2 && abs(vRest.y + 0.0045 * uLen) < 0.18){ col = vec3(0.1, 0.07, 0.16); id = 44.0; }
      // old scratches
      float sc1 = abs(fract((m.x * 0.62 + m.y * 0.8) / 70.0 + 0.4 * wob) - 0.5);
      float scm = step(0.6, fbm2(m * 0.02 + 80.0)) * (1.0 - bl);
      float sw = 0.006 + 0.004 * sin(m.x * 0.2);
      scm *= smoothstep(0.1, 0.05, mpp);
      float scar = step(sc1, sw) * scm;
      col = mix(col, vec3(0.78, 0.82, 0.9), scar);
      col = mix(col, col * 0.62, step(sc1, sw + 0.006) * (1.0 - scar) * scm);
      if(scar > 0.5) id = 48.0;
      // ring scars where barnacles used to be
      float patchB = smoothstep(0.62, 0.68, fbm2(m * 0.03 + 40.0)) * (1.0 - bl);
      if(patchB > 0.01){
        vec3 b = voro(m / 1.4 + 9.0);
        float ringB = step(abs(b.x - 0.3), 0.07) * patchB * step(0.45, b.z);
        col = mix(col, pale * 0.9, ringB * lod2);
        h += ringB * 0.6;
      }
    }
  } else if(part < 2.5){
    // ------------------------------------------------ mouth lining: dark wine, filter pads deep in the throat
    float k = vUv.x;
    float rib = abs(fract(vRest.x * 0.55 + 0.3 * sin(vRest.z * 0.4)) - 0.5) * 2.0;
    vec3 flesh = mix(vec3(0.42, 0.16, 0.24), vec3(0.16, 0.05, 0.14), smoothstep(0.1, 0.7, k));
    col = flesh;
    float pads = smoothstep(0.45, 0.6, k);
    col = mix(col, mix(vec3(0.22, 0.12, 0.2), vec3(0.42, 0.3, 0.36), step(0.5, rib)), pads);
    h = pads * (1.0 - rib) * 0.6;
    col = mix(vec3(0.03, 0.015, 0.05), col, smoothstep(1.0, 0.75, k));
    gloss = 0.7; id = 41.0;
    shade = col * vec3(0.45, 0.36, 0.62);
    occ = step(k, 0.12);
  } else if(part < 3.5){
    // ------------------------------------------------ barnacle: pale ridged cone, dark crater
    float k = vUv.x;
    col = mix(vec3(0.84, 0.83, 0.78), vec3(0.95, 0.94, 0.89), step(0.5, fract(vUv.y * 6.0 + 0.3 * vInfo.w)));
    col = mix(col, col * 0.8, smoothstep(0.35, 0.0, k));
    if(k > 0.97) col = vec3(0.12, 0.13, 0.22);
    h = step(0.5, fract(vUv.y * 6.0)) * 0.3;
    id = 46.0 + vInfo.w;
    gloss = 0.3;
  } else if(part < 4.5){
    // ------------------------------------------------ remora: grey, a dark stripe down the side
    float s = vUv.y;
    col = mix(vec3(0.52, 0.55, 0.62), vec3(0.86, 0.87, 0.9), step(0.5, abs(s - 0.5) * 2.0));
    if(abs(fract(s + 0.25) - 0.5) < 0.08) col = vec3(0.16, 0.17, 0.24);
    if(vUv.x < 0.12) col *= 0.8;
    id = 49.0; gloss = 0.8;
  } else {
    // ------------------------------------------------ eye: uv = (toward snout, up) on the eyeball
    vec2 q = vUv;
    float front = vInfo.z;
    col = vec3(0.05, 0.04, 0.09);
    vec2 ip = q - uEyeLook * 0.22;
    float ir = length(ip);
    float IR = 0.6;
    if(ir < IR){
      float a = atan(ip.y, ip.x);
      col = mix(vec3(1.0, 0.56, 0.1), vec3(1.0, 0.88, 0.36), smoothstep(IR, 0.1, ir));
      col *= 0.86 + 0.14 * step(0.5, fract(a * 4.0 + ir * 3.0));
      col = mix(col, vec3(0.6, 0.24, 0.06), smoothstep(IR - 0.09, IR - 0.02, ir));
      float pr = length(ip / vec2(0.82, 1.0)) / (0.27 * uEyePupil);
      if(pr < 1.0) col = vec3(0.02, 0.015, 0.05);
      emis = col * 0.22;
    }
    vec2 h1 = q - vec2(0.24, 0.34);
    if(abs(h1.x + h1.y * 0.25) < 0.13 && abs(h1.y) < 0.09){ col = vec3(1.0); emis = vec3(0.5); }
    if(length(q - vec2(-0.2, -0.26)) < 0.06){ col = vec3(1.0); emis = vec3(0.4); }
    float lidY = mix(-0.32, 1.05, uEyeOpen) - 0.18 * q.x * q.x;
    float lowY = mix(-0.36, -0.86, min(1.0, uEyeOpen * 1.4)) + 0.12 * q.x * q.x;
    id = 42.0; gloss = 1.4;
    shade = col * 0.78;
    if(q.y > lidY || q.y < lowY){ col = mix(backC, flankC, 0.6); emis = vec3(0.0); id = 43.0; gloss = 0.0; shade = vec3(-1.0);
      vec3 lv = voro(q * 4.0 + 7.0); col = mix(col, pale, step(lv.x, 0.2) * step(0.4, lv.z)); }
    else if(q.y > lidY - 0.07 || q.y < lowY + 0.05){ col = vec3(0.06, 0.05, 0.12); emis = vec3(0.0); }
    if(front < 0.15) col = vec3(0.05, 0.04, 0.09);
  }

  // ---- lighting: two hard tones through the bumped normal
  vec3 Nb = (h != 0.0) ? bump(N, h, 1.5 * smoothstep(0.25, 0.06, mpp)) : N;
  float ndl = dot(Nb, uKeyDir);
  float lit = smoothstep(-0.02, 0.04, ndl) * occ;
  vec3 litCol = col * mix(uSkyTint, uSunColor, 0.75) * 1.05;
  float upk = smoothstep(-0.7, 0.6, N.y);
  vec3 shadeCol = shade.x >= 0.0 ? shade : col * mix(uShadeTint, uShadeTint * 0.75 + uBounce * 0.4, 1.0 - upk);
  vec3 outc = mix(shadeCol, litCol, lit);
  float deep = step(ndl, -0.55) * step(N.y, -0.35) * step(shade.x, -0.5);
  outc = mix(outc, col * uDeepTint, deep * 0.6);
  vec3 H = normalize(uKeyDir + V);
  float spd = dot(Nb, H);
  float wetn = step(0.45, fbm2(vWorld.xy * 0.06 + vWorld.z * 0.03));
  spd = dot(normalize(mix(N, Nb, 0.35)), H);
  float spec = step(0.975, spd) * lit * step(0.5, gloss * (0.5 + 0.5 * uWet) * (0.5 + 0.5 * wetn)) * mix(0.0, 1.0, smoothstep(0.6, 0.25, mpp));
  outc = mix(outc, vec3(1.0, 0.99, 0.95), spec * 0.85);
  // a cool sky rim on the shadow side keeps the mass readable; warm back light
  float fres = 1.0 - max(dot(N, V), 0.0);
  float rimS = smoothstep(0.6, 0.7, fres) * (1.0 - lit) * step(N.y, 0.6) * (part > 1.5 && part < 2.5 ? 0.0 : 1.0);
  outc = mix(outc, mix(outc, vec3(0.62, 0.86, 0.98), 0.7), rimS);
  float backL = smoothstep(0.1, 0.5, dot(-V, uKeyDir));
  float rimL = smoothstep(0.66, 0.72, fres) * smoothstep(-0.1, 0.1, dot(N, uKeyDir)) * backL;
  outc = mix(outc, uSunColor * 1.2, rimL * 0.8);
  // water sheeting off the body as it rises: hard white streaks running down in world space
  if(uRun > 0.002 && (part < 0.5 || (part > 5.5 && part < 6.5))){
    float dn = vWorld.y + uFxTime * 38.0;
    float ra = vInfo.z * 1.2 + vRest.x * 0.8;
    float wig = 4.0 * sin(dn * 0.03 + ra * 0.05);
    float st = fbm2(vec2((ra + wig) * 0.22, dn * 0.004 + vRest.z * 0.002));
    float st2 = vnoise(vec2((ra + wig) * 0.3, dn * 0.02));
    float downF = (smoothstep(0.85, -0.1, abs(N.y)) * 0.6 + 0.4) * smoothstep(0.45, 0.18, mpp);
    float th = mix(0.95, 0.68, uRun);
    float sheet = step(th, st + 0.14 * st2) * downF;
    float core = step(th + 0.07, st + 0.14 * st2) * downF;
    outc = mix(outc, mix(outc, vec3(0.8, 0.92, 1.0), 0.6), sheet * 0.6);
    outc = mix(outc, vec3(1.0), core * (0.35 + 0.55 * lit));
  }
  // foam collar where the hide meets the sea
  if(uFoamLine > 0.0 && uUnder < 0.5){
    float n0 = vnoise(vWorld.xz * 0.08 + uFxTime * 0.6);
    float collar = step(vWorld.y, uFoamLine * (0.4 + 0.9 * n0)) * step(-uFoamLine * 3.0, vWorld.y);
    outc = mix(outc, mix(vec3(0.74, 0.88, 0.98), vec3(1.0), lit), collar);
  }
  // underwater: caustic net, cooler tone
  if(uUnder > 0.5){
    vec2 cq = vWorld.xz * 0.12 + vec2(uFxTime * 0.3, uFxTime * 0.2);
    float cn = vnoise(cq * 3.0) * vnoise(cq * 3.7 + 4.0);
    outc *= vec3(0.62, 0.86, 0.98);
    outc += vec3(0.5, 0.9, 1.0) * smoothstep(0.32, 0.38, cn) * 0.35 * smoothstep(-0.2, 0.6, N.y);
  }
  outc += emis;
  writeOut(outc, NV, vDepth, id);
}
`;

function lordMaterial(u, rigid) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { ...G, ...u, uRigid: { value: rigid ? 1 : 0 } },
    vertexShader: VS, fragmentShader: FS, side: THREE.DoubleSide,
  });
}

export function makeLord(ctx) {
  const root = new THREE.Group();
  const SP = new Float32Array(NB * 3), SB = new Float32Array(NB * 3), SN = new Float32Array(NB * 3);
  const U = {
    uSP: { value: SP }, uSB: { value: SB }, uSN: { value: SN }, uLen: { value: L },
    uWag: { value: 0 }, uWagZ: { value: 0.8 * L },
    uJaw: { value: new THREE.Vector2() }, uHinge: { value: new THREE.Vector2(HINGE[0], HINGE[1]) },
    uEyeOpen: { value: 1 }, uEyePupil: { value: 1 }, uEyeLook: { value: new THREE.Vector2() },
    uWet: { value: 1 }, uRun: { value: 0 }, uFoamLine: { value: 0 },
  };
  const body = new THREE.Mesh(buildBody(), lordMaterial(U, false));
  body.frustumCulled = false;
  root.add(body);
  const pecGeo = buildPectoral();
  const pecMat = lordMaterial(U, true);
  const finR = new THREE.Mesh(pecGeo, pecMat), finL = new THREE.Mesh(pecGeo, pecMat);
  for (const f of [finR, finL]) { f.matrixAutoUpdate = false; f.frustumCulled = false; root.add(f); }

  // ---- spine from the director's control points (head -> tail), parallel-transported frames
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)], false, 'centripetal');
  const C = [], T = [], Nn = [], B = [];
  for (let i = 0; i < NB; i++) { C.push(new THREE.Vector3()); T.push(new THREE.Vector3()); Nn.push(new THREE.Vector3()); B.push(new THREE.Vector3()); }
  const jaw = { lo: 0, up: 0 };
  const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();

  // JS mirror of the vertex shader (without the tail wag: used for points on the head)
  function spineAt(s, p, b, n) {
    const f = Math.min(1, Math.max(0, s)) * (NB - 1), i = Math.min(Math.floor(f), NB - 2), t = f - i;
    const i0 = Math.max(i - 1, 0), i3 = Math.min(i + 2, NB - 1), t2 = t * t, t3 = t2 * t;
    const P0 = C[i0], P1 = C[i], P2 = C[i + 1], P3 = C[i3];
    for (const k of ['x', 'y', 'z']) p[k] = 0.5 * (2 * P1[k] + (P2[k] - P0[k]) * t + (2 * P0[k] - 5 * P1[k] + 4 * P2[k] - P3[k]) * t2 + (3 * P1[k] - P0[k] - 3 * P2[k] + P3[k]) * t3);
    b.lerpVectors(B[i], B[i + 1], t).normalize();
    n.lerpVectors(Nn[i], Nn[i + 1], t).normalize(); n.addScaledVector(b, -b.dot(n)).normalize();
  }
  function toWorld(r, out, jw = 0) {
    let { x, y, z } = r;
    if (jw) {
      const ang = jw > 0 ? -jaw.lo * jw : -jaw.up * jw, c = Math.cos(ang), s = Math.sin(ang);
      const ry = y - HINGE[0], rz = z - HINGE[1];
      y = HINGE[0] + c * ry - s * rz; z = HINGE[1] + s * ry + c * rz;
    }
    const zc = Math.min(L, Math.max(0, z));
    spineAt(zc / L, _a, _b, _c);
    const Tt = new THREE.Vector3().crossVectors(_c, _b);
    return out.copy(_a).addScaledVector(_b, x).addScaledVector(_c, y).addScaledVector(Tt, z - zc);
  }
  const placeFin = (mesh, side, flap, sweep) => {
    const zz = 0.205 * L, ph = side > 0 ? Math.PI * 2 - 0.62 : Math.PI + 0.62;
    const P = restPoint(zz, ph); P.x -= side * 1.2; P.y += 0.6;
    const W = toWorld(P, new THREE.Vector3());
    spineAt(zz / L, _a, _b, _c);
    const Tt = new THREE.Vector3().crossVectors(_c, _b);
    const basis = new THREE.Matrix4().makeBasis(_b.clone(), _c.clone(), Tt);
    const loc = new THREE.Matrix4();
    if (side < 0) loc.makeScale(-1, 1, 1);
    loc.multiply(new THREE.Matrix4().makeRotationY(-sweep));
    loc.multiply(new THREE.Matrix4().makeRotationZ(-flap));
    loc.multiply(new THREE.Matrix4().makeRotationX(0.12));
    mesh.matrix.copy(basis).multiply(loc).setPosition(W);
    mesh.matrixWorldNeedsUpdate = true;
  };

  const F = { c: new THREE.Vector3(), t: new THREE.Vector3(), n: new THREE.Vector3(), b: new THREE.Vector3() };
  const api = {
    root, eye: U,
    pose(p) {
      curve.points = p.points.map((v) => (v.isVector3 ? v : new THREE.Vector3(...v)));
      curve.needsUpdate = true;
      curve.arcLengthDivisions = 400;
      const Lc = curve.getLength();
      for (let i = 0; i < NB; i++) {
        const d = (i / (NB - 1)) * L;
        if (d <= Lc) { curve.getPointAt(d / Lc, C[i]); curve.getTangentAt(d / Lc, T[i]); }
        else { curve.getTangentAt(1, T[i]); curve.getPointAt(1, C[i]).addScaledVector(T[i], d - Lc); }
      }
      const up = p.up ? (p.up.isVector3 ? p.up.clone() : new THREE.Vector3(...p.up)) : new THREE.Vector3(0, 1, 0);
      for (let i = 0; i < NB; i++) {
        const t = T[i];
        if (i === 0) Nn[0].copy(up).addScaledVector(t, -up.dot(t)).normalize();
        else Nn[i].copy(Nn[i - 1]).addScaledVector(t, -Nn[i - 1].dot(t)).normalize();
        B[i].crossVectors(t, Nn[i]).normalize();
        C[i].toArray(SP, i * 3); B[i].toArray(SB, i * 3); Nn[i].toArray(SN, i * 3);
      }
      jaw.lo = (p.jaw ?? 0) * 0.42; jaw.up = (p.jaw ?? 0) * 0.1;
      U.uJaw.value.set(jaw.lo, jaw.up);
      U.uWag.value = p.wag ?? p.fluke ?? 0;
      const flap = p.fins ?? 0.3, sweep = p.finSweep ?? 0.6;
      placeFin(finR, 1, flap, sweep);
      placeFin(finL, -1, flap, sweep);
      if (p.eyeOpen !== undefined) U.uEyeOpen.value = p.eyeOpen;
      if (p.eyePupil !== undefined) U.uEyePupil.value = p.eyePupil;
      if (p.eyeLook) U.uEyeLook.value.set(p.eyeLook[0], p.eyeLook[1]);
      if (p.wet !== undefined) U.uWet.value = p.wet;
      U.uRun.value = p.run ?? 0;
      U.uFoamLine.value = p.foam ?? 0;
    },
    // world point on the hide at (s, theta): theta 0 = right flank, PI/2 = back, negative = below
    surface(s, theta, out = new THREE.Vector3(), lift = 1) {
      const zz = s * L, lower = wrap(theta) > Math.PI;
      const P = restPoint(zz, theta);
      if (lift !== 1) { const S = section(zz); P.x *= lift; P.y = S.cy + (P.y - S.cy) * lift; }
      return toWorld(P, out, jawWeight(zz, theta, lower));
    },
    frame(s) {
      spineAt(s, F.c, F.b, F.n);
      F.t.crossVectors(F.n, F.b);
      const S = section(s * L);
      return { c: F.c.clone(), t: F.t.clone(), n: F.n.clone(), b: F.b.clone(), w: S.rx, h: S.top };
    },
    eyeWorld(side = 1, out = new THREE.Vector3()) {
      const phi = side > 0 ? EYE.phi : Math.PI - EYE.phi, ze = EYE.t * L;
      const P = restPoint(ze, phi), o = restNormal(ze, phi);
      return toWorld(P.addScaledVector(o, EYE.R * 0.55), out);
    },
    // a point on the lower lip (u 0..1 across under the chin), for water pouring from the mouth
    lip(u, out = new THREE.Vector3()) {
      const ph = Math.PI + u * Math.PI;
      const zz = 0.006 * L + Math.abs(Math.cos(ph)) * 0.04 * L;
      return toWorld(restPoint(zz, ph), out, 1);
    },
    show(v) { root.visible = v; },
  };
  void ctx;
  return api;
}
