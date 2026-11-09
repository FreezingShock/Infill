import { nearestOnLine, polyLen } from '../../engine/core.js';
import { EL, rowWidth } from '../../engine/model.js';
import { isFreewayJoin, rankOf } from './classes.js';

// =====================================================================
// Intersection-aware road details, as plain geometry for buildRoads to draw (no THREE here):
//   - where each leg's markings and median must stop so the box stays clean
//   - ladder crosswalks set back from the box, spanning the roadway kerb to kerb
//   - stop bars across the approaching lanes
//   - medians end before the crosswalk with a rounded nose
// One rule for every junction in every area.
// =====================================================================
const SKIP_LEG = (e) => e.xmed || e.s === 'driveway' || e.s === 'alley' || e.prof?.k === 'plain';
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

// three legs where two head the same way and the third the opposite way: a road splitting, not a crossing
function isFork(d) {
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
  for (let k = 0; k < 3; k++) { const a = d[(k + 1) % 3], b = d[(k + 2) % 3]; if (dot(a, b) > 0.7 && dot(d[k], a) < -0.7 && dot(d[k], b) < -0.7) return true; }
  return false;
}

function analyse(S) {
  const deg = new Map();
  for (const e of S.edges.values()) if (e.g && !SKIP_LEG(e)) for (const n of [e.a, e.b]) { if (!deg.has(n)) deg.set(n, []); deg.get(n).push(e); }
  const info = new Map(); // edge id -> { t0, t1, mt0, mt1 } distances to keep markings / median clear of the box
  const legs = [], openings = [];
  const get = (e) => { let r = info.get(e.id); if (!r) { r = { t0: 0, t1: 0, mt0: 0, mt1: 0, gaps: [] }; info.set(e.id, r); } return r; };
  for (const [n, es] of deg) {
    if (es.length < 3 || es.some((e) => e.ring) || es.filter((e) => e.taper).length >= 2 || isFreewayJoin(es)) continue; // a merge into the two-way road is not an intersection
    const dirs = es.map((e) => { const atEnd = e.b === n, p = e.p, q = atEnd ? at(p, polyLen(p) - 4) : at(p, 4); const x0 = p[atEnd ? p.length - 1 : 0]; return [q.x - x0[0], q.z - x0[1]].map((v, _, a) => v / (Math.hypot(a[0], a[1]) || 1)); });
    if (es.length === 3 && isFork(dirs)) continue; // a fork or a swerve where one road splits in two: no box, crosswalks or stop bars
    es.forEach((e, i) => {
      const atEnd = e.b === n;
      // the box reaches as far as the widest street that crosses this one
      let box = BOX_MIN;
      es.forEach((q, j) => { if (j === i) return; const d = dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]; if (Math.abs(d) < 0.8) box = Math.max(box, rowWidth(q.prof) / 2); });
      // a main road meeting only minor streets has priority: its lines run through, nothing crosses it
      const rk = rankOf, priority = rk(e) >= 2 && es.every((q, j) => j === i || Math.abs(dirs[i][0] * dirs[j][0] + dirs[i][1] * dirs[j][1]) >= 0.8 || rk(q) <= rk(e) - 1);
      const mw = e.prof.els.find((q) => q[0] === 'median')?.[1] || 0;
      if (priority) { // the through road: lane lines stop before the box, the median opens as wide as the side street, ends rounded
        const r = get(e), half = box + 1 + mw; if (atEnd) { r.t1 = Math.max(r.t1, box + 0.5); r.mt1 = Math.max(r.mt1, half); } else { r.t0 = Math.max(r.t0, box + 0.5); r.mt0 = Math.max(r.mt0, half); }
        if (mw && !e.nose) openings.push({ x: S.nodes[n][0], z: S.nodes[n][1], half, name: e.n, e });
        legs.push({ e, n, atEnd, D: box + 2.2, priority: true }); return;
      }
      const D = box + 2.2, len = polyLen(e.p);
      if (len < 2 * (D + CW_HALF + BAR_GAP) + 4) { const r = get(e); if (atEnd) r.t1 = len; else r.t0 = len; return; } // a short link inside the box: no markings at all
      const r = get(e), clear = D + CW_HALF + BAR_GAP;
      if (atEnd) { r.t1 = Math.max(r.t1, clear); r.mt1 = Math.max(r.mt1, D + CW_HALF + NOSE_GAP + NOSE_R * 2); } else { r.t0 = Math.max(r.t0, clear); r.mt0 = Math.max(r.mt0, D + CW_HALF + NOSE_GAP + NOSE_R * 2); }
      legs.push({ e, n, atEnd, D });
    });
  }
  // the other carriageway of a divided road opens opposite the side street, so the median is cut straight across
  for (const o of openings) for (const f of S.edges.values()) {
    if (f === o.e || !f.g || !f.divided || f.nose || f.n !== o.name || !f.prof.els.some((q) => q[0] === 'median')) continue;
    const q = nearestOnLine(f.p, o.x, o.z); if (q.d > 30) continue;
    let s = 0; for (let i = 1; i <= q.i; i++) s += Math.hypot(f.p[i][0] - f.p[i - 1][0], f.p[i][1] - f.p[i - 1][1]);
    s += Math.hypot(f.p[q.i + 1][0] - f.p[q.i][0], f.p[q.i + 1][1] - f.p[q.i][1]) * q.t;
    get(f).gaps.push([s - o.half, s + o.half]);
  }
  return { info, legs };
}

