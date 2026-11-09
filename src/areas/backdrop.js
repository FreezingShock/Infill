// The real map beyond the playable box, drawn as a soft low-detail backdrop that fades into the fog
// (terrain, main streets, and building coverage as blocks). Built by tools/pack/backdrop.py into
// <area>.bg.json in the pack's own local metres. Pointing at it offers to open or build that part of the Valley.
// Read-only: it never changes the game state, and the game runs fine without the file.
import * as THREE from 'three';
import { AREA, PACK } from '../engine/pack.js';
import { X0, X1, Z0, Z1, elev as coreElev } from '../engine/core.js';

const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const ROAD_W = { m: 16, p: 12, s: 9, r: 6 };
const TONES = [0xe9dfcc, 0xdcd2c0, 0xd2c8b6, 0xe3d6bf, 0xcfc6b8].map((c) => new THREE.Color(c));

/** Draws the backdrop into `scene`; returns { dispose } or null when this area has none. */
export async function initBackdrop({ scene, cam, canvas, onPick }) {
  if (!AREA.bg) return null;
  let D;
  try { const r = await fetch(`areas/${AREA.bg}`); if (!r.ok) return null; D = await r.json(); } catch { return null; }
  const T = D.terrain, H = Float32Array.from(T.h, (v) => v / 10);
  const grid = (x, z) => { // backdrop terrain height, bilinear
    const fx = (x - T.minx) / T.cell, fz = (z - T.minz) / T.cell;
    const i = Math.min(Math.max(Math.floor(fx), 0), T.nx - 2), j = Math.min(Math.max(Math.floor(fz), 0), T.nz - 2);
    const dx = Math.min(Math.max(fx - i, 0), 1), dz = Math.min(Math.max(fz - j, 0), 1);
    return H[j * T.nx + i] * (1 - dx) * (1 - dz) + H[j * T.nx + i + 1] * dx * (1 - dz) + H[(j + 1) * T.nx + i] * (1 - dx) * dz + H[(j + 1) * T.nx + i + 1] * dx * dz;
  };
  const outside = (x, z) => Math.max(X0 - x, x - X1, Z0 - z, z - Z1, 0); // metres beyond the playable box
  const ground = (x, z) => { // the playable terrain at the border, easing into the backdrop terrain beyond it
    const d = outside(x, z), c = coreElev(x, z);
    return d <= 0 ? c - 0.5 : c + (grid(x, z) - c) * smooth(d / 160);
  };
  const group = new THREE.Group(); group.name = 'backdrop';
  // --- building coverage raster, also used to tint the ground under towns
  const bn = [Math.ceil((T.nx * T.cell) / D.bcell) + 2, Math.ceil((T.nz * T.cell) / D.bcell) + 2];
  const cov = new Float32Array(bn[0] * bn[1]);
  for (let k = 0; k < D.cells.length; k += 4) cov[D.cells[k + 1] * bn[0] + D.cells[k]] = D.cells[k + 3] / 100;
  const covAt = (x, z) => { const i = Math.floor((x - D.bx0) / D.bcell), j = Math.floor((z - D.bz0) / D.bcell); return i < 0 || j < 0 || i >= bn[0] || j >= bn[1] ? 0 : cov[j * bn[0] + i]; };
  // --- terrain
  {
    const pos = new Float32Array(T.nx * T.nz * 3), col = new Float32Array(T.nx * T.nz * 3), tmp = new THREE.Color();
    const grass = new THREE.Color(0xa3b58b), dry = new THREE.Color(0xcdbf8c), town = new THREE.Color(0xcbc3ae);
    for (let j = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++) {
      const k = j * T.nx + i, x = T.minx + i * T.cell, z = T.minz + j * T.cell;
      pos[k * 3] = x; pos[k * 3 + 1] = ground(x, z) - 0.4; pos[k * 3 + 2] = z;
      const hx = H[j * T.nx + Math.min(i + 1, T.nx - 1)] - H[j * T.nx + Math.max(i - 1, 0)], hz = H[Math.min(j + 1, T.nz - 1) * T.nx + i] - H[Math.max(j - 1, 0) * T.nx + i];
      const slope = Math.hypot(hx, hz) / (2 * T.cell);
      tmp.copy(grass).lerp(dry, Math.min(1, Math.max(0, (slope - 0.1) * 4))).lerp(town, Math.min(0.85, covAt(x, z) * 2.4));
      col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
    }
    const idx = [];
    for (let j = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) { const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1; idx.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true })); m.receiveShadow = false; group.add(m);
  }
  // --- streets as ribbons
  {
    const p = [], c = [], col = { m: new THREE.Color(0x77716a), p: new THREE.Color(0x7d7872), s: new THREE.Color(0x8a847c), r: new THREE.Color(0x9a948a) };
    for (const [k, list] of Object.entries(D.roads)) for (const flat of list) {
      const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push([flat[i], flat[i + 1]]);
      const P = []; for (let i = 0; i < pts.length - 1; i++) { const [a, b] = [pts[i], pts[i + 1]], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 25)); for (let s = 0; s < n; s++) P.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]); }
      P.push(pts[pts.length - 1]);
      const w = ROAD_W[k] / 2, C = col[k];
      const side = (i, o) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; const x = P[i][0] - dz / L * o, z = P[i][1] + dx / L * o; return [x, ground(x, z) + 0.15, z]; };
      for (let i = 0; i < P.length - 1; i++) {
        const q = [side(i, -w), side(i, w), side(i + 1, w), side(i + 1, -w)];
        for (const t of [[0, 1, 2], [0, 2, 3]]) for (const v of t) { p.push(...q[v]); c.push(C.r, C.g, C.b); }
      }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); group.add(m);
  }
  // --- buildings as blocks, one per 30 m cell
  {
    const n = D.cells.length / 4, geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), n), M = new THREE.Matrix4(), q = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3();
    for (let k = 0, o = 0; k < D.cells.length; k += 4, o++) {
      const x = D.bx0 + (D.cells[k] + 0.5) * D.bcell, z = D.bz0 + (D.cells[k + 1] + 0.5) * D.bcell, h = Math.max(3.5, D.cells[k + 2] / 10), cv = D.cells[k + 3] / 100;
      const s = D.bcell * 0.82 * Math.sqrt(Math.min(1, Math.max(0.3, cv * 1.3)));
      pv.set(x, ground(x, z) - 0.2, z); sv.set(s, h, s); M.compose(pv, q, sv); mesh.setMatrixAt(o, M);
      mesh.setColorAt(o, TONES[(Math.abs(Math.floor(x * 7 + z * 13)) >> 2) % TONES.length]);
    }
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; mesh.frustumCulled = false; group.add(mesh);
  }
  scene.add(group);

  // --- pointing at the backdrop: a ghost box over the part of the Valley you could open
  const o = PACK.origin, KX = Math.cos(o[1] * Math.PI / 180) * 111320, KY = 110540;
  const SIDE = 1200, ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const ghost = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new THREE.Vector3(a * SIDE / 2, 0, b * SIDE / 2))), new THREE.LineBasicMaterial({ color: 0x2f7fb8 }));
  ghost.visible = false; ghost.frustumCulled = false; scene.add(ghost);
  const tip = document.createElement('div'); tip.className = 'bd-tip'; tip.hidden = true; document.body.appendChild(tip);
  const point = (e) => {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam);
    let y = 0, hit = null;
    for (let k = 0; k < 3; k++) { const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -y); hit = ray.ray.intersectPlane(pl, new THREE.Vector3()); if (!hit) return null; y = ground(hit.x, hit.z); }
    return hit;
  };
  const inRing = (x, z) => x > T.minx && x < T.minx + (T.nx - 1) * T.cell && z > T.minz && z < T.minz + (T.nz - 1) * T.cell && outside(x, z) > 40;
  const where = (h) => ({ lon: o[0] + h.x / KX, lat: o[1] - h.z / KY });
  let down = null;
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) { ghost.visible = false; tip.hidden = true; return; }
    const h = point(e);
    if (!h || !inRing(h.x, h.z)) { ghost.visible = false; tip.hidden = true; canvas.classList.remove('bd-hover'); return; }
    ghost.position.set(h.x, ground(h.x, h.z) + 2, h.z); ghost.visible = true;
    tip.hidden = false; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; tip.textContent = 'Click to open or build this part of the Valley';
    canvas.classList.add('bd-hover');
  });
  canvas.addEventListener('pointerleave', () => { ghost.visible = false; tip.hidden = true; });
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, b: e.button }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || down.b !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) { down = null; return; }
    down = null; const h = point(e);
    if (h && inRing(h.x, h.z) && onPick) onPick(where(h));
  });
  return { group, dispose() { scene.remove(group, ghost); tip.remove(); } };
}
