// Real infrastructure in the 3D city: City of LA street lights (poles, heads and pools of light at night),
// City of LA hydrants, CEC transmission lines (towers and sagging conductors), OSM power lines and poles.
// Street view draws them as real objects; scan view swaps in data colours (userData.scanMat).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { elev } from '../engine/core.js';

const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), UPV = new THREE.Vector3(0, 1, 0);
const merged = (list) => mergeGeometries(list.map((g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); return n; }));
const scanLine = (hex, op = 0.7) => new THREE.LineBasicMaterial({ color: hex, transparent: true, opacity: op, depthWrite: false, toneMapped: false });
const scanFill = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), toneMapped: false });

// ---------- geometry ----------
const POLE_G = merged([new THREE.CylinderGeometry(0.09, 0.13, 7.6, 6).translate(0, 3.8, 0), new THREE.BoxGeometry(0.08, 0.08, 1.7).translate(0, 7.5, 0.8)]);
const HEAD_G = new THREE.BoxGeometry(0.32, 0.12, 0.62).translate(0, 7.42, 1.55);
const HYD_G = merged([new THREE.CylinderGeometry(0.17, 0.2, 0.62, 10).translate(0, 0.31, 0), new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.62, 0), new THREE.CylinderGeometry(0.07, 0.07, 0.5, 6).rotateZ(Math.PI / 2).translate(0, 0.42, 0), new THREE.CylinderGeometry(0.24, 0.24, 0.06, 10).translate(0, 0.03, 0)]);
const TOWER_G = (() => { const g = new THREE.CylinderGeometry(0.7, 3.2, 32, 4, 5, true).translate(0, 16, 0); const arm = new THREE.BoxGeometry(12, 0.5, 0.5).translate(0, 29, 0), arm2 = new THREE.BoxGeometry(9, 0.4, 0.4).translate(0, 24, 0); return merged([g, arm, arm2]); })();
const WPOLE_G = merged([new THREE.CylinderGeometry(0.14, 0.19, 10.5, 6).translate(0, 5.25, 0), new THREE.BoxGeometry(2.4, 0.14, 0.14).translate(0, 9.7, 0)]);
function poolTexture() {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 2, 64, 64, 64); g.addColorStop(0, 'rgba(255,214,150,1)'); g.addColorStop(0.35, 'rgba(255,190,120,.45)'); g.addColorStop(1, 'rgba(255,170,100,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------- materials (street view, then scan) ----------
const MAT = {
  pole: new THREE.MeshStandardMaterial({ color: 0x5f666b, roughness: 0.55, metalness: 0.55 }),
  head: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.4, emissive: 0x000000 }),
  hyd: new THREE.MeshStandardMaterial({ color: 0xd8b03a, roughness: 0.5, metalness: 0.25 }),
  tower: new THREE.MeshStandardMaterial({ color: 0x8a9095, roughness: 0.6, metalness: 0.6, wireframe: true }),
  wpole: new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.95 }),
  wire: new THREE.LineBasicMaterial({ color: 0x1d2124, transparent: true, opacity: 0.75 }),
  pool: new THREE.MeshBasicMaterial({ map: poolTexture(), color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -8, polygonOffsetUnits: -12, toneMapped: false }),
};
const SCAN = {
  pole: scanFill(0.12, 0.16, 0.18), head: scanFill(2.4, 1.6, 0.55), hyd: scanFill(2.6, 0.45, 0.3),
  tower: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.6, 1.75), wireframe: true, toneMapped: false, transparent: true, opacity: 0.8 }),
  wpole: scanFill(0.2, 0.55, 0.6), wire: scanLine(0x8ff4fb, 0.6),
};

function inst(geo, mat, scan, pts, y = (x, z) => elev(x, z), rot = () => 0) {
  const n = Math.max(1, pts.length), m = new THREE.InstancedMesh(geo, mat, n);
  pts.forEach((p, i) => { q.setFromAxisAngle(UPV, rot(p)); v.set(p.x, y(p.x, p.z), p.z); m4.compose(v, q, s1); m.setMatrixAt(i, m4); });
  m.count = pts.length; m.castShadow = true; m.userData.scanMat = scan; return m;
}
const ang = (x, z) => Math.abs(Math.sin(x * 12.9898 + z * 78.233)) * Math.PI * 2;

