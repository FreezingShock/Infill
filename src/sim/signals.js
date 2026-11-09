// Signal phasing by general rules. Pure data, no THREE, runs in the sim worker and in node tests.
//
// planSignal(n) reads a built junction (legs with bearing, rank and lanes) and picks a phasing from road
// class, lane count and which turns exist. The same rules run at every signalized junction in every area:
//   permissive  both directions of an axis go together, lefts yield to oncoming traffic
//   leadlag     both directions go together and a protected left arrow runs with one side first, then ends
//               while the other direction continues, then the other side gets its arrow
//   dual        both lefts get a protected arrow together, then both directions go straight
//   split       one approach at a time (offset legs, uneven lane counts, 5+ legs, or a lone stem)
// The sim asks stateAt(plan, t, leg, mv) for each movement. Interface for the traffic code:
//   0 red   1 permissive green (go, but yield to conflicting traffic)   2 protected green   3 yellow
// Movement keys are 'T' (straight and right) and 'L' (left and U-turn); `leg` indexes node.legs.

const YELLOW = 3, ALLRED = 1, TURN_DEPTH = 2.75, LEFT_MIN = 0.6;
const TAU = Math.PI * 2;
const norm = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a <= -Math.PI) a += TAU; return a; };

// What each approach looks like: lanes in, which turns leave it, how big the road is.
function approaches(n) {
  const out = [];
  n.legs.forEach((lg, i) => {
    const ins = n.ins.filter((l) => l.eid === lg.item.e.id);
    if (!ins.length || lg.item.tp) return;
    const din = lg.bearing + Math.PI; let left = false, right = false, thru = false;
    for (const o of n.legs) {
      if (o === lg || !n.outs.some((l) => l.eid === o.item.e.id)) continue;
      const a = norm(o.bearing - din);
      if (Math.abs(a) > TURN_DEPTH) continue;
      if (a < -LEFT_MIN) left = true; else if (a > LEFT_MIN) right = true; else thru = true;
    }
    out.push({ i, bearing: lg.bearing, group: lg.group, rank: n.ramp && lg.item.lk ? 1 : lg.item.rank, lanes: ins.length, left, right, thru });
  });
  return out;
}

function split(list) { // two sides of one axis: the first approach's side, and the rest
  const a = list[0], A = [a], B = [];
  for (const q of list.slice(1)) (Math.abs(norm(q.bearing - a.bearing)) < Math.PI / 2 ? A : B).push(q);
  return [A, B];
}

function planSignal(n) {
  const ap = approaches(n), phases = [], notes = [];
  if (ap.length < 2) return finish(n, [], []);
  const byGroup = new Map(); for (const a of ap) { if (!byGroup.has(a.group)) byGroup.set(a.group, []); byGroup.get(a.group).push(a); }
  const rankOf = (g) => Math.max(...byGroup.get(g).map((a) => a.rank));
  const order = [...byGroup.keys()].sort((p, q) => rankOf(q) - rankOf(p));
  const solo = order.length >= 3; // five-way and skewed junctions: every approach alone
  const green = (r) => (r >= 4 ? 15 : r >= 3 ? 12 : 9), lgreen = (r) => (r >= 4 ? 6 : r >= 3 ? 5 : 4);
  const push = (g, go) => phases.push({ g, go });
  for (const g of order) {
    const list = byGroup.get(g), rank = rankOf(g);
    const cross = Math.max(0, ...order.filter((q) => q !== g).map(rankOf));
    const [A, B] = split(list);
    const oneSide = !B.length;
    if (solo || oneSide || A.length > 1 || B.length > 1) {
      for (const a of list) { push(Math.max(6, green(a.rank) - 3), { [a.i + 'T']: 2, [a.i + 'L']: 2 }); notes.push('split'); }
      continue;
    }
    const a = A[0], b = B[0];
    const offset = Math.abs(Math.abs(norm(a.bearing - b.bearing)) - Math.PI), skew = offset > 0.45 || Math.abs(a.lanes - b.lanes) >= 2;
    if (skew) { for (const q of [a, b]) push(Math.max(6, green(q.rank) - 3), { [q.i + 'T']: 2, [q.i + 'L']: 2 }); notes.push('split'); continue; }
    const arterial = rank >= 3 && cross >= 3, wide = a.lanes >= 2 && b.lanes >= 2;
    const both = a.left && b.left, one = a.left !== b.left;
    const G = green(rank), L = lgreen(rank);
    if (arterial && wide && both && (rank >= 4 || (a.lanes >= 3 && b.lanes >= 3))) {
      push(L, { [a.i + 'L']: 2, [b.i + 'L']: 2 }); push(G, { [a.i + 'T']: 2, [b.i + 'T']: 2 }); notes.push('dual');
    } else if (arterial && (both || one) && (a.lanes >= 2 || b.lanes >= 2)) {
      // the side with a left turn (the busier road's first side when both have one) leads, the other lags
      const lead = a.left || !b.left ? a : b, lag = lead === a ? b : a;
      push(L, { [lead.i + 'T']: 2, [lead.i + 'L']: 2 });
      push(G, { [a.i + 'T']: 2, [b.i + 'T']: 2 });
      push(L, { [lag.i + 'T']: 2, [lag.i + 'L']: 2 }); notes.push('leadlag');
    } else {
      push(G, { [a.i + 'T']: 2, [b.i + 'T']: 2, [a.i + 'L']: 1, [b.i + 'L']: 1 }); notes.push('permissive');
    }
  }
  return finish(n, phases, notes);
}

