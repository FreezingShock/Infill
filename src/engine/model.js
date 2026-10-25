import PC from 'polygon-clipping';
import { PACK } from './pack.js';
import { area, bbox, centroid, elev, inPoly, nearestOnLine, pcSafe, pick, ringDistToLine, rng, segDist2, toPC } from './core.js';

// =====================================================================
// World model: road graph -> blocks -> parcels -> programs -> generated scene
// =====================================================================
const LT = {
  house: { name: 'House lot', col: 0x9fbf7a },
  multi: { name: 'Small multi', col: 0xe0b85a },
  apts: { name: 'Apartments', col: 0xd98a4e },
  main: { name: 'Main street', col: 0xc4613b },
  parking: { name: 'Parking lot', col: 0x8a8580 },
  civic: { name: 'Civic and open', col: 0x7d9fc9 },
  vacant: { name: 'Vacant', col: 0xcdb98f },
};
const ZONES = {
  R1: { name: 'R1 One-family', front: 6.1, side: 1.5, rear: 4.6, st: 2, allow: ['house'] },
  RE11: { name: 'RE11 Residential estate', front: 7.6, side: 1.5, rear: 7.6, st: 2, allow: ['house'] },
  R2: { name: 'R2 Two-family', front: 4.6, side: 1.5, rear: 4.6, st: 3, allow: ['house', 'multi'] },
  R3: { name: 'R3 Multiple dwelling', front: 4.6, side: 1.5, rear: 4.6, st: 4, allow: ['house', 'multi', 'apts'] },
  RAS4: { name: 'RAS4 Residential/accessory', front: 1.5, side: 1.5, rear: 4.6, st: 5, allow: ['multi', 'apts', 'main'] },
  C2: { name: 'C2 Commercial', front: 0, side: 0, rear: 0, st: 4, allow: ['main', 'apts', 'multi', 'parking'] },
  P: { name: 'P Parking', front: 1.5, side: 0, rear: 0, st: 1, allow: ['parking'] },
  PF: { name: 'PF Public facilities', front: 3, side: 1.5, rear: 3, st: 3, allow: ['civic', 'parking'] },
  OS: { name: 'OS Open space', front: 0, side: 0, rear: 0, st: 1, allow: ['civic'] },
};
const ZONE_CODES = ['R1-1', 'RE11-1', 'R2-1', 'R3-1', 'RAS4-1', 'C2-1VL', 'P-1', 'PF-1', 'OS-1'];
const zfam = (z) => (z || 'R1').split('-')[0];
const zrule = (z) => ZONES[zfam(z)] || ZONES.R1;
const DREAM = { name: 'Dream', front: 0.5, side: 0.5, rear: 0.5, st: 8, allow: Object.keys(LT) };
const PAL = {
  sand: { w: 0xead7b5, r: 0x9a5a3c }, terracotta: { w: 0xf1e2c4, r: 0xbb5836 }, sage: { w: 0xdfe3cf, r: 0x6f7f5e },
  sky: { w: 0xdce8ee, r: 0x4f6470 }, cream: { w: 0xf4eadb, r: 0x8a6a52 }, white: { w: 0xf4f1ea, r: 0x4f4b48 },
  brick: { w: 0xc98a6b, r: 0x5d4a3e }, mint: { w: 0xd2e6d6, r: 0x5b7f73 }, butter: { w: 0xf2dfa2, r: 0x7a6a4a },
};
const ERA = (yr) => yr < 1945 ? 'bungalow' : yr < 1966 ? 'ranch' : yr < 1991 ? 'split' : 'stucco';
const ERA_NAME = { bungalow: 'Pre-1945 bungalow', ranch: '1945–65 ranch', split: '1966–90 split-level', stucco: '1990+ stucco' };
const ERA_STYLE = { bungalow: ['gable', ['cream', 'sage']], ranch: ['hip', ['sand', 'white', 'cream']], split: ['gable', ['sky', 'butter', 'white']], stucco: ['hip', ['terracotta', 'sand']] };

