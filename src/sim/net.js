// Drivable network built from street edges: lanes per direction, intersections with turn
// connectors and traffic control, and curb parking slots. Pure data, no THREE, worker-safe.
//
// Input edge: { id, p: [[x,z],...], c: class, els: [[kind, width],...] (left to right of the a->b direction) }.
// Optional future fields (absent means today's behaviour): oneway: 1|-1, speed: m/s.
import { bezier, cubic, cumLen, offsetLine, pathsCross, trimLine } from './geom.js';

const RANK = { motorway: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1, unclassified: 1, service: 0, unknown: 0 };
const SPEED = { motorway: 19, primary: 14, secondary: 12, tertiary: 10.5, residential: 8.5, unclassified: 8.5, service: 5, unknown: 5 };
const DRIVE_EL = new Set(['lane', 'bus', 'shared', 'drive']);
const SLOT_LEN = 6.2, SLOT_END = 9;
const key = (p) => `${Math.round(p[0])},${Math.round(p[1])}`;

// Lane offsets (metres right of the edge centerline) per travel direction, outer lane first.
function laneLayout(e) {
  const cars = [], parks = [];
  let row = 0; for (const [, w] of e.els) row += w;
  let o = -row / 2;
  for (const [k, w] of e.els) { const c = o + w / 2; if (DRIVE_EL.has(k)) cars.push({ off: c, w }); else if (k === 'park') parks.push({ off: c, w }); o += w; }
  if (!cars.length) return { fwd: [], bwd: [], parks };
  let fwd, bwd;
  if (cars.length === 1) {
    const c = cars[0];
    if (c.w >= 5.6) { fwd = [{ off: c.off + c.w / 4, w: c.w / 2 }]; bwd = [{ off: c.off - c.w / 4, w: c.w / 2 }]; }
    else { fwd = [{ off: c.off + 0.9, w: c.w }]; bwd = [{ off: c.off - 0.9, w: c.w }]; }
  } else {
    const s = cars.slice().sort((a, b) => a.off - b.off), h = Math.floor(s.length / 2);
    bwd = s.slice(0, h); fwd = s.slice(h);
  }
  if (e.oneway === 1) { fwd = fwd.concat(bwd); bwd = []; } else if (e.oneway === -1) { bwd = bwd.concat(fwd); fwd = []; }
  fwd.sort((a, b) => b.off - a.off); // outer (curb side) first
  bwd.sort((a, b) => a.off - b.off);
  return { fwd, bwd, parks };
}