// Add clearance after each phase (yellow then all red for the movements that stop) and the derived tables.
function finish(n, phases, notes) {
  const prot = {}; let cycle = 0;
  phases.forEach((p, k) => {
    const next = phases[(k + 1) % phases.length];
    p.drop = Object.keys(p.go).filter((key) => !(next.go[key] > 0) && p !== next);
    p.clear = p.drop.length ? YELLOW + ALLRED : 0;
    p.len = p.g + p.clear; cycle += p.len;
    for (const key of Object.keys(p.go)) if (key.endsWith('L') && p.go[key] === 2) prot[+key.slice(0, -1)] = true;
  });
  for (const p of phases) for (const key of Object.keys(p.go)) if (key.endsWith('L') && p.go[key] === 1) delete prot[+key.slice(0, -1)];
  const lead = (notes.includes('dual') ? 'dual' : notes.includes('leadlag') ? 'leadlag' : notes.includes('split') ? 'split' : 'permissive');
  return { phases, cycle, prot, mode: lead, notes };
}

// State of one movement at time t (seconds, including the node's offset).
function stateAt(plan, t, leg, mv) {
  if (!plan || !plan.phases.length || plan.cycle <= 0) return 2;
  let u = ((t % plan.cycle) + plan.cycle) % plan.cycle;
  const key = leg + mv;
  for (const p of plan.phases) {
    if (u >= p.len) { u -= p.len; continue; }
    const s = p.go[key] || 0;
    if (!s) return 0;
    if (u < p.g) return s;
    return p.drop.includes(key) ? (u < p.g + YELLOW ? 3 : 0) : s;
  }
  return 0;
}

// ---------- mast arms ----------
// Each approach gets a pole at the far right corner of the junction with an arm reaching over its lanes
// and one head per lane hanging on the far side, facing the traffic that approaches. Returns plain data.
const NOT_ROAD = new Set(['walk', 'trees', 'median', 'plaza']);
function curbRight(item, dir) { // metres from the centreline to the roadway's outer edge on the right of travel
  let row = 0; for (const [, w] of item.e.els) row += w;
  let o = -row / 2, best = 0;
  for (const [k, w] of item.e.els) { if (!NOT_ROAD.has(k)) best = Math.max(best, dir > 0 ? o + w : -o); o += w; }
  return best;
}
const latOf = (lane) => (lane.dir > 0 ? lane.off : -lane.off); // metres right of the direction of travel
function layoutMasts(n, plan) {
  const masts = [], heads = [];
  for (const a of approaches(n)) {
    const lg = n.legs[a.i], lanes = n.ins.filter((l) => l.eid === lg.item.e.id).sort((p, q) => p.idx - q.idx);
    if (!lanes.length) continue;
    const end = lanes[0].pts.at(-1), pa = lanes[0].pts.at(-2), L0 = Math.hypot(end[0] - pa[0], end[1] - pa[1]) || 1;
    const d = [(end[0] - pa[0]) / L0, (end[1] - pa[1]) / L0], r = [-d[1], d[0]];
    const s = Math.min(22, Math.max(4, (n.x - end[0]) * d[0] + (n.z - end[1]) * d[1])); // stop line to junction centre
    const far = 2 * s - 0.4; // stop line to the far side of the junction
    const base = lanes.map((l) => ({ x: l.pts.at(-1)[0] + d[0] * far, z: l.pts.at(-1)[1] + d[1] * far }));
    const edge = curbRight(lg.item, lanes[0].dir) + 0.9 - latOf(lanes[0]); // from the outer lane's centre to the pole
    const px = base[0].x + r[0] * edge, pz = base[0].z + r[1] * edge, tip = base[base.length - 1];
    const reach = Math.hypot(tip.x - px, tip.z - pz) + 0.7;
    masts.push({ leg: a.i, x: px, z: pz, ax: px - r[0] * reach, az: pz - r[1] * reach, dx: d[0], dz: d[1] });
    lanes.forEach((l, k) => {
      const kinds = new Set(l.conns.map((c) => (c.type === 'L' || c.type === 'U' ? 'L' : 'T'))), leftOnly = kinds.size === 1 && kinds.has('L');
      heads.push({ leg: a.i, mv: leftOnly ? 'L' : 'T', arrow: leftOnly ? 1 : 0, x: base[k].x, z: base[k].z, dx: d[0], dz: d[1] });
    });
    // a protected left from a shared lane still gets its own arrow head, on the innermost lane
    if (plan.prot[a.i] && !heads.some((h) => h.leg === a.i && h.mv === 'L')) heads.push({ leg: a.i, mv: 'L', arrow: 1, x: tip.x - r[0] * 1.1, z: tip.z - r[1] * 1.1, dx: d[0], dz: d[1] });
  }
  return { masts, heads };
}

// What the main thread needs to draw and time the signals of a built net.
function exportSignals(net) {
  const out = [];
  for (const n of net.nodes) {
    if (n.control !== 'signal' || !n.sig || !n.sig.phases.length) continue;
    const { masts, heads } = layoutMasts(n, n.sig);
    out.push({ id: n.id, x: n.x, z: n.z, off: n.cycleOff, plan: n.sig, masts, heads });
  }
  return out;
}

export { ALLRED, YELLOW, approaches, exportSignals, layoutMasts, planSignal, stateAt };
