// Live traffic view: runs the sim (src/sim) in a Web Worker and draws moving and parked cars as instanced meshes.
// Hooks: syncTraffic(STATE) from state.refresh(), tickTraffic(now) from the frame loop. Nothing here is saved.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { scene, toon } from '../app/render.js';
import { X0, X1, Z0, Z1, elev } from '../engine/core.js';
import { clock } from '../game/clock.js';
import { nodeControl } from '../tools/roads/graph.js';
import { provide } from './providers.js';
import { buildNet, drivableEdges, keyOf } from '../sim/net.js';
import { Sim, STRIDE } from '../sim/sim.js';

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

const st = { on: true, mode: 1, key: '', snap: new Float32Array(0), snapT: 0, stats: { moving: 0, parked: 0, waiting: 0, avg: 0, ms: 0 }, cfgKey: '', lastCfg: 0, fresh: false, lastEdges: null };

// ---------- backend: a module worker, or the same sim on the main thread if workers are unavailable ----------
let backend = null;
function startBackend() {
  try {
    const w = new Worker(new URL('../sim/worker.js', import.meta.url), { type: 'module' });
    w.onmessage = (e) => { if (e.data.type === 'snap') onSnap(e.data.buf, e.data.stats, e.data.edges); };
    w.onerror = () => { backend = localBackend(); };
    return { post: (m) => w.postMessage(m) };
  } catch (err) { return localBackend(); }
}
function localBackend() {
  const sim = new Sim(7); let last = performance.now(), acc = 0, tick = 0;
  setInterval(() => {
    const now = performance.now(), el = Math.min(0.25, (now - last) / 1000); last = now;
    if (!sim.net) return;
    const t0 = performance.now(); if (sim.running) { acc += el; let n = 0; while (acc >= 0.05 && n < 2) { sim.step(0.05); acc -= 0.05; n++; } if (n === 2) acc = 0; }
    const buf = sim.snapshot(); onSnap(buf, { ...sim.stats, ms: performance.now() - t0 }, ++tick % 20 === 1 ? sim.edgeStats() : null);
  }, 50);
  return { post: (m) => { if (m.type === 'net') sim.setNet(buildNet(m.edges, { bounds: m.bounds, control: m.control })); else if (m.type === 'cfg') { if (m.density != null) sim.density = m.density; if (m.running != null) sim.running = m.running; } } };
}

const live = { flow: null, curb: null };
// the info views switch from estimates to these as soon as the sim has numbers (see views/providers.js)
provide('edgeFlow', () => (live.flow && st.on ? live.flow : null));
provide('curbOcc', () => (live.curb && st.on ? live.curb : null));
function onSnap(buf, stats, edges) {
  if (edges) { live.flow = new Map(Object.entries(edges.flow)); live.curb = new Map(Object.entries(edges.curb)); }
  st.snap = buf; st.snapT = performance.now(); st.stats = stats; st.fresh = true;
  // colours only change when the list does, so set them here and leave the per-frame work to positions
  const nm = [0, 0, 0, 0, 0], np = [0, 0, 0, 0, 0];
  for (let o = 0; o < buf.length; o += STRIDE) {
    const park = buf[o] >= 1e6, look = buf[o + 6] | 0, k = Math.min(4, look >> 3), n = park ? np : nm, cap = park ? PARKED_CAP : MOVING_CAP, i = n[k]++;
    if (i < cap) (park ? parked : moving)[k].a.setColorAt(i, COLS[look % 8 % 6]);
  }
  for (let k = 0; k < 5; k++) {
    if (moving[k].a.instanceColor) moving[k].a.instanceColor.needsUpdate = true;
    if (parked[k].a.instanceColor) parked[k].a.instanceColor.needsUpdate = true;
    moving[k].a.count = moving[k].b.count = Math.min(nm[k], MOVING_CAP); parked[k].a.count = parked[k].b.count = Math.min(np[k], PARKED_CAP);
  }
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
  backend.post({ type: 'net', edges: JSON.parse(JSON.stringify(drivableEdges(S.edges))), control, bounds: [X0, Z0, X1, Z1] });
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
  const nm = [0, 0, 0, 0, 0], np = [0, 0, 0, 0, 0];
  for (let o = 0; o < buf.length; o += STRIDE) {
    const park = buf[o] >= 1e6, k = Math.min(4, (buf[o + 6] | 0) >> 3), n = park ? np : nm, i = n[k]++;
    if (park && !st.fresh) continue;
    if (i >= (park ? PARKED_CAP : MOVING_CAP)) continue;
    const f = (park ? parked : moving)[k];
    const x = buf[o + 1] + buf[o + 4] * dt, z = buf[o + 2] + buf[o + 5] * dt, h = buf[o + 3], c = Math.cos(h), s = Math.sin(h), y = elev(x, z) + 0.3, j = i * 16;
    for (const M of [f.a.instanceMatrix.array, f.b.instanceMatrix.array]) { M[j] = c; M[j + 1] = 0; M[j + 2] = -s; M[j + 3] = 0; M[j + 4] = 0; M[j + 5] = 1; M[j + 6] = 0; M[j + 7] = 0; M[j + 8] = s; M[j + 9] = 0; M[j + 10] = c; M[j + 11] = 0; M[j + 12] = x; M[j + 13] = y; M[j + 14] = z; M[j + 15] = 1; }
  }
  for (const f of moving) f.a.instanceMatrix.needsUpdate = f.b.instanceMatrix.needsUpdate = true;
  if (st.fresh) { for (const f of parked) f.a.instanceMatrix.needsUpdate = f.b.instanceMatrix.needsUpdate = true; st.fresh = false; }
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
