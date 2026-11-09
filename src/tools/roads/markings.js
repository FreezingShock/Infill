import { polyLen } from '../../engine/core.js';
import { EL, rowWidth } from '../../engine/model.js';

// =====================================================================
// Intersection-aware road details, as plain geometry for buildRoads to draw (no THREE here):
//   - where each leg's markings and median must stop so the box stays clean
//   - ladder crosswalks set back from the box, spanning the roadway kerb to kerb
//   - stop bars across the approaching lanes
//   - medians end before the crosswalk with a rounded nose
// One rule for every junction in every area.
// =====================================================================
const RANK = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1, unclassified: 1, service: 0, unknown: 0 };
const SKIP_LEG = (e) => e.s === 'driveway' || e.s === 'alley' || e.prof?.k === 'plain';
const BOX_MIN = 4, CW_HALF = 1.5, BAR_GAP = 1.3, NOSE_GAP = 0.6, NOSE_R = 1.75;

// point and tangent (a to b) at distance d from the start of polyline p
function at(p, d) {
  let acc = 0;
  for (let i = 1; i < p.length; i++) {
    const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
    if (acc + L >= d || i === p.length - 1) { const t = L ? Math.max(0, Math.min(1, (d - acc) / L)) : 0; return { x: p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, z: p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t, tx: L ? (p[i][0] - p[i - 1][0]) / L : 1, tz: L ? (p[i][1] - p[i - 1][1]) / L : 0 }; }
    acc += L;
  }
  return { x: p[0][0], z: p[0][1], tx: 1, tz: 0 };
}
// the part of p between distance t0 from its start and t1 from its end
function trimPath(p, t0, t1) {
  const L = polyLen(p); if (t0 + t1 >= L - 0.5) return [];
  if (t0 <= 0 && t1 <= 0) return p;
  const out = []; let acc = 0;
  const a = at(p, t0), b = at(p, L - t1);
  out.push([a.x, a.z]);
  for (let i = 1; i < p.length; i++) { acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (acc > t0 + 0.01 && acc < L - t1 - 0.01) out.push(p[i].slice()); }
  out.push([b.x, b.z]);
  return out;
}
// lateral extents (from -row/2) of the roadway proper, and of the lanes on one side
function zones(prof) {
  const row = rowWidth(prof); let o = -row / 2; const z = [];
  for (const [k, w] of prof.els) { z.push({ k, a: o, b: o + w, curb: !!EL[k]?.curb }); o += w; }
  return z;
}

function analyse(S) {
  const deg = new Map();
  for (const e of S.edges.values()) if (e.g && !SKIP_LEG(e)) for (const n of [e.a, e.b]) { if (!deg.has(n)) deg.set(n, []); deg.get(n).push(e); }
  const info = new Map(); // edge id -> { t0, t1, mt0, mt1 } distances to keep markings / median clear of the box
  const legs = [];
  const get = (e) => { let r = info.get(e.id); if (!r) { r = { t0: 0, t1: 0, mt0: 0, mt1: 0, nose: [] }; info.set(e.id, r); } return r; };
  for (const [n, es] of deg) {
    if (es.length < 3 || es.some((e) => e.ring) || es.filter((e) => e.taper).length >= 2) continue; // a merge into the two-way road is not an intersection
    const dirs = es.map((e) => { const atEnd = e.b === n, p = e.p, q = atEnd ? at(p, polyLen(p) - 4) : at(p, 4); const x0 = p[atEnd ? p.length - 1 : 0]; return [q.x - x0[0], q.z - x0[1]].map((v, _, a) => v / (Math.hypot(a[0], a[1]) || 1)); });
    es.forEach((e, i) => {
      const atEnd = e.b === n;
      // the box reaches as far as the widest street that crosses this one
      let box = BOX_MIN;
      es.forEach((q, j) => { if (j === i) return; const d = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]; if (Math.abs(d) < 0.8) box = Math.max(box, rowWidth(q.prof) / 2); });
      // a main road meeting only minor streets has priority: its lines run through, nothing crosses it
      const rk = (q) => RANK[q.c] ?? 1, priority = rk(e) >= 3 && es.every((q, j) => j === i || Math.abs(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]) >= 0.8 || rk(q) <= rk(e) - 2);
      if (priority) { const r = get(e), D2 = box + 2.2 + CW_HALF + NOSE_GAP + NOSE_R * 2; if (atEnd) r.mt1 = Math.max(r.mt1, D2); else r.mt0 = Math.max(r.mt0, D2); return; }
      const D = box + 2.2, len = polyLen(e.p);
      if (len < 2 * (D + CW_HALF + BAR_GAP) + 4) { const r = get(e); if (atEnd) r.t1 = len; else r.t0 = len; return; } // a short link inside the box: no markings at all
      const r = get(e), clear = D + CW_HALF + BAR_GAP;
      if (atEnd) { r.t1 = Math.max(r.t1, clear); r.mt1 = Math.max(r.mt1, D + CW_HALF + NOSE_GAP + NOSE_R * 2); } else { r.t0 = Math.max(r.t0, clear); r.mt0 = Math.max(r.mt0, D + CW_HALF + NOSE_GAP + NOSE_R * 2); }
      legs.push({ e, n, atEnd, D });
    });
  }
  return { info, legs };
}

