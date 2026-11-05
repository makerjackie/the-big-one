import * as THREE from 'three';
import { CUES, shotAt } from './shots.js';
import { OCEAN, oceanHeight } from './ocean.js';
import { G } from './glsl.js';
import { clamp, lerp, smooth, ease, easeOut, easeIn, onTwos, track, kick, noise1 } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = CUES;

// ------------------------------------------------------------------ boat path (towed)
const TOW0 = C.reel, TOW1 = C.calm;
function towSpeed(t) { return 13 * smooth((t - TOW0) / 1.4) * (1 - smooth((t - (TOW1 - 2.2)) / 2.0)); }
function towHeading(t) { return 0.2 * Math.sin((t - TOW0) * 0.9) * smooth((t - TOW0) / 2); }
const TAB = [];
{
  let x = 0, z = 0;
  const dt = 1 / 120;
  for (let t = 9.0; t <= 21; t += dt) {
    TAB.push([x, z]);
    const h = towHeading(t), v = t >= TOW0 && t < TOW1 ? towSpeed(t) : 0;
    x += Math.cos(h) * v * dt; z += Math.sin(h) * v * dt;
  }
}
export function boatState(t) {
  if (t < TOW0 || t >= TOW1) return { x: 0, z: 0, heading: 0, speed: 0 };
  const f = (t - 9.0) * 120, i = Math.floor(f), u = f - i;
  const a = TAB[i], b = TAB[Math.min(i + 1, TAB.length - 1)];
  return { x: lerp(a[0], b[0], u), z: lerp(a[1], b[1], u), heading: towHeading(t), speed: towSpeed(t) };
}
const boatLocal = (b, lx, ly, lz) => V(b.x + Math.cos(b.heading) * lx - Math.sin(b.heading) * lz, ly, b.z + Math.sin(b.heading) * lx + Math.cos(b.heading) * lz);

// ------------------------------------------------------------------ the Lord's poses
const RISE_X = 105;
function riseHeight(t) { return track([[C.rise - 0.2, -30], [C.rise + 1.0, 55], [C.rise + 2.2, 112], [C.peak, 136], [C.topple, 146]], t, (x) => 1 - (1 - x) * (1 - x)); }
function lordRise(t) {
  const h = riseHeight(t);
  const lean = 24 * smooth((t - (C.peak - 0.8)) / 1.8);       // bows its head toward the boat
  const pts = [V(RISE_X - lean, h, 0), V(RISE_X - lean * 0.4, h - 52, 0), V(RISE_X + 3, h - 105, 0), V(RISE_X + 14, h - 152, 0), V(RISE_X + 40, h - 190, 0)];
  return { points: pts, up: V(0.25, 0.0, 0.97).normalize(), fins: 0.2 + 0.7 * smooth((t - C.rise) / 2.5), finSweep: 0.5, fluke: 0 };
}
// the mouth gapes as the Lord climbs out of the sea, then closes to look at the robot
function mouthOpen(t) { return 0.85 * smooth((t - C.rise - 0.4) / 0.9) * (1 - smooth((t - (C.peak - 0.9)) / 0.9)); }
function lordDive(t) {
  // not a plank falling over: a breath forward, then it goes over backwards with the head
  // trailing (the spine arches and the head whips down last), rolling onto its side,
  // fins flailing and the tail thrashing
  const base = lordRise(C.topple);
  const fall = (tt) => easeIn(clamp((tt - C.topple) / (C.splash - C.topple))) * 0.92 + 0.35 * clamp((tt - C.splash) / 1.5) * (1 - 0.5 * clamp((tt - C.splash) / 1.5));
  const p = fall(t);
  const pivot = V(RISE_X, -40, -10);
  const antic = Math.sin(Math.PI * clamp((t - (C.topple - 0.25)) / 0.7)) * 0.09;
  const go = smooth((t - C.topple) / 0.5);
  const pts = base.points.map((q, i) => {
    const w = 1 - i / 4;                                   // 1 at the head .. 0 at the tail
    const ang = fall(t - 0.24 * w ** 1.3) * 1.72 - antic * w;
    const sway = Math.sin((t - C.topple) * 3.4 - i * 0.9) * 7 * w * go;
    return q.clone().sub(pivot).applyAxisAngle(V(1, 0, 0), ang).add(pivot).add(V(sway, 0, 0));
  });
  const axis = pts[0].clone().sub(pts[4]).normalize();
  const up = base.up.clone().applyAxisAngle(V(1, 0, 0), p * 1.72).applyAxisAngle(axis, 0.6 * smooth((t - C.topple - 0.1) / 1.6));
  const flail = go * (1 - smooth((t - C.splash) / 0.6));
  return {
    ...base, points: pts, up,
    fins: 0.55 + 0.45 * Math.sin((t - C.topple) * 7.5) * flail, finSweep: 0.35 + 0.3 * Math.sin((t - C.topple) * 7.5 + 1.2) * flail,
    wag: 0.38 * Math.sin((t - C.topple) * 5.2) * flail,
    eyeOpen: 1 - 0.75 * smooth((t - (C.splash - 0.35)) / 0.25),
  };
}
function lordUnder(t) {
  // swimming below the towed boat, head a little ahead of it
  const b = boatState(Math.min(t, C.calm - 0.01));
  const sway = Math.sin(t * 0.7) * 6;
  const hx = b.x + 34 - (t - C.below) * 2.0;
  const pts = [0, 1, 2, 3, 4].map((k) => V(hx - k * 55, -34 - k * 4 + (k === 0 ? 4 : 0), b.z + sway * (k / 4) - 3 + Math.sin(t * 1.3 - k) * k * 2));
  return { points: pts, up: V(0, 1, 0), fins: 0.25 + 0.15 * Math.sin(t * 1.4), finSweep: 0.8, fluke: Math.sin(t * 1.5) * 0.3 };
}
function lordFarewell(t) {
  // swimming away across the horizon: the dorsal and the great crescent tail cut the surface,
  // and the tail sweeps side to side - a wave goodbye
  const k = easeOut(clamp((t - (C.farewell - 0.5)) / 1.6));
  const O = V(-235, 0, -340);
  const dir = V(-0.75, 0, -0.66).normalize();
  const swim = (t - C.farewell) * 6;
  const y = lerp(-64, -15, k);
  const pts = [0, 1, 2, 3, 4].map((i) => O.clone().addScaledVector(dir, 110 - i * 55 + swim).add(V(0, y + i * 2.2 + (i === 4 ? 3 * k : 0), Math.sin(t * 1.4 - i * 0.9) * i * 1.5)));
  const wave = Math.sin((t - C.farewell) * 3.6) * 0.42 * smooth((t - C.farewell - 0.3) / 0.6);
  return { points: pts, up: V(0, 1, 0), fins: 0.35, finSweep: 0.7, wag: wave, wet: 1 };
}

