import { bbox, nearestOnLine, offsetLine, polyLen } from '../../engine/core.js';

// =====================================================================
// Divided roads. Map data draws a boulevard with a median as two one-way pieces. Left alone, each piece
// gets a full two-way cross-section, so they overlap and the cars on them drive both ways.
// markDivided turns each such pair into two one-way carriageways with a planted median between them,
// and the short connector pieces that merge them back into the two-way road into one-way lanes.
// Runs once while the base city is built. Pure data, no THREE.
// =====================================================================
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const WALK = 2.2, LANE = 3.3;

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
  // a short pair that closes up into one node is the taper where the divided road joins the undivided one
  const shares = e1.a === e2.a || e1.a === e2.b || e1.b === e2.a || e1.b === e2.b;
  if (shares && hi <= 30 && Math.max(polyLen(e1.p), polyLen(e2.p)) < 90) return { d: hi, taper: true };
  return hi - lo <= 7 ? { d: mean, taper: false } : null;
}
// Real boulevards have a narrow raised median (about 3.5 m), not the gap the map data keeps between the two ways.
// Each carriageway is [half median, lanes, sidewalk], centred on its own centreline, so with n lanes of width lw
// the two ways sit 7.45 + n * lw apart. Pick n so the existing positions already fit.
const MEDIAN = 3.5;
function profileFor(e, d) {
  const free = d - MEDIAN - WALK * 2 + 0.0; // room for the lanes of both carriageways' halves
  const n = Math.max(1, Math.min(4, Math.round(free / LANE))), lw = Math.max(2.8, Math.min(4, free / n));
  const els = [['median', MEDIAN / 2], ...Array.from({ length: n }, () => ['lane', lw]), ['walk', WALK]];
  return { n, lw, els };
}
// median on the side facing the partner. offsetLine(+) side is the end of the list.
function oriented(e, partner, els) {
  const s = e.p[Math.floor(e.p.length / 2)], q = nearestOnLine(partner.p, s[0], s[1]);
  const pos = offsetLine(e.p, 1)[Math.floor(e.p.length / 2)], neg = offsetLine(e.p, -1)[Math.floor(e.p.length / 2)];
  const toward = Math.hypot(pos[0] - q.x, pos[1] - q.z) < Math.hypot(neg[0] - q.x, neg[1] - q.z) ? 1 : -1;
  return toward === 1 ? els.slice().reverse() : els; // median first = partner on the negative side
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
  const done = new Set();
  for (const { e, partner, d, taper } of found.values()) {
    if (!found.has(partner.id)) continue; // both halves must agree
    const { els, n, lw } = profileFor(e, d);
    if (taper) { e.prof = { k: 'asbuilt', els: Array.from({ length: n }, () => ['lane', lw]) }; e.oneway = 1; e.divided = 1; e.taper = 1; e.w = n * lw; done.add(e.id); continue; } // lanes only: no median, trees or kerbs across the V
    e.prof = { k: 'asbuilt', els: oriented(e, partner, els) }; e.oneway = 1; e.divided = 1; e.w = n * lw; done.add(e.id);
  }
  // a taper carries as many lanes as the carriageway it grows out of
  for (const e of S.edges.values()) {
    if (!e.taper) continue;
    const nb = [...S.edges.values()].find((q) => q.divided && !q.taper && (q.a === e.a || q.a === e.b || q.b === e.a || q.b === e.b) && q.prof.els.some((x) => x[0] === 'lane'));
    if (nb) { const ln = nb.prof.els.filter((x) => x[0] === 'lane'); e.prof = { k: 'asbuilt', els: ln.map((x) => ['lane', x[1]]) }; e.w = ln.reduce((a, x) => a + x[1], 0); }
  }
  reshapeTapers(S);
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
  return done.size;
}

// Real divided roads keep both carriageways parallel at a constant median width and only close up over a short smooth
// transition. Map data often starts the closing-up right at the cross street, so the pair splays into a long V.
// Rebuild each taper pair from the merge node: parallel at the far end's offset, then a smoothstep blend onto the axis.
const TAPER_LEN = 14, CLEAR = 12; // the carriageways close up over 14 m, starting 12 m past the cross street
function reshapeTapers(S) {
  const byNode = new Map();
  for (const e of S.edges.values()) if (e.taper) for (const n of [e.a, e.b]) { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push(e); }
  for (const [m, es] of byNode) {
    if (es.length !== 2) continue;
    const far = es.map((e) => (e.b === m ? e.p[0] : e.p[e.p.length - 1]));
    const mid = [(far[0][0] + far[1][0]) / 2, (far[0][1] + far[1][1]) / 2];
    let M = S.nodes[m].slice(); const L0 = Math.hypot(mid[0] - M[0], mid[1] - M[1]);
    if (L0 < 20) continue;
    const u = [(mid[0] - M[0]) / L0, (mid[1] - M[1]) / L0], nv = [-u[1], u[0]], total = CLEAR + TAPER_LEN;
    // pull the merge point up the road so it is clear of the intersection
    if (L0 > total + 4) {
      const M2 = [mid[0] - u[0] * total, mid[1] - u[1] * total];
      for (const q of S.edges.values()) { if (q.taper || !(q.a === m || q.b === m)) continue; if (q.a === m) q.p[0] = M2.slice(); else q.p[q.p.length - 1] = M2.slice(); q.bb = bbox(q.p); }
      S.nodes[m] = M2; M = M2;
    }
    const L = Math.hypot(mid[0] - M[0], mid[1] - M[1]), tl = Math.min(TAPER_LEN, L * 0.7);
    es.forEach((e, k) => {
      const F = far[k], sF = (F[0] - M[0]) * u[0] + (F[1] - M[1]) * u[1], oF = (F[0] - M[0]) * nv[0] + (F[1] - M[1]) * nv[1];
      const pts = [], n = Math.max(6, Math.ceil(sF / 3));
      for (let i = 0; i <= n; i++) {
        const sv = sF * i / n, t = Math.min(1, sv / tl), w = t * t * (3 - 2 * t);
        pts.push([M[0] + u[0] * sv + nv[0] * oF * w, M[1] + u[1] * sv + nv[1] * oF * w]);
      }
      pts[0] = M.slice(); pts[n] = F.slice();
      e.p = e.b === m ? pts.slice().reverse() : pts; e.bb = bbox(e.p);
    });
  }
}

// The wedge between the two tapering carriageways, as polygons to draw as median (lanes are drawn on top).
function taperMedians(S) {
  const byNode = new Map();
  for (const e of S.edges.values()) if (e.taper) for (const n of [e.a, e.b]) { if (!byNode.has(n)) byNode.set(n, []); byNode.get(n).push(e); }
  const out = [];
  for (const [m, es] of byNode) {
    if (es.length !== 2) continue;
    const far = (e) => (e.b === m ? e.p.slice() : e.p.slice().reverse()); // far end first, ends at the shared node
    const a = far(es[0]), b = far(es[1]);
    out.push(a.concat(b.reverse().slice(1)));
  }
  return out;
}

export { markDivided, taperMedians };
