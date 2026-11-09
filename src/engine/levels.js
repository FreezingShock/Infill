import { HG, T, elev } from './core.js';
import { heightIn, polyLen } from '../tools/roads/deck.js';

// =====================================================================
// Road levels: bridges, underpasses, tunnels, and what they do to the ground.
// One ruleset for every area (nothing is special-cased per road):
//   1. Spans come from the data: `edge.lv = [[a, b, level]]` in metres along the edge (Overture is_bridge / is_tunnel and
//      level_rules, written by tools/pack/levels.py). A pack without them still works, because of rule 2.
//   2. Two roads whose paths cross with no shared node are not at the same level (the map splits roads at every real
//      junction). The one with a tagged span over the crossing is the upper. Untagged, a freeway or ramp passes over any
//      other road; anything else stays as drawn (a stray crossing is a data glitch, not an overpass).
//   3. A deck follows a straight grade between the ground at its two ends (the approach is on the ground), raised
//      where it must clear a deck beneath it. Tunnels dip below the ground between their portals.
//   4. The ground under a deck is cut away so the road below really passes under it, with an approach grade of at most
//      8 percent on the road that goes under.
//   5. Traffic on different levels never meets: an edge end counts as elevated only where the deck continues past the node
//      (`l0`, `l1`), see src/sim/net.js.
// Pure data except that it lowers the shared terrain grid (HG) under bridges. Run once on the base city.
// =====================================================================
const CLEAR = 5.6, DECK_T = 1.1, STEP = 3, MAX_GRADE = 0.07, GRADE = 0.08, STACK_CLEAR = 6.2, ENDPAD = 4, TUNNEL_DEPTH = 6.5;
const SERVICE = new Set(['service', 'unknown']);
const freewayish = (e) => e.c === 'motorway' || e.c === 'trunk' || e.rc === 'freeway';
const smooth = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const half = (e) => (e.prof ? e.prof.els.reduce((s, q) => s + q[1], 0) : e.w || 8) / 2;
const RANKS = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, residential: 1, unclassified: 1 };

function cumOf(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; }
function pointAt(p, cum, s) {
  let i = 1; while (i < p.length - 1 && cum[i] < s) i++;
  const L = cum[i] - cum[i - 1] || 1, u = Math.min(1, Math.max(0, (s - cum[i - 1]) / L));
  return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u];
}
function segCross(a, b, c, d) { // proper crossing of segments ab and cd: [t along ab, u along cd, sin of the angle] or null
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u, Math.abs(den) / (Math.hypot(rx, rz) * Math.hypot(sx, sz))];
}
function mergeSpans(list) { // union of spans of the same sign
  const out = [];
  for (const s of list.sort((a, b) => a[0] - b[0])) {
    const last = out[out.length - 1];
    if (last && (last[2] > 0) === (s[2] > 0) && s[0] <= last[1] + 0.5) { last[1] = Math.max(last[1], s[1]); if (Math.abs(s[2]) > Math.abs(last[2])) last[2] = s[2]; } else out.push(s.slice());
  }
  return out;
}

let PLAN = { stacks: [] };
// where roads pass over roads (edge ids, so it survives the state being cloned): the road builder draws the cut's retaining walls from it
const levelPlan = () => PLAN;