// ------------------------------------------------------------------ FX emitters (installed once)
let fxReady = false;
function installFx(fx, world) {
  const R = (r, i, a, b) => a + (b - a) * r[i];
  const dir = (r, i) => { const a = r[i] * Math.PI * 2; return [Math.cos(a), Math.sin(a)]; };
  // bobber nibble + plunge
  const BOB = [11.2, 0, 0.6];
  fx.add({ t0: C.nibble, t1: C.nibble + 0.05, n: 16, life: [0.35, 0.55], size: [0.012, 0.03], origin: () => BOB, vel: (tb, r) => { const [c, s] = dir(r, 2); return [c * 0.6, R(r, 3, 0.8, 1.6), s * 0.6]; } });
  fx.add({ t0: C.bite, t1: C.bite + 0.12, n: 46, life: [0.4, 0.75], size: [0.02, 0.06], stretch: 1.5, origin: () => BOB, vel: (tb, r) => { const [c, s] = dir(r, 2); return [c * R(r, 4, 0.5, 1.3), R(r, 3, 1.2, 3.0), s * R(r, 4, 0.5, 1.3)]; } });
  // bow spray while towed: two curtains peeling off the bow
  for (const sd of [1, -1]) {
    fx.add({
      t0: TOW0 + 0.3, t1: TOW1 - 0.3, n: 900, life: [0.5, 1.0], size: [0.07, 0.26], stretch: 1.2, grow: 0.8,
      origin: (tb, r) => { const b = boatState(tb); return boatLocal(b, R(r, 2, 1.6, 3.0), 0.05, sd * R(r, 3, 0.7, 1.0)).toArray(); },
      vel: (tb, r) => { const b = boatState(tb); const sp = b.speed * smooth(b.speed / 6); return boatLocal({ x: 0, z: 0, heading: b.heading }, sp * R(r, 4, 0.15, 0.55), sp * R(r, 5, 0.25, 0.5), sd * sp * R(r, 1, 0.25, 0.5)).toArray(); },
    });
  }
  // bubbles streaming from the Lord's mouth underwater
  fx.add({
    t0: C.below, t1: C.calm, n: 260, kind: 'bubble', g: 3.5, drag: 1.2, life: [1.8, 3.2], size: [0.25, 1.1],
    origin: (tb, r) => { const p = lordUnder(tb).points[0]; return [p.x - R(r, 2, 4, 30), p.y + R(r, 3, -8, 6), p.z + R(r, 4, -14, 14)]; },
    vel: (tb, r) => [R(r, 5, -1, 1), R(r, 1, 1, 4), R(r, 0, -1, 1)],
  });
  // ambient underwater motes/bubbles near camera
  fx.add({ t0: C.below - 0.5, t1: C.calm, n: 120, kind: 'bubble', g: 1.5, drag: 0.5, life: [2, 3.5], size: [0.04, 0.12],
    origin: (tb, r) => { const b = boatState(tb); return [b.x + R(r, 2, -30, 10), R(r, 3, -22, -4), b.z + R(r, 4, -20, 25)]; }, vel: () => [0, 0.4, 0] });
  // boiling surface before the rise
  fx.add({
    t0: C.bubbles, t1: C.rise + 0.4, n: 420, life: [0.5, 1.1], size: [0.25, 1.6], grow: 0.4,
    origin: (tb, r) => { const a = r[2] * Math.PI * 2, rr = Math.sqrt(r[3]) * 70 * (0.5 + 0.5 * smooth((tb - C.bubbles) / 1.0)); return [RISE_X - 20 + Math.cos(a) * rr, 0, Math.sin(a) * rr]; },
    vel: (tb, r) => [R(r, 4, -0.5, 0.5), R(r, 5, 1.0, 3.2), R(r, 1, -0.5, 0.5)],
  });
  // ---- the rise: falling sheets, base crown, mist
  fx.add({
    t0: C.rise + 0.3, t1: C.peak + 0.6, n: 800, life: [1.4, 2.6], size: [0.35, 1.4], stretch: 3, grow: 0.2, floor: -2,
    origin: (tb, r) => {
      const h = Math.max(0, riseHeight(tb)), a = (r[2] - 0.5) * Math.PI * 1.6 + Math.PI, rr = R(r, 3, 25, 31);
      const y = h * Math.pow(r[4], 0.8) * 0.8;
      const lean = 16 * smooth((tb - (C.peak - 0.6)) / 1.6) * (y / Math.max(h, 1));
      return [RISE_X - lean + Math.cos(a) * rr, y, Math.sin(a) * rr * 1.1];
    },
    vel: (tb, r) => { const a = (r[2] - 0.5) * Math.PI * 1.6 + Math.PI; return [Math.cos(a) * R(r, 5, 1, 6), R(r, 1, -2, 3), Math.sin(a) * R(r, 5, 1, 6)]; },
  });
  fx.add({
    t0: C.rise, t1: C.rise + 2.0, n: 450, life: [1.4, 2.4], size: [0.6, 2.2], stretch: 2, grow: 0.3, floor: -3, heightTint: [-2, 18],
    origin: (tb, r) => { const a = r[2] * Math.PI * 2, rr = R(r, 3, 24, 40); return [RISE_X + Math.cos(a) * rr, 0, Math.sin(a) * rr]; },
    vel: (tb, r) => { const a = r[2] * Math.PI * 2; const k = 1 - 0.6 * smooth((tb - C.rise) / 2.4); return [Math.cos(a) * R(r, 4, 6, 18) * k, R(r, 5, 12, 30) * k, Math.sin(a) * R(r, 4, 6, 18) * k]; },
  });
  fx.add({
    t0: C.rise + 0.4, t1: C.topple - 0.6, n: 140, kind: 'mist', g: 0.6, drag: 0.6, life: [2.0, 3.2], size: [4, 9], grow: 0.6, heightTint: [-2, 22],
    origin: (tb, r) => { const a = r[2] * Math.PI * 2, rr = R(r, 3, 25, 55); return [RISE_X + 15 + Math.cos(a) * rr, R(r, 4, 0, 6), Math.sin(a) * rr]; },
    vel: (tb, r) => { const a = r[2] * Math.PI * 2; return [Math.cos(a) * R(r, 5, 2, 8), R(r, 1, 1, 3), Math.sin(a) * R(r, 5, 2, 8)]; },
  });
  // water pouring out of the gaping mouth as it rises
  fx.add({
    t0: C.rise + 0.5, t1: C.peak - 0.6, n: 900, life: [1.2, 2.2], size: [0.5, 1.8], stretch: 3, grow: 0.3, floor: -2,
    origin: (tb, r) => { const lp = lordRise(tb); const p0 = lp.points[0], p1 = lp.points[1]; const ax = p1.clone().sub(p0).normalize(); const open = mouthOpen(tb); return p0.clone().addScaledVector(ax, R(r, 2, 4, 12) + open * 4).add(V(-R(r, 3, 6, 12) * open - 4, 0, R(r, 4, -16, 16))).toArray(); },
    vel: (tb, r) => [-R(r, 5, 2, 7) * mouthOpen(tb), R(r, 1, -3, 2), R(r, 0, -3, 3)],
  });
  // drips off the brow (seen in the eye close-up)
  fx.add({
    t0: C.peak - 0.5, t1: C.topple, n: 260, life: [0.8, 1.6], size: [0.04, 0.12], stretch: 3, g: -9.8,
    origin: (tb, r) => { const lp = lordRise(tb); const p0 = lp.points[0], p1 = lp.points[1]; const ax = p1.clone().sub(p0).normalize(); const sd = r[5] > 0.5 ? 1 : -1; return p0.clone().addScaledVector(ax, R(r, 2, 6, 28)).add(V(R(r, 3, -14, 4), 0, sd * R(r, 4, 17, 23))).toArray(); },
    vel: (tb, r) => [R(r, 4, -1, 1), R(r, 1, -1, 0.5), R(r, 0, -1, 1)],
  });
  // ---- the dive splash: a wall of water along the body's line of impact
  fx.add({   // the wall along the line of impact: explosive, decelerating jets
    t0: C.splash - 0.15, t1: C.splash + 0.7, n: 3200, life: [2.0, 3.4], size: [3, 10], stretch: 2.2, grow: 0.8, drag: 0.9, floor: -4, heightTint: [-5, 55],
    origin: (tb, r) => { const z = 20 + Math.pow(r[2], 0.8) * 200; return [RISE_X + R(r, 3, -24, 24), 0, z]; },
    vel: (tb, r) => { const sd = r[3] > 0.5 ? 1 : -1; return [sd * R(r, 1, 10, 45), R(r, 5, 50, 125) * (0.55 + 0.45 * r[2]), R(r, 4, -8, 14)]; },
  });
  fx.add({   // the crown where the head slams down: tall leaning jets
    t0: C.splash - 0.05, t1: C.splash + 0.35, n: 900, life: [1.8, 3.0], size: [2.5, 7], stretch: 3.4, grow: 0.6, drag: 1.1, floor: -4, heightTint: [-5, 80],
    origin: (tb, r) => { const a = r[2] * Math.PI * 2, rr = R(r, 3, 18, 34); return [RISE_X + Math.cos(a) * rr, 0, 195 + Math.sin(a) * rr * 1.4]; },
    vel: (tb, r) => { const a = r[2] * Math.PI * 2, out = R(r, 4, 8, 30); return [Math.cos(a) * out, R(r, 5, 110, 190), Math.sin(a) * out]; },
  });
  fx.add({
    t0: C.splash + 0.1, t1: C.splash + 1.2, n: 320, kind: 'mist', g: 0.4, drag: 0.6, life: [2.5, 4.5], size: [14, 30], grow: 0.8, heightTint: [-5, 70],
    origin: (tb, r) => [RISE_X + R(r, 4, -40, 40), R(r, 3, 0, 40), 20 + r[2] * 200],
    vel: (tb, r) => [R(r, 0, -10, 10), R(r, 1, 8, 40), R(r, 5, -4, 6)],
  });
  // the boat's crest spray and the landing slap
  fx.add({
    t0: C.air - 0.7, t1: C.air + 0.1, n: 300, life: [0.5, 1.0], size: [0.06, 0.22], stretch: 2,
    origin: (tb, r) => { const b = wavePlace(tb); return [b.x + R(r, 2, -2, 3), b.y + R(r, 3, -0.3, 0.4), R(r, 4, -2.5, 2.5)]; },
    vel: (tb, r) => [R(r, 5, -4, 2), R(r, 1, 3, 8), R(r, 0, -3, 3)],
  });
  fx.add({
    t0: C.land, t1: C.land + 0.1, n: 260, life: [0.5, 0.85], size: [0.06, 0.24], stretch: 1.8, grow: 0.5,
    origin: (tb, r) => { const b = wavePlace(C.land); const [c, s] = dir(r, 2); return [b.x + c * R(r, 3, 1.5, 3.5), b.y - 0.2, s * R(r, 3, 1, 2)]; },
    vel: (tb, r) => { const [c, s] = dir(r, 2); return [c * R(r, 4, 2, 6), R(r, 5, 2.5, 6), s * R(r, 4, 2, 6)]; },
  });
  // the hat comes up dripping
  fx.add({ t0: C.hat, t1: C.hat + 0.1, n: 30, life: [0.4, 0.8], size: [0.02, 0.05], origin: () => hookPos(C.hat).toArray(), vel: (tb, r) => { const [c, s] = dir(r, 2); return [c * 1.2, R(r, 3, 1, 2.5), s * 1.2]; } });
  fx.add({ t0: C.hat, t1: HAT_T2, n: 70, life: [0.3, 0.6], size: [0.012, 0.025], stretch: 2, origin: (tb, r) => { const p = tb < HAT_T1 ? hookPos(tb).add(V(0, -0.18, 0)) : ROBOT_ROOT.clone().add(HAT_GRAB).add(V(-0.04, 0.12, 0.06)).add(HAT_HELD); return [p.x + R(r, 2, -0.3, 0.3), p.y - 0.05, p.z + R(r, 3, -0.3, 0.3)]; }, vel: () => [0, -0.5, 0] });
  // farewell fluke: water streaming off the trailing edge
  fx.add({
    t0: C.farewell + 0.3, t1: 39, n: 700, life: [1.0, 2.0], size: [1.0, 3.0], stretch: 2.5, floor: -2,
    origin: (tb, r) => { const lp = lordFarewell(tb); const tp = lp.points[4]; return [tp.x + R(r, 2, -18, 4), tp.y + 16 + R(r, 3, 4, 40), tp.z + R(r, 4, -4, 4)]; },
    vel: (tb, r) => [R(r, 4, -2, 2), R(r, 5, -2, 1), R(r, 1, -2, 2)],
  });
  fxReady = true;
}

