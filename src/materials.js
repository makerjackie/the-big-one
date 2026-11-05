import * as THREE from 'three';
import { G, COMMON, MRT_OUT, VERT_STD } from './glsl.js';

// Hand-inked anime cel: two hard tones (cool lavender shadow), a crisp highlight, rim light.
// o.pattern: GLSL run before lighting; may edit col (albedo), gloss, emis, idOut, and read
// vLocal / vLocalN / vUv / vWorld. o.vertex: GLSL that may edit `pos` / `nrm` before stdVertex.
export function celMaterial(o = {}) {
  const u = {
    ...G,
    uColor: { value: new THREE.Color(o.color ?? '#eeeeee') },
    uId: { value: o.id ?? 1 },
    uGloss: { value: o.gloss ?? 0.6 },
    uRim: { value: o.rim ?? 0.6 },
    uEmissive: { value: new THREE.Color(o.emissive ?? '#000000') },
    uShadeMul: { value: o.shadeMul ?? 1 },
    uLitBias: { value: o.litBias ?? 0 },
    uOpacity: { value: 1 },
    ...(o.uniforms ?? {}),
  };
  const decl = Object.keys(o.uniforms ?? {}).map((k) => {
    const v = o.uniforms[k].value;
    const t = typeof v === 'number' ? 'float' : v?.isColor || v?.isVector3 ? 'vec3' : v?.isVector2 ? 'vec2' : v?.isVector4 ? 'vec4' : v?.isMatrix4 ? 'mat4' : v?.isTexture || v === null ? 'sampler2D' : 'float';
    if (Array.isArray(v)) return `uniform vec4 ${k}[${v.length}];`;
    return `uniform ${t} ${k};`;
  }).join('\n');
  const vs = /* glsl */ `
    ${decl}
    uniform float uTime, uFxTime;
    varying vec3 vLocal;
    varying vec3 vLocalN;
    varying vec2 vUv;
    varying vec3 vInstColor;
    ${VERT_STD}
    void main(){
      vec3 pos = position; vec3 nrm = normal;
      vUv = uv;
      ${o.vertex ?? ''}
      vLocal = pos; vLocalN = nrm;
      mat4 mm = modelMatrix;
      #ifdef USE_INSTANCING
      mm = modelMatrix * instanceMatrix;
      #endif
      #ifdef USE_INSTANCING_COLOR
      vInstColor = instanceColor;
      #else
      vInstColor = vec3(1.0);
      #endif
      stdVertex(pos, nrm, mm);
    }
  `;
  const fs = /* glsl */ `
    ${COMMON}
    ${MRT_OUT}
    ${decl}
    uniform vec3 uColor, uEmissive;
    uniform float uId, uGloss, uRim, uShadeMul, uLitBias, uOpacity;
    varying vec3 vWorld, vNormalW, vNormalV, vLocal, vLocalN;
    varying float vDepth;
    varying vec2 vUv;
    varying vec3 vInstColor;
    ${o.fsHead ?? ''}
    void main(){
      vec3 N = normalize(vNormalW);
      vec3 NV = normalize(vNormalV);
      if(!gl_FrontFacing){ N = -N; NV = -NV; }
      vec3 col = uColor;
      col *= vInstColor;
      float gloss = uGloss;
      vec3 emis = uEmissive;
      float idOut = uId;
      float litBias = uLitBias;
      float shadeMul = uShadeMul;
      vec3 shadeTint = uShadeTint;
      vec3 litMul = mix(uSkyTint, uSunColor, 0.75) * 1.04;
      float specK = 1.0;
      float specTh = 0.975;
      { ${o.pattern ?? ''} }
      float ndl = dot(N, uKeyDir) + litBias;
      float lit = smoothstep(-0.02, 0.04, ndl);
      vec3 litCol = col * litMul;
      float up = smoothstep(-0.8, 0.7, N.y);
      vec3 shadeCol = col * mix(shadeTint, shadeTint * 0.75 + uBounce * 0.4, 1.0 - up) * shadeMul;
      vec3 outc = mix(shadeCol, litCol, lit);
      float deep = step(ndl, -0.6) * step(N.y, -0.4);
      outc = mix(outc, col * uDeepTint, deep * 0.6);
      vec3 V = normalize(cameraPosition - vWorld);
      vec3 H = normalize(uKeyDir + V);
      float spec = step(specTh, dot(N, H)) * lit * gloss * specK;
      outc = mix(outc, vec3(1.0, 0.99, 0.95) * 1.06, spec);
      // rim: thin bright edge facing the light from behind
      float fres = 1.0 - max(dot(N, V), 0.0);
      float rimL = smoothstep(0.72, 0.76, fres) * smoothstep(-0.3, 0.3, dot(N, uKeyDir) + 0.3) * uRim;
      outc = mix(outc, mix(col, vec3(1.0), 0.7) * 1.1, rimL * 0.7);
      // underwater: caustic net on surfaces, cooler tone
      if(uUnder > 0.5){
        vec2 q = vWorld.xz * 0.12 + vec2(uFxTime * 0.3, uFxTime * 0.2);
        float c = vnoise(q * 3.0) * vnoise(q * 3.7 + 4.0);
        outc *= vec3(0.62, 0.86, 0.98);
        outc += vec3(0.5, 0.9, 1.0) * smoothstep(0.32, 0.38, c) * 0.35 * smoothstep(-0.2, 0.6, N.y);
      }
      outc += emis;
      writeOut(outc, NV, vDepth, idOut);
    }
  `;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3, uniforms: u, vertexShader: vs, fragmentShader: fs,
    side: o.side ?? THREE.FrontSide,
  });
}

// Overlay sprites: drawn after atmosphere onto the composited image (glows, flashes, marks).
export function overlayMaterial(o = {}) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: { uTex: { value: o.map ?? null }, uColor: { value: new THREE.Color(o.color ?? '#ffffff') }, uOpacity: { value: o.opacity ?? 1 } },
    vertexShader: `
      varying vec2 vUv;
      void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform sampler2D uTex; uniform vec3 uColor; uniform float uOpacity;
      varying vec2 vUv; out vec4 oc;
      void main(){ vec4 t = texture(uTex, vUv); oc = vec4(t.rgb * uColor, t.a * uOpacity); if(oc.a < 0.003) discard; }`,
    transparent: true, depthTest: false, depthWrite: false,
    blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
}
