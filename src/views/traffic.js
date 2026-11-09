// Live traffic view: runs the sim (src/sim) in a Web Worker and draws moving and parked cars as instanced meshes.
// Hooks: syncTraffic(STATE) from state.refresh(), tickTraffic(now) from the frame loop. Nothing here is saved.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, toon } from '../app/render.js';
import { X0, X1, Z0, Z1, elev } from '../engine/core.js';
import { clock } from '../game/clock.js';
import { nodeControl } from '../tools/roads/graph.js';
import { provide } from './providers.js';
import { drivableEdges, keyOf } from '../sim/net.js';
import { Sim, STRIDE } from '../sim/sim.js';
import { advance, applyMessage } from '../sim/host.js';

const COLS = [0xc4613b, 0x3e9fdc, 0xf4f1ea, 0x4f4b48, 0xd6ad57, 0x8ea67a].map((h) => new THREE.Color(h));
const MODES = [['Calm', 0.2], ['Normal', 0.4], ['Rush', 0.8]];
const MOVING_CAP = 1400, PARKED_CAP = 6000;

// ---------- vehicle models: chunky toon boxes, painted body plus a dark trim mesh (glass, wheels) ----------
const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const wheels = (w, z0, z1, r = 0.36) => [z0, z1].flatMap((z) => [-1, 1].map((sx) => new THREE.CylinderGeometry(r, r, 0.26, 8).rotateZ(Math.PI / 2).translate(sx * (w / 2 - 0.05), r, z)));
const merge = (list) => mergeGeometries(list.map((g) => (g.index ? g : g.toNonIndexed())).map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
const MODELS = [
  { // sedan
    paint: [box(1.8, 0.62, 4.4, 0, 0.55, 0), box(1.62, 0.5, 2.3, 0, 1.1, -0.25)],
    trim: [box(1.66, 0.36, 2.1, 0, 1.12, -0.25), box(1.84, 0.12, 4.44, 0, 0.3, 0), ...wheels(1.8, 1.4, -1.4)] },
  { // SUV
    paint: [box(1.92, 0.78, 4.7, 0, 0.66, 0), box(1.82, 0.7, 3.4, 0, 1.38, -0.3)],
    trim: [box(1.86, 0.42, 3.2, 0, 1.42, -0.3), box(1.96, 0.12, 4.74, 0, 0.32, 0), ...wheels(1.92, 1.5, -1.5, 0.4)] },
  { // pickup
    paint: [box(1.92, 0.7, 5.2, 0, 0.62, 0), box(1.82, 0.7, 1.9, 0, 1.3, 0.85)],
    trim: [box(1.86, 0.4, 1.7, 0, 1.34, 0.85), box(1.6, 0.06, 2.2, 0, 1.0, -1.45), box(1.96, 0.12, 5.24, 0, 0.3, 0), ...wheels(1.92, 1.7, -1.6, 0.4)] },
  { // van
    paint: [box(1.96, 1.9, 5.0, 0, 1.25, 0)],
    trim: [box(2.0, 0.55, 3.6, 0, 1.85, -0.3), box(1.7, 0.7, 0.1, 0, 1.75, 2.5), box(2.0, 0.12, 5.04, 0, 0.35, 0), ...wheels(1.96, 1.6, -1.5, 0.4)] },
  { // bus
    paint: [box(2.5, 2.8, 10.5, 0, 1.9, 0)],
    trim: [box(2.54, 0.95, 9.4, 0, 2.55, -0.2), box(2.2, 0.8, 0.1, 0, 2.5, 5.27), box(2.54, 0.14, 10.54, 0, 0.55, 0), ...wheels(2.5, 3.4, -3.4, 0.5)] },
].map((m) => ({ paint: merge(m.paint), trim: merge(m.trim) }));

const root = new THREE.Group(); root.name = 'traffic'; scene.add(root);
const bodyMat = toon({ color: 0xffffff }), trimMat = toon({ color: 0x33414c });
function fleet(cap) {
  return MODELS.map((m) => {
    const a = new THREE.InstancedMesh(m.paint, bodyMat, cap), b = new THREE.InstancedMesh(m.trim, trimMat, cap);
    for (const q of [a, b]) { q.frustumCulled = false; q.count = 0; q.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(q); }
    a.setColorAt(0, COLS[0]); // no cast shadow: moving cars threw blurry grey ghosts over the lanes
    return { a, b };
  });
}
const moving = fleet(MOVING_CAP), parked = fleet(PARKED_CAP);

const st = { mvOff: new Int32Array(0), mvN: 0, parkSig: 0, parkCnt: [-1, 0, 0, 0, 0], netMsg: null, on: true, mode: 1, key: '', snap: new Float32Array(0), snapT: 0, stats: { moving: 0, parked: 0, waiting: 0, avg: 0, ms: 0 }, cfgKey: '', lastCfg: 0, fresh: false, lastEdges: null };

// ---------- backend: a module worker, or the same sim on the main thread if workers are unavailable ----------
let backend = null;
function startBackend() {
  try {
    const w = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { if (e.data.type === 'snap') onSnap(e.data.buf, e.data.stats, e.data.edges); };
    w.onerror = () => { backend = localBackend(); if (st.netMsg) backend.post(st.netMsg); sendCfg(true); }; // fall back, and hand the new backend the street network it missed
    return { post: (m) => w.postMessage(m) };
  } catch (err) { return localBackend(); }
}
function localBackend() {
  const sim = new Sim(7); let last = performance.now(), tick = 0;
  setInterval(() => {
    const now = performance.now(), el = Math.min(0.25, (now - last) / 1000); last = now;
    if (!sim.net) return;
    const t0 = performance.now(); advance(sim, el, 2);
    const buf = sim.snapshot(); onSnap(buf, { ...sim.stats, ms: performance.now() - t0 }, ++tick % 20 === 1 ? sim.edgeStats() : null);
  }, 50);
  return { post: (m) => applyMessage(sim, m) };
}

const live = { flow: null, curb: null };
// the info views switch from estimates to these as soon as the sim has numbers (see views/providers.js)
provide('edgeFlow', () => (live.flow && st.on ? live.flow : null));
provide('curbOcc', () => (live.curb && st.on ? live.curb : null));
function onSnap(buf, stats, edges) {
  if (edges) { live.flow = new Map(Object.entries(edges.flow)); live.curb = new Map(Object.entries(edges.curb)); }
  st.snap = buf; st.snapT = performance.now(); st.stats = stats;
  // Per snapshot (20 Hz): list the moving cars once so the 60 Hz frame loop only walks those, and recolour
  // the parked cars only when that set changed (about 6000 of them, and they almost never do).
  const nm = [0, 0, 0, 0, 0], np = [0, 0, 0, 0, 0], n = buf.length / STRIDE;
  if (st.mvOff.length < n) st.mvOff = new Int32Array(n + 256);
  let mv = 0, sig = 0;
  for (let o = 0; o < buf.length; o += STRIDE) {
    const park = buf[o] >= 1e6, look = buf[o + 6] | 0, k = Math.min(4, look >> 3);
    if (park) { np[k]++; sig = (Math.imul(sig, 31) + buf[o] + look * 7) | 0; continue; }
    const i = nm[k]++;
    st.mvOff[mv++] = o;
    if (i < MOVING_CAP) moving[k].a.setColorAt(i, COLS[look % 8 % 6]);
  }
  st.mvN = mv;
  const same = sig === st.parkSig && np.every((c, k) => c === st.parkCnt[k]);
  if (!same) {
    st.parkSig = sig; st.parkCnt = np.slice(); const at = [0, 0, 0, 0, 0];
    for (let o = 0; o < buf.length; o += STRIDE) {
      if (buf[o] < 1e6) continue;
      const look = buf[o + 6] | 0, k = Math.min(4, look >> 3), i = at[k]++;
      if (i < PARKED_CAP) parked[k].a.setColorAt(i, COLS[look % 8 % 6]);
    }
  }
  for (let k = 0; k < 5; k++) {
    if (moving[k].a.instanceColor) moving[k].a.instanceColor.needsUpdate = true;
    if (!same && parked[k].a.instanceColor) parked[k].a.instanceColor.needsUpdate = true;
    moving[k].a.count = moving[k].b.count = Math.min(nm[k], MOVING_CAP); parked[k].a.count = parked[k].b.count = Math.min(np[k], PARKED_CAP);
  }
  if (!same) st.fresh = true; // parked matrices only need rewriting when the parked set changed
  paintChip();
}

// ---------- street edits: rebuild the lane graph when the streets or their controls change ----------
function edgeKey(S) {
  const out = [];
  for (const e of S.edges.values()) if (e.g) out.push(e.id, e.p.length, e.p[0][0], e.p[0][1], e.p.at(-1)[0], e.p.at(-1)[1], e.prof.k, e.prof.els.length, e.prof.els.reduce((s, q) => s + q[1], 0).toFixed(1), e.oneway || 0, e.ring || 0, e.speed || 0);
  return out.join('|') + JSON.stringify(S.ctrl || {});
}
function syncTraffic(S) {
  const key = edgeKey(S);
  if (key === st.key) return;
  st.key = key;
  const control = {};
  for (const e of S.edges.values()) if (e.g) for (const n of [e.a, e.b]) { if (n == null || !S.nodes[n]) continue; const k = keyOf(S.nodes[n]); if (control[k] === undefined) control[k] = nodeControl(S, n); }
  if (!backend) backend = startBackend();
  st.netMsg = { type: 'net', edges: JSON.parse(JSON.stringify(drivableEdges(S.edges))), control, bounds: [X0, Z0, X1, Z1] };
  backend.post(st.netMsg);
  sendCfg(true);
}
// quieter streets at night, busy at the morning and evening peaks
function hourFactor(h) { const bump = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w)); return Math.min(1.25, 0.28 + 0.7 * bump(8, 1.6) + 0.85 * bump(17.3, 2) + 0.45 * bump(12.5, 2.5)); }
function sendCfg(force) {
  if (!backend) return;
  const d = +(MODES[st.mode][1] * hourFactor(clock.hour)).toFixed(2), key = d + '|' + st.on;
  if (!force && key === st.cfgKey) return;
  st.cfgKey = key; backend.post({ type: 'cfg', density: d, running: st.on });
}

