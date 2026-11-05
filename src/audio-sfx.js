// Sound department — the effects track of THE BIG ONE, cue by cue.
// Above water goes to G.sfx (open-air room, muffled by the master while the picture is under);
// in-the-water sounds go to G.under (dark closed room, never muffled). Every time hangs off CUES.
import { SR, TAU, Noise, bubble, noiseBurst, pwl, clamp, smooth } from './audio-dsp.js';
import { K, tex, tone, grains, putGr, put1, impact, splash, boil, whale, friction, FLESH, creak, gull, slap, ratchet, plip, bloop, gulp, pomf, beep, clank, whoosh } from './audio-sfxlib.js';

export function buildSfx(C, G, N, DURATION) {
  let seed = 500; const S = () => ++seed;
  const report = [], cue = (t, l) => report.push([+t.toFixed(3), 'SFX', l]);
  const A = G.sfx, U = G.under, END = DURATION;
  const { reel, tow, below, eye, look, calm, bubbles, rise, hatOff, peak, blink, topple, splash: spl, wave, air, land, hat, hatOn, farewell, fin } = C;

  // ============================================================ the sea, all film long
  // level of the open-sea wash (instant steps on the cuts to and from underwater)
  const SEA = [[0, 0], [0.8, 0.9], [reel, 0.9], [tow, 0.5], [below - 0.001, 0.5], [below, 0], [calm - 0.001, 0], [calm, 0.4], [bubbles, 0.36], [rise, 0.3], [rise + 0.6, 0], [spl + 2.5, 0], [wave, 0.35], [air, 0.2], [land, 0.7], [land + 1.2, 0.8], [fin, 0.75], [END - 0.2, 0.5], [END, 0]];
  const sea = (t) => pwl(SEA, t);
  const swell = (t) => 0.62 + 0.38 * Math.sin(0.9 * t + 1.3 * Math.sin(0.37 * t));
  tex(A, { t0: 0, t1: END, seed: S(), color: 'p', mode: 'lp', f: (t) => 420 + 380 * swell(t), q: 0.6, g: (t) => 0.32 * sea(t) * swell(t), width: 0.9, send: 0.25 });
  tex(A, { t0: 0, t1: END, seed: S(), color: 'w', mode: 'hp', f: 3800, g: (t) => 0.04 * sea(t) * swell(t + 0.4) ** 2, width: 1, send: 0.3 });
  // lapping at the hull
  const LAP = [[0, 0.6], [reel, 1.0], [tow, 0], [calm - 0.001, 0], [calm, 0.8], [rise, 0.8], [rise + 0.5, 0], [land, 0], [land + 0.3, 1.5], [hat, 1.0], [END, 0.8]];
  const LAPG = [[0, 0.7], [calm, 0.7], [calm + 0.01, 0.42], [rise, 0.5], [land, 1], [END - 0.3, 0.6], [END, 0]];
  const lapG = grains(0.2, END - 0.3, (t) => 1.6 * pwl(LAP, t) + 0.01, (s, at, r, t, pan, pg) => slap(s, at, r, 0.12 * pg * pwl(LAPG, t) * (pwl(LAP, t) > 0.02 ? 1 : 0)), S(), 0.4);
  putGr(A, lapG, { gain: 1, send: 0.2 });
  // the boat rocking
  [2.1, 4.4, 6.9].forEach((t, i) => creak(A, t, { dur: 0.55, gain: 0.07, pan: -0.15 + i * 0.1, seed: S(), pitch: 1 + i * 0.07 }));
  // gulls far off in the summer sky
  gull(A, 1.4, { pan: -0.6, calls: 2, seed: S(), gain: 0.022 });
  gull(A, 3.3, { pan: 0.55, calls: 3, pitch: 1.08, seed: S(), gain: 0.016 });
  gull(A, 6.7, { pan: -0.25, calls: 1, pitch: 0.95, seed: S(), gain: 0.012 });
  gull(A, land + 1.2, { pan: 0.6, calls: 2, pitch: 1.04, seed: S(), gain: 0.014 });
  gull(A, fin + 0.5, { pan: -0.5, calls: 2, pitch: 1.1, seed: S(), gain: 0.012, send: 0.8 });
  cue(0, 'sea wash, hull lapping, gulls, creaks');

  // ============================================================ nibble / bite / jolt
  plip(A, C.nibble, { f: 1250, gain: 0.22, pan: 0.1, seed: S() }); plip(A, C.nibble + 0.13, { f: 900, gain: 0.1, pan: 0.12, seed: S() });
  cue(C.nibble, 'nibble: plip');
  bloop(A, C.bite, { f: 140, gain: 0.55, pan: 0.1, seed: S() });
  splash(A, C.bite + 0.01, { size: 0.25, gain: 0.5, pan: 0.1, seed: S(), thump: 0.3 });
  cue(C.bite, 'bite: deep bloop');
  // jolt: slide whistle "fwee!" and the robot clanks against the boat
  tone(A, { t0: C.jolt - 0.12, t1: C.jolt + 0.2, h: [1, 0.06], f: (x) => 600 * Math.pow(4.2, smooth((x - C.jolt + 0.12) / 0.3)), g: (x) => 0.07 * Math.sin(Math.PI * clamp((x - C.jolt + 0.12) / 0.32)) ** 0.5, pan: () => -0.1, send: 0.3 });
  clank(A, C.jolt, { f: 760, gain: 0.16, pan: -0.05, seed: S() });
  impact(A, C.jolt + 0.01, { size: 0.12, f0: 160, f1: 90, body: 600, crack: 3000, seed: S(), gain: 0.35, dur: 0.4 });
  cue(C.jolt, 'jolt: slide whistle + clank');

  // ============================================================ reel screams, boat is towed
  const rate = (t) => (t < reel ? 0 : 22 + 120 * smooth((t - reel) / 0.9) + 14 * Math.sin(TAU * 3.1 * t));
  const ramp = (t) => (t < tow ? 0.5 + 0.5 * smooth((t - reel) / 0.6) : 0.55 - 0.25 * smooth((t - tow) / 2.5));
  ratchet(A, reel, below, rate, ramp, { gain: 0.5, pan: 0.15, seed: S(), send: 0.12 });
  // drag whine and line hiss
  tone(A, { t0: reel + 0.15, t1: below, h: [1, 0.3, 0.12], jit: 0.01, f: (t) => 1900 + 700 * smooth((t - reel) / 1.6), g: (t) => 0.012 * smooth((t - reel - 0.15) / 0.8) * (t < tow ? 1 : 0.6), pan: () => 0.15, send: 0.15 });
  tex(A, { t0: reel, t1: below, seed: S(), color: 'w', mode: 'bp', q: 2, f: 3400, g: (t) => 0.06 * smooth((t - reel) / 0.5) * (t < tow ? 1 : 0.5), pan: () => 0.25, send: 0.1 });
  // the boat lurches
  creak(A, reel + 0.05, { dur: 0.7, gain: 0.16, r0: 40, r1: 90, seed: S() });
  splash(A, reel + 0.1, { size: 0.45, gain: 0.5, pan: -0.2, seed: S(), thump: 0.6 });
  whoosh(A, reel + 0.05, { f: [[0, 400], [0.5, 1400], [1.2, 900]], g: [[0, 0], [0.3, 0.2], [1.2, 0]], seed: S(), color: 'p', q: 0.7 });
  cue(reel, 'reel: ratchet scream, drag whine, lurch');
  // TOW: rushing wake and spray, hull bouncing on the chop (keeps going, muffled, while we are under)
  const WK = [[reel + 0.6, 0], [tow, 0.9], [below - 0.3, 1], [below, 0.8], [calm - 0.3, 0.5], [calm, 0]];
  tex(A, { t0: reel + 0.6, t1: calm, seed: S(), color: 'p', mode: 'bp', q: 0.55, f: (t) => 900 + 400 * swell(t * 3), g: (t) => 0.75 * pwl(WK, t) * (0.8 + 0.2 * swell(t * 4)), pan: K([[tow, -0.4], [below, 0.4]]), width: 0.8, send: 0.2 });
  tex(A, { t0: tow - 0.3, t1: calm, seed: S(), color: 'w', mode: 'hp', f: 3000, g: (t) => 0.1 * pwl(WK, t) * swell(t * 5) ** 2, width: 1, send: 0.25 });
  tex(A, { t0: tow - 0.3, t1: calm, seed: S(), color: 'b', mode: 'lp', f: 220, g: (t) => 0.35 * pwl(WK, t), width: 0.6, send: 0.05 });
  const hullG = grains(tow, below, () => 3.2, (s, at, r) => {
    const nz = new Noise(at + 5);
    noiseBurst(s, at, { a: 0.004, tau: 0.05, f0: 700, f1: 300, q: 0.8, amp: r.range(0.25, 0.5) }, nz);
    noiseBurst(s, at, { a: 0.002, tau: 0.06, f0: 140, q: 1.2, mode: 'lp', amp: r.range(0.5, 0.9) }, nz);
  }, S(), 0.4);
  putGr(A, hullG, { gain: 0.6, send: 0.15 });
  cue(tow, 'tow: wake rush, spray, hull slaps');

  // ============================================================ below: the world under the boat
  impact(U, below, { size: 0.5, f0: 80, f1: 38, body: 220, crack: 600, crackA: 0.2, seed: S(), gain: 0.7, send: 0.4 });
  boil(U, below, below + 0.5, (t) => 90 * (1 - (t - below) / 0.5) + 5, { lo: 180, hi: 1300, seed: S(), gain: 0.9, send: 0.4 });
  const UND = [[below, 0], [below + 0.15, 1], [calm - 0.25, 1], [calm, 0]];
  tex(U, { t0: below, t1: calm, seed: S(), color: 'b', mode: 'lp', f: 260, g: (t) => 0.32 * pwl(UND, t), width: 0.8, send: 0.4 });
  tex(U, { t0: below, t1: calm, seed: S(), color: 'b', mode: 'lp', f: 70, g: (t) => 0.45 * pwl(UND, t), width: 0.3, send: 0.1 });
  boil(U, below + 0.4, calm - 0.2, () => 5, { lo: 200, hi: 1600, seed: S(), gain: 0.35, send: 0.5 });
  // the eye glides past: a slow deep displacement of water, left to right
  tex(U, { t0: eye - 0.4, t1: calm - 0.1, seed: S(), color: 'p', mode: 'lp', q: 0.9, f: K([[eye - 0.4, 90], [eye + 0.6, 320], [calm - 0.1, 110]]), g: K([[eye - 0.4, 0], [eye + 0.5, 0.7], [look + 0.4, 0.55], [calm - 0.1, 0]]), pan: K([[eye - 0.4, -0.8], [calm, 0.7]]), width: 0.5, send: 0.4 });
  // whale song: a long low moan as it passes, then a rising "hm?" as the eye turns up
  put1(U, eye, whale([[0, 62], [0.5, 84], [1.1, 92], [1.6, 74], [2.0, 56]], [[0, 0], [0.4, 0.7], [1.4, 1], [2.0, 0]], { f1: 240, f2: 560, f3: 1200, gain: 0.3, rough: 0.4 }, S()), { gain: 1, pan: -0.2, send: 0.6 });
  put1(U, look, whale([[0, 58], [0.45, 96], [0.8, 128], [1.1, 118]], [[0, 0], [0.25, 0.8], [0.8, 1], [1.1, 0]], { f1: 260, f2: 620, f3: 1300, gain: 0.26, rough: 0.5 }, S()), { gain: 1, pan: 0.15, send: 0.6 });
  put1(U, look, friction(0.8, { modes: FLESH(1), rate: (u) => 18 + 30 * Math.sin(Math.PI * u), env: (u) => Math.sin(Math.PI * u), gain: 0.5, drive: 1.5 }, S()), { gain: 0.25, pan: 0.1, send: 0.4 });
  cue(below, 'below: plunge, underwater rumble, bubbles'); cue(eye, 'eye: displacement swell + whale moan'); cue(look, 'look: rising whale call, wet creak');

  // ============================================================ calm: the held breath
  // the line goes slack: a little descending twang
  tone(A, { t0: calm + 0.05, t1: calm + 0.6, h: [1, 0.4, 0.15], jit: 0.004, f: (x) => 540 - 170 * smooth((x - calm) / 0.5) + 14 * Math.sin(TAU * 9 * (x - calm)), g: (x) => 0.03 * Math.exp(-(x - calm - 0.05) / 0.16) * Math.min(1, (x - calm - 0.05) / 0.005), pan: () => 0.2, send: 0.3 });
  creak(A, calm + 0.7, { dur: 0.5, gain: 0.04, seed: S(), pitch: 1.1 });
  // bubbles boil up around the boat, a rumble grows under them
  const bu = (t) => clamp((t - bubbles) / (rise - bubbles));
  boil(A, bubbles, rise - 0.05, (t) => 4 + 70 * bu(t) ** 1.6, { lo: 110, hi: 650, seed: S(), gain: 0.55, rise: 0.35, amp: (t) => 0.5 + 0.6 * bu(t), send: 0.3 });
  boil(A, bubbles + 0.3, rise - 0.05, (t) => 2 + 40 * bu(t) ** 2, { lo: 700, hi: 1800, seed: S(), gain: 0.25, send: 0.3 });
  tex(A, { t0: bubbles, t1: rise + 0.05, seed: S(), color: 'b', mode: 'lp', f: (t) => 60 + 120 * bu(t), g: (t) => 1.4 * bu(t) ** 2.2, width: 0.4, send: 0.05 });
  tex(A, { t0: bubbles + 0.4, t1: rise + 0.05, seed: S(), color: 'p', mode: 'bp', q: 0.7, f: (t) => 300 + 500 * bu(t), g: (t) => 0.25 * bu(t) ** 3, width: 0.9, send: 0.2 });
  cue(bubbles, 'bubbles: boiling blips, rumble grows');

  // ============================================================ RISE: the Lord of the Sea
  impact(A, rise, { size: 1.4, f0: 100, f1: 36, body: 300, crack: 1800, crackT: 0.03, seed: S(), gain: 0.9, send: 0.3 });
  splash(A, rise + 0.03, { size: 1.6, gain: 0.8, seed: S(), hi: 2200 });
  const RR = [[rise, 0], [rise + 0.25, 1], [peak, 1.1], [peak + 0.8, 0.9], [blink, 0.4], [C.gulp, 0.2], [topple, 0.25], [spl - 0.2, 0.5], [spl, 0]];
  const rr = (t) => pwl(RR, t);
  tex(A, { t0: rise, t1: spl, seed: S(), color: 'b', mode: 'lp', f: (t) => 120 + 60 * swell(t * 2), g: (t) => 1.6 * rr(t), width: 0.7, send: 0.15 });
  tex(A, { t0: rise, t1: spl, seed: S(), color: 'p', mode: 'bp', q: 0.5, f: (t) => 500 + 250 * swell(t * 1.7), g: (t) => 0.75 * rr(t), width: 0.9, send: 0.3 });
  tex(A, { t0: rise + 0.1, t1: spl, seed: S(), color: 'w', mode: 'hp', f: 2600, g: (t) => 0.1 * rr(t) * (0.7 + 0.3 * swell(t * 3)), width: 1, send: 0.35 });
  // cascades: masses of water falling off the body
  const casc = grains(rise + 0.3, blink + 0.6, (t) => (t < peak + 0.8 ? 7 : 3), (s, at, r, t) => {
    const nz = new Noise(at + 9), a = r.range(0.4, 1) * (t > peak + 0.8 ? 0.5 : 1);
    noiseBurst(s, at, { a: r.range(0.02, 0.06), tau: r.range(0.15, 0.35), f0: r.range(90, 180), q: 0.8, mode: 'lp', amp: a * 1.2 }, nz);
    noiseBurst(s, at, { a: 0.01, tau: r.range(0.1, 0.25), f0: r.range(900, 1600), f1: 500, q: 0.7, amp: a * 0.3 }, nz);
  }, S(), 0.8);
  putGr(A, casc, { gain: 0.8, send: 0.3 });
  // the hat is blown away
  whoosh(A, hatOff - 0.05, { f: [[0, 500], [0.18, 2800], [0.55, 1300]], g: [[0, 0], [0.12, 0.55], [0.55, 0]], pan: [[0, -0.5], [0.55, 0.9]], flutter: 0.6, flutterHz: 24, seed: S(), q: 1.2, send: 0.3 });
  whoosh(A, hatOff - 0.02, { f: [[0, 2000], [0.3, 5200], [0.5, 3000]], g: [[0, 0], [0.1, 0.12], [0.5, 0]], pan: [[0, -0.3], [0.5, 0.9]], seed: S(), q: 2.0 });
  // the surge as it reaches full height
  impact(A, peak, { size: 0.7, f0: 80, f1: 36, body: 250, crack: 1200, crackA: 0.3, seed: S(), gain: 0.5, send: 0.3 });
  // heavy drips and rain off the giant
  const drips = grains(peak + 0.3, topple + 0.3, () => 9, (s, at, r) => bubble(s, at, r.range(350, 1300), r.range(0.03, 0.08), 0.2), S(), 0.3);
  putGr(A, drips, { gain: 0.6, send: 0.35 });
  cue(rise, 'rise: impact, eruption, roaring water'); cue(hatOff, 'hatOff: flutter whoosh'); cue(peak, 'peak: surge');

  // ============================================================ blink / gulp
  // the deep warm call, and the wet low thud of a lid the size of a house
  put1(A, blink - 0.15, whale([[0, 50], [0.35, 58], [0.9, 53], [1.3, 46]], [[0, 0], [0.3, 0.9], [0.9, 0.7], [1.3, 0]], { f1: 220, f2: 520, f3: 1100, gain: 0.55, rough: 0.35 }, S()), { gain: 1, pan: 0, send: 0.4 });
  impact(A, blink, { size: 0.5, f0: 75, f1: 38, body: 180, crack: 500, crackA: 0.15, bodyT: 0.08, seed: S(), gain: 0.6, send: 0.2 });
  tex(A, { t0: blink, t1: blink + 0.16, seed: S(), color: 'w', mode: 'bp', q: 2.5, f: K([[blink, 420], [blink + 0.16, 160]]), g: (x) => 0.35 * Math.exp(-(x - blink) / 0.05), send: 0.1 });
  tex(A, { t0: blink + 0.3, t1: blink + 0.48, seed: S(), color: 'w', mode: 'bp', q: 3, f: K([[blink + 0.3, 180], [blink + 0.48, 520]]), g: (x) => 0.18 * Math.sin(Math.PI * clamp((x - blink - 0.3) / 0.18)), send: 0.1 });
  cue(blink, 'blink: whale call + wet thud');
  gulp(A, C.gulp, { gain: 0.42, pan: 0.05 });
  ping1(A, C.gulp + 0.42, 2600, 0.05);          // the sweat drop
  cue(C.gulp, 'gulp: cartoon gulp + sweat drop tink');

  // ============================================================ topple and the giant splash
  put1(A, topple, friction(1.2, { modes: FLESH(0.8), rate: (u) => 12 + 25 * u, env: (u) => Math.sin(Math.PI * Math.min(1, u * 1.2)), gain: 0.5, drive: 1.6 }, S()), { gain: 0.25, pan: -0.1, send: 0.4 });
  const fall = (t) => clamp((t - topple) / (spl - topple));
  tex(A, { t0: topple, t1: spl, seed: S(), color: 'p', mode: 'lp', q: 0.8, f: (t) => 150 + 900 * fall(t) ** 2, g: (t) => 0.9 * fall(t) ** 2.2, pan: K([[topple, -0.3], [spl, 0.3]]), width: 0.7, send: 0.3 });
  tex(A, { t0: topple + 0.6, t1: spl, seed: S(), color: 'w', mode: 'bp', q: 0.7, f: (t) => 800 + 2400 * fall(t) ** 2, g: (t) => 0.14 * fall(t) ** 3, width: 1, send: 0.3 });
  impact(A, spl, { size: 1.5, f0: 95, f1: 34, body: 280, crack: 1600, crackT: 0.04, seed: S(), gain: 1, send: 0.3 });
  splash(A, spl, { size: 2.4, gain: 0.9, seed: S(), hi: 2400 });
  tex(A, { t0: spl, t1: spl + 3, seed: S(), color: 'b', mode: 'lp', f: 300, g: (x) => 2.2 * Math.exp(-(x - spl) / 0.7) * Math.min(1, (x - spl) / 0.02), width: 0.8, send: 0.2 });
  tex(A, { t0: spl, t1: spl + 2.2, seed: S(), color: 'p', mode: 'bp', q: 0.5, f: K([[spl, 1500], [spl + 2.2, 600]]), g: (x) => 0.9 * Math.exp(-(x - spl) / 0.45) * Math.min(1, (x - spl) / 0.01), width: 1, send: 0.35 });
  // the rain-down tail
  const rain = grains(spl + 0.4, wave + 1.2, (t) => 160 * Math.exp(-(t - spl - 0.4) / 1.0) + 6, (s, at, r) => {
    if (r.next() < 0.5) bubble(s, at, r.range(900, 3000), r.range(0.01, 0.04), 0.15);
    else noiseBurst(s, at, { a: 0.0008, tau: r.range(0.003, 0.01), f0: r.range(2000, 6000), q: 1, amp: r.range(0.05, 0.15) }, new Noise(at));
  }, S(), 0.2);
  putGr(A, rain, { gain: 0.6, send: 0.3 });
  tex(A, { t0: spl + 0.3, t1: wave + 1.4, seed: S(), color: 'w', mode: 'hp', f: 4500, g: (x) => 0.08 * Math.exp(-(x - spl - 0.3) / 1.2) * Math.min(1, (x - spl - 0.3) / 0.3), width: 1, send: 0.3 });
  cue(topple, 'topple: groan + falling air'); cue(spl, 'splash: giant crash, sub thump, rain tail');

  // ============================================================ wave, air, land
  const up = (t) => clamp((t - wave) / (air - wave));
  tex(A, { t0: wave - 0.2, t1: air + 0.02, seed: S(), color: 'p', mode: 'bp', q: 0.7, f: (t) => 400 + 2200 * up(t) ** 1.5, g: (t) => 0.15 + 0.85 * up(t) ** 1.5, pan: K([[wave, -0.3], [air, 0.3]]), width: 0.9, send: 0.25 });
  tex(A, { t0: wave, t1: air + 0.02, seed: S(), color: 'b', mode: 'lp', f: 180, g: (t) => 0.8 * Math.sin(Math.PI * up(t) * 0.9), width: 0.5, send: 0.05 });
  tex(A, { t0: wave + 0.4, t1: air + 0.02, seed: S(), color: 'w', mode: 'hp', f: (t) => 2000 + 3000 * up(t), g: (t) => 0.12 * up(t) ** 2, width: 1, send: 0.3 });
  creak(A, wave + 0.3, { dur: 0.8, gain: 0.12, r0: 30, r1: 70, seed: S() });
  // airborne: only the wind in the line
  tex(A, { t0: air, t1: land, seed: S(), color: 'w', mode: 'bp', q: 5, f: K([[air, 1300], [land, 1700]]), g: K([[air, 0], [air + 0.25, 0.04], [land, 0.01]]), pan: () => 0.2, send: 0.4 });
  // LAND: the smack
  impact(A, land, { size: 0.75, tau: 0.16, dur: 0.9, f0: 150, f1: 60, body: 500, crack: 3200, crackT: 0.018, crackA: 1.2, seed: S(), gain: 0.85, send: 0.25 });
  splash(A, land + 0.005, { size: 0.6, gain: 1.0, seed: S(), hi: 3000 });
  noiseBurst2(A, land, { a: 0.0015, tau: 0.03, f0: 1800, q: 0.6, mode: 'hp', amp: 0.8 }, 0.7);
  creak(A, land + 0.02, { dur: 0.35, gain: 0.2, r0: 80, r1: 120, seed: S() });
  clank(A, land + 0.03, { f: 690, gain: 0.18, seed: S() });
  clank(A, land + 0.16, { f: 880, gain: 0.08, seed: S(), pan: 0.2 });
  // settling: a few bounces of water, rocking creaks
  [0.5, 1.1].forEach((d, i) => splash(A, land + d, { size: 0.2 - i * 0.05, gain: 0.4, seed: S(), thump: 0.3, pan: i ? 0.3 : -0.3 }));
  creak(A, land + 0.8, { dur: 0.6, gain: 0.07, seed: S() }); creak(A, hat - 0.2, { dur: 0.6, gain: 0.05, seed: S(), pitch: 1.1 });
  cue(wave, 'wave: rushing climb'); cue(air, 'air: near silence, wind'); cue(land, 'land: smack, splash, clank');

  // ============================================================ the hat comes back
  const reelIn = land + (hat - land) * 0.4;
  ratchet(A, reelIn, hat + 0.15, (t) => 9 + 4 * Math.sin(TAU * 1.3 * (t - reelIn)), (t) => 0.25 * smooth((t - reelIn) / 0.2), { gain: 0.5, pan: 0.15, seed: S(), bright: 0.9 });
  ratchet(A, hat + 0.5, hatOn - 0.15, () => 11, (t) => 0.18, { gain: 0.45, pan: 0.15, seed: S(), bright: 0.9 });
  splash(A, hat, { size: 0.22, gain: 0.45, seed: S(), thump: 0.2, pan: 0.1 });
  const hd = grains(hat + 0.1, hatOn - 0.1, () => 7, (s, at, r) => bubble(s, at, r.range(900, 2200), r.range(0.03, 0.07), 0.25), S(), 0.2);
  putGr(A, hd, { gain: 0.5, send: 0.3 });
  pomf(A, hatOn, { gain: 0.32 });
  beep(A, hatOn + 0.2, [[0, 1320, 0.06], [0.08, 1760, 0.09]], { gain: 0.03, pan: 0.05 });
  cue(hat, 'hat: reel clicks, little sploosh, drips'); cue(hatOn, 'hatOn: pomf + happy beep');
  // farewell: far away, the Lord's fluke and a deep "moo"
  put1(A, farewell, whale([[0, 92], [0.25, 110], [0.7, 112], [1.1, 98], [1.4, 82]], [[0, 0], [0.25, 0.8], [0.8, 1], [1.4, 0]], { f1: 300, f2: 760, f3: 1600, gain: 0.32, rough: 0.3 }, S()), { gain: 0.45, pan: 0.45, send: 1.4 });
  splash(A, farewell + 1.0, { size: 0.5, gain: 0.12, seed: S(), pan: 0.5, thump: 0.5 });
  cue(farewell, 'farewell: distant whale moo, far splash');
  return report;

  function ping1(G, t, f, g) { const b = new Float32Array(Math.round(0.4 * SR)); bubble(b, 0, f, 1, 0.05); put1(G, t, b, { gain: g, pan: 0.15, send: 0.3 }); }
  function noiseBurst2(G, t, o, g) { const b = new Float32Array(Math.round((o.a + o.tau * 7) * SR) + 1); noiseBurst(b, 0, o, new Noise(S())); put1(G, t, b, { gain: g, send: 0.2 }); }
}
