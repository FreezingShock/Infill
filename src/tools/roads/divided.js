import { bbox, clamp, nearestOnLine, offsetLine, polyLen } from '../../engine/core.js';
import { ARTERIAL, rankOf, roadClassOf } from './classes.js';

// =====================================================================
// Divided roads (corridors). Map data draws a boulevard as two one-way pieces with whatever gap the mapper
// left between them, and the pieces that close up into the two-way road as a long V.
//
// Model: a divided road is the undivided road with its centre turn lane replaced by a narrow raised median.
// Both come from the same class numbers (classes.js ARTERIAL), so the total width never changes:
//   - the two carriageways are pulled to exactly parallel, medians touching, one median of ARTERIAL.median wide
//   - where the pair meets the two-way road at a merge node the carriageways keep running parallel and
//     the median narrows to a point (a nose) over a gradual taper; pavement stays one constant width
//   - the traffic polyline (e.p) still ends on the merge node so the lane graph connects; the drawn path
//     (e.dp) carries on parallel to the axis, so nothing is ever drawn as a wedge
// Runs once while the base city is built. Pure data, no THREE.
// =====================================================================
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const NOSE_CLEAR = 18; // median stays full width this far from the cross street, then narrows
const rowWidth = (prof) => prof.els.reduce((s, e) => s + e[1], 0);

function tangentAt(p, i) { const a = p[Math.max(0, i)], b = p[Math.min(p.length - 1, i + 1)]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; }
function sampleAlong(p, k) {
  const L = polyLen(p), out = []; let acc = 0, i = 1;
  for (let s = 1; s <= k; s++) {
    const at = L * s / (k + 1); while (i < p.length - 1 && acc + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]) < at) { acc += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); i++; }
    const a = p[i - 1], b = p[i], d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, t = (at - acc) / d;
    out.push({ x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, i: i - 1 });
  }
  return out;
}
// distance to the partner carriageway if e2 runs alongside e1 the opposite way, else null
function gapTo(e1, e2) {
  const ds = []; let against = 0;
  for (const s of sampleAlong(e1.p, 5)) {
    const q = nearestOnLine(e2.p, s.x, s.z); if (q.d < 3 || q.d > 45) continue;
    const t1 = tangentAt(e1.p, s.i), t2 = tangentAt(e2.p, q.i); if (t1[0] * t2[0] + t1[1] * t2[1] < -0.9) { against++; ds.push(q.d); }
  }
  if (against < 3) return null;
  const lo = Math.min(...ds), hi = Math.max(...ds), mean = ds.reduce((a, b) => a + b, 0) / ds.length;
  // a short pair that closes up into one node is where the divided road joins the undivided one
  const shares = e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b;
  if (shares && hi <= 30 && Math.max(polyLen(e1.p), polyLen(e2.p)) < 90) return { d: hi, taper: true };
  return hi - lo <= 7 ? { d: mean, taper: false } : null;
}

// One carriageway, median side first: [half median, lanes, parking/bus lane, sidewalk].
function carriageEls(rc) {
  const A = rc === 'arterial' ? ARTERIAL : { walk: 2.2, park: 2, lane: 3.4, n: 1, median: 3 };
  const n = A.n; // lane count is a property of the class, so it never jumps along a road or across a merge
  return { n, els: [['median', A.median / 2], ...Array.from({ length: n }, () => ['lane', A.lane]), ['park', A.park], ['walk', A.walk]] };
}
// median on the side facing the partner. offsetLine(+) side is the end of the list.
function oriented(e, partner, els) {
  const k = Math.floor(e.p.length / 2), s = e.p[k], q = nearestOnLine(partner.p, s[0], s[1]);
  const pos = offsetLine(e.p, 1)[k], neg = offsetLine(e.p, -1)[k];
  const toward = Math.hypot(pos[0] - q.x, pos[1] - q.z) < Math.hypot(neg[0] - q.x, neg[1] - q.z) ? 1 : -1;
  return toward === 1 ? els.slice().reverse() : els; // median first = partner on the negative side
}

