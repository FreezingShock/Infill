import { bbox, bufferLine } from '../../engine/core.js';
import { PACK } from '../../engine/pack.js';
import { rowWidth } from '../../engine/model.js';
import { ring } from './shapes.js';
import { rankOf } from './classes.js';

// =====================================================================
// Intersections and the road-graph API other systems (traffic sim, parking, routing) read.
//
//   S.nodes[i]            [x, z]               graph node
//   S.edges  (e.g === 1)  drivable street piece: e.a / e.b node indices, e.p polyline a -> b,
//                         e.c class, e.prof cross-section, e.oneway 0 | 1 (a->b) | -1 (b->a), e.speed mph (absent = by class)
//   S.ctrl[nodeIndex]     'signal' | 'allway' | 'stop' | 'yield' | 'roundabout'. Absent = auto.
//   S.rounds[nodeIndex]   { r } for converted roundabouts. Their ring edges have e.ring === 1, oneway 1,
//                         and run counterclockwise on screen (decreasing atan2(z, x)).
//
// Read it through nodeEdges / nodeControl / isOneWay, not by poking at S directly.
// =====================================================================
const CONTROLS = {
  auto: { name: 'Automatic', hint: 'Signals on big roads, stop signs on small ones.' },
  signal: { name: 'Traffic signal', hint: 'Cars take turns on a timer.' },
  allway: { name: 'All-way stop', hint: 'Every street stops.' },
  stop: { name: 'Stop on side streets', hint: 'The main road keeps flowing, side streets stop.' },
  yield: { name: 'Yield', hint: 'Side streets give way, nobody stops fully.' },
  roundabout: { name: 'Roundabout', hint: 'Replaces the junction with a one-way ring.' },
};
const BIG = new Set(['motorway', 'trunk', 'primary', 'secondary']);

function nodeEdges(S, n) {
  const out = []; for (const e of S.edges.values()) if (e.g && !e.xmed && (e.a === n || e.b === n)) out.push(e); return out; // the box between a divided road's carriageways is not a leg
}
function nearestNode(S, x, z, tol) {
  let b = -1, bd = tol; S.nodes.forEach((p, i) => { const d = Math.hypot(p[0] - x, p[1] - z); if (d < bd) { bd = d; b = i; } }); return b;
}
// Real junctions only: three or more drivable pieces meet (roundabout rings count)
function isJunction(S, n) { return nodeEdges(S, n).length >= 3; }
function isOneWay(e) { return e.oneway === 1 || e.oneway === -1; }

// The control a node actually has: an explicit choice, or a sensible default for the streets that meet there.
function nodeControl(S, n) {
  const set = S.ctrl && S.ctrl[n]; if (set) return set;
  const es = nodeEdges(S, n); if (es.length < 3) return 'none';
  if (es.filter((e) => e.taper).length >= 2) return 'none'; // where a divided road merges into the two-way road nobody stops
  const p = S.nodes[n], big = es.filter((e) => BIG.has(e.c));
  // a divided road is one road, not two: two carriageways of the same street never make a signal by themselves
  if (new Set(big.map((e) => e.n || e.id)).size >= 2) return 'signal';
  if (PACK.props.some(([k, x, z]) => k === 'signal' && Math.hypot(x - p[0], z - p[1]) < 25)) return 'signal';
  const rk = es.map(rankOf);
  return Math.max(...rk) > Math.min(...rk) ? 'stop' : 'allway'; // the bigger road flows through, smaller streets stop; equals take turns
}
// Streets that must give way under the node's control: side streets for stop/yield, everything for allway.
function givesWay(S, n, e) {
  const c = nodeControl(S, n);
  if (c === 'allway') return true;
  if (c === 'stop' || c === 'yield') { const es = nodeEdges(S, n), top = Math.max(...es.map((q) => (BIG.has(q.c) ? 2 : rowWidth(q.prof) > 12 ? 1 : 0))); const mine = BIG.has(e.c) ? 2 : rowWidth(e.prof) > 12 ? 1 : 0; return mine < top; }
  return false;
}

