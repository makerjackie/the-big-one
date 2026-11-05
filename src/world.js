import * as THREE from 'three';
import { celMaterial } from './materials.js';
import { makeBoat } from './boat.js';
import { makeRobot } from './robot.js';
import { makeLord } from './lord.js';
import { makeFx } from './fx.js';
import { makeGulls } from './gulls.js';
import { makeSchool } from './school.js';
import { CUES } from './shots.js';
import { clamp, smooth, easeOut } from './util.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// ---- rod + line: rebuilt each frame
function makeTackle(scene) {
  const rodMat = celMaterial({
    color: '#26324f', id: 50, gloss: 1.0,
    pattern: 'if(vUv.x < 0.12) { col = vec3(0.78, 0.6, 0.4); idOut = 51.0; } if(fract(vUv.x * 9.0) < 0.04 && vUv.x > 0.12) col = vec3(0.9, 0.75, 0.3);',
  });
  const NS = 24, NR = 6;
  const rodGeo = new THREE.BufferGeometry();
  const rp = new Float32Array((NS + 1) * NR * 3), ru = new Float32Array((NS + 1) * NR * 2);
  const ri = [];
  for (let i = 0; i < NS; i++) for (let k = 0; k < NR; k++) { const a = i * NR + k, b = i * NR + ((k + 1) % NR), c = a + NR, d = b + NR; ri.push(a, c, b, b, c, d); }
  for (let i = 0; i <= NS; i++) for (let k = 0; k < NR; k++) { ru[(i * NR + k) * 2] = i / NS; ru[(i * NR + k) * 2 + 1] = k / NR; }
  rodGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
  rodGeo.setAttribute('uv', new THREE.BufferAttribute(ru, 2));
  rodGeo.setIndex(ri);
  const rod = new THREE.Mesh(rodGeo, rodMat); rod.frustumCulled = false; scene.add(rod);
  const reel = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16).rotateX(Math.PI / 2), celMaterial({ color: '#c9ced8', id: 52, gloss: 1 }));
  scene.add(reel);
  // line: a camera-facing ribbon
  const NL = 40;
  const lineGeo = new THREE.BufferGeometry();
  const lp = new Float32Array((NL + 1) * 2 * 3);
  const li = []; for (let i = 0; i < NL; i++) { const a = i * 2; li.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  lineGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lineGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(lp.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  lineGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((NL + 1) * 4), 2));
  lineGeo.setIndex(li);
  const line = new THREE.Mesh(lineGeo, celMaterial({ color: '#f7f7ff', id: 102, side: THREE.DoubleSide, pattern: 'litBias = 2.0; emis = vec3(0.15);' }));
  line.frustumCulled = false; scene.add(line);
  const bobber = new THREE.Group();
  const bm = celMaterial({ color: '#ffffff', id: 53, gloss: 1, pattern: 'col = vLocal.y > 0.0 ? vec3(1.0, 0.18, 0.15) : vec3(0.98, 0.98, 0.95); if(abs(vLocal.y) < 0.006) col = vec3(0.1);' });
  bobber.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 20, 14), bm));
  const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), celMaterial({ color: '#ffe04a', id: 54 }));
  stick.position.y = 0.12; bobber.add(stick);
  scene.add(bobber);

  const b0 = V(), b1 = V(), b2 = V(), tmp = V(), side = V(), cam = V();
  return {
    rod, line, bobber, reel,
    // butt, direction (unit), bend target (where the line pulls), tension 0..1
    update(butt, dir, len, pull, tension, lineEnd, slack, camPos, lineOn) {
      const tip0 = tmp.copy(butt).addScaledVector(dir, len);
      // bend: pull the tip toward the line direction
      const toward = V().subVectors(pull, tip0).normalize();
      const tip = b2.copy(tip0).addScaledVector(toward, len * 0.42 * tension).sub(butt).setLength(len * (1 - 0.12 * tension)).add(butt);
      const ctrl = b1.copy(butt).addScaledVector(dir, len * 0.55);
      b0.copy(butt);
      let j = 0;
      for (let i = 0; i <= NS; i++) {
        const u = i / NS;
        const p = V().copy(b0).multiplyScalar((1 - u) * (1 - u)).addScaledVector(ctrl, 2 * u * (1 - u)).addScaledVector(tip, u * u);
        const tg = V().copy(ctrl).sub(b0).multiplyScalar(2 * (1 - u)).addScaledVector(V().copy(tip).sub(ctrl), 2 * u).normalize();
        const n1 = V().crossVectors(tg, V(0, 1, 0)); if (n1.lengthSq() < 1e-6) n1.set(1, 0, 0); n1.normalize();
        const n2 = V().crossVectors(n1, tg).normalize();
        const r = 0.024 * (1 - u) + 0.006 * u;
        for (let k = 0; k < NR; k++) {
          const a = (k / NR) * Math.PI * 2;
          const q = V().copy(p).addScaledVector(n1, Math.cos(a) * r).addScaledVector(n2, Math.sin(a) * r);
          rp[j++] = q.x; rp[j++] = q.y; rp[j++] = q.z;
        }
      }
      rodGeo.attributes.position.needsUpdate = true;
      rodGeo.computeVertexNormals();
      reel.position.copy(butt).addScaledVector(dir, 0.3).add(V(0, -0.07, 0));
      // line from the tip to lineEnd with a sag when slack
      line.visible = lineOn;
      cam.copy(camPos);
      const span = V().subVectors(lineEnd, tip);
      for (let i = 0; i <= NL; i++) {
        const u = i / NL;
        const p = V().copy(tip).addScaledVector(span, u);
        p.y -= slack * 4 * u * (1 - u);
        const dcam = p.distanceTo(cam);
        const w = Math.max(0.004, dcam * 0.0011);
        const vd = V().subVectors(cam, p).normalize();
        side.crossVectors(span, vd).normalize().multiplyScalar(w);
        lp.set([p.x + side.x, p.y + side.y, p.z + side.z, p.x - side.x, p.y - side.y, p.z - side.z], i * 6);
      }
      lineGeo.attributes.position.needsUpdate = true;
      lineGeo.computeBoundingSphere();
      return tip;
    },
  };
}