// ------------------------------------------------------------------ s12 wave ride
function wavePlace(t) {
  const y = oceanHeightAt(0, 0, t) + airLift(t);
  return { x: 0, y };
}
function airLift(t) {
  if (t < C.air || t > C.land) return 0;
  const u = (t - C.air) / (C.land - C.air);
  return 4 * u * (1 - u) * 2.6;
}
function ringFor(t) {   // the swell cheat for s12: its crest reaches the boat at C.air
  const sp = 26, d0 = 140;
  OCEAN.uRing.value.set(d0, 0, C.air - d0 / sp, 7.5);
  OCEAN.uRingB.value.set(sp, 16, 0.02, 0);
  void t;
}
function oceanHeightAt(x, z, t) {
  const save = OCEAN.uWT.value; OCEAN.uWT.value = Math.floor(t * 12) / 12;
  const h = oceanHeight(x, z); OCEAN.uWT.value = save; return h;
}

// ------------------------------------------------------------------ s13 the hat on the hook
// the hat is reeled in, swings in on the line and the robot's left hand catches it
const HAT_T1 = C.hatOn - 0.9, HAT_T2 = C.hatOn - 0.55;
const HAT_GRAB = V(0.4, 0.62, -0.42);                     // left hand, robot-root space
const HAT_HELD = V(0.5, -0.04, -0.05);                    // hat centre relative to the hand
const ROBOT_ROOT = V(1.5, 0.92, 0);                       // robot root in the world (boat at rest)
function hookPos(t) {
  const k = ease(t, C.hat - 0.45, HAT_T1);
  const p0 = V(2.6, -1.5, -3.6), p1 = ROBOT_ROOT.clone().add(HAT_GRAB).add(HAT_HELD).add(V(0, 0.18, 0));
  const p = p0.clone().lerp(p1, k);
  p.y += Math.sin(k * Math.PI) * 0.7;
  return p;
}