// the stretches of an edge's median that are not cut by a junction opening, as [from, to] distances along the edge
function medianRuns(len, r) {
  const gaps = [];
  if (r) { if (r.mt0 > 0) gaps.push([-1, r.mt0]); if (r.mt1 > 0) gaps.push([len - r.mt1, len + 1]); for (const g of r.gaps) gaps.push(g); }
  gaps.sort((a, b) => a[0] - b[0]);
  const merged = []; for (const g of gaps) { const l = merged[merged.length - 1]; if (l && g[0] <= l[1]) l[1] = Math.max(l[1], g[1]); else merged.push(g.slice()); }
  const runs = []; let at0 = 0;
  for (const g of merged) { if (g[0] - at0 > 0.5) runs.push([at0, g[0]]); at0 = Math.max(at0, g[1]); }
  if (len - at0 > 0.5) runs.push([at0, len]);
  return runs;
}
// the sub-polylines of P that the median occupies
function medianPaths(P, r) {
  const len = polyLen(P); return medianRuns(len, r).map(([a, b]) => trimPath(P, a, len - b)).filter((q) => q.length >= 2);
}

// Rounded noses: a quarter disc per carriageway's half-median at every end the junction openings cut, its flat side flush with the median strip.
function mediansNoses(S, info, noses) {
  for (const e of S.edges.values()) {
    if (!e.g || !e.divided || e.nose || e.xmed) continue;
    const z = zones(e.prof), m = z.find((q) => q.k === 'median'); if (!m) continue;
    const mw = m.b - m.a, first = z[0] === m, axis = first ? m.a : m.b, v = first ? 1 : -1, len = polyLen(e.p), runs = medianRuns(len, info.get(e.id));
    for (const [a, b] of runs) for (const [d, dir] of [[a, -1], [b, 1]]) {
      if (d < 0.5 || d > len - 0.5) continue; // the strip carries on into the next piece
      const Q = at(e.p, d), nx = -Q.tz, nz = Q.tx;
      noses.push({ c: [Q.x + nx * axis, Q.z + nz * axis], u: [Q.tx * dir, Q.tz * dir], v: [nx * v, nz * v], r: mw, e });
    }
  }
}

// Everything to draw, in plain data:
//   ladders: { p:[[x,z],[x,z]], o1, o2 }   white stripes (ribbon along p between lateral o1..o2)
//   bars:    same shape, stop bars
//   noses:   { c:[x,z], u:[x,z], v:[x,z], r }   quarter discs capping a median half
function plan(S, walks = []) {
  const { info, legs } = analyse(S);
  const ladders = [], bars = [], noses = [], centres = [];
  for (const { e, atEnd, D, priority } of legs) {
    const len = polyLen(e.p), dist = atEnd ? len - D : D, P = at(e.p, dist), z = zones(e.prof), road = z.filter((q) => !q.curb);
    if (!road.length) continue;
    if (priority) continue; // the through road: no crosswalk or stop bar across it
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
  }
  mediansNoses(S, info, noses);
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

export { at, medianPaths, plan, trimPath, zones };