function buildNet(edges, opts = {}) {
  const signals = opts.signals || [], bounds = opts.bounds || null;
  const nodes = new Map(), lanes = [], connectors = [];
  const node = (pt) => { const k = key(pt); let n = nodes.get(k); if (!n) { n = { id: k, x: pt[0], z: pt[1], legs: [], ins: [], outs: [], conns: [], control: 'none', rank: 0 }; nodes.set(k, n); } return n; };
  const half = (e) => { let r = 0; for (const [, w] of e.els) r += w; return r / 2; };
  // pass 1: nodes and legs
  const list = [];
  for (const e of edges) {
    if (!e.p || e.p.length < 2) continue;
    const lay = laneLayout(e);
    if (!lay.fwd.length && !lay.bwd.length) continue;
    const a = node(e.p[0]), b = node(e.p[e.p.length - 1]);
    if (a === b) continue;
    const item = { e, lay, a, b, h: half(e), rank: RANK[e.c] ?? 0, speed: e.speed || SPEED[e.c] || 8.5, len: cumLen(e.p).at(-1) };
    a.legs.push({ item, end: 0 }); b.legs.push({ item, end: 1 });
    list.push(item);
  }
  // trims: back off each lane end by the widest street meeting there
  const trimAt = (n, item) => { let t = 0; for (const lg of n.legs) if (lg.item !== item) t = Math.max(t, lg.item.h); return n.legs.length === 1 ? 3 : t + 1.5; };
  // pass 2: lanes
  for (const it of list) {
    const ta = trimAt(it.a, it), tb = trimAt(it.b, it);
    const make = (dir, L, idx, n) => {
      const base = offsetLine(it.e.p, L.off);
      const pts = dir > 0 ? trimLine(base, ta, tb) : trimLine(base.slice().reverse(), tb, ta);
      const cum = cumLen(pts);
      const lane = { id: `${it.e.id}:${dir > 0 ? 'f' : 'b'}${idx}`, eid: it.e.id, dir, idx, n, off: L.off, pts, cum, len: cum.at(-1), from: dir > 0 ? it.a : it.b, to: dir > 0 ? it.b : it.a,
        rank: it.rank, speed: it.speed, cars: [], conns: [], slots: [], reserved: 0 };
      lanes.push(lane); lane.from.outs.push(lane); lane.to.ins.push(lane); return lane;
    };
    it.fl = it.lay.fwd.map((L, i) => make(1, L, i, it.lay.fwd.length));
    it.bl = it.lay.bwd.map((L, i) => make(-1, L, i, it.lay.bwd.length));
    // curb parking slots live on the outer lane of the side the parking strip is on
    for (const P of it.lay.parks) {
      const dir = P.off >= 0 ? 1 : -1, lane = (dir > 0 ? it.fl : it.bl)[0];
      if (!lane || lane.len < SLOT_END * 2 + SLOT_LEN) continue;
      const lat = dir > 0 ? P.off - lane.off : lane.off - P.off; // metres to the right of travel
      if (Math.abs(lat) > 6 || Math.abs(lat) < 0.8) continue;
      for (let s = SLOT_END + SLOT_LEN / 2; s <= lane.len - SLOT_END - SLOT_LEN / 2; s += SLOT_LEN) lane.slots.push({ id: `${lane.id}#${lane.slots.length}`, lane, s, lat, state: 0, leaveAt: 0, by: -1 });
    }
  }
  // pass 3: intersections
  for (const n of nodes.values()) {
    const nlegs = n.legs.length;
    n.rank = Math.max(0, ...n.legs.map((l) => l.item.rank));
    n.nearEdge = !!bounds && (n.x < bounds[0] + 40 || n.x > bounds[2] - 40 || n.z < bounds[1] + 40 || n.z > bounds[3] - 40);
    n.portal = nlegs === 1 && n.nearEdge;
    // legs grouped by axis for signal phases
    const ang = (lg) => { const p = lg.item.e.p, q = lg.end === 0 ? p[1] : p[p.length - 2], o = lg.end === 0 ? p[0] : p[p.length - 1]; return Math.atan2(q[1] - o[1], q[0] - o[0]); };
    const groups = [], axis = (a) => ((a % Math.PI) + Math.PI) % Math.PI, near = (a, b) => { const d = Math.abs(axis(a) - axis(b)); return Math.min(d, Math.PI - d) < 0.6; };
    for (const lg of n.legs) {
      lg.bearing = ang(lg);
      let g = groups.findIndex((a0) => near(lg.bearing, a0));
      if (g < 0) { groups.push(lg.bearing); g = groups.length - 1; }
      lg.group = g;
    }
    n.phases = groups.length;
    const sig = signals.some((s) => Math.hypot(s[0] - n.x, s[1] - n.z) < 30);
    const major = n.legs.filter((l) => l.item.rank >= 3).length;
    if (nlegs >= 3 && (sig || (major >= 2 && nlegs >= 3 && n.phases > 1))) n.control = 'signal';
    else if (nlegs >= 3) { const top = n.rank, low = n.legs.some((l) => l.item.rank < top); n.control = low ? 'priority' : 'allway'; }
    n.cycleOff = (Math.abs(n.x * 7.3 + n.z * 3.1) % 17);
    // connectors
    for (const L of n.portal ? [] : n.ins) {
      const dIn = tail(L.pts), made = [];
      const outsByEdge = new Map();
      for (const M of n.outs) { if (!outsByEdge.has(M.eid)) outsByEdge.set(M.eid, []); outsByEdge.get(M.eid).push(M); }
      for (const [eid, group] of outsByEdge) {
        group.sort((a, b) => a.idx - b.idx);
        const dOut = head(group[0].pts), ang2 = Math.atan2(dIn[0] * dOut[1] - dIn[1] * dOut[0], dIn[0] * dOut[0] + dIn[1] * dOut[1]);
        const uturn = eid === L.eid;
        if (uturn && nlegs !== 1) continue;
        if (!uturn && Math.abs(ang2) > 2.75) continue;
        const type = uturn ? 'U' : Math.abs(ang2) < 0.6 ? 'S' : ang2 > 0 ? 'R' : 'L';
        const m = group.length;
        const idx = type === 'R' ? 0 : type === 'L' ? m - 1 : type === 'U' ? 0 : Math.min(m - 1, Math.round(L.n > 1 ? (L.idx / (L.n - 1)) * (m - 1) : 0));
        const M = group[idx];
        made.push({ L, M, type, ang: ang2 });
      }
      // lane use: outer lane right/straight, inner lane left/straight (single lane takes everything)
      let use = made.filter((c) => L.n === 1 || c.type === 'S' || c.type === 'U' || (c.type === 'R' && L.idx === 0) || (c.type === 'L' && L.idx === L.n - 1));
      if (!use.length) use = made;
      for (const c of use) {
        const pts = connectorPath(c.L, c.M, c.type);
        const cum = cumLen(pts);
        const conn = { id: `${c.L.id}>${c.M.id}`, node: n, from: c.L, to: c.M, type: c.type, pts, cum, len: cum.at(-1), cars: [], conflicts: [], reserved: 0,
          rank: c.L.rank, speed: c.type === 'S' ? Math.min(c.L.speed, c.M.speed) : c.type === 'R' ? 4.2 : c.type === 'L' ? 5.2 : 3.2, group: legGroup(n, c.L) };
        conn.pv = conn.rank * 10 + (c.type === 'S' ? 3 : c.type === 'R' ? 2 : 1);
        c.L.conns.push(conn); n.conns.push(conn); connectors.push(conn);
      }
    }
    for (const a of n.conns) for (const b of n.conns) {
      if (a === b || a.from === b.from) continue;
      if (a.to === b.to || pathsCross(a.pts, b.pts)) a.conflicts.push(b);
    }
  }
  const slots = []; for (const l of lanes) for (const s of l.slots) slots.push(s);
  let laneMeters = 0; for (const l of lanes) laneMeters += l.len;
  return { nodes: [...nodes.values()], lanes, connectors, slots, laneMeters, laneById: new Map(lanes.map((l) => [l.id, l])), connById: new Map(connectors.map((c) => [c.id, c])) };
}

