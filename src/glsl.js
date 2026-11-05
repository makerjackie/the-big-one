import * as THREE from 'three';

// Uniforms shared by every material: spreading G copies the {value} refs, so one write updates all.
export const G = {
  uTime: { value: 0 },
  uFxTime: { value: 0 },            // film time on threes (drawn water FX)
  uSunDir: { value: new THREE.Vector3(-0.3, 0.62, 0.72).normalize() },
  uKeyDir: { value: new THREE.Vector3(-0.3, 0.62, 0.72).normalize() },   // character key light (anime cheat)
  uSunColor: { value: new THREE.Color('#fff1d6') },
  uShadeTint: { value: new THREE.Color('#8e95d6') },
  uDeepTint: { value: new THREE.Color('#5d5aa0') },
  uBounce: { value: new THREE.Color('#b9e4f0') },
  uSkyTint: { value: new THREE.Color('#ffffff') },
  uUnder: { value: 0 },             // camera is underwater
  uWaterLevel: { value: 0 },
};

export const NOISE = /* glsl */ `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float vnoise3(vec3 p){ vec3 i = floor(p), f = fract(p); vec3 u = f*f*(3.-2.*f);
  float a = mix(mix(hash13(i), hash13(i+vec3(1,0,0)), u.x), mix(hash13(i+vec3(0,1,0)), hash13(i+vec3(1,1,0)), u.x), u.y);
  float b = mix(mix(hash13(i+vec3(0,0,1)), hash13(i+vec3(1,0,1)), u.x), mix(hash13(i+vec3(0,1,1)), hash13(i+vec3(1,1,1)), u.x), u.y);
  return mix(a, b, u.z); }
float fbm2(vec2 p){ float s = 0., a = .5; for(int i = 0; i < 5; i++){ s += a*vnoise(p); p = p*2.03 + vec2(1.7, 9.2); a *= .5; } return s; }
float fbm3(vec3 p){ float s = 0., a = .5; for(int i = 0; i < 4; i++){ s += a*vnoise3(p); p = p*2.07 + vec3(1.7, 9.2, 4.1); a *= .5; } return s; }
`;

export const COMMON = /* glsl */ `
uniform float uTime, uFxTime, uUnder, uWaterLevel;
uniform vec3 uSunDir, uKeyDir, uSunColor, uShadeTint, uDeepTint, uBounce, uSkyTint;
${NOISE}
`;

export const MRT_OUT = /* glsl */ `
layout(location = 0) out vec4 oColor;
layout(location = 1) out vec4 oData;
// data: view normal xy, view depth, material id (0 painted bg, 1..99 inked cel, 100+ cel without ink)
void writeOut(vec3 col, vec3 nView, float viewDepth, float id){
  oColor = vec4(col, id > 0.5 ? 0.0 : 1.0);   // alpha marks painted pixels for the brush pass
  oData = vec4(nView.xy * 0.5 + 0.5, viewDepth, id);
}
`;

export const VERT_STD = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
varying vec3 vNormalV;
varying float vDepth;
void stdVertex(vec3 pos, vec3 nrm, mat4 mm){
  vec4 wp = mm * vec4(pos, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(mm) * nrm);
  vNormalV = normalize(mat3(viewMatrix) * vNormalW);
  vec4 mv = viewMatrix * wp;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;