// ---------- per frame: place every car from the newest snapshot plus its velocity ----------
function tickTraffic(now) {
  if (now - st.lastCfg > 1000) { st.lastCfg = now; sendCfg(false); }
  root.visible = st.on;
  if (!st.on) return;
  const buf = st.snap, dt = Math.min(0.2, (now - st.snapT) / 1000);
  const nm = [0, 0, 0, 0, 0];
  for (let q = 0; q < st.mvN; q++) {
    const o = st.mvOff[q], k = Math.min(4, (buf[o + 6] | 0) >> 3), i = nm[k]++;
    if (i >= MOVING_CAP) continue;
    writeCar(moving[k], i, buf[o + 1] + buf[o + 4] * dt, buf[o + 2] + buf[o + 5] * dt, buf[o + 3]);
  }
  for (const f of moving) f.a.instanceMatrix.needsUpdate = f.b.instanceMatrix.needsUpdate = true;
  if (st.fresh) {
    const np = [0, 0, 0, 0, 0];
    for (let o = 0; o < buf.length; o += STRIDE) {
      if (buf[o] < 1e6) continue;
      const k = Math.min(4, (buf[o + 6] | 0) >> 3), i = np[k]++;
      if (i < PARKED_CAP) writeCar(parked[k], i, buf[o + 1], buf[o + 2], buf[o + 3]);
    }
    for (const f of parked) f.a.instanceMatrix.needsUpdate = f.b.instanceMatrix.needsUpdate = true;
    st.fresh = false;
  }
}
// one car's matrix into both of its instanced meshes (body and trim share it)
function writeCar(f, i, x, z, h) {
  const c = Math.cos(h), s = Math.sin(h), y = elev(x, z) + 0.3, j = i * 16, A = f.a.instanceMatrix.array, B = f.b.instanceMatrix.array;
  A[j] = c; A[j + 1] = 0; A[j + 2] = -s; A[j + 3] = 0; A[j + 4] = 0; A[j + 5] = 1; A[j + 6] = 0; A[j + 7] = 0; A[j + 8] = s; A[j + 9] = 0; A[j + 10] = c; A[j + 11] = 0; A[j + 12] = x; A[j + 13] = y; A[j + 14] = z; A[j + 15] = 1;
  B.set(A.subarray(j, j + 16), j);
}