// ---------- street cross-sections (Streetmix-style element lists) ----------
const EL = {
  walk: { name: 'Sidewalk', c: 0xe6ddcc, curb: 1 }, trees: { name: 'Tree strip', c: 0xa7b98a, curb: 1 }, median: { name: 'Planted median', c: 0x8fa874, curb: 1 },
  park: { name: 'Parking', c: 0x77716b }, lane: { name: 'Car lane', c: 0x6c6662, car: 1 }, turn: { name: 'Turn lane', c: 0x6c6662 },
  bike: { name: 'Bike lane', c: 0x5f9e63 }, bus: { name: 'Bus lane', c: 0xa8554a, car: 1 }, shared: { name: 'Shared lane', c: 0xc79c7a },
  plaza: { name: 'Plaza', c: 0xdccdb0, curb: 1 },
};
const PRESETS = {
  complete: { name: 'Complete street', els: [['walk', 3], ['trees', 1.6], ['bike', 1.8], ['park', 2.4], ['lane', 3.3], ['turn', 3.2], ['lane', 3.3], ['park', 2.4], ['bike', 1.8], ['trees', 1.6], ['walk', 3]] },
  diet: { name: 'Road diet', els: [['walk', 2.2], ['park', 2.2], ['bike', 2.6], ['lane', 3.5], ['turn', 3.4], ['lane', 3.5], ['bike', 2.6], ['park', 2.2], ['walk', 2.2]] },
  slow: { name: 'Slow street', els: [['walk', 2.2], ['trees', 1.4], ['park', 2], ['shared', 3], ['shared', 3], ['park', 2], ['trees', 1.4], ['walk', 2.2]] },
  woonerf: { name: 'Woonerf', els: [['walk', 1.5], ['trees', 1.5], ['shared', 5.5], ['trees', 1.5], ['walk', 1.5]] },
  ped: { name: 'Pedestrian only', els: [['walk', 2], ['trees', 2], ['plaza', 5], ['trees', 2], ['walk', 2]] },
  alley: { name: 'Alley', els: [['shared', 5]] },
  local: { name: 'Local street', els: [['walk', 2.2], ['park', 2], ['lane', 2.5], ['lane', 2.5], ['park', 2], ['walk', 2.2]] },
};
const WALKABLE = new Set(['complete', 'diet', 'slow', 'woonerf', 'ped']);
function defaultProfile(e) {
  const w = e.w;
  if (e.c === 'primary') return { k: 'asbuilt', els: [['walk', 2.2], ['park', 2], ['lane', 3.25], ['lane', 3.25], ['turn', w - 17], ['lane', 3.25], ['lane', 3.25], ['park', 2], ['walk', 2.2]] };
  if (e.c === 'secondary') return { k: 'asbuilt', els: [['walk', 2.2], ['park', 2.5], ['lane', (w - 5) / 2], ['lane', (w - 5) / 2], ['park', 2.5], ['walk', 2.2]] };
  if (['tertiary', 'residential', 'unclassified'].includes(e.c) && e.s !== 'link') { const p = w >= 10 ? 2 : 1.6, l = (w - 2 * p) / 2; return { k: 'asbuilt', els: [['walk', 2.2], ['park', p], ['lane', l], ['lane', l], ['park', p], ['walk', 2.2]] }; }
  return { k: 'plain', els: [[e.s === 'driveway' ? 'drive' : 'lane', w]] };
}
const rowWidth = (prof) => prof.els.reduce((s, e) => s + e[1], 0);
const curbHalf = (e) => rowWidth(e.prof) / 2;