function planLevels(S) {
  const cand = [];
  for (const e of S.edges.values()) {
    if (!e.g || !e.p || e.p.length < 2 || e.ring || e.s === 'driveway' || e.s === 'parking_aisle') continue;
    if (SERVICE.has(e.c) && !e.lv) continue;
    const cum = cumOf(e.p), len = cum[cum.length - 1];
    if (len < 6) continue;
    cand.push({ e, cum, len, spans: (e.lv || []).filter((s) => s[1] > s[0]).map((s) => [Math.max(0, s[0]), Math.min(len, s[1]), s[2] || (s[2] === 0 ? 0 : 1)]).filter((s) => s[2] !== 0), cross: [] });
  }
  const levelOf = (c, s) => { let L = 0; for (const sp of c.spans) if (s >= sp[0] - 0.01 && s <= sp[1] + 0.01 && Math.abs(sp[2]) > Math.abs(L)) L = sp[2]; return L; };

  // ---- 2. crossings without a shared node
  const grid = new Map(), CELL = 60;
  for (const c of cand) { const b = c.e.bb || [Infinity, Infinity, -Infinity, -Infinity]; for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) { const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(c); } }
  const done = new Set(), crossings = [];
  for (const A of cand) {
    const b = A.e.bb; if (!b) continue;
    const seen = new Set();
    for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++) for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++) for (const B of grid.get(i + ',' + j) || []) {
      if (B === A || seen.has(B)) continue; seen.add(B);
      const key = A.e.id < B.e.id ? A.e.id + '|' + B.e.id : B.e.id + '|' + A.e.id; if (done.has(key)) continue; done.add(key);
      const bb = B.e.bb; if (!bb || bb[0] > b[2] || bb[2] < b[0] || bb[1] > b[3] || bb[3] < b[1]) continue;
      for (let m = 1; m < A.e.p.length; m++) for (let n = 1; n < B.e.p.length; n++) {
        const x = segCross(A.e.p[m - 1], A.e.p[m], B.e.p[n - 1], B.e.p[n]); if (!x || x[2] < 0.2) continue;
        const sa = A.cum[m - 1] + x[0] * (A.cum[m] - A.cum[m - 1]), sb = B.cum[n - 1] + x[1] * (B.cum[n] - B.cum[n - 1]);
        if (sa < 6 || sa > A.len - 6 || sb < 6 || sb > B.len - 6) continue; // at a junction, not an overpass
        const pt = [A.e.p[m - 1][0] + (A.e.p[m][0] - A.e.p[m - 1][0]) * x[0], A.e.p[m - 1][1] + (A.e.p[m][1] - A.e.p[m - 1][1]) * x[0]];
        if (crossings.some((q) => q.A === A && q.B === B && Math.hypot(q.x - pt[0], q.z - pt[1]) < 12)) continue;
        crossings.push({ A, B, sa, sb, x: pt[0], z: pt[1] });
      }
    }
  }
  const stacks = []; // { up, lo, su, sl, x, z }
  for (const q of crossings) {
    const la = levelOf(q.A, q.sa), lb = levelOf(q.B, q.sb);
    let up = null;
    if (la !== lb) up = la > lb ? q.A : q.B;
    else if (la > 0 || lb > 0) { const ra = RANKS[q.A.e.c] ?? 0, rb = RANKS[q.B.e.c] ?? 0; if (ra !== rb) up = ra > rb ? q.A : q.B; else if ((q.A.e.s === 'link') !== (q.B.e.s === 'link')) up = q.A.e.s === 'link' ? q.B : q.A; } // a ramp passes under the mainline // two bridges at once: the bigger road is the higher one
    else if (la === 0 && freewayish(q.A.e) !== freewayish(q.B.e)) up = freewayish(q.A.e) ? q.A : q.B; // untagged: the freeway or ramp carries over
    if (!up) continue;
    const lo = up === q.A ? q.B : q.A, su = up === q.A ? q.sa : q.sb, sl = up === q.A ? q.sb : q.sa;
    if (levelOf(lo, sl) < 0) continue; // already in a tunnel under it
    if (levelOf(up, su) <= 0) { // inferred: a deck long enough to span the road beneath and rest on both sides
      const pad = Math.max(16, half(lo.e) + 12);
      up.spans.push([Math.max(ENDPAD, su - pad), Math.min(up.len - ENDPAD, su + pad), 1]);
    }
    stacks.push({ up, lo, su, sl, x: q.x, z: q.z });
  }

  // ---- 3. decks: grade between the ground at both ends, tunnels dip under it
  // Freeway lanes and ramps are graded as a whole, not draped: one profile for the full length of the edge (the ground with the bridge
  // spans straightened, low-passed, no steeper than 7 percent, its two ends on the ground). Bridges then run straight between the
  // profile's own heights at their ends, so a deck always joins the road on either side, and the bed under the graded stretches is
  // cut and filled to meet it (step 4). Other roads keep the ground height at the ends of each span.
  const isFw = (e) => e.c === 'motorway' || e.c === 'trunk';
  function gradeProfile(c) {
    const n = Math.max(3, Math.ceil(c.len / STEP) + 1), d = c.len / (n - 1), h = new Array(n);
    for (let k = 0; k < n; k++) { const p = pointAt(c.e.p, c.cum, k * d); h[k] = elev(p[0], p[1]); }
    for (const [a, b, L] of c.spans) { // inside a bridge or tunnel the ground says nothing about the road
      if (L === 0) continue;
      const i0 = Math.max(0, Math.floor(a / d)), i1 = Math.min(n - 1, Math.ceil(b / d));
      for (let k = i0 + 1; k < i1; k++) h[k] = h[i0] + (h[i1] - h[i0]) * (k - i0) / (i1 - i0);
    }
    for (let it = 0; it < 30; it++) for (let k = 1; k < n - 1; k++) h[k] = (h[k - 1] + 2 * h[k] + h[k + 1]) / 4; // the DEM is coarse and bumpy, a road is not
    const g = MAX_GRADE * d;
    for (let k = 1; k < n; k++) h[k] = Math.min(h[k - 1] + g, Math.max(h[k - 1] - g, h[k]));
    for (let k = n - 2; k >= 0; k--) h[k] = Math.min(h[k + 1] + g, Math.max(h[k + 1] - g, h[k]));
    return { h, d, at: (s) => { const f = Math.min(Math.max(s / d, 0), n - 1), i = Math.min(Math.floor(f), n - 2); return h[i] + (h[i + 1] - h[i]) * (f - i); } };
  }
  const decks = [];
  for (const c of cand) {
    c.spans = mergeSpans(c.spans);
    c.deck = [];
    const G = isFw(c.e) ? gradeProfile(c) : null, ground = (s) => { if (G) return G.at(s); const p = pointAt(c.e.p, c.cum, s); return elev(p[0], p[1]); };
    for (const [a, b, L] of c.spans) {
      const n = Math.max(2, Math.ceil((b - a) / STEP) + 1), d = (b - a) / (n - 1), h = new Array(n);
      if (L > 0) { const ha = ground(a), hb = ground(b); for (let i = 0; i < n; i++) h[i] = ha + (hb - ha) * i / (n - 1); }
      else for (let i = 0; i < n; i++) { const s = a + i * d; h[i] = ground(s) - TUNNEL_DEPTH * smooth(Math.min(s - a, b - s) / 30); }
      const sp = { a: +a.toFixed(2), b: +b.toFixed(2), L, h, d };
      c.deck.push(sp); decks.push({ c, sp });
    }
    if (G) { // the stretches between the spans are graded roads on the ground (level 0)
      const cuts = [0]; for (const [a, b] of c.spans) cuts.push(a, b); cuts.push(c.len);
      for (let i = 0; i + 1 < cuts.length; i += 2) {
        const u0 = cuts[i], u1 = cuts[i + 1]; if (u1 - u0 < 6) continue;
        const n = Math.max(2, Math.ceil((u1 - u0) / STEP) + 1), d = (u1 - u0) / (n - 1), h = new Array(n);
        for (let k = 0; k < n; k++) h[k] = G.at(u0 + k * d);
        c.deck.push({ a: +u0.toFixed(2), b: +u1.toFixed(2), L: 0, h, d });
      }
      c.deck.sort((x, y) => x.a - y.a);
    }
  }
  const spanOf = (c, s) => c.deck.find((q) => s >= q.a - 1e-6 && s <= q.b + 1e-6) || null;
  for (let pass = 0; pass < 2; pass++) for (const k of stacks) { // an upper deck clears a lower deck by STACK_CLEAR
    const su = spanOf(k.up, k.su), sl = spanOf(k.lo, k.sl); if (!su || su.L < 0 || !sl || sl.L < 0) continue;
    const need = heightIn(sl, k.sl) + STACK_CLEAR, have = heightIn(su, k.su), lift = need - have;
    if (lift <= 0) continue;
    for (let i = 0; i < su.h.length; i++) { const s = su.a + i * su.d; su.h[i] += lift * (1 - smooth(Math.abs(s - k.su) / 28)); }
  }

  // ---- 4. the ground under a deck goes away; the road that passes under it dips to match, at a gentle grade
  const stamp = (x, z, target, r, ring) => {
    const i0 = Math.max(0, Math.floor((x - r - ring - T.minx) / T.cell)), i1 = Math.min(T.nx - 1, Math.ceil((x + r + ring - T.minx) / T.cell));
    const j0 = Math.max(0, Math.floor((z - r - ring - T.minz) / T.cell)), j1 = Math.min(T.nz - 1, Math.ceil((z + r + ring - T.minz) / T.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(T.minx + i * T.cell - x, T.minz + j * T.cell - z), k = j * T.nx + i;
      if (d <= r) { if (HG[k] > target) HG[k] = target; } else if (d < r + ring) { const v = target + (HG[k] - target) * smooth((d - r) / ring); if (HG[k] > v) HG[k] = v; }
    }
  };
  const flatten = (x, z, y, r, ring) => { // ground becomes y inside r and blends back over the ring
    const i0 = Math.max(0, Math.floor((x - r - ring - T.minx) / T.cell)), i1 = Math.min(T.nx - 1, Math.ceil((x + r + ring - T.minx) / T.cell));
    const j0 = Math.max(0, Math.floor((z - r - ring - T.minz) / T.cell)), j1 = Math.min(T.nz - 1, Math.ceil((z + r + ring - T.minz) / T.cell));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(T.minx + i * T.cell - x, T.minz + j * T.cell - z), k = j * T.nx + i;
      if (d <= r) HG[k] = y; else if (d < r + ring) HG[k] += (y - HG[k]) * (1 - smooth((d - r) / ring));
    }
  };
  let carved = 0;
  for (const c of cand) for (const sp of c.deck) { // cut and fill the bed of a graded road, with side slopes blending back into the ground
    if (sp.L !== 0) continue;
    const r = half(c.e) + 2;
    for (let i = 0; i < sp.h.length; i++) { const p = pointAt(c.e.p, c.cum, sp.a + i * sp.d); flatten(p[0], p[1], sp.h[i], r, 8); }
  }
  for (const { c, sp } of decks) {
    if (sp.L < 0) continue;
    const hw = half(c.e) + 2.5;
    for (let i = 0; i < sp.h.length; i++) {
      const s = sp.a + i * sp.d, p = pointAt(c.e.p, c.cum, s), end = Math.min(s - sp.a, sp.b - s);
      stamp(p[0], p[1], sp.h[i] - DECK_T - (CLEAR - DECK_T) * smooth(end / 10), hw, 5); carved++;
    }
  }
  for (const k of stacks) {
    const su = spanOf(k.up, k.su); if (!su || su.L < 0 || spanOf(k.lo, k.sl)) continue; // the road beneath is on the ground here
    const yc = heightIn(su, k.su) - CLEAR, hu = half(k.up.e) + 1, r = half(k.lo.e) + 3, R = hu + CLEAR / GRADE + 8;
    for (let s = Math.max(0, k.sl - R); s <= Math.min(k.lo.len, k.sl + R); s += 2) {
      const p = pointAt(k.lo.e.p, k.lo.cum, s);
      stamp(p[0], p[1], yc + GRADE * Math.max(0, Math.abs(s - k.sl) - hu), r, 4); carved++;
    }
  }

  // ---- 5. write the plan onto the edges
  const ends = new Map(); // node -> [{ c, end, spanned }]
  for (const c of cand) for (const end of [0, 1]) { const n = end ? c.e.b : c.e.a; if (n == null) continue; (ends.get(n) || ends.set(n, []).get(n)).push({ c, end, sp: spanOf(c, end ? c.len : 0) }); }
  let bridges = 0, tunnels = 0;
  for (const c of cand) {
    const e = c.e; delete e.dk; delete e.dkp; delete e.l0; delete e.l1;
    if (!c.deck.length) continue;
    e.dk = c.deck; e.dkp = +polyLen(e.p).toFixed(2);
    for (const sp of c.deck) { if (sp.L > 0) bridges++; else if (sp.L < 0) tunnels++; }
    for (const end of [0, 1]) { // elevated at a node only where the deck carries on across it
      const here = spanOf(c, end ? c.len : 0); if (!here) continue;
      const n = end ? e.b : e.a, group = (ends.get(n) || []).filter((q) => q.c !== c);
      if (group.length && group.every((q) => q.sp && (q.sp.L > 0) === (here.L > 0))) e[end ? 'l1' : 'l0'] = here.L;
    }
  }
  PLAN = { stacks: stacks.map((k) => ({ up: k.up.e.id, lo: k.lo.e.id, su: +k.su.toFixed(1), sl: +k.sl.toFixed(1), x: k.x, z: k.z, ground: !spanOf(k.lo, k.sl) })) };
  return { bridges, tunnels, crossings: stacks.length, carved, edges: cand.length };
}

export { CLEAR, DECK_T, levelPlan, planLevels };