// ---------- chip: on/off, how busy, live counts ----------
let chip = null, txt = null;
function mountChip() {
  const style = document.createElement('style');
  style.textContent = `.trafficchip{position:absolute;left:calc(50% + 200px);bottom:max(16px,env(safe-area-inset-bottom,0px));display:flex;align-items:center;gap:8px;padding:6px 12px;z-index:3;font:12.5px var(--body);color:var(--ink)}
.trafficchip .n{min-width:112px;font-variant-numeric:tabular-nums}
.trafficchip .tool{padding:5px 8px}
@media (max-width:1180px){.trafficchip{display:none}}`;
  document.head.appendChild(style);
  chip = document.createElement('div'); chip.className = 'plaque trafficchip'; chip.setAttribute('role', 'group'); chip.setAttribute('aria-label', 'Traffic');
  chip.innerHTML = '<button class="tool" id="trfOn" aria-pressed="true" title="Cars on or off">Traffic</button><button class="tool" id="trfMode" title="How busy the streets are">Normal</button><span class="n" id="trfN"></span>';
  document.getElementById('app').appendChild(chip);
  txt = chip.querySelector('#trfN');
  chip.querySelector('#trfOn').onclick = (e) => { st.on = !st.on; e.currentTarget.setAttribute('aria-pressed', String(st.on)); sendCfg(true); paintChip(); };
  chip.querySelector('#trfMode').onclick = (e) => { st.mode = (st.mode + 1) % MODES.length; e.currentTarget.textContent = MODES[st.mode][0]; sendCfg(true); };
}
function paintChip() { if (txt) txt.textContent = st.on ? `${st.stats.moving} driving · ${st.stats.parked} parked` : 'off'; }
if (typeof document !== 'undefined' && document.getElementById('app')) mountChip();

export { syncTraffic, tickTraffic };