// ---------- base state ----------
const BLD = PACK.buildings;
BLD.forEach((b) => { b.bb = bbox(b.r); });
function mkLot(l) {
  const lot = { id: l.id, r: l.r, a: l.a || null, c: l.c, e: l.e, m2: l.m2, blk: l.blk, rd: l.rd, fp: l.fp, fd: l.fd, fr: l.fr, dp: l.dp, wd: l.wd,
    lt: l.lt, z: l.z, yr: l.yr, st0: l.st, u0: l.u, b: l.b.slice(), sh: l.sh || [], sd: l.sd, flags: {}, pk: [], ain: l.ain || null, zr: l.zr || null, gp: l.gp || null, ys: l.ys || null };
  lot.bb = bbox(lot.r);
  lot.prog = inferProgram(lot);
  return lot;
}
function inferProgram(lot) {
  const era = ERA(lot.yr), [roof, pals] = ERA_STYLE[era], r = rng(lot.sd + 7);
  const bl = lot.b.map((i) => BLD[i]);
  const big = bl.some((b) => b.a > 900 || b.t === 'commercial' || b.t === 'industrial' || b.t === 'education' || b.t === 'civic');
  const pr = { t: 'asb', st: lot.st0 || 1, rf: big || lot.lt === 'main' || lot.lt === 'apts' ? 'flat' : roof, pl: big ? pick(r, ['white', 'sand', 'cream']) : pick(r, pals), sd: lot.sd };
  return pr;
}
function mkEdge(e) { const E = { id: e.id, a: e.a, b: e.b, p: e.p, c: e.c, s: e.s || null, n: e.n || null, w: e.w, g: e.g, grp: null }; E.prof = defaultProfile(E); E.bb = bbox(E.p); return E; }
function buildBase() {
  const S = { lots: new Map(), edges: new Map(), nodes: PACK.nodes.map((n) => n.slice()), blocks: PACK.blocks.map((r) => r), demo: new Set(), seq: 0, notes: [] };
  for (const l of PACK.lots) S.lots.set(l.id, mkLot(l));
  for (const e of PACK.edges) S.edges.set(e.id, mkEdge(e));
  // as-built paving: Overture parking polygons clipped to each lot
  const PK = PACK.parking.map((r) => ({ r, bb: bbox(r) }));
  for (const lot of S.lots.values()) {
    for (const p of PK) {
      if (p.bb[0] > lot.bb[2] || p.bb[2] < lot.bb[0] || p.bb[1] > lot.bb[3] || p.bb[3] < lot.bb[1]) continue;
      const res = pcSafe(PC.intersection, toPC(lot.r), toPC(p.r));
      if (res) for (const r of res) if (Math.abs(area(r)) > 25) lot.pk.push(r);
    }
  }
  return S;
}

