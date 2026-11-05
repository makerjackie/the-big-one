import * as THREE from 'three';
import { Engine } from './engine.js';
import { G } from './glsl.js';
import { makeSky } from './sky.js';
import { makeOcean, OCEAN } from './ocean.js';
import { makeWorld } from './world.js';
import { direct } from './director.js';
import { FPS, DURATION } from './shots.js';
import { onThrees } from './util.js';
import { Player } from './player.js';
import { renderScore } from './audio.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') ?? 1920), H = +(q.get('h') ?? 1038), S = +(q.get('scale') ?? 1);

const canvas = document.getElementById('film');
canvas.width = W; canvas.height = H;
const engine = new Engine(canvas, W, H, S);
const scene = new THREE.Scene();
const overlay = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, W / H, 0.3, 12000);
const sky = makeSky(scene);
const ocean = makeOcean(scene);
const world = makeWorld({ scene, overlay, camera });
const title = document.getElementById('titles');
const tctx = title.getContext('2d');
title.width = W; title.height = H;

function renderAt(t) {
  t = Math.max(0, Math.min(DURATION - 1e-4, t));
  G.uTime.value = t;
  G.uFxTime.value = onThrees(t);
  OCEAN.uWT.value = Math.floor(t * 12) / 12;
  const st = direct(t, world, camera);
  G.uUnder.value = st.under ? 1 : 0;
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  sky.update(st, camera);
  ocean.update(st, camera);
  world.update(st, camera);
  engine.render(scene, overlay, camera, { ...st.look, frame: Math.round(t * FPS) });
  world.drawTitles(tctx, W, H, st);
  return st;
}

window.renderAt = renderAt; window.world = world; window.cam = camera;
window.renderScore = renderScore;
window.FILM = { DURATION, FPS, W, H };
// compile every shader the film will need up front, so playback never hitches on a first use
for (const t of [17.5, 23.5, 27.0, 30.9, 33.5, 37.5]) renderAt(t);
const player = new Player({ renderAt, canvas, DURATION, still: q.has('still'), start: +(q.get('t') ?? 0), makeScore: async (sr) => renderScore(sr) });
window.player = player;
window.__ready = true;