export function makeWorld({ scene, overlay, camera }) {
  const ctx = { scene, overlay, camera };
  const boat = makeBoat(ctx);
  scene.add(boat.root);
  const robot = makeRobot(ctx);
  boat.root.add(robot.root);
  robot.root.position.copy(boat.seat);
  const lord = makeLord(ctx);
  scene.add(lord.root);
  const fx = makeFx(ctx);
  scene.add(fx.root);
  const tackle = makeTackle(scene);
  const gulls = makeGulls(scene);
  const school = makeSchool(scene);
  const hatFree = new THREE.Group(); scene.add(hatFree);
  // a second, distant boat-scale prop: the hat on the hook is the robot's own hat moved around
  const tmpM = new THREE.Matrix4();
  const marks = [];

  const world = {
    boat, robot, lord, fx, tackle,
    update(st, cam) {
      // boat
      const b = st.boat;
      boat.root.visible = b.visible !== false;
      boat.place(b.x, b.z, b.heading, b);
      // robot
      robot.root.visible = boat.root.visible;
      robot.pose(st.robot.pose);
      robot.setFace(st.robot.face);
      // hat: on the head, or flying free in world space
      if (st.hat.on) {
        if (robot.hat.parent !== robot.hatOnHead) robot.hatOnHead.add(robot.hat);
        robot.hat.position.set(0, 0, 0); robot.hat.rotation.set(0, 0, 0);
        const sq = st.hat.squash ?? 1; robot.hat.scale.set(1 + (1 - sq) * 0.6, sq, 1 + (1 - sq) * 0.6);
      } else if (st.hat.local) {
        // in the robot's hand, or tossed up to land on its head: robot-root space
        if (robot.hat.parent !== robot.root) robot.root.add(robot.hat);
        const pos = new THREE.Vector3().fromArray(st.hat.pos);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...st.hat.rot));
        if (st.hat.toss !== undefined) {
          robot.root.updateMatrixWorld(true);
          const m = new THREE.Matrix4().copy(robot.root.matrixWorld).invert().multiply(robot.hatOnHead.matrixWorld);
          const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
          m.decompose(tp, tq, ts);
          const k = st.hat.toss, apex = pos.clone().lerp(tp, 0.5).add(new THREE.Vector3(0, st.hat.apex ?? 0.9, 0));
          // quadratic arc through the apex; a full flip and a spin on the way, landing square
          const a = pos.clone().lerp(apex, k), b = apex.clone().lerp(tp, k);
          pos.copy(a.lerp(b, k));
          q.slerp(tq, k);
          q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI * 2 * k, Math.PI * 2 * k, 0)));
        }
        robot.hat.position.copy(pos); robot.hat.quaternion.copy(q); robot.hat.scale.setScalar(1);
      } else if (st.hat.fromHead) {
        // blown off: flies away from exactly where it sat on the head
        if (robot.hat.parent !== hatFree) hatFree.add(robot.hat);
        boat.root.updateMatrixWorld(true);
        const tp = new THREE.Vector3(), tq = new THREE.Quaternion(), ts = new THREE.Vector3();
        robot.hatOnHead.matrixWorld.decompose(tp, tq, ts);
        robot.hat.position.copy(tp).add(new THREE.Vector3().fromArray(st.hat.offset));
        robot.hat.quaternion.copy(tq).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...st.hat.spin)));
        robot.hat.scale.setScalar(1);
      } else {
        if (robot.hat.parent !== hatFree) hatFree.add(robot.hat);
        robot.hat.position.fromArray(st.hat.pos);
        robot.hat.rotation.set(st.hat.rot[0], st.hat.rot[1], st.hat.rot[2]);
        robot.hat.scale.setScalar(st.hat.scale ?? 1);
      }
      // tackle: butt at the right hand, in world space
      boat.root.updateMatrixWorld(true);
      const handW = st.robot.pose.handR.clone().applyMatrix4(robot.root.matrixWorld);
      const dirW = st.rod.dir.clone().transformDirection(robot.root.matrixWorld);
      const lineEnd = st.line.end.clone();
      const tip = tackle.update(handW, dirW, 2.5, lineEnd, st.rod.tension, lineEnd, st.line.slack, cam.position, st.line.on !== false && boat.root.visible);
      tackle.rod.visible = tackle.reel.visible = boat.root.visible;
      st.rodTip = tip.clone();
      // bobber
      tackle.bobber.visible = !!st.bobber;
      if (st.bobber) { tackle.bobber.position.fromArray(st.bobber.pos); tackle.bobber.rotation.set(st.bobber.tilt ?? 0, 0, st.bobber.tilt2 ?? 0); }
      // the Lord
      lord.show(!!st.lord);
      if (st.lord && !st.lord._posed) lord.pose(st.lord);
      fx.update(st.t);
      gulls.update(st);
      school.update(st);
      // screen marks (the "!" pop, zzz) are drawn by drawTitles from projected anchors
      marks.length = 0;
      for (const m of st.marks ?? []) {
        const p = (m.anchor === 'head' ? robot.headWorld(V()) : V(...m.pos)).add(V(...(m.offset ?? [0, 0, 0])));
        p.project(cam);
        marks.push({ ...m, sx: p.x * 0.5 + 0.5, sy: 0.5 - p.y * 0.5, behind: p.z > 1 });
      }
      void tmpM;
    },
    drawTitles(c, W, H, st) {
      c.clearRect(0, 0, W, H);
      const u = H / 1038;
      // marks
      for (const m of marks) {
        if (m.behind) continue;
        const x = m.sx * W, y = m.sy * H;
        if (m.type === '!') {
          const k = m.k;   // pop 0..1
          const s = (0.4 + 0.75 * easeOut(k * 3) - 0.15 * Math.sin(k * 20) * (1 - k)) * u * (m.size ?? 1);
          c.save(); c.translate(x, y); c.rotate(-0.12); c.scale(s, s);
          // burst lines
          c.strokeStyle = '#22203a'; c.lineWidth = 7; c.lineCap = 'round';
          for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i - 3) * 0.42; c.beginPath(); c.moveTo(Math.cos(a) * 95, Math.sin(a) * 95 + 20); c.lineTo(Math.cos(a) * 135, Math.sin(a) * 135 + 20); c.stroke(); }
          c.font = '900 150px "Arial Black", Impact, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
          c.lineWidth = 16; c.strokeStyle = '#22203a'; c.strokeText('!', 0, 10);
          c.fillStyle = '#ffd23a'; c.fillText('!', 0, 10);
          c.restore();
        } else if (m.type === 'zzz') {
          c.save(); c.translate(x, y);
          c.font = `italic 700 ${Math.round(34 * u)}px Georgia, serif`;
          for (let i = 0; i < 3; i++) {
            const ph = (m.k * 1.2 + i * 0.33) % 1;
            c.globalAlpha = Math.sin(ph * Math.PI) * 0.95;
            c.lineWidth = 5 * u; c.strokeStyle = '#22203a'; c.fillStyle = '#ffffff';
            const xx = (20 + ph * 60) * u, yy = (-ph * 90) * u, sc = 0.6 + ph * 0.7;
            c.save(); c.translate(xx, yy); c.scale(sc, sc); c.strokeText('z', 0, 0); c.fillText('z', 0, 0); c.restore();
          }
          c.restore();
        } else if (m.type === '?') {
          c.save(); c.translate(x, y); const s = (0.3 + 0.7 * easeOut(m.k * 3)) * u; c.scale(s, s);
          c.font = '900 120px "Arial Black", Impact, sans-serif'; c.textAlign = 'center';
          c.lineWidth = 14; c.strokeStyle = '#22203a'; c.strokeText('?', 0, 0); c.fillStyle = '#ffffff'; c.fillText('?', 0, 0);
          c.restore();
        } else if (m.type === 'note') {
          c.save(); c.translate(x, y); c.globalAlpha = clamp(Math.sin(m.k * Math.PI) * 1.4);
          c.font = `700 ${Math.round(70 * u)}px "Segoe UI Symbol", serif`; c.lineWidth = 8 * u; c.strokeStyle = '#22203a'; c.fillStyle = '#ffd23a';
          c.translate(m.k * 40 * u, -m.k * 60 * u); c.rotate(0.2 * Math.sin(m.k * 9));
          c.strokeText('♪', 0, 0); c.fillText('♪', 0, 0); c.restore();
        }
      }
      // title cards
      const T = st.title;
      if (T && T.a > 0) {
        c.save();
        c.globalAlpha = T.a;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        const pop = (txt, x, y, size, t0, fill, opts = {}) => {
          // chunky anime title letters that pop in one by one on a gentle arc
          c.font = `900 ${Math.round(size * u)}px "Arial Black", "Arial Bold", Impact, sans-serif`;
          const sp = (opts.spacing ?? 0.06) * size * u;
          const ws = [...txt].map((ch) => c.measureText(ch).width);
          const total = ws.reduce((a, b) => a + b, 0) + sp * (ws.length - 1);
          let xx = x - total / 2;
          [...txt].forEach((ch, i) => {
            const w = ws[i];
            const k = clamp((st.t - t0 - i * (opts.stagger ?? 0.05)) / 0.35);
            const cx = xx + w / 2; xx += w + sp;
            if (k <= 0 || ch === ' ') return;
            const s = easeOut(k) * (1 + 0.25 * Math.sin(k * Math.PI));
            const arc = (opts.arc ?? 0) * ((cx - x) / (total / 2 || 1)) ** 2 * u;
            const rot = (opts.tilt ?? 0) * ((cx - x) / (total / 2 || 1)) + 0.04 * Math.sin(i * 2.3);
            c.save(); c.translate(cx, y + arc); c.rotate(rot); c.scale(s, s);
            c.lineJoin = 'round';
            c.fillStyle = 'rgba(20,24,70,0.35)'; c.fillText(ch, 6 * u, 9 * u);
            c.lineWidth = size * 0.13 * u; c.strokeStyle = '#22203a'; c.strokeText(ch, 0, 0);
            c.fillStyle = fill; c.fillText(ch, 0, 0);
            // a sliver of highlight on each letter
            c.save(); c.beginPath(); c.rect(-w, -size * u, w * 2, size * u * 0.42); c.clip();
            c.fillStyle = 'rgba(255,255,255,0.55)'; c.fillText(ch, 0, 0); c.restore();
            c.restore();
          });
        };
        if (T.kind === 'open') {
          const y = H * 0.33, t0 = CUES.titleIn;
          pop('THE', W / 2, y - 112 * u, 54, t0, '#ffd23a', { spacing: 0.25, stagger: 0.06 });
          pop('BIG ONE', W / 2, y + 6 * u, 168, t0 + 0.22, '#fff8ea', { spacing: 0.04, stagger: 0.07, arc: 26, tilt: 0.08 });
          c.font = `italic 700 ${Math.round(40 * u)}px Georgia, "Times New Roman", serif`;
          c.globalAlpha = T.a * clamp((st.t - t0 - 1.0) / 0.6);
          c.lineJoin = 'round'; c.lineWidth = 7 * u; c.strokeStyle = '#22203a';
          c.strokeText('a fishing story', W / 2, y + 134 * u);
          c.fillStyle = '#ffd23a'; c.fillText('a fishing story', W / 2, y + 134 * u);
        } else if (T.kind === 'fin') {
          const y = H * 0.14, t0 = CUES.fin;
          pop('THE END', W / 2, y, 104, t0, '#fff8ea', { spacing: 0.06, stagger: 0.07, arc: 12, tilt: 0.05 });
          c.font = `italic 700 ${Math.round(30 * u)}px Georgia, serif`;
          c.globalAlpha = T.a * clamp((st.t - t0 - 0.6) / 0.5);
          c.lineJoin = 'round'; c.lineWidth = 7 * u; c.strokeStyle = '#22203a';
          c.strokeText('see you, big one', W / 2, y + 88 * u); c.fillStyle = '#ffd23a'; c.fillText('see you, big one', W / 2, y + 88 * u);
        }
        c.restore();
      }
      void smooth; void CUES;
    },
  };
  void overlay; void camera;
  return world;
}
