// Scan view: the full surveillance read of the same city. Dark massing with lit edges, wireframe crowns,
// glowing cars, live traffic flow on every street, a signal network, the area perimeter and real infrastructure in data colours.
// It only swaps materials and adds its own group; nothing in the city state changes.
import * as THREE from 'three';
import { PACK } from '../engine/pack.js';
import { X0, X1, Z0, Z1, elev, offsetLine, polyLen } from '../engine/core.js';
import { rowWidth } from '../engine/model.js';
import { INK, MAT, scene } from '../app/render.js';
import { STATE, helpers, overlays } from '../app/state.js';
import { minuteOfDay } from '../game/clock.js';
import { getFacts } from '../views/index.js';
import { traffic } from '../views/metrics.js';
import { skyState } from './sky.js';

const C = (r, g, b) => new THREE.Color(r, g, b);
const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
const S = {
  solid: basic({ color: 0x0b1317 }),
  glass: basic({ color: C(0.05, 0.2, 0.24) }),
  edge: new THREE.LineBasicMaterial({ color: C(0.78, 0.95, 1.0), transparent: true, opacity: 0.55, depthWrite: false, toneMapped: false }),
  foliage: basic({ color: C(0.16, 0.75, 0.82), wireframe: true, transparent: true, opacity: 0.32, depthWrite: false }),
  trunk: basic({ color: C(0.1, 0.32, 0.36) }),
  car: basic({ color: C(1.7, 1.9, 2.0) }),
  carTrim: basic({ color: C(0.3, 0.9, 1.0) }),
  hide: basic({ visible: false }),
};
const VARIANT = new WeakMap();
const ref = new THREE.Color();
const near = (c, hex) => !!c && (ref.setHex(hex), Math.abs(c.r - ref.r) + Math.abs(c.g - ref.g) + Math.abs(c.b - ref.b) < 0.02);
function variant(m, o) {
  if (m === MAT.solid) return S.solid;
  if (m === MAT.glass) return S.glass;
  if (m === INK) return S.edge;
  let inTraffic = false; for (let p = o.parent; p; p = p.parent) if (p.name === 'traffic') { inTraffic = true; break; }
  if (inTraffic) return near(m.color, 0x33414c) ? S.carTrim : S.car;
  if (m.side === THREE.BackSide) return S.hide;
  if (o.isInstancedMesh) return o.geometry.type === 'CylinderGeometry' || near(m.color, 0x7a5636) ? S.trunk : S.foliage;
  if (VARIANT.has(m)) return VARIANT.get(m);
  let out = null;
  if (m.isLineBasicMaterial) out = new THREE.LineBasicMaterial({ color: C(0.3, 0.85, 0.92), transparent: true, opacity: Math.min(0.5, m.opacity), depthWrite: false, toneMapped: false });
  else if (m.isShaderMaterial) out = m;
  else if (m.vertexColors) out = basic({ vertexColors: true, color: m.isMeshBasicMaterial ? C(0.42, 0.5, 0.52) : C(0.12, 0.15, 0.16), side: m.side, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits });
  else if (m.map) out = basic({ map: m.map, color: C(0.1, 0.13, 0.14), transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
  else out = basic({ color: C(0.08, 0.11, 0.12), side: m.side, transparent: m.transparent, opacity: m.opacity });
  VARIANT.set(m, out); return out;
}
let root = null; // our own group: never swapped
function sweep(on) {
  for (const top of scene.children) {
    if (top === overlays || top === helpers || top === root || top.userData.noScan || top.name === 'camino-infra') continue;
    top.traverse((o) => {
      if (!o.material || Array.isArray(o.material) || o.userData.noScan) return;
      if (on) { if (o.material === o.userData.camScan) return; o.userData.camOrig = o.material; o.userData.camScan = variant(o.material, o); o.material = o.userData.camScan; o.userData.camShadow = o.castShadow; o.castShadow = false; }
      else if (o.userData.camOrig) { if (o.material === o.userData.camScan) { o.material = o.userData.camOrig; o.castShadow = !!o.userData.camShadow; } delete o.userData.camOrig; delete o.userData.camScan; }
    });
  }
}

// ---------- flow: animated dashes along every lane, coloured by load ----------
const FLOW_V = `attribute float aD; attribute vec3 aC; varying float vD; varying vec3 vC; void main(){ vD = aD; vC = aC; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const FLOW_F = `uniform float t; varying float vD; varying vec3 vC; void main(){ float f = fract((vD - t * 14.0) / 18.0); float a = smoothstep(0.0, 0.08, f) * (1.0 - smoothstep(0.28, 0.4, f)); if (a < 0.03) discard; gl_FragColor = vec4(vC * (0.7 + a), 0.35 + 0.65 * a); }`;
const flowMat = new THREE.ShaderMaterial({ uniforms: { t: { value: 0 } }, vertexShader: FLOW_V, fragmentShader: FLOW_F, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
const RAMP = [[0, C(0.18, 0.85, 0.95)], [0.55, C(0.95, 0.95, 1.0)], [0.8, C(1.0, 0.75, 0.25)], [1, C(1.0, 0.27, 0.21)]];
const tmpC = new THREE.Color();
function ramp(t) { t = Math.max(0, Math.min(1, t)); for (let i = 1; i < RAMP.length; i++) if (t <= RAMP[i][0]) return tmpC.copy(RAMP[i - 1][1]).lerp(RAMP[i][1], (t - RAMP[i - 1][0]) / (RAMP[i][0] - RAMP[i - 1][0])); return tmpC.copy(RAMP.at(-1)[1]); }
function buildFlow() {
  const pos = [], d = [], col = [], ranges = new Map();
  for (const e of STATE.edges.values()) {
    if (!e.g || e.s === 'driveway' || e.c === 'service' || e.p.length < 2) continue;
    const start = pos.length / 3, half = Math.max(1.4, rowWidth(e.prof) / 4);
    const lines = e.oneway ? [[e.p, 1]] : [[offsetLine(e.p, half), 1], [offsetLine(e.p, -half), -1]];
    for (const [p, dir] of lines) {
      const L = polyLen(p); let acc = 0;
      for (let k = 1; k < p.length; k++) {
        const a = p[k - 1], b = p[k], s = Math.hypot(b[0] - a[0], b[1] - a[1]);
        pos.push(a[0], elev(a[0], a[1]) + 0.7, a[1], b[0], elev(b[0], b[1]) + 0.7, b[1]);
        d.push(dir > 0 ? acc : L - acc, dir > 0 ? acc + s : L - acc - s); acc += s;
        col.push(0, 0, 0, 0, 0, 0);
      }
    }
    ranges.set(e.id, [start, pos.length / 3 - start]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('aD', new THREE.Float32BufferAttribute(d, 1));
  const ca = new THREE.Float32BufferAttribute(col, 3); ca.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aC', ca);
  const m = new THREE.LineSegments(g, flowMat); m.frustumCulled = false; m.renderOrder = 7; m.userData.ranges = ranges; return m;
}
function paintFlow(m) {
  let v; try { v = traffic(STATE, getFacts(), minuteOfDay()).v; } catch { return; }
  const a = m.geometry.getAttribute('aC');
  for (const [id, [s, n]] of m.userData.ranges) { const c = ramp((v.get(id) ?? 0.1) / 1.1); for (let i = s; i < s + n; i++) a.setXYZ(i, c.r, c.g, c.b); }
  a.needsUpdate = true;
}

// ---------- signal net, perimeter, light points ----------
const signals = () => PACK.props.filter((p) => p[0] === 'signal').map(([, x, z]) => [x, z]);
function buildNet() {
  const sg = signals(), arcs = [], seen = new Set();
  sg.forEach((a, i) => {
    const near = sg.map((b, j) => [Math.hypot(b[0] - a[0], b[1] - a[1]), j]).filter(([dd, j]) => j !== i && dd < 650).sort((p, q) => p[0] - q[0]).slice(0, 2);
    for (const [dd, j] of near) {
      const k = i < j ? i + ',' + j : j + ',' + i; if (seen.has(k)) continue; seen.add(k);
      const b = sg[j], ya = elev(a[0], a[1]) + 7, yb = elev(b[0], b[1]) + 7, lift = Math.min(60, dd * 0.12);
      let px = a[0], py = ya, pz = a[1];
      for (let s = 1; s <= 12; s++) { const t = s / 12, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, y = ya + (yb - ya) * t + lift * 4 * t * (1 - t); arcs.push(px, py, pz, x, y, z); px = x; py = y; pz = z; }
    }
  });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arcs, 3));
  const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: C(0.3, 1.2, 1.3), transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
  const pts = new Float32Array(sg.length * 3); sg.forEach(([x, z], i) => { pts[i * 3] = x; pts[i * 3 + 1] = elev(x, z) + 7; pts[i * 3 + 2] = z; });
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pts, 3));
  const nodes = new THREE.Points(pg, new THREE.PointsMaterial({ color: C(0.6, 2.2, 2.4), size: 5, sizeAttenuation: true, transparent: true, depthWrite: false, toneMapped: false }));
  const ticks = []; for (const [x, z] of sg) { const y = elev(x, z); ticks.push(x, y, z, x, y + 7, z); }
  const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.Float32BufferAttribute(ticks, 3));
  const tk = new THREE.LineSegments(tg, new THREE.LineBasicMaterial({ color: C(0.4, 1.4, 1.5), transparent: true, opacity: 0.6, toneMapped: false }));
  const grp = new THREE.Group(); grp.add(lines, nodes, tk); grp.userData.lines = lines; grp.userData.nodes = nodes; return grp;
}
function buildPerimeter() {
  const ring = [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1], [X0, Z0]], p = [];
  for (let k = 1; k < ring.length; k++) { const a = ring[k - 1], b = ring[k], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 20); for (let s = 0; s < n; s++) { const t0 = s / n, t1 = (s + 1) / n, x0 = a[0] + (b[0] - a[0]) * t0, z0 = a[1] + (b[1] - a[1]) * t0, x1 = a[0] + (b[0] - a[0]) * t1, z1 = a[1] + (b[1] - a[1]) * t1; p.push(new THREE.Vector3(x0, elev(x0, z0) + 1.5, z0), new THREE.Vector3(x1, elev(x1, z1) + 1.5, z1)); } }
  const g = new THREE.BufferGeometry().setFromPoints(p);
  const m = new THREE.LineSegments(g, new THREE.LineDashedMaterial({ color: C(2.2, 0.35, 0.28), dashSize: 6, gapSize: 5, toneMapped: false })); m.computeLineDistances(); return m;
}
function buildLightPoints(I) {
  const L = I ? I.lights : PACK.props.filter((p) => p[0] === 'lamp').map(([, x, z]) => ({ x, z }));
  const a = new Float32Array(L.length * 3); L.forEach((l, i) => { a[i * 3] = l.x; a[i * 3 + 1] = elev(l.x, l.z) + 7.5; a[i * 3 + 2] = l.z; });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  return new THREE.Points(g, new THREE.PointsMaterial({ color: C(2.4, 1.6, 0.55), size: 2.6, sizeAttenuation: true, transparent: true, depthWrite: false, toneMapped: false }));
}

// ---------- public ----------
const st = { on: false, flow: null, dirty: true, lastPaint: 0, lastSweep: 0, infra: null, I: null, subs: new Set() };
export const scanOn = () => st.on;
export const onScan = (f) => st.subs.add(f);
export function initScan({ infra, I }) {
  st.infra = infra; st.I = I;
  root = new THREE.Group(); root.name = 'camino-scan'; root.visible = false; scene.add(root);
  root.add(buildNet(), buildPerimeter(), buildLightPoints(I));
  addEventListener('infill:state', () => { st.dirty = true; });
}
export function setScan(on) {
  if (st.on === on || !root) return; st.on = on;
  skyState.scan = on ? 1 : 0; skyState.sky?.refresh();
  sweep(on); root.visible = on; st.infra?.setScan(on);
  if (on) { st.dirty = true; tick(performance.now()); }
  document.documentElement.classList.toggle('scan', on);
  for (const f of st.subs) f(on);
}
export function tick(now) {
  if (!st.on || !root) return;
  flowMat.uniforms.t.value = now / 1000;
  if (st.dirty) { if (st.flow) { root.remove(st.flow); st.flow.geometry.dispose(); } st.flow = buildFlow(); root.add(st.flow); st.dirty = false; st.lastPaint = 0; }
  if (now - st.lastPaint > 2000) { paintFlow(st.flow); st.lastPaint = now; }
  if (now - st.lastSweep > 400) { sweep(true); st.lastSweep = now; } // rebuilt chunks and new cars pick up the scan look
  const net = root.children[0]; net.userData.lines.material.opacity = 0.2 + 0.12 * Math.sin(now / 420); net.userData.nodes.material.size = 4.5 + 1.2 * Math.sin(now / 300);
}