function legGroup(n, lane) { for (const lg of n.legs) if (lg.item.e.id === lane.eid) return lg.group; return 0; }
function tail(p) { const a = p[p.length - 2], b = p[p.length - 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; }
function head(p) { const a = p[0], b = p[1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; }
function connectorPath(L, M, type) {
  const p0 = L.pts.at(-1), p1 = M.pts[0], dIn = tail(L.pts), dOut = head(M.pts), chord = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
  if (type === 'U') return cubic(p0, [p0[0] + dIn[0] * 6, p0[1] + dIn[1] * 6], [p1[0] - dOut[0] * 6, p1[1] - dOut[1] * 6], p1, 14);
  if (type === 'S' || chord < 1) return chord < 1 ? [p0, p1] : bezier(p0, [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], p1, 6);
  const den = dIn[0] * dOut[1] - dIn[1] * dOut[0];
  let c;
  if (Math.abs(den) < 1e-3) c = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  else {
    const t = ((p1[0] - p0[0]) * dOut[1] - (p1[1] - p0[1]) * dOut[0]) / den;
    const tt = Math.min(Math.max(t, 0.5), chord * 1.2);
    c = [p0[0] + dIn[0] * tt, p0[1] + dIn[1] * tt];
  }
  return bezier(p0, c, p1, 10);
}

// Edge list for the sim from the game state's edge map (kept here so every caller agrees on what drives).
function drivableEdges(edgeMap) {
  const out = [];
  for (const e of edgeMap.values()) {
    if (!e.g || e.s === 'driveway' || !e.prof) continue;
    out.push({ id: e.id, p: e.p, c: e.c, els: e.prof.els, oneway: e.oneway, speed: e.speed });
  }
  return out;
}

export { RANK, SLOT_LEN, buildNet, drivableEdges };
