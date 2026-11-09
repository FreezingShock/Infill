// Traffic signals you can see: a pole on the far right corner of each approach, a mast arm reaching out over its
// lanes, and one head per lane hanging on the far side of the junction facing the traffic that approaches.
// Phasing and head positions come from src/sim/signals.js (the sim worker sends them whenever the lane graph
// changes); the lamp colours here are driven by the same plan and the sim clock, so they match what the cars obey.
// Hooks: setSignals(list) from views/traffic.js when a new lane graph arrives, tickSignals(simSeconds) per frame.
import * as THREE from 'three';
import { scene, INK, MAT } from '../app/render.js';
import { Acc, C, elev, lineGeo, obox } from '../engine/core.js';
import { BASE } from '../engine/commands.js';
import { roadwayIndex } from '../tools/roads/roadway.js';
import { stateAt } from '../sim/signals.js';

const POLE = C(0x4d5258), HEAD = C(0x23262a), PLATE = C(0x181a1d);
const ON = [[1, 0.2, 0.14], [1, 0.78, 0.12], [0.22, 1, 0.42]], DIM = 0.1;
const POLE_H = 6.6, ARM_Y = 6.15, HEAD_Y = 4.95, LENS_Y = [5.82, 5.46, 5.1];

const root = new THREE.Group(); root.name = 'signals'; scene.add(root);
let lampMesh = null, lampColor = null, heads = [], clockAt = 0, lastStep = -1, rw = null;

const R = (x, z, a, hw, hd) => ({ x, z, ux: Math.cos(a), uz: Math.sin(a), vx: -Math.sin(a), vz: Math.cos(a), hw, hd });
// lens shapes in the head's face plane: u across (driver's right positive), up
const disc = (r) => { const out = []; for (let k = 0; k < 10; k++) { const a0 = k / 10 * Math.PI * 2, a1 = (k + 1) / 10 * Math.PI * 2; out.push([0, 0], [Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]); } return out; };
const arrowLeft = () => [[-0.13, 0], [0.0, 0.1], [0.0, -0.1], [0.0, 0.04], [0.11, 0.04], [0.11, -0.04], [0.0, 0.04], [0.11, -0.04], [0.0, -0.04]];
const DISC = disc(0.115), ARROW = arrowLeft();

function clear() {
  for (const ch of [...root.children]) { root.remove(ch); ch.geometry?.dispose(); }
  lampMesh = lampColor = null; heads = []; lastStep = -1;
}

function setSignals(list) {
  clear();
  if (!list || !list.length) return;
  rw = roadwayIndex([...BASE.edges.values()]);
  const acc = new Acc(), lp = [], lc = [];
  for (const sg of list) {
    for (const m of sg.masts) {
      let [px, pz] = rw.nudge(m.x, m.z, 0.5); // a pole always stands off the pavement
      const y = elev(px, pz), tipX = m.ax, tipZ = m.az, ax = tipX - px, az = tipZ - pz, len = Math.hypot(ax, az) || 1;
      obox(acc, R(px, pz, 0, 0.15, 0.15), y, POLE_H, POLE);
      obox(acc, R(px, pz, 0, 0.26, 0.26), y, 0.5, POLE); // base
      obox(acc, R((px + tipX) / 2, (pz + tipZ) / 2, Math.atan2(az, ax), len / 2, 0.08), y + ARM_Y, 0.2, POLE, false);
    }
    for (const h of sg.heads) {
      const y = elev(h.x, h.z), a = Math.atan2(h.dz, h.dx), rx = -h.dz, rz = h.dx;
      obox(acc, R(h.x, h.z, a, 0.14, h.arrow ? 0.18 : 0.2), y + HEAD_Y, 1.1, HEAD);
      obox(acc, R(h.x + h.dx * 0.18, h.z + h.dz * 0.18, a, 0.025, 0.31), y + HEAD_Y - 0.08, 1.26, PLATE, false); // backplate
      obox(acc, R(h.x, h.z, a, 0.05, 0.05), y + HEAD_Y + 1.1, ARM_Y - HEAD_Y - 1.1 + 0.05, POLE, false); // hanger up to the arm
      const fx = h.x - h.dx * 0.157, fz = h.z - h.dz * 0.157, shape = h.arrow ? ARROW : DISC, lens = [];
      for (let k = 0; k < 3; k++) {
        const start = lp.length / 3;
        for (const [u, v] of shape) { lp.push(fx + rx * u, y + LENS_Y[k] + v, fz + rz * u); lc.push(0, 0, 0); }
        lens.push([start, shape.length]);
      }
      heads.push({ plan: sg.plan, off: sg.off, leg: h.leg, mv: h.mv, lens, last: -1 });
    }
  }
  const body = new THREE.Mesh(acc.geo(), MAT.solid); body.castShadow = true;
  root.add(body, new THREE.LineSegments(lineGeo(acc.l), INK));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  lampColor = new THREE.Float32BufferAttribute(lc, 3); lampColor.setUsage(THREE.DynamicDrawUsage); g.setAttribute('color', lampColor);
  lampMesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  lampMesh.frustumCulled = false; lampMesh.userData.noScan = true; // lamps keep their own colours in the scan view
  root.add(lampMesh);
}

// lamp 0 red, 1 yellow, 2 green for a movement state
const lampOf = (s) => (s === 3 ? 1 : s === 1 || s === 2 ? 2 : 0);
function tickSignals(t) {
  if (!lampMesh) return;
  const step = Math.floor(t * 4); if (step === lastStep) return; // lamps change at most a few times a second
  lastStep = step; clockAt = t;
  const col = lampColor.array;
  for (const h of heads) {
    const on = lampOf(stateAt(h.plan, t + h.off, h.leg, h.mv));
    if (on === h.last) continue; h.last = on;
    for (let k = 0; k < 3; k++) {
      const c = ON[k], f = k === on ? 1 : DIM, [s0, n] = h.lens[k];
      for (let i = 0; i < n; i++) { const o = (s0 + i) * 3; col[o] = c[0] * f; col[o + 1] = c[1] * f; col[o + 2] = c[2] * f; }
    }
  }
  lampColor.needsUpdate = true;
  void clockAt;
}

export { setSignals, tickSignals };