// Everything to draw, in plain data:
//   ladders: { p:[[x,z],[x,z]], o1, o2 }   white stripes (ribbon along p between lateral o1..o2)
//   bars:    same shape, stop bars
//   noses:   { c:[x,z], u:[x,z], v:[x,z], r }   quarter discs capping a median half
function plan(S, walks = []) {
  const { info, legs } = analyse(S);
  const ladders = [], bars = [], noses = [], centres = [];
  for (const { e, atEnd, D } of legs) {
    const len = polyLen(e.p), dist = atEnd ? len - D : D, P = at(e.p, dist), z = zones(e.prof), road = z.filter((q) => !q.curb);
    if (!road.length) continue;
    centres.push([P.x, P.z]);
    const lo = Math.min(...road.map((q) => q.a)), hi = Math.max(...road.map((q) => q.b));
    const path = [[P.x - P.tx * CW_HALF, P.z - P.tz * CW_HALF], [P.x + P.tx * CW_HALF, P.z + P.tz * CW_HALF]];
    // ladder: bars along the traffic, evenly spaced across the roadway between the kerbs
    const span = hi - lo, n = Math.max(3, Math.round((span - 0.5) / 1.2)), pitch = span / n;
    for (let i = 0; i < n; i++) { const c = lo + pitch * (i + 0.5); ladders.push({ p: path, o1: c - 0.27, o2: c + 0.27, e }); }
    // stop bar across the lanes that approach the box
    const sg = atEnd ? 1 : -1, lanes = road.filter((q) => (q.k === 'lane' || q.k === 'bus' || q.k === 'shared' || q.k === 'bike' ? true : false) && (e.oneway ? (e.oneway === 1) === atEnd : (q.a + q.b) / 2 * sg > 0));
    if (lanes.length && !(e.oneway && (e.oneway === 1) !== atEnd)) {
      const a = Math.min(...lanes.map((q) => q.a)), b = Math.max(...lanes.map((q) => q.b)), d2 = dist + (atEnd ? -1 : 1) * (CW_HALF + 0.9), P2 = at(e.p, d2);
      bars.push({ p: [[P2.x - P2.tx * 0.22, P2.z - P2.tz * 0.22], [P2.x + P2.tx * 0.22, P2.z + P2.tz * 0.22]], o1: a + 0.15, o2: b - 0.15, e });
    }
    // median nose: quarter disc at the end of each carriageway's half-median
    const m = z.find((q) => q.k === 'median');
    if (m) {
      const first = z[0] === m, axis = first ? m.a : m.b, v = first ? 1 : -1, nd = atEnd ? len - (D + CW_HALF + NOSE_GAP + NOSE_R) : D + CW_HALF + NOSE_GAP + NOSE_R, Q = at(e.p, nd);
      const nx = -Q.tz, nz = Q.tx; // right of a to b
      noses.push({ c: [Q.x + nx * axis, Q.z + nz * axis], u: atEnd ? [Q.tx, Q.tz] : [-Q.tx, -Q.tz], v: [nx * v, nz * v], r: NOSE_R, e });
    }
  }
  // mapped crossings away from any junction crossing keep their place, drawn as the same ladder
  const mid = [];
  for (const w of walks) {
    if (w.k !== 'crosswalk' || w.p.length < 2) continue;
    const a = w.p[0], b = w.p[w.p.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 3) continue;
    const c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; if (centres.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < 22)) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, n = Math.max(3, Math.round((L - 0.5) / 1.2)), pitch = L / n;
    for (let i = 0; i < n; i++) { const t = pitch * (i + 0.5); const x = a[0] + ux * t, zz = a[1] + uz * t; mid.push({ p: [[x - uz * CW_HALF, zz + ux * CW_HALF], [x + uz * CW_HALF, zz - ux * CW_HALF]], o1: -0.27, o2: 0.27 }); }
  }
  return { info, ladders: ladders.concat(mid), bars, noses };
}

export { at, plan, trimPath, zones };
