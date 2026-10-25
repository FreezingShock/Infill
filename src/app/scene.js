import * as THREE from 'three';
import { PACK } from '../engine/pack.js';
import { Acc, C, HG, T, X0, X1, Z0, Z1, alongPts, area, bbox, dashed, densify, disposeTree, elev, inPoly, lineGeo, obox, offsetLine, ribbon, rng } from '../engine/core.js';
import { EL, liveBuildings, rowWidth } from '../engine/model.js';
import { genLot } from '../engine/templates.js';
import { BASE } from '../engine/commands.js';
import { INK, MAT, toon } from './render.js';

// =====================================================================
// Generated scene: never saved, rebuilt from programs. Lots merge into chunks.
// =====================================================================
const CH = 110;
// grid index over lot bounds for instant picking, lasso and brush
class LotIndex {
  constructor(lots, cell = 40) { this.cell = cell; this.m = new Map(); this.lots = lots; for (const l of lots) { const b = l.bb; for (let i = Math.floor(b[0] / cell); i <= Math.floor(b[2] / cell); i++) for (let j = Math.floor(b[1] / cell); j <= Math.floor(b[3] / cell); j++) { const k = i + ',' + j; if (!this.m.has(k)) this.m.set(k, []); this.m.get(k).push(l); } } }
  at(x, z) { const a = this.m.get(Math.floor(x / this.cell) + ',' + Math.floor(z / this.cell)); if (!a) return null; for (const l of a) { const b = l.bb; if (x < b[0] || x > b[2] || z < b[1] || z > b[3]) continue; if (inPoly(x, z, l.r)) return l; } return null; }
  near(x, z, r) { const out = new Set(), c = this.cell; for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) for (const l of this.m.get(i + ',' + j) || []) if ((l.c[0] - x) ** 2 + (l.c[1] - z) ** 2 <= r * r) out.add(l); return out; }
}
const BASE_LOT_GRID = new LotIndex([...BASE.lots.values()]);
const GEN = new Map(); // lot hash -> generated lot, shared by the before and after worlds
function lotHash(lot, S) { return JSON.stringify([lot.id, lot.r, lot.prog, liveBuildings(lot, S), lot.z, lot.fd, lot.flags.noaccess ? 1 : 0, lot.pk.length, lot.lt]); }
function genCached(lot, S) {
  const h = lotHash(lot, S); let g = GEN.get(h);
  if (!g) { g = genLot(lot, S); g.h = h; if (GEN.size > 9000) GEN.clear(); GEN.set(h, g); }
  return g;
}
const chunkKey = (c) => Math.floor((c[0] - X0) / CH) + ',' + Math.floor((c[1] - Z0) / CH);
function concatAcc(gens, key) {
  let n = 0, nl = 0; for (const g of gens) { n += g[key].p.length; nl += g[key].l.length; }
  const p = new Float32Array(n), c = new Float32Array(n), l = new Float32Array(nl); let o = 0, ol = 0;
  for (const g of gens) { const a = g[key]; p.set(a.p, o); c.set(a.c, o); o += a.p.length; l.set(a.l, ol); ol += a.l.length; }
  return { p, c, l };
}
function meshFrom(arr, mat, shadow) {
  if (!arr.p.length) return null;
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(arr.p, 3)); g.setAttribute('color', new THREE.BufferAttribute(arr.c, 3)); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); if (shadow) { m.castShadow = true; m.receiveShadow = true; } else m.receiveShadow = true; return m;
}
function lotObject(gens) {
  const grp = new THREE.Group();
  const s = concatAcc(gens, 's'), gl = concatAcc(gens, 'g'), d = concatAcc(gens, 'd');
  const a = meshFrom(s, MAT.solid, true), b = meshFrom(gl, MAT.glass, false), c = meshFrom(d, MAT.ground, false);
  if (a) grp.add(a); if (b) grp.add(b); if (c) grp.add(c);
  if (s.l.length) grp.add(new THREE.LineSegments(lineGeo(s.l), INK));
  return grp;
}

