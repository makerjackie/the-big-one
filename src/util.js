// Deterministic helpers: every frame is a pure function of film time.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export class Rng {
  constructor(seed = 1) { this.r = mulberry32(seed); }
  next() { return this.r(); }
  range(a, b) { return a + (b - a) * this.r(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
}
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
export const smoother = (x) => { x = clamp(x); return x * x * x * (x * (x * 6 - 15) + 10); };
export const ease = (t, a, b) => smooth((t - a) / (b - a));       // 0..1 between times a and b
export const easeOut = (x) => { x = clamp(x); return 1 - (1 - x) * (1 - x) * (1 - x); };
export const easeIn = (x) => { x = clamp(x); return x * x * x; };
export const onTwos = (t) => Math.floor(t * 12 + 1e-6) / 12;      // character drawings at 12/s
export const onThrees = (t) => Math.floor(t * 8 + 1e-6) / 8;      // water FX at 8/s
export const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// keyframes [[time, value(s)], ...] with smoothstep easing between keys
export function track(keys, t, e = smooth) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, v0] = keys[i - 1], [t1, v1] = keys[i];
      const u = e((t - t0) / (t1 - t0));
      return Array.isArray(v0) ? v0.map((x, j) => lerp(x, v1[j], u)) : lerp(v0, v1, u);
    }
  }
  return keys[keys.length - 1][1];
}
// a damped spring kick: 0 before t0, overshoots, settles at 0
export const kick = (t, t0, freq = 3, decay = 4) => (t < t0 ? 0 : Math.exp(-(t - t0) * decay) * Math.sin((t - t0) * freq * Math.PI * 2));
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