// ------------------------------------------------------------------ helpers
function shake(t, amp, f = 7) { return V((noise1(t * f, 1) - 0.5) * amp, (noise1(t * f, 2) - 0.5) * amp, (noise1(t * f, 3) - 0.5) * amp); }
function lookAt(cam, pos, at, fov, roll = 0) {
  cam.position.copy(pos);
  cam.up.set(0, 1, 0);
  cam.lookAt(at);
  if (roll) cam.rotateZ(roll);
  cam.fov = fov;
  cam.near = pos.y < 40 && fov < 50 ? 0.08 : 0.5;
  cam.far = 12000;
}
const ROD_BASE = V(0.86, 0.5, 0.05).normalize();
function basePose(tc) {
  const br = Math.sin(tc * 1.4) * 0.012;
  const handR = V(0.4, 0.4 + br, 0.07);
  return { lean: 0.06 + br, twist: 0, headPitch: -0.05, headYaw: 0, headRoll: 0, bob: br, handR, handL: handR.clone().addScaledVector(ROD_BASE, 0.3).add(V(0, 0.02, -0.06)), kick: tc * 2 };
}
const FACE0 = { uEyeOpen: 1, uPupil: 1, uEyeMode: 0, uBlush: 0.55, uLook: [0, 0], uSweat: 0 };