// ---------- trees, cars ----------
const TREE_COLS = [0x6f9a52, 0x7fa65a, 0x5d8a4a, 0x8aab5e, 0x6a8f58].map((h) => new THREE.Color(h));
const TREE_KINDS = (() => {
  const mk = (geo, y) => { geo.translate(0, y, 0); return geo; };
  return [
    { f: mk(new THREE.IcosahedronGeometry(2.6, 0), 5), t: mk(new THREE.CylinderGeometry(0.25, 0.35, 3.4, 5), 1.7) },
    { f: mk(new THREE.ConeGeometry(2.1, 6.5, 7), 5.4), t: mk(new THREE.CylinderGeometry(0.22, 0.3, 2.4, 5), 1.2) },
    { f: mk(new THREE.IcosahedronGeometry(1.9, 0).scale(1, 0.55, 1), 10), t: mk(new THREE.CylinderGeometry(0.2, 0.28, 10, 5), 5) },
    { f: mk(new THREE.IcosahedronGeometry(1.1, 0), 0.8), t: null },
  ];
})();
const TRUNK = toon({ color: 0x7a5636 }), SHELL = new THREE.MeshBasicMaterial({ color: 0x2b2420, side: THREE.BackSide });
const FOL = toon({ color: 0xffffff });
const CAR_COLS = [0xc4613b, 0x3e9fdc, 0xf4f1ea, 0x4f4b48, 0xd6ad57, 0x8ea67a].map((h) => new THREE.Color(h));
const CAR_BODY = new THREE.BoxGeometry(1.8, 1.0, 4.3).translate(0, 0.5, 0), CAR_TOP = new THREE.BoxGeometry(1.6, 0.75, 2.2).translate(0, 1.35, -0.2);
function instTrees(list) {
  const grp = new THREE.Group(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
  TREE_KINDS.forEach((K, k) => {
    const items = list.filter((t) => t[4] === k); if (!items.length) return;
    const f = new THREE.InstancedMesh(K.f, FOL, items.length), sh = new THREE.InstancedMesh(K.f, SHELL, items.length), tr = K.t ? new THREE.InstancedMesh(K.t, TRUNK, items.length) : null;
    items.forEach((t, i) => {
      v.set(t[0], t[1], t[2]); sc.setScalar(t[3]); m4.compose(v, q, sc); f.setMatrixAt(i, m4); if (tr) tr.setMatrixAt(i, m4);
      sc.setScalar(t[3] * 1.09); v.y = t[1] - 0.1 * t[3]; m4.compose(v, q, sc); sh.setMatrixAt(i, m4);
      f.setColorAt(i, TREE_COLS[t[5] % 5]);
    });
    f.castShadow = true; if (tr) tr.castShadow = true;
    grp.add(f, sh); if (tr) grp.add(tr);
  });
  return grp;
}
function instCars(list) {
  if (!list.length) return new THREE.Group();
  const grp = new THREE.Group(), a = new THREE.InstancedMesh(CAR_BODY, FOL, list.length), b = new THREE.InstancedMesh(CAR_TOP, toon({ color: 0x3a4a55 }), list.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s1 = new THREE.Vector3(1, 1, 1), ax = new THREE.Vector3(0, 1, 0);
  list.forEach((c, i) => { v.set(c[0], c[1] - 0.3, c[2]); q.setFromAxisAngle(ax, c[3]); m4.compose(v, q, s1); a.setMatrixAt(i, m4); b.setMatrixAt(i, m4); a.setColorAt(i, CAR_COLS[c[4] % 6]); });
  a.castShadow = true; grp.add(a, b); return grp;
}

// ---------- streets from cross-section profiles ----------
const ROAD_ORDER = { service: 0, unknown: 0, unclassified: 1, residential: 1, tertiary: 2, secondary: 3, primary: 4, motorway: 5 };
function buildRoads(S) {
  const acc = new Acc(), marks = new Acc(), trees = [];
  const YEL = C(0xe9c24a), WHITE = C(0xf5f2ea), DRIVE = C(0xcbc1b0), ASPH = { motorway: C(0x5f5a57), primary: C(0x66615d), secondary: C(0x6c6662), tertiary: C(0x75706a), residential: C(0x7d7771), unclassified: C(0x7d7771), service: C(0x8a837c), unknown: C(0x8a837c) };
  const E = [...S.edges.values()].sort((a, b) => (ROAD_ORDER[a.c] ?? 0) - (ROAD_ORDER[b.c] ?? 0));
  for (const pass of [0, 1]) for (const e of E) {
    const els = e.prof.els, row = rowWidth(e.prof), base = 0.26 + (ROAD_ORDER[e.c] ?? 0) * 0.02;
    if (e.prof.k === 'plain') { if (pass === 1) ribbon(acc, e.p, -row / 2, row / 2, e.s === 'driveway' ? 0.2 : base, e.s === 'driveway' ? DRIVE : ASPH[e.c] || ASPH.service); continue; }
    let o = -row / 2;
    for (const [k, w] of els) {
      const d = EL[k] || EL.lane, curb = !!d.curb;
      if ((pass === 0) === curb) {
        const col = (k === 'lane' || k === 'turn' || k === 'park') && e.prof.k === 'asbuilt' ? (k === 'park' ? ASPH[e.c].clone().offsetHSL(0, 0, 0.03) : ASPH[e.c]) : C(d.c);
        ribbon(acc, e.p, o, o + w, curb ? (k === 'median' ? base + 0.06 : 0.16) : base, col);
        if (k === 'trees' || k === 'median') alongPts(offsetLine(e.p, o + w / 2), k === 'median' ? 12 : 9, (x, z) => trees.push([x, elev(x, z), z, k === 'median' ? 0.85 : 0.9, e.c === 'primary' && e.prof.k === 'complete' ? 2 : 0, Math.floor(Math.abs(x * 7 + z * 3)) % 5]));
      }
      o += w;
    }
    if (pass === 1) { // markings
      let o2 = -row / 2; const pos = [];
      for (const [k, w] of els) { pos.push([k, o2, o2 + w]); o2 += w; }
      const hasTurn = pos.some((p) => p[0] === 'turn');
      for (let i = 0; i < pos.length; i++) {
        const [k, a, b] = pos[i], nk = pos[i + 1]?.[0];
        if (k === 'turn') { ribbon(marks, e.p, a + 0.1, a + 0.28, base + 0.16, YEL, 2); ribbon(marks, e.p, b - 0.28, b - 0.1, base + 0.16, YEL, 2); }
        if ((k === 'lane' || k === 'bus') && (nk === 'lane' || nk === 'bus')) {
          if (!hasTurn && Math.abs(b) < 0.6) { ribbon(marks, e.p, b - 0.32, b - 0.14, base + 0.16, YEL, 2); ribbon(marks, e.p, b + 0.14, b + 0.32, base + 0.16, YEL, 2); }
          else dashed(marks, e.p, b - 0.08, b + 0.08, base + 0.16, WHITE, 3, 6);
        }
        if (k === 'bike' && (nk === 'lane' || nk === 'park' || nk === 'turn')) ribbon(marks, e.p, b - 0.12, b + 0.04, base + 0.16, WHITE, 3);
        if ((nk === 'bike') && (k === 'lane' || k === 'park' || k === 'turn')) ribbon(marks, e.p, b - 0.04, b + 0.12, base + 0.16, WHITE, 3);
        if (k === 'shared' && nk === 'shared') dashed(marks, e.p, b - 0.06, b + 0.06, base + 0.16, C(0xf0e2c8), 1, 2);
      }
    }
  }
  const grp = new THREE.Group();
  const m1 = new THREE.Mesh(acc.geo(), toon({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })); m1.receiveShadow = true;
  const m2 = new THREE.Mesh(marks.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
  grp.add(m1, m2); grp.userData.trees = trees;
  return grp;
}
function buildWalks() { // mapped sidewalks, paths and crossings from the data
  const acc = new Acc(), marks = new Acc(), WALK = C(0xe6ddcc), PATH = C(0xd3c19c), WHITE = C(0xf5f2ea);
  for (const w of PACK.walks) {
    if (w.k === 'crosswalk') dashed(marks, w.p, -1.6, 1.6, 0.5, WHITE, 0.6, 0.6);
    else if (w.k === 'sidewalk') ribbon(acc, w.p, -0.9, 0.9, 0.38, WALK, 3);
    else ribbon(acc, w.p, -0.7, 0.7, 0.36, PATH, 3);
  }
  const g = new THREE.Group();
  g.add(new THREE.Mesh(acc.geo(), toon({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 })));
  g.add(new THREE.Mesh(marks.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 })));
  return g;
}

// ---------- a world = one city state rendered ----------
class World {
  constructor() { this.group = new THREE.Group(); this.lotRoot = new THREE.Group(); this.group.add(this.lotRoot); this.rendered = new Map(); this.chunks = new Map(); this.roads = null; this.roadKey = ''; this.inst = null; this.gens = new Map(); this.held = new Set(); }
  sync(S, hold = new Set()) {
    const dirty = new Set(), seen = new Set();
    for (const lot of S.lots.values()) {
      seen.add(lot.id);
      const g = genCached(lot, S), ck = chunkKey(lot.c), prev = this.rendered.get(lot.id);
      if (!prev || prev.h !== g.h || prev.ck !== ck || hold.has(lot.id) !== this.held.has(lot.id)) { if (prev) dirty.add(prev.ck); dirty.add(ck); this.rendered.set(lot.id, { h: g.h, ck }); }
      this.gens.set(lot.id, g);
    }
    for (const [id, r] of this.rendered) if (!seen.has(id)) { dirty.add(r.ck); this.rendered.delete(id); this.gens.delete(id); }
    this.held = new Set(hold);
    if (dirty.size) {
      const byChunk = new Map(); for (const [id, r] of this.rendered) { if (!dirty.has(r.ck)) continue; if (!byChunk.has(r.ck)) byChunk.set(r.ck, []); if (!hold.has(id)) byChunk.get(r.ck).push(this.gens.get(id)); }
      for (const ck of dirty) {
        const old = this.chunks.get(ck); if (old) { this.lotRoot.remove(old); disposeTree(old); this.chunks.delete(ck); }
        const list = byChunk.get(ck); if (!list || !list.length) continue;
        const obj = lotObject(list); this.chunks.set(ck, obj); this.lotRoot.add(obj);
      }
    }
    const rk = JSON.stringify([...S.edges.values()].map((e) => [e.id, e.prof.k, e.prof.els.length, rowWidth(e.prof)]));
    if (rk !== this.roadKey) { if (this.roads) { this.group.remove(this.roads); disposeTree(this.roads); } this.roads = buildRoads(S); this.group.add(this.roads); this.roadKey = rk; dirty.add('roads'); }
    if (dirty.size) {
      if (this.inst) { this.group.remove(this.inst); disposeTree(this.inst); }
      const trees = [...this.roads.userData.trees, ...STATIC_TREES], cars = [];
      for (const [id, g] of this.gens) { for (const t of g.trees) trees.push(t); for (const c of g.cars) cars.push(c); void id; }
      this.inst = new THREE.Group(); this.inst.add(instTrees(trees), instCars(cars)); this.group.add(this.inst);
      this.treeCount = trees.length; this.carCount = cars.length;
    }
    return dirty.size;
  }
}

// ---------- static scenery: terrain, mapped walks, street props, trees on wild land ----------
function buildTerrain() {
  const pos = new Float32Array(T.nx * T.nz * 3), col = new Float32Array(T.nx * T.nz * 3);
  const grass = C(0xa3b58b), meadow = C(0x93ab7c), dry = C(0xd2bb7f), dirt = C(0xc2a77a), tmp = new THREE.Color();
  for (let j = 0; j < T.nz; j++) for (let i = 0; i < T.nx; i++) {
    const k = j * T.nx + i, h = HG[k];
    pos[k * 3] = T.minx + i * T.cell; pos[k * 3 + 1] = h; pos[k * 3 + 2] = T.minz + j * T.cell;
    const hx = HG[j * T.nx + Math.min(i + 1, T.nx - 1)] - HG[j * T.nx + Math.max(i - 1, 0)], hz = HG[Math.min(j + 1, T.nz - 1) * T.nx + i] - HG[Math.max(j - 1, 0) * T.nx + i];
    const slope = Math.hypot(hx, hz) / (2 * T.cell), n = (Math.sin(i * 0.37 + j * 0.11) + Math.sin(i * 0.07 - j * 0.29) + Math.sin((i + j) * 0.9)) / 3;
    tmp.copy(grass).lerp(meadow, 0.5 + n * 0.5); tmp.lerp(dry, Math.min(1, Math.max(0, (slope - 0.12) * 4))); if (slope > 0.45) tmp.lerp(dirt, 0.4);
    col[k * 3] = tmp.r; col[k * 3 + 1] = tmp.g; col[k * 3 + 2] = tmp.b;
  }
  const idx = []; for (let j = 0; j < T.nz - 1; j++) for (let i = 0; i < T.nx - 1; i++) { const a = j * T.nx + i, b = a + 1, c = a + T.nx, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, toon({ vertexColors: true })); m.receiveShadow = true;
  const sk = new Acc(), soil = C(0x8b6f4e), BOT = -12;
  const edge = (pts) => { for (let k = 0; k < pts.length - 1; k++) { const [x0, z0] = pts[k], [x1, z1] = pts[k + 1]; sk.quad([x0, BOT, z0], [x1, BOT, z1], [x1, elev(x1, z1), z1], [x0, elev(x0, z0), z0], soil); } };
  edge(densify([[X0, Z0], [X1, Z0]], T.cell)); edge(densify([[X1, Z0], [X1, Z1]], T.cell)); edge(densify([[X1, Z1], [X0, Z1]], T.cell)); edge(densify([[X0, Z1], [X0, Z0]], T.cell));
  return [m, new THREE.Mesh(sk.geo(), toon({ vertexColors: true, side: THREE.DoubleSide }))];
}
function buildProps() {
  const acc = new Acc(), glow = new Acc(), R = (x, z, a = 0, hw = 0.12, hd = 0.12) => ({ x, z, ux: Math.cos(a), uz: Math.sin(a), vx: -Math.sin(a), vz: Math.cos(a), hw, hd });
  const POLE = C(0x5d5148), BOX = C(0x2b2420), LAMP = C(0xffe2a8), SHEL = C(0x9db7c9);
  for (const [k, x, z] of PACK.props) {
    const y = elev(x, z);
    if (k === 'signal') { obox(acc, R(x, z), y, 6, POLE); obox(acc, R(x, z, 0, 0.35, 0.3), y + 4.4, 1.2, BOX); obox(glow, R(x, z, 0, 0.12, 0.33), y + 5.1, 0.25, C(0x6fd36f), false); }
    else if (k === 'lamp') { obox(acc, R(x, z), y, 7.5, POLE); obox(glow, R(x, z, 0, 0.45, 0.25), y + 7.2, 0.3, LAMP, false); }
    else if (k === 'bus') { obox(acc, R(x, z, 0, 1.6, 0.7), y + 2.4, 0.15, POLE); obox(glow, R(x - 0.0, z, 0, 1.5, 0.05), y, 2.3, SHEL, false); obox(acc, R(x, z + 0.4, 0, 0.08, 0.08), y, 2.4, POLE); }
    else if (k === 'bench') obox(acc, R(x, z, 0.3, 0.9, 0.3), y, 0.5, C(0xa8774d));
    else if (k === 'pole') obox(acc, R(x, z, 0, 0.14, 0.14), y, 9, C(0x8a6a4a));
    else if (k === 'bin') obox(acc, R(x, z, 0, 0.3, 0.3), y, 0.9, C(0x4f6470));
    else if (k === 'bike') obox(acc, R(x, z, 0, 1.2, 0.08), y, 0.8, POLE);
  }
  const g = new THREE.Group(), m = new THREE.Mesh(acc.geo(), MAT.solid); m.castShadow = true; g.add(m, new THREE.LineSegments(lineGeo(acc.l), INK));
  const lampMat = toon({ vertexColors: true, emissive: 0x000000 }); g.add(new THREE.Mesh(glow.geo(), lampMat)); g.userData.lampMat = lampMat;
  return g;
}
const STATIC_TREES = (() => { // forest and reserve land outside any lot: trees by rule, not from an inventory
  const out = [], r = rng(99);
  for (const u of PACK.landuse) {
    if (!['forest', 'nature_reserve'].includes(u.k)) continue;
    const bb = bbox(u.r), A = Math.abs(area(u.r)), n = Math.min(500, Math.round(A / 900));
    for (let k = 0; k < n * 3 && out.length < 900; k++) {
      const x = bb[0] + r() * (bb[2] - bb[0]), z = bb[1] + r() * (bb[3] - bb[1]);
      if (!inPoly(x, z, u.r)) continue;
      if (BASE_LOT_GRID.at(x, z)) continue;
      out.push([x, elev(x, z), z, 0.7 + r() * 0.6, r() < 0.3 ? 3 : 0, Math.floor(r() * 5)]);
    }
  }
  return out;
})();

export {
  LotIndex,
  World,
  buildProps,
  buildTerrain,
  buildWalks,
  genCached,
  lotObject,
};