// ---------- lot geometry upkeep after cuts, merges and splits ----------
function interiorPoint(r) {
  const c = centroid(r); if (inPoly(c[0], c[1], r)) return c;
  const bb = bbox(r); let best = null;
  for (let k = 1; k < 8; k++) {
    const z = bb[1] + (bb[3] - bb[1]) * k / 8, xs = [];
    for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if ((a[1] > z) !== (b[1] > z)) xs.push(a[0] + (z - a[1]) / (b[1] - a[1]) * (b[0] - a[0])); }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[0]) best = [xs[i + 1] - xs[i], (xs[i] + xs[i + 1]) / 2, z];
  }
  return best ? [best[1], best[2]] : c;
}
function graphEdges(S) { const out = []; for (const e of S.edges.values()) if (e.g && e.c !== 'motorway') out.push(e); return out; }
function lotMeta(lot, S) {
  lot.m2 = Math.round(Math.abs(area(lot.r))); lot.bb = bbox(lot.r);
  const c = interiorPoint(lot.r); lot.c = [c[0], c[1]]; lot.e = elev(c[0], c[1]);
  let best = null;
  for (const e of graphEdges(S)) {
    const bb = e.bb; if (bb[0] > lot.bb[2] + 60 || bb[2] < lot.bb[0] - 60 || bb[1] > lot.bb[3] + 60 || bb[3] < lot.bb[1] - 60) continue;
    const d = ringDistToLine(lot.r, e.p) - curbHalf(e);
    if (!best || d < best.d) best = { d, e };
  }
  if (!best || best.d > 14) { lot.flags.noaccess = true; if (!best) return; } else delete lot.flags.noaccess;
  const e = best.e, q = nearestOnLine(e.p, c[0], c[1]);
  lot.rd = e.id; lot.fp = [q.x, q.z];
  const dx = q.x - c[0], dz = q.z - c[1], L = Math.hypot(dx, dz) || 1; lot.fd = [dx / L, dz / L];
  let fr = 0; for (let i = 0; i < lot.r.length; i++) { const a = lot.r[i], b = lot.r[(i + 1) % lot.r.length]; const m = nearestOnLine(e.p, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); if (m.d < curbHalf(e) + 6) fr += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  lot.fr = Math.round(fr * 10) / 10;
  let p0 = 1e9, p1 = -1e9, w0 = 1e9, w1 = -1e9;
  for (const [x, z] of lot.r) { const p = x * lot.fd[0] + z * lot.fd[1], w = -x * lot.fd[1] + z * lot.fd[0]; p0 = Math.min(p0, p); p1 = Math.max(p1, p); w0 = Math.min(w0, w); w1 = Math.max(w1, w); }
  lot.dp = Math.round((p1 - p0) * 10) / 10; lot.wd = Math.round((w1 - w0) * 10) / 10;
  lot.blk = blockOf(S, lot.c);
}
function blockOf(S, c) { for (let i = 0; i < S.blocks.length; i++) { const r = S.blocks[i]; if (r && inPoly(c[0], c[1], r)) return i; } return -1; }
function liveBuildings(lot, S) { return lot.b.filter((i) => !S.demo.has(i)); }

// ---------- lot frame and the setback envelope grid ----------
// Local frame: s runs along the street, t runs from the front line (t=0) into the lot.
function frameOf(lot) {
  const fx = -lot.fd[0], fz = -lot.fd[1], ax = -fz, az = fx;
  let t0 = 1e9, t1 = -1e9, s0 = 1e9, s1 = -1e9;
  const c = lot.c;
  for (const [x, z] of lot.r) { const s = (x - c[0]) * ax + (z - c[1]) * az, t = (x - c[0]) * fx + (z - c[1]) * fz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
  const O = [c[0] + fx * t0, c[1] + fz * t0];
  return { ax, az, fx, fz, O, smin: s0, smax: s1, tmax: t1 - t0,
    P: (s, t) => [O[0] + ax * s + fx * t, O[1] + az * s + fz * t],
    L: (x, z) => [(x - O[0]) * ax + (z - O[1]) * az, (x - O[0]) * fx + (z - O[1]) * fz],
    R: (s0_, t0_, w, d) => { const s = s0_ + w / 2, t = t0_ + d / 2; return { x: O[0] + ax * s + fx * t, z: O[1] + az * s + fz * t, ux: ax, uz: az, vx: fx, vz: fz, hw: w / 2, hd: d / 2 }; } };
}
const GRID = new Map();
function lotGrid(lot) {
  const key = lot.id + '|' + lot.r.length + '|' + lot.r[0] + '|' + lot.fd;
  let g = GRID.get(key); if (g) return g;
  if (GRID.size > 4000) GRID.clear();
  const F = frameOf(lot), loc = lot.r.map(([x, z]) => F.L(x, z));
  const cs = lot.m2 > 9000 ? 3 : lot.m2 > 2500 ? 2 : 1;
  const nx = Math.max(1, Math.ceil((F.smax - F.smin) / cs)), ny = Math.max(1, Math.ceil(F.tmax / cs));
  const cl = []; // edge classes: 0 front, 1 side, 2 rear
  for (let i = 0; i < loc.length; i++) {
    const a = loc[i], b = loc[(i + 1) % loc.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    let nxx = -(b[1] - a[1]) / L, nyy = (b[0] - a[0]) / L;
    const mx = (a[0] + b[0]) / 2 + nxx * 0.2, my = (a[1] + b[1]) / 2 + nyy * 0.2;
    if (inPoly(mx, my, loc)) { nxx = -nxx; nyy = -nyy; }
    cl.push(nyy < -0.6 ? 0 : nyy > 0.6 ? 2 : 1);
  }
  const N = nx * ny, ins = new Uint8Array(N), dF = new Float32Array(N), dS = new Float32Array(N), dR = new Float32Array(N);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const s = F.smin + (i + 0.5) * cs, t = (j + 0.5) * cs, k = j * nx + i;
    if (!inPoly(s, t, loc)) continue; ins[k] = 1;
    let f = 1e9, sd = 1e9, rr = 1e9;
    for (let e = 0; e < loc.length; e++) { const a = loc[e], b = loc[(e + 1) % loc.length], d = Math.sqrt(segDist2(s, t, a[0], a[1], b[0], b[1])); if (cl[e] === 0) f = Math.min(f, d); else if (cl[e] === 1) sd = Math.min(sd, d); else rr = Math.min(rr, d); }
    dF[k] = f; dS[k] = sd; dR[k] = rr;
  }
  g = { F, cs, nx, ny, ins, dF, dS, dR, loc }; GRID.set(key, g); return g;
}
// Largest rectangle near the requested size inside the envelope, aligned to the street.
function fitRect(lot, w, d, sb, o = {}) {
  const g = lotGrid(lot), { cs, nx, ny } = g, half = cs * 0.5;
  const M = new Uint8Array(nx * ny);
  for (let k = 0; k < M.length; k++) M[k] = g.ins[k] && g.dF[k] >= sb.front - half * 0.5 && g.dS[k] >= sb.side - half * 0.5 && g.dR[k] >= sb.rear - half * 0.5 && Math.min(g.dF[k], g.dS[k], g.dR[k]) >= half * 0.9 ? 1 : 0;
  if (o.avoid) for (const av of o.avoid) {
    const ring = av.map(([x, z]) => g.F.L(x, z)), gap = o.gap ?? 2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i; if (!M[k]) continue; const s = g.F.smin + (i + 0.5) * cs, t = (j + 0.5) * cs; if (inPoly(s, t, ring)) { M[k] = 0; continue; } for (let e = 0; e < ring.length; e++) { const a = ring[e], b = ring[(e + 1) % ring.length]; if (segDist2(s, t, a[0], a[1], b[0], b[1]) < gap * gap) { M[k] = 0; break; } } }
  }
  const S = new Int32Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) S[(j + 1) * (nx + 1) + i + 1] = M[j * nx + i] + S[j * (nx + 1) + i + 1] + S[(j + 1) * (nx + 1) + i] - S[j * (nx + 1) + i];
  const sum = (i, j, W, D) => S[(j + D) * (nx + 1) + i + W] - S[j * (nx + 1) + i + W] - S[(j + D) * (nx + 1) + i] + S[j * (nx + 1) + i];
  const minS = o.minScale ?? 0.6, rear = o.pref === 'rear', centre = (nx - 1) / 2;
  for (let sc = 1; sc >= minS - 1e-6; sc -= 0.08) {
    const W = Math.max(1, Math.round(w * sc / cs)), D = Math.max(1, Math.round(d * (o.keepDepth ? 1 : sc) / cs));
    if (W > nx || D > ny) continue;
    for (let jj = 0; jj <= ny - D; jj++) {
      const j = rear ? ny - D - jj : jj; let bi = -1, bd = 1e9;
      for (let i = 0; i <= nx - W; i++) if (sum(i, j, W, D) === W * D) { const dd = Math.abs(i + W / 2 - 0.5 - centre); if (dd < bd) { bd = dd; bi = i; } }
      if (bi >= 0) { const s0 = g.F.smin + bi * cs, t0 = j * cs; return { R: g.F.R(s0, t0, W * cs, D * cs), s0, t0, w: W * cs, d: D * cs, F: g.F }; }
    }
  }
  return null;
}

export {
  BLD,
  DREAM,
  EL,
  ERA,
  ERA_NAME,
  LT,
  PAL,
  PRESETS,
  WALKABLE,
  ZONES,
  ZONE_CODES,
  buildBase,
  curbHalf,
  fitRect,
  frameOf,
  inferProgram,
  liveBuildings,
  lotMeta,
  rowWidth,
  zfam,
  zrule,
};