// Pull each carriageway to exactly the distance its profile needs, so the two medians meet and make one.
// Every vertex and every shared node moves along the line to its partner; cross streets keep their nodes.
function tighten(S, pairs) {
  const nd = new Map(), inner = new Map();
  for (const [e, f] of pairs) {
    const T = (rowWidth(e.prof) + rowWidth(f.prof)) / 2;
    const dl = e.p.map((v) => { const q = nearestOnLine(f.p, v[0], v[1]); if (q.d < 1e-3) return [0, 0]; const s = clamp((q.d - T) / 2, -7, 7); return [(q.x - v[0]) / q.d * s, (q.z - v[1]) / q.d * s]; });
    inner.set(e.id, dl);
    for (const [n, d] of [[e.a, dl[0]], [e.b, dl[dl.length - 1]]]) { const r = nd.get(n) || [0, 0, 0]; r[0] += d[0]; r[1] += d[1]; r[2]++; nd.set(n, r); }
  }
  for (const [e] of pairs) { const dl = inner.get(e.id); e.p = e.p.map((v, i) => [v[0] + dl[i][0], v[1] + dl[i][1]]); }
  for (const [n, r] of nd) S.nodes[n] = [S.nodes[n][0] + r[0] / r[2], S.nodes[n][1] + r[1] / r[2]];
  snapEnds(S, [...nd.keys()]);
}
function snapEnds(S, nodes) {
  const set = new Set(nodes);
  for (const e of S.edges.values()) {
    let hit = false;
    if (set.has(e.a)) { e.p[0] = S.nodes[e.a].slice(); hit = true; }
    if (set.has(e.b)) { e.p[e.p.length - 1] = S.nodes[e.b].slice(); hit = true; }
    if (hit) e.bb = bbox(e.p);
  }
}

// Rebuild the pair of carriageways that close up at merge node m: parallel to the axis all the way, median narrowing to a nose.
function rebuildMerge(S, m, es) {
  const far = es.map((e) => (e.b === m ? e.p[0] : e.p[e.p.length - 1])), farNode = es.map((e) => (e.b === m ? e.a : e.b));
  const mid = [(far[0][0] + far[1][0]) / 2, (far[0][1] + far[1][1]) / 2], M = S.nodes[m], L = Math.hypot(M[0] - mid[0], M[1] - mid[1]);
  if (L < 18) return false;
  const u = [(M[0] - mid[0]) / L, (M[1] - mid[1]) / L], nv = [-u[1], u[0]];
  const side = far.map((f) => Math.sign((f[0] - mid[0]) * nv[0] + (f[1] - mid[1]) * nv[1]));
  if (side[0] === side[1] || !side[0]) return false;
  const T = (rowWidth(es[0].prof) + rowWidth(es[1].prof)) / 2;
  es.forEach((e, k) => { S.nodes[farNode[k]] = [mid[0] + nv[0] * side[k] * T / 2, mid[1] + nv[1] * side[k] * T / 2]; });
  const st = Math.min(9, L * 0.25), n = Math.max(4, Math.ceil(L / 3));
  es.forEach((e, k) => {
    const o = side[k] * T / 2, at = (s) => [mid[0] + u[0] * s + nv[0] * o, mid[1] + u[1] * s + nv[1] * o];
    const dp = [], p = [];
    for (let i = 0; i <= n; i++) { const s = L * i / n; dp.push(at(s)); if (s <= L - st + 1e-6) p.push(at(s)); }
    p.push(M.slice()); // the lane graph ends on the node; the last few metres bend in to meet the two-way road
    const rev = e.a === m;
    e.p = rev ? p.reverse() : p; e.dp = rev ? dp.reverse() : dp; e.bb = bbox(e.dp);
    e.nose = { from: Math.min(NOSE_CLEAR, L * 0.3), to: L - 1.5, rev: rev ? 1 : 0, len: L };
  });
  snapEnds(S, farNode);
  return true;
}