/** Sag a straight span into a hanging wire: n pieces, dropping `sag` metres at the middle. */
function span(out, a, b, ya, yb, off, sag, n = 8) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L * off, nz = dx / L * off;
  let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= n; k++) {
    const t = k / n, x = a[0] + dx * t + nx, z = a[1] + dz * t + nz, y = ya + (yb - ya) * t - sag * 4 * t * (1 - t);
    if (k) out.push(px, py, pz, x, y, z); px = x; py = y; pz = z;
  }
}

/** Build the 3D layer. I is layoutInfra() output. Returns { group, setGlow(g), setScan(on) }. */
export function buildInfra(I) {
  const G = new THREE.Group(); G.name = 'camino-infra';
  if (!I) return { group: G, setGlow() {}, setScan() {} };
  const poles = I.lights.filter((l) => l.pole);
  const lightPoles = inst(POLE_G, MAT.pole, SCAN.pole, poles, undefined, (p) => ang(p.x, p.z));
  const heads = inst(HEAD_G, MAT.head, SCAN.head, poles, undefined, (p) => ang(p.x, p.z)); heads.castShadow = false;
  const hyd = inst(HYD_G, MAT.hyd, SCAN.hyd, I.hydrants, (x, z) => elev(x, z) + 0.12);
  // pools of light under every real city light (pack lamps too), shown from dusk on
  const pool = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), MAT.pool, Math.max(1, I.lights.length));
  I.lights.forEach((l, i) => { const r = l.w >= 150 ? 19 : l.w >= 90 ? 15 : 12; v.set(l.x, elev(l.x, l.z) + 0.55, l.z); m4.compose(v, q.identity(), new THREE.Vector3(r, 1, r)); pool.setMatrixAt(i, m4); });
  pool.count = I.lights.length; pool.renderOrder = 4; pool.frustumCulled = false; pool.userData.scanHide = true;
  // transmission (CEC): towers and three sagging conductors per span
  const tw = []; const wires = [];
  for (const t of I.trans) {
    t.towers.forEach((p) => tw.push({ x: p[0], z: p[1] }));
    for (let k = 1; k < t.towers.length; k++) { const a = t.towers[k - 1], b = t.towers[k], ya = elev(a[0], a[1]) + 29, yb = elev(b[0], b[1]) + 29; for (const off of [-5.5, 0, 5.5]) span(wires, a, b, ya + (off ? 0 : -5), yb + (off ? 0 : -5), off, Math.min(9, Math.hypot(b[0] - a[0], b[1] - a[1]) / 40)); }
  }
  for (const p of I.towers) tw.push(p);
  const towers = inst(TOWER_G, MAT.tower, SCAN.tower, tw, undefined, (p) => ang(p.x, p.z) * 0.1);
  // OSM distribution lines and poles, only where mapped
  for (const l of I.plines) for (let k = 1; k < l.p.length; k++) { const a = l.p[k - 1], b = l.p[k]; span(wires, a, b, elev(a[0], a[1]) + 9.6, elev(b[0], b[1]) + 9.6, 0, Math.min(1.2, Math.hypot(b[0] - a[0], b[1] - a[1]) / 60), 4); }
  const wpoles = inst(WPOLE_G, MAT.wpole, SCAN.wpole, I.poles);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wires, 3));
  const wireLines = new THREE.LineSegments(wg, MAT.wire); wireLines.userData.scanMat = SCAN.wire;
  G.add(lightPoles, heads, hyd, pool, towers, wpoles, wireLines);
  return {
    group: G,
    setGlow(g) { MAT.pool.opacity = 0.5 * g; pool.visible = g > 0.04 && !pool.userData.scanOff; MAT.head.emissive.setRGB(1.6 * g, 1.25 * g, 0.75 * g); },
    setScan(on) { for (const o of G.children) { if (o.userData.scanHide) { o.userData.scanOff = on; o.visible = !on && MAT.pool.opacity > 0.02; continue; } if (!o.userData.base) o.userData.base = o.material; o.material = on ? o.userData.scanMat : o.userData.base; o.castShadow = !on && o !== wireLines && o !== heads; } },
  };
}