// ---------- commands ----------
function streetSpeed(S, cmd) { for (const id of cmd.ids) { const e = S.edges.get(id); if (!e) continue; if (cmd.v) e.speed = cmd.v; else delete e.speed; } }
function nodeCtrl(S, cmd) {
  S.ctrl = S.ctrl || {};
  for (const n of cmd.nodes) { if (cmd.t === 'auto' || !cmd.t) delete S.ctrl[n]; else if (cmd.t !== 'roundabout') S.ctrl[n] = cmd.t; }
}
function streetOneway(S, cmd) {
  for (const id of cmd.ids) { const e = S.edges.get(id); if (!e) continue; if (cmd.dir) e.oneway = cmd.dir; else delete e.oneway; }
}
// Point on polyline p (starting at index 0) first reaching distance r from c, plus the index of the segment it falls on.
function crossing(p, c, r) {
  for (let i = 1; i < p.length; i++) {
    const d0 = Math.hypot(p[i - 1][0] - c[0], p[i - 1][1] - c[1]), d1 = Math.hypot(p[i][0] - c[0], p[i][1] - c[1]);
    if (d1 >= r && d0 < r) { let lo = 0, hi = 1; for (let k = 0; k < 24; k++) { const t = (lo + hi) / 2, x = p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, z = p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t; if (Math.hypot(x - c[0], z - c[1]) < r) lo = t; else hi = t; } const t = hi; return { i, pt: [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t] }; }
  }
  return null;
}
const RING_PROF = { k: 'ring', els: [['trees', 1.5], ['lane', 5.5], ['trees', 1.5]] };

// Replace a junction with a one-way ring. Every street ends at the ring instead of the middle.
function roundabout(S, cmd, info, H) {
  const n = cmd.node, c = S.nodes[n]; if (!c) return;
  const r = Math.max(8, Math.min(40, cmd.r || 14)), spokes = [];
  for (const e of nodeEdges(S, n)) {
    if (e.ring) continue;
    const atA = e.a === n, p = atA ? e.p : e.p.slice().reverse(), x = crossing(p, c, r);
    if (!x) { S.edges.delete(e.id); continue; } // shorter than the ring: it lies inside the island
    const np = [x.pt, ...p.slice(x.i)], q = atA ? np : np.reverse();
    const nd = H.addNode(S, x.pt[0], x.pt[1]);
    if (atA) e.a = nd; else e.b = nd;
    e.p = q; e.bb = bbox(q); spokes.push({ nd, ang: Math.atan2(x.pt[1] - c[1], x.pt[0] - c[0]) });
  }
  if (spokes.length < 2) { info.notes.push('A roundabout needs at least two streets meeting there.'); return; }
  spokes.sort((a, b) => b.ang - a.ang); // decreasing angle = counterclockwise on screen
  const made = [];
  spokes.forEach((s, k) => {
    const t = spokes[(k + 1) % spokes.length], a0 = s.ang; let a1 = t.ang; while (a1 >= a0 - 1e-6) a1 -= Math.PI * 2;
    const m = Math.max(2, Math.ceil((a0 - a1) * r / 3)), p = [];
    for (let j = 0; j <= m; j++) { const th = a0 + (a1 - a0) * j / m; p.push([c[0] + Math.cos(th) * r, c[1] + Math.sin(th) * r]); }
    p[0] = S.nodes[s.nd].slice(); p[m] = S.nodes[t.nd].slice();
    const E = { id: `${cmd.id}.r${k + 1}`, a: s.nd, b: t.nd, p, c: 'residential', s: null, n: null, w: 5.5, g: 1, grp: cmd.id, prof: structuredClone(RING_PROF), bb: bbox(p), ring: 1, oneway: 1, drawn: 1 };
    S.edges.set(E.id, E); made.push(E);
  });
  S.ctrl = S.ctrl || {}; S.rounds = S.rounds || {};
  S.ctrl[n] = 'roundabout'; S.rounds[n] = { r };
  const touched = H.cutLots(S, bufferLine(ring(c, r, 24), rowWidth(RING_PROF) / 2), cmd.id);
  H.refreshNear(S, bbox(ring(c, r + 10, 8)));
  touched.forEach((l) => H.lotMeta(l, S));
  info.notes.push(`Roundabout: ${made.length} ring pieces`);
}
// A roundabout on open ground: a ring only, with no streets joined yet (draw streets into it afterwards).
function roundaboutAt(S, cmd, info, H) {
  const c = cmd.c, r = Math.max(8, Math.min(40, cmd.r || 14)), pts = ring(c, r, 24, -1);
  const made = H.streetAdd(S, { id: cmd.id, pts, prof: structuredClone(RING_PROF), name: cmd.name || null }, info);
  for (const e of made) { e.ring = 1; e.oneway = 1; }
}

export { CONTROLS, givesWay, isJunction, isOneWay, nearestNode, nodeCtrl, nodeControl, nodeEdges, roundabout, roundaboutAt, streetOneway, streetSpeed };