function markDivided(S) {
  const cand = [...S.edges.values()].filter((e) => e.g && MAJOR.has(e.c) && e.n && e.p.length >= 2 && polyLen(e.p) > 25 && e.s !== 'link');
  const found = new Map();
  for (const e1 of cand) {
    let best = null, bd = 1e9;
    for (const e2 of cand) {
      if (e2 === e1 || e2.n !== e1.n || e2.bb[0] > e1.bb[2] + 45 || e2.bb[2] < e1.bb[0] - 45 || e2.bb[1] > e1.bb[3] + 45 || e2.bb[3] < e1.bb[1] - 45) continue;
      const g = gapTo(e1, e2); if (g && g.d < bd) { bd = g.d; best = { e: e2, taper: g.taper }; }
    }
    if (best && bd >= 7) found.set(e1.id, { e: e1, partner: best.e, d: bd, taper: best.taper });
  }
  const pairs = [], tapers = [];
  for (const { e, partner, taper } of found.values()) {
    if (!found.has(partner.id)) continue; // both halves must agree
    const { n, els } = carriageEls(roadClassOf(e));
    e.prof = { k: 'asbuilt', els: oriented(e, partner, els) }; e.oneway = 1; e.divided = 1; e.dn = n;
    e.w = rowWidth(e.prof) - ARTERIAL.walk - els[0][1];
    if (taper) { e.taper = 1; tapers.push(e); } else pairs.push([e, partner]);
  }
  tighten(S, pairs);
  // merge nodes: exactly two taper pieces meet
  const byNode = new Map();
  for (const e of tapers) for (const n of [e.a, e.b]) (byNode.get(n) || byNode.set(n, []).get(n)).push(e);
  for (const [m, es] of byNode) {
    if (es.length !== 2 || es[0] === es[1]) continue;
    if (!rebuildMerge(S, m, es)) for (const e of es) { // too short to rebuild: plain lanes where they close up
      const ln = e.prof.els.filter((q) => q[0] === 'lane' || q[0] === 'park'); e.prof = { k: 'asbuilt', els: ln }; e.w = ln.reduce((a, q) => a + q[1], 0);
    }
  }
  // a street with a divided stretch is a 45 mph boulevard along its whole length
  const blvd = new Set([...S.edges.values()].filter((e) => e.divided && e.n).map((e) => e.n));
  for (const e of S.edges.values()) if (e.g && e.n && blvd.has(e.n) && (e.c === 'primary' || e.c === 'secondary')) e.speed = Math.max(e.speed || 0, 45);
  // connectors: short pieces that join a divided pair back into the two-way road at one node
  const ends = (n) => [...S.edges.values()].filter((q) => q.g && (q.a === n || q.b === n));
  for (const c of [...S.edges.values()]) {
    if (!c.g || c.divided || !MAJOR.has(c.c) || polyLen(c.p) > 120) continue;
    const other = (n) => ends(n).find((q) => q.divided);
    const viaA = other(c.a), viaB = other(c.b); if (!viaA === !viaB) continue;
    const via = viaA || viaB, m = viaA ? c.b : c.a, at = ends(m);
    if (at.length !== 3 || at.filter((q) => !q.divided && polyLen(q.p) <= 120 && ends(q.a === m ? q.b : q.a).some((r) => r.divided)).length !== 2) continue;
    const lanes = via.prof.els.filter((x) => x[0] === 'lane'); if (!lanes.length) continue;
    c.prof = { k: 'asbuilt', els: lanes.map((x) => ['lane', x[1]]) }; c.oneway = 1; c.divided = 1; c.w = lanes.length * lanes[0][1];
  }
  closeMedianOpenings(S);
  return pairs.length + tapers.length;
}

// Where a residential street meets a divided arterial, the short piece that bridges the two carriageways is the junction box:
// paved as part of the arterial, and drivable only for turns off the arterial (a left into the side street from a pocket at the
// median nose). Cars on the side street cannot cross it or turn left across Topanga: they turn right in and right out.
// Collectors and up keep a full opening.
function closeMedianOpenings(S) {
  const div = (n) => [...S.edges.values()].filter((q) => q.g && q.divided && !q.xmed && (q.a === n || q.b === n));
  for (const c of S.edges.values()) {
    if (!c.g || c.divided || c.xmed || c.s === 'driveway' || polyLen(c.p) > 22) continue;
    const da = div(c.a), db = div(c.b); if (!da.length || !db.length) continue;
    if (!da.some((x) => db.some((y) => x !== y && x.n && x.n === y.n))) continue;
    const others = [...S.edges.values()].filter((q) => q !== c && q.g && !q.divided && (q.a === c.a || q.b === c.a || q.a === c.b || q.b === c.b));
    if (!others.length || others.some((q) => rankOf(q) > 1)) continue;
    c.xmed = 1; c.prof = { k: 'plain', els: [['lane', Math.max(7, c.w || 9)]] };
  }
}

// The path to draw an edge along. Traffic uses e.p; a merge piece draws parallel to the road axis (e.dp).
// Falls back to e.p when an edit has moved the piece since (the two no longer share their far end).
function drawPath(e) {
  const d = e.dp; if (!d || !e.p) return e.p;
  const a = e.p[0], b = d[0], c = e.p[e.p.length - 1], f = d[d.length - 1];
  return (Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.5 || Math.hypot(c[0] - f[0], c[1] - f[1]) < 0.5) ? d : e.p;
}
// How much of the median remains at distance d along the drawn path (1 full, 0 gone). Full for pieces without a nose.
function medianKeep(e, d) {
  const n = e.nose; if (!n) return 1;
  const s = n.rev ? n.len - d : d, t = clamp((s - n.from) / Math.max(1, n.to - n.from), 0, 1);
  return 1 - t * t * (3 - 2 * t);
}

export { drawPath, markDivided, medianKeep };