export function direct(t, world, cam) {
  if (!fxReady) installFx(world.fx, world);
  const shot = shotAt(t);
  const lt = t - shot.t0, d = shot.t1 - shot.t0, u = lt / d;
  const tc = onTwos(t);   // character drawings on twos
  // defaults
  OCEAN.uCalm.value = 0; OCEAN.uSwellAmp.value = 1;
  OCEAN.uBulge.value.set(0, 0, 0, 30);
  OCEAN.uRing.value.set(0, 0, -99, 0);
  OCEAN.uWake.value.set(0, 0, 0, 0);
  OCEAN.uShadow.value.set(0, 0, 0, 0);
  for (const f of OCEAN.uFoam.value) f.set(0, 0, 0, 0);
  for (const r of OCEAN.uRip.value) r.set(0, 0, -99, 0);
  G.uKeyDir.value.copy(G.uSunDir.value);
  const st = {
    t, shot: shot.id, under: false,
    boat: { x: 0, z: 0, heading: 0 },
    robot: { pose: basePose(tc), face: { ...FACE0 } },
    rod: { dir: ROD_BASE.clone(), tension: 0 },
    line: { end: V(11.2, 0, 0.6), slack: 0.25, on: true },
    bobber: null, hat: { on: true }, lord: null, marks: [], title: null,
    look: { haze: 0.00028, shafts: 0, speed: 0, flash: 0, fade: 0, paintRadius: 4, inkWidth: 1.2, bloom: 0.8 },
  };
  const P = st.robot.pose, F = st.robot.face;
  const bobberAt = (x, z, dip = 0) => { const y = oceanHeight(x, z) + 0.02 - dip; return [x, y, z]; };
  // hull foam where the little boat sits
  const hullFoam = (b, s = 0.5) => { OCEAN.uFoam.value[0].set(b.x + Math.cos(b.heading) * 0.2, b.z + Math.sin(b.heading) * 0.2, 3.6, s); };

  switch (shot.name) {
    case 'open': {
      // a tiny red boat under a castle of summer cloud; slow push in
      st.bobber = { pos: bobberAt(11.2, 0.6) };
      st.line.end = V(...st.bobber.pos);
      P.headPitch = -0.25; F.uEyeOpen = 0.25;
      const p = V(lerp(16, 10.5, smooth(u)), lerp(5.2, 3.6, smooth(u)), lerp(48, 30, smooth(u)));
      lookAt(cam, p, V(1.5, lerp(9, 6.5, smooth(u)), -20), 42);
      st.gulls = { center: [2, 0, -4] };
      st.title = { kind: 'open', a: ease(t, C.titleIn, C.titleIn + 0.7) * (1 - ease(t, C.titleOut - 0.5, C.titleOut)) };
      hullFoam(st.boat, 0.35);
      st.look.shafts = 0.6;
      st.look.fade = 1 - ease(t, 0, 0.6);
      break;
    }
    case 'fisher': {
      st.bobber = { pos: bobberAt(11.2, 0.6) };
      st.line.end = V(...st.bobber.pos);
      // dozing: head sinks, snaps up at each nod
      const nod = (c) => (tc < c ? smooth((tc - (c - 0.9)) / 0.9) * 0.35 : Math.max(0, 0.35 - (tc - c) * 3.5) * Math.exp(-(tc - c) * 3));
      P.headPitch = -0.2 - nod(C.nod1) - nod(C.nod2) + kick(tc, C.nod1, 2.5, 5) * 0.06 + kick(tc, C.nod2, 2.5, 5) * 0.06;
      P.lean = 0.12 + 0.3 * (nod(C.nod1) + nod(C.nod2));
      F.uEyeOpen = 0.12 + 0.25 * (Math.abs(kick(tc, C.nod1, 1, 3)) + Math.abs(kick(tc, C.nod2, 1, 3)));
      st.rod.dir = ROD_BASE.clone().applyAxisAngle(V(0, 0, 1), -0.25 * (nod(C.nod1) + nod(C.nod2)));
      const p = V(lerp(4.9, 4.5, u), 1.75, lerp(2.4, 2.1, u));
      lookAt(cam, p, V(1.75, 1.55, 0.12), 34);
      st.gulls = { center: [-6, -4, -14] };
      st.marks.push({ type: 'zzz', anchor: 'head', offset: [0.1, 0.35, 0.15], k: (t * 0.6) % 1 });
      hullFoam(st.boat, 0.3);
      break;
    }
    case 'bobber': {
      const dip = t > C.nibble && t < C.nibble + 0.35 ? Math.sin((t - C.nibble) / 0.35 * Math.PI) * 0.06 : 0;
      const plunge = easeIn(clamp((t - C.bite) / 0.25)) * 0.9;
      const bx = 11.2 + plunge * 0.6;
      st.bobber = { pos: bobberAt(bx, 0.6, dip + plunge), tilt: Math.sin(t * 2.2) * 0.12 + plunge * 0.6, tilt2: Math.cos(t * 1.7) * 0.1 };
      st.line.end = V(...st.bobber.pos);
      st.line.slack = 0.25 * (1 - smooth((t - C.bite) / 0.2));
      st.rod.tension = 0.5 * smooth((t - C.bite) / 0.3);
      OCEAN.uRip.value[0].set(11.2, 0.6, C.nibble, 0.6);
      OCEAN.uRip.value[1].set(11.2, 0.6, C.bite, 1.2);
      OCEAN.uRip.value[2].set(11.2, 0.6, 7.0, 0.3);
      OCEAN.uRip.value[3].set(11.2, 0.6, C.bite + 0.25, 0.9);
      const sh = shake(t, 0.06 * smooth((t - C.bite) / 0.1) * (1 - smooth((t - C.bite - 0.4) / 0.4)), 14);
      const p = V(9.3, 0.42, 2.3).add(sh);
      lookAt(cam, p, V(11.0, 0.12, 0.5), 30, 0.03);
      F.uEyeOpen = 0.15;
      break;
    }
    case 'strike': {
      // the jolt: "!", the rod bends double, the reel screams, the boat starts to move
      const b = boatState(t);
      st.boat = { x: b.x, z: b.z, heading: b.heading, pitch: 0.09 * smooth((t - C.reel) / 0.6) + kick(t, C.reel, 2, 4) * 0.04 };
      const j = clamp((tc - C.jolt) / 0.12);
      P.lean = lerp(0.12, -0.32, easeOut(j)) + kick(tc, C.jolt, 3, 6) * 0.05;
      P.headPitch = lerp(-0.35, 0.12, easeOut(j));
      P.bob = 0.06 * easeOut(j) * Math.exp(-(tc - C.jolt) * 3);
      F.uEyeOpen = lerp(0.12, 1.0, easeOut(j * 2)); F.uPupil = lerp(1, 0.38, easeOut(j)); F.uBlush = 0.2;
      P.handR = V(0.33, 0.52, 0.06); P.handL = P.handR.clone().add(V(0.12, 0.17, -0.06));
      st.rod.dir = V(0.55, 0.83, 0.04).normalize();
      st.rod.tension = 0.6 + 0.4 * smooth((t - C.jolt) / 0.3);
      const fwd = boatLocal(b, 18, -2.5, 0.8);
      st.line.end = fwd; st.line.slack = 0;
      if (tc > C.jolt) st.marks.push({ type: '!', anchor: 'head', offset: [0, 0.75, 0.25], k: clamp((tc - C.jolt) / 1.0), size: 1.1 });
      const sh = shake(t, 0.05 + 0.08 * smooth((t - C.reel) / 0.5), 11);
      const c0 = boatLocal(b, 4.9, 2.1, 3.0);
      lookAt(cam, c0.add(sh), boatLocal(b, 1.6, 1.75, 0.1), 38, -0.08 * smooth((t - C.reel) / 0.6));
      st.look.speed = 0.45 * smooth((t - C.reel - 0.1) / 0.5);
      st.look.speedC = [0.42, 0.55];
      OCEAN.uWake.value.set(b.x, b.z, b.heading, smooth(b.speed / 5));
      OCEAN.uWakeB.value.set(70, 1, 0, 0);
      hullFoam(b, 0.45);
      st.hat = { on: true };
      break;
    }
    case 'towed': {
      // aerial: the little boat dragged across the sea, a colossal shadow ahead of it
      const b = boatState(t);
      st.boat = { x: b.x, z: b.z, heading: b.heading, pitch: 0.12 };
      P.lean = -0.3; P.headPitch = 0.05; F.uEyeOpen = 1; F.uPupil = 0.4;
      P.handR = V(0.33, 0.52, 0.06); P.handL = P.handR.clone().add(V(0.12, 0.17, -0.06));
      st.rod.dir = V(0.55, 0.83, 0.04).normalize(); st.rod.tension = 1;
      st.line.end = boatLocal(b, 22, -3, 0); st.line.slack = 0;
      OCEAN.uWake.value.set(b.x, b.z, b.heading, 1);
      OCEAN.uWakeB.value.set(90, 1.1, 0, 0);
      const sp = boatLocal(b, 95 + 10 * Math.sin(t * 0.5), 0, 0);
      OCEAN.uShadow.value.set(sp.x, sp.z, b.heading + 0.04 * Math.sin(t), 0.7 + 0.2 * smooth(u));
      OCEAN.uShadowB.value.set(120, 32, 0, 0);
      hullFoam(b, 0.6);
      const cp = boatLocal(b, lerp(-24, -14, u), lerp(30, 21, u), lerp(20, 13, u));
      lookAt(cam, cp, boatLocal(b, 26, 0, 0), 46, 0.05);
      st.look.speed = 0.12; st.look.speedC = [0.62, 0.42];
      st.look.haze = 0.0002;
      break;
    }
    case 'below': {
      // under the sea: the line runs down to the corner of a giant mouth; the eye opens and looks up
      st.under = true;
      const b = boatState(t);
      st.boat = { x: b.x, z: b.z, heading: b.heading, pitch: 0.1 * smooth(b.speed / 6) };
      st.rod.tension = 1; P.handR = V(0.33, 0.52, 0.06); P.handL = P.handR.clone().add(V(0.12, 0.17, -0.06));
      st.rod.dir = V(0.55, 0.83, 0.04).normalize();
      const lp = lordUnder(t);
      lp.eyeOpen = track([[C.eye - 0.3, 0.05], [C.eye + 0.4, 1.0]], t);
      lp.eyeLook = track([[C.look - 0.1, [-0.2, -0.1]], [C.look + 0.5, [0.15, 0.85]]], t);
      lp.eyePupil = track([[C.look, 1.0], [C.look + 0.4, 0.75]], t);
      lp.wet = 0.6; lp.jaw = 0.12 + 0.06 * Math.sin(t * 1.1);
      world.lord.pose(lp); lp._posed = true;
      st.lord = lp;
      st.line.end = world.lord.surface(0.008, -0.12, V(), 1.0);
      st.line.slack = 0;
      // a shoal of little fish rides the bow wave, just ahead of the snout
      { const h = lp.points[0], d = lp.points[0].clone().sub(lp.points[1]).normalize(); st.school = { center: h.clone().addScaledVector(d, 14).add(V(0, 9, -16)).toArray(), dir: d.toArray(), size: 16, fish: 1.6 }; }
      const eye = world.lord.eyeWorld(1, V());
      const fr = world.lord.frame(0.08);
      const out = eye.clone().sub(fr.c); out.y *= 0.15; out.normalize();
      const cp = eye.clone().addScaledVector(out, lerp(58, 46, smooth(u))).add(V(-14 + 6 * u, 14, 0));
      lookAt(cam, cp, eye.clone().add(V(-6, 10 - 2 * u, 0)), 50, 0.04);
      G.uKeyDir.value.set(0.2, 1, 0.3).normalize();
      st.look.haze = 0; st.look.shafts = 1; st.look.paintRadius = 5;
      OCEAN.uSwellAmp.value = 1.5;
      break;
    }
    case 'calm': {
      // everything stops; the line goes slack; the robot peers over the bow; the sea darkens and boils
      st.boat = { x: 0, z: 0, heading: 0 };
      OCEAN.uCalm.value = 0.75;
      F.uEyeOpen = 1; F.uPupil = 0.8;
      const peer = smooth((tc - (C.calm + 0.3)) / 0.6);
      P.lean = lerp(0.0, 0.42, peer); P.headPitch = lerp(0.0, -0.45, peer); P.headYaw = 0.15 * Math.sin(tc * 1.5) * peer;
      F.uLook = [0, -0.6 * peer];
      st.rod.tension = 0; st.line.slack = 1.2;
      st.line.end = V(12, -0.4, 0.4);
      st.rod.dir = ROD_BASE.clone().applyAxisAngle(V(0, 0, 1), -0.35);
      OCEAN.uShadow.value.set(RISE_X - 30, 0, 0, 0.75 * smooth((t - C.calm) / 1.6));
      OCEAN.uShadowB.value.set(150, 42, 0, 0);
      for (let i = 0; i < 6; i++) { const a = i * 2.1, r = 8 + i * 9; OCEAN.uRip.value[i].set(RISE_X - 70 + Math.cos(a) * r, Math.sin(a) * r, C.bubbles + i * 0.15, 3 + i); }
      hullFoam(st.boat, 0.2);
      if (tc > C.calm + 0.6) st.marks.push({ type: '?', anchor: 'head', offset: [0, 0.7, 0.25], k: clamp((tc - C.calm - 0.6) / 1.0) });
      const p = V(lerp(-2.5, -3.2, u), 3.0, lerp(8.5, 9.2, u));
      lookAt(cam, p, V(7, 0.4, -1.5), 48);
      break;
    }
    case 'rise': {
      // from behind the boat: the Lord rises like a skyscraper; the hat blows away
      st.boat = { x: 0, z: 0, heading: 0, pitch: -0.12 * smooth((t - C.rise - 1.5) / 1.5) * Math.exp(-Math.max(0, t - C.rise - 3) * 0.6) };
      const lp = lordRise(t);
      lp.eyeOpen = 1; lp.eyeLook = [-0.4, -0.5]; lp.wet = 1;
      lp.jaw = mouthOpen(t); lp.run = 1 - 0.5 * smooth((t - C.peak) / 1.5); lp.foam = 3;
      world.lord.pose(lp); lp._posed = true; st.lord = lp;
      const h = riseHeight(t);
      OCEAN.uBulge.value.set(RISE_X, 0, 7 * smooth((t - C.rise + 0.8) / 1.2) * (1 - 0.6 * smooth((t - C.rise - 2) / 2)), 75);
      OCEAN.uRing.value.set(RISE_X, 0, C.rise, 2.2); OCEAN.uRingB.value.set(30, 12, 0.3, 0);
      OCEAN.uFoam.value[1].set(RISE_X, 0, 30 + 25 * smooth((t - C.rise) / 3), smooth((t - C.rise + 0.2) / 0.4));
      OCEAN.uFoam.value[2].set(RISE_X - 20, 0, 60 * smooth((t - C.rise) / 4) + 5, 0.6 * smooth((t - C.rise) / 0.6));
      OCEAN.uCalm.value = 0.4;
      // robot: looks up, up, up
      const look = smooth((tc - C.rise - 0.5) / 2.0);
      P.lean = lerp(0.1, -0.35, look); P.headPitch = lerp(0.0, 0.75, look); F.uPupil = lerp(0.8, 0.35, look); F.uEyeOpen = 1;
      P.handR = V(0.36, 0.45, 0.07); P.handL = P.handR.clone().addScaledVector(ROD_BASE, 0.3).add(V(0, 0.02, -0.06));
      st.rod.tension = 0.15; st.line.slack = 0.2;
      st.line.end = world.lord.surface(0.05, -0.14, V(), 1.0);
      // hat
      if (t > C.hatOff) {
        const a = t - C.hatOff;
        st.hat = { on: false, fromHead: true, offset: [-a * 6 - a * a * 2, a * 7 - a * a * 1.5, a * 2.5], spin: [a * 3, a * 9, a * 5] };
      }
      // camera: low behind the stern, tilting up with the rise
      const sh = shake(t, 0.35 * smooth((t - C.rise) / 0.6) * (1 - 0.7 * smooth((t - C.rise - 2.5) / 2)), 9);
      const tilt = smooth((t - C.rise) / 3.4);
      const cp = V(lerp(-7.5, -9, u), lerp(1.6, 1.3, u), 3.2).add(sh);
      lookAt(cam, cp, V(RISE_X * 0.5, lerp(12, Math.max(30, h * 0.48), tilt), lerp(0.5, -6, tilt)), lerp(52, 60, tilt), 0.02);
      st.look.haze = 0.00022;
      st.look.shafts = 0.4;
      st.look.flash = 0.0;
      break;
    }
    case 'eye': {
      // close on the eye: it looks down at the little robot, and blinks
      const lp = lordRise(t);
      const bl = t > C.blink && t < C.blink + 0.32 ? Math.sin(((t - C.blink) / 0.32) * Math.PI) : 0;
      lp.eyeOpen = 1 - bl; lp.eyeLook = track([[C.eye, [-0.4, -0.5]], [C.blink + 0.4, [-0.5, -0.65]]], t);
      lp.eyePupil = track([[C.blink + 0.2, 0.85], [C.blink + 0.5, 1.25]], t);
      lp.wet = 1; lp.run = 0.15;
      world.lord.pose(lp); lp._posed = true; st.lord = lp;
      const eye = world.lord.eyeWorld(1, V());
      const fr = world.lord.frame(0.072);
      const out = eye.clone().sub(fr.c).normalize();
      const cp = eye.clone().addScaledVector(out, lerp(17, 14.5, u)).add(V(-3, -4.5, 0));
      lookAt(cam, cp, eye.clone().add(V(0, -0.6, 0)), 40, -0.04);
      st.boat.visible = false;
      st.look.haze = 0.0002;
      break;
    }
    case 'react': {
      // the little robot, hatless, gulps
      const gulp = kick(tc, C.gulp, 1.6, 3.5);
      P.lean = -0.25; P.headPitch = 0.45 - gulp * 0.12; P.bob = -Math.max(0, gulp) * 0.04;
      F.uPupil = 0.32; F.uEyeOpen = 1.0; F.uBlush = 0.9; st.rod.dir = V(0.3, 0.95, -0.12).normalize(); F.uSweat = tc > C.gulp - 0.3 ? 1 : 0;
      P.handR = V(0.33, 0.47, 0.07); P.handL = P.handR.clone().addScaledVector(ROD_BASE, 0.3).add(V(0, 0.02, -0.06));
      st.hat = { on: false, pos: [-30, 30, 0], rot: [0, 0, 0] };
      st.line.end = V(30, 4, 0); st.line.slack = 0.3;
      const p = V(lerp(3.35, 3.2, u), lerp(1.75, 1.7, u), lerp(0.55, 0.45, u));
      lookAt(cam, p, V(1.6, 1.95, 0.1), 36, 0.06);
      G.uKeyDir.value.set(0.4, 0.5, 0.75).normalize();
      // the Lord's shadow falls on the boat: cooler key
      st.look.haze = 0.0002;
      const lp = lordRise(t); lp.eyeLook = [-0.5, -0.65]; world.lord.pose(lp); lp._posed = true; st.lord = lp;
      break;
    }
    case 'dive': {
      // wide: the Lord topples backwards into the sea
      const lp = lordDive(t);
      lp.wet = 1; lp.eyeLook = [0.3, 0.3]; lp.run = 0.6; lp.jaw = 0.55 * smooth((t - C.topple - 0.2) / 0.6) * (1 - 0.6 * smooth((t - C.splash) / 0.4)); lp.foam = 3;
      world.lord.pose(lp); lp._posed = true; st.lord = lp;
      st.hat = { on: false, pos: [-30, 30, 0], rot: [0, 0, 0] };
      st.line.on = false; st.rod.tension = 0;
      OCEAN.uRing.value.set(RISE_X, 120, C.splash, 6); OCEAN.uRingB.value.set(32, 18, 0.15, 0);
      OCEAN.uFoam.value[1].set(RISE_X, 100, 130 * smooth((t - C.splash + 0.1) / 0.8) + 1, smooth((t - C.splash + 0.2) / 0.3));
      OCEAN.uFoam.value[2].set(RISE_X, 0, 40, 1 - smooth((t - C.splash) / 1.0));
      const sh = shake(t, 4 * smooth((t - C.splash) / 0.15) * Math.exp(-Math.max(0, t - C.splash) * 1.5), 8);
      const cp = V(lerp(-125, -135, u), lerp(12, 10, u), lerp(-30, -34, u)).add(sh);
      lookAt(cam, cp, V(RISE_X, lerp(70, 45, u), lerp(40, 80, u)), 54);
      st.boat = { x: 0, z: 0, heading: 0.3, pitch: kick(t, C.splash + 1.2, 1, 2) * 0.1 };
      st.look.flash = 0.35 * Math.exp(-Math.max(0, t - C.splash) * 6) * (t > C.splash ? 1 : 0);
      st.look.haze = 0.0003;
      break;
    }
    case 'wave': {
      // the swell arrives; the boat climbs, flies off the crest, smacks down
      ringFor(t);
      OCEAN.uCalm.value = 0.3;
      const lift = airLift(t);
      st.boat = { x: 0, z: 0, heading: 0, lift, pitch: t > C.air && t < C.land ? lerp(0.5, -0.15, (t - C.air) / (C.land - C.air)) : 0, pitchMul: 0.8 };
      st.hat = { on: false, pos: [-30, 30, 0], rot: [0, 0, 0] };
      F.uPupil = 0.3; F.uEyeOpen = 1; F.uSweat = 1;
      P.lean = -0.4 + 0.3 * Math.sin(tc * 9) * (t > C.air && t < C.land ? 1 : 0.2); P.headPitch = 0.2;
      P.handR = V(0.3, 0.6, 0.05); P.handL = V(0.22, 0.78, -0.08);
      st.rod.dir = V(0.25, 0.95, 0.1).normalize(); st.line.on = false;
      OCEAN.uFoam.value[0].set(0, 0, 3.5, 0.6);
      const by = oceanHeightAt(0, 0, t) + lift;
      const sh = shake(t, 0.25 + 0.6 * (Math.abs(t - C.land) < 0.3 ? 1 : 0), 10);
      const cp = V(lerp(1.5, -2, u), 0, 13).add(sh);
      cp.y = Math.max(1.6 + by * 0.6, oceanHeightAt(cp.x, cp.z, t) + 1.8);
      lookAt(cam, cp, V(2.5, by * 0.85 + 2.2, 0), 50, 0.06 * Math.sin(t * 2));
      st.look.speed = 0.5 * (t > C.air - 0.5 && t < C.land + 0.3 ? 1 : 0.3);
      st.look.speedC = [0.5, 0.5];
      if (t > C.air - 0.2 && t < C.land) st.marks.push({ type: '!', anchor: 'head', offset: [0, 0.75, 0.25], k: clamp((t - C.air + 0.2) / 0.8), size: 0.8 });
      break;
    }
    case 'catch': {
      // calm again. Reel in... the hat comes up on the hook. Put it on. A fluke waves far away.
      OCEAN.uCalm.value = 0.25;
      st.boat = { x: 0, z: 0, heading: 0 };
      const reel = t < HAT_T1 - 0.35;
      const hp = hookPos(t);
      const on = t > C.hatOn;
      // reeling: left hand cranks a circle around the reel
      const rc = V(0.4, 0.4, 0.07).addScaledVector(ROD_BASE, 0.3).add(V(0, -0.07, 0));
      const ang = tc * 11;
      P.handL = reel ? rc.clone().add(V(0, Math.cos(ang) * 0.07, -0.1 + Math.sin(ang) * 0.07 * 0)).add(V(Math.sin(ang) * 0.07, 0, 0)) : P.handL;
      st.rod.tension = lerp(0.35, 0.15, smooth((t - C.hat + 0.2) / 0.5));
      st.line.end = hp.clone(); st.line.slack = 0;
      F.uEyeOpen = 1; F.uPupil = 0.9;
      if (t > C.hat + 0.2) { F.uEyeMode = 1; F.uBlush = 1; }
      if (!on) {
        // the hat swings in on the line (rod lifted), the left hand catches it, unhooks it,
        // and flips it up into the air - it spins over and lands square on the robot's head
        const sw = Math.sin(t * 5) * 0.15 * (1 - smooth((t - (HAT_T1 - 0.5)) / 0.5));
        const lift = smooth((t - (HAT_T1 - 0.7)) / 0.6) * (1 - smooth((t - HAT_T2) / 0.4));
        st.rod.dir = ROD_BASE.clone().lerp(V(0.42, 0.9, 0.08).normalize(), lift).normalize();
        const ws = Math.sin(t * 9) * 0.02;
        if (t < HAT_T1) {
          st.hat = { on: false, pos: [hp.x, hp.y - 0.18, hp.z], rot: [sw, t * 0.6, 0.3 + sw] };
          // the left hand stops cranking and reaches out for the brim
          const k = smooth((t - (HAT_T1 - 0.35)) / 0.35);
          if (k > 0) P.handL = P.handL.clone().lerp(HAT_GRAB, k);
          P.lean = 0.12 * k; P.headPitch = -0.25 * k; P.headYaw = -0.15 * k;
        } else {
          // held up for a happy look, a little wind-up, then the flick
          const hold = smooth((t - HAT_T1) / 0.3);
          const wind = Math.sin(Math.PI * clamp((t - (HAT_T2 - 0.16)) / 0.2)) * (t < HAT_T2 + 0.04 ? 1 : 0);
          const flick = smooth((t - HAT_T2) / 0.16) * (1 - smooth((t - HAT_T2 - 0.25) / 0.35));
          const H = HAT_GRAB.clone().lerp(V(0.36, 0.78, -0.36), hold).add(V(0, -0.1 * wind + ws, 0)).lerp(V(0.3, 1.02, -0.26), flick);
          P.handL = H;
          P.lean = 0.12 * (1 - hold) - 0.08 * flick; P.headPitch = lerp(-0.25, 0.25, smooth((t - HAT_T2) / 0.3)); P.headYaw = -0.15 * (1 - hold);
          const hatAtRelease = HAT_GRAB.clone().lerp(V(0.36, 0.78, -0.36), 1).add(HAT_HELD);
          if (t < HAT_T2) st.hat = { on: false, local: true, pos: H.clone().add(HAT_HELD).toArray(), rot: [0.15 * Math.sin(t * 7), 0.4, 0.1] };
          else st.hat = { on: false, local: true, pos: hatAtRelease.add(V(0, 0.1, 0)).toArray(), rot: [0, 0.4, 0.1], toss: easeOut(clamp((t - HAT_T2) / (C.hatOn - HAT_T2))) * 0.35 + 0.65 * clamp((t - HAT_T2) / (C.hatOn - HAT_T2)) ** 1.6, apex: 1.0 };
          // the hook is free: the line swings back to the rod tip
          st.line.end = hp.clone().lerp(V(4.4, 1.9, 0.3), smooth((t - HAT_T1 - 0.1) / 0.5)); st.line.slack = 0.15 * smooth((t - HAT_T1) / 0.5);
          if (t > HAT_T2) { F.uEyeMode = 0; F.uEyeOpen = 1; F.uPupil = 1.1; F.uLook = [0, 0.8]; }
        }
      } else {
        st.line.end = V(4.4, 1.9, 0.3); st.line.slack = 0.15;
        // landing: the hat squashes, the head ducks, then everything springs back
        const land = t - C.hatOn;
        st.hat = { on: true, squash: 1 - 0.22 * Math.exp(-land * 9) * Math.cos(land * 26) };
        P.headRoll = 0.1 * Math.sin(land * 6) * Math.exp(-land * 2);
        const settle = smooth(land / 0.35);
        P.headPitch = lerp(0.25, -0.12 * Math.exp(-land * 7), settle);
        P.bob = Math.abs(Math.sin((tc - C.hatOn) * 7)) * 0.03 - 0.05 * Math.exp(-land * 8);
        // wave toward the distant fluke
        const wv = smooth((t - C.farewell - 0.4) / 0.4);
        P.handL = V(lerp(0.4, 0.15, wv), lerp(0.5, 1.05, wv), lerp(-0.1, -0.35, wv)).add(V(0, Math.sin(tc * 12) * 0.06 * wv, Math.cos(tc * 12) * 0.08 * wv));
        P.handL = V(0.36, 0.78, -0.36).lerp(P.handL, smooth(land / 0.4));
        P.headYaw = -0.5 * wv;
        st.marks.push({ type: 'note', anchor: 'head', offset: [0, 0.6, 0.3], k: clamp((t - C.hatOn) / 0.9) });
      }
      if (t > C.farewell - 0.5) { const lp = lordFarewell(t); world.lord.pose(lp); lp._posed = true; st.lord = lp; }
      OCEAN.uFoam.value[1].set(-160, -275, 30, smooth((t - C.farewell) / 0.8));
      OCEAN.uRip.value[0].set(hookPos(C.hat).x, hookPos(C.hat).z, C.hat, 1.5);
      hullFoam(st.boat, 0.3);
      const p = V(lerp(6.4, 5.6, smooth(u)), lerp(1.9, 1.8, u), lerp(3.6, 3.2, smooth(u)));
      lookAt(cam, p, V(lerp(1.2, 0.8, smooth(u)), 1.9, -0.6), 40);
      st.gulls = { center: [-8, -5, -16] };
      st.title = { kind: 'fin', a: ease(t, C.fin, C.fin + 0.6) };
      st.look.fade = ease(t, 38.3, 39.0);
      break;
    }
  }
  return st;
}
