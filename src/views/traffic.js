// Live traffic view: runs the sim (src/sim) in a Web Worker and draws moving and parked cars as instanced meshes.
// Hooks: syncTraffic(STATE) from state.refresh(), tickTraffic(now) from the frame loop. Nothing here is saved.
import * as THREE from 'three';
import { scene, toon } from '../app/render.js';
import { X0, X1, Z0, Z1, elev } from '../engine/core.js';
import { clock } from '../game/clock.js';
import { nodeControl } from '../tools/roads/graph.js';
import { provide } from './providers.js';
import { buildNet, drivableEdges, keyOf } from '../sim/net.js';
import { Sim, STRIDE } from '../sim/sim.js';

const COLS = [0xc4613b, 0x3e9fdc, 0xf4f1ea, 0x4f4b48, 0xd6ad57, 0x8ea67a].map((h) => new THREE.Color(h));
const BODY = new THREE.BoxGeometry(1.8, 1.0, 4.3).translate(0, 0.5, 0), TOP = new THREE.BoxGeometry(1.6, 0.75, 2.2).translate(0, 1.35, -0.2);
const MODES = [['Calm', 0.2], ['Normal', 0.4], ['Rush', 0.8]];
const MOVING_CAP = 1400, PARKED_CAP = 6000;

const root = new THREE.Group(); root.name = 'traffic'; scene.add(root);
const bodyMat = toon({ color: 0xffffff }), topMat = toon({ color: 0x3a4a55 });
function fleet(cap) {
  const a = new THREE.InstancedMesh(BODY, bodyMat, cap), b = new THREE.InstancedMesh(TOP, topMat, cap);
  for (const m of [a, b]) { m.frustumCulled = false; m.count = 0; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); root.add(m); }
  a.setColorAt(0, COLS[0]); // no cast shadow: moving cars threw blurry grey ghosts over the lanes
  return { a, b };
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
  let nm = 0, np = 0;
  for (let o = 0; o < buf.length; o += STRIDE) {
    const park = buf[o] >= 1e6, f = park ? parked : moving, i = park ? np++ : nm++;
    if (i < (park ? PARKED_CAP : MOVING_CAP)) f.a.setColorAt(i, COLS[buf[o + 6] % 6 | 0]);
  }
  if (moving.a.instanceColor) moving.a.instanceColor.needsUpdate = true;
  if (parked.a.instanceColor) parked.a.instanceColor.needsUpdate = true;
  moving.a.count = moving.b.count = Math.min(nm, MOVING_CAP); parked.a.count = parked.b.count = Math.min(np, PARKED_CAP);
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
  let nm = 0, np = 0;
  const fm = moving.a.instanceMatrix.array, tm = moving.b.instanceMatrix.array;
  for (let o = 0; o < buf.length; o += STRIDE) {
    const park = buf[o] >= 1e6;
    if (park) { if (!st.fresh) { np++; continue; } }
    const f = park ? parked : moving, i = park ? np++ : nm++;
    if (i >= (park ? PARKED_CAP : MOVING_CAP)) continue;
    const x = buf[o + 1] + buf[o + 4] * dt, z = buf[o + 2] + buf[o + 5] * dt, h = buf[o + 3], c = Math.cos(h), s = Math.sin(h), y = elev(x, z) + 0.3;
    const A = f.a.instanceMatrix.array, B = f.b.instanceMatrix.array, k = i * 16;
    for (const M of [A, B]) { M[k] = c; M[k + 1] = 0; M[k + 2] = -s; M[k + 3] = 0; M[k + 4] = 0; M[k + 5] = 1; M[k + 6] = 0; M[k + 7] = 0; M[k + 8] = s; M[k + 9] = 0; M[k + 10] = c; M[k + 11] = 0; M[k + 12] = x; M[k + 13] = y; M[k + 14] = z; M[k + 15] = 1; }
  }
  void fm; void tm;
  moving.a.instanceMatrix.needsUpdate = moving.b.instanceMatrix.needsUpdate = true;
  if (st.fresh) { parked.a.instanceMatrix.needsUpdate = parked.b.instanceMatrix.needsUpdate = true; st.fresh = false; }
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
