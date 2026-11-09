import { C, UP, elev, ey, obox } from '../engine/core.js';
import { CLEAR, DECK_T } from '../engine/levels.js';
import { heightIn, project, spanAt, spansOf } from '../tools/roads/deck.js';

// =====================================================================
// Drawing what a level change needs: the deck's slab and parapets, abutments, piers, the retaining walls of the cut the
// road underneath runs in, and the concrete barrier strip freeways and ramps carry. Planning is src/engine/levels.js; the
// ribbons themselves follow the deck through core's setDeck hook. Geometry only, built with the road mesh.
// =====================================================================
const CONC = C(0xaaa69e), CONC_D = C(0x77736c), CONC_L = C(0xc4c0b8), WALL = C(0xa09c94);

// (x, z) -> deck height or NaN, for core's setDeck. null for an edge that stays on the ground.
function deckFn(e) {
  const sp = spansOf(e); if (!sp) return null;
  return (x, z) => { const q = project(e.p, x, z), s = spanAt(sp, q.s); return s ? heightIn(s, q.s) : NaN; };
}

function normalsOf(P) {
  return P.map((_, i) => { const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, P.length - 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [-dz / L, dx / L]; });
}
function resample(p, step) { // points every `step` metres, ends kept
  const out = [p[0]];
  for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
  return out;
}

// A raised concrete strip along a path between offsets o1 and o2, h high, standing on whatever the road is on (ground or deck).
function barrierStrip(acc, path, o1, o2, h, col = CONC) {
  if (path.length < 2) return;
  const P = resample(path, 3), N = normalsOf(P);
  const v = (i, o, dy) => { const x = P[i][0] + N[i][0] * o, z = P[i][1] + N[i][1] * o; return [x, ey(x, z) + dy, z]; };
  for (let i = 0; i < P.length - 1; i++) {
    const nx = N[i][0], nz = N[i][1];
    acc.quad(v(i, o1, h), v(i, o2, h), v(i + 1, o2, h), v(i + 1, o1, h), CONC_L, UP);
    acc.quad(v(i, o1, 0), v(i + 1, o1, 0), v(i + 1, o1, h), v(i, o1, h), col, [-nx, 0, -nz]);
    acc.quad(v(i, o2, 0), v(i + 1, o2, 0), v(i + 1, o2, h), v(i, o2, h), col, [nx, 0, nz]);
  }
}

// slab, parapets, abutments and piers for every bridge span of one edge. `row` is the cross-section width.
function bridgeParts(acc, e, row, onRoad) {
  const spans = spansOf(e); if (!spans) return;
  const hw = row / 2 + 0.3, hasBarrier = e.prof.els.some((q) => q[0] === 'barrier');
  for (const sp of spans) {
    if (sp.L <= 0) continue;
    const n = sp.h.length, P = [], Y = [];
    for (let i = 0; i < n; i++) { const s = sp.a + i * sp.d, q = at(e.p, s); P.push(q); Y.push(sp.h[i]); }
    const N = normalsOf(P);
    const L = (i) => [P[i][0] + N[i][0] * -hw, Y[i], P[i][1] + N[i][1] * -hw], R = (i) => [P[i][0] + N[i][0] * hw, Y[i], P[i][1] + N[i][1] * hw];
    const low = (a, k = DECK_T) => [a[0], a[1] - k, a[2]];
    for (let i = 0; i < n - 1; i++) {
      acc.quad(low(L(i)), low(R(i)), low(R(i + 1)), low(L(i + 1)), CONC_D, [0, -1, 0]); // soffit
      acc.quad(low(L(i)), low(L(i + 1)), low(L(i + 1), -0.3), low(L(i), -0.3), CONC, [-N[i][0], 0, -N[i][1]]); // fascia, left (up to the kerb)
      acc.quad(low(R(i)), low(R(i + 1)), low(R(i + 1), -0.3), low(R(i), -0.3), CONC, [N[i][0], 0, N[i][1]]); // fascia, right
    }
    if (!hasBarrier) { // parapet where the profile carries no barrier of its own
      const path = offs(e.p, sp);
      barrierStrip(acc, path, -row / 2 - 0.05, -row / 2 + 0.3, 0.95); barrierStrip(acc, path, row / 2 - 0.3, row / 2 + 0.05, 0.95);
    }
    // abutments: a wall across the deck at each end, down to the cut ground
    for (const end of [0, 1]) {
      const i = end ? n - 1 : 0, j = end ? n - 2 : 1, q = P[i], dir = end ? [P[i][0] - P[j][0], P[i][1] - P[j][1]] : [P[i][0] - P[j][0], P[i][1] - P[j][1]];
      const dl = Math.hypot(dir[0], dir[1]) || 1, ux = dir[0] / dl, uz = dir[1] / dl, cx = q[0] + ux * 0.7, cz = q[1] + uz * 0.7;
      const g = Math.min(elev(cx + ux * 2.5, cz + uz * 2.5), elev(cx, cz)), top = Y[i] - DECK_T, bottom = Math.min(g, top - 0.9) - 0.4;
      obox(acc, { x: cx, z: cz, ux: -uz, uz: ux, vx: ux, vz: uz, hw: hw + 0.5, hd: 0.7 }, bottom, top - bottom, CONC, false, CONC_L);
    }
    // piers: one bent under each long span's middle thirds, never inside the road that passes beneath
    const len = sp.b - sp.a, bents = Math.max(0, Math.ceil(len / 32) - 1);
    for (let b = 1; b <= bents; b++) {
      const s = sp.a + len * b / (bents + 1), q = at(e.p, s), i = Math.min(n - 1, Math.round((s - sp.a) / sp.d)), nn = N[i];
      if (onRoad && onRoad(q[0], q[1], 3)) continue;
      const g = elev(q[0], q[1]), top = Y[i] - DECK_T;
      obox(acc, { x: q[0], z: q[1], ux: nn[0], uz: nn[1], vx: -nn[1], vz: nn[0], hw: hw * 0.8, hd: 0.55 }, g - 0.3, top - g + 0.3, CONC, false, CONC_L);
    }
  }
}
function at(p, s) { let acc = 0; for (let i = 1; i < p.length; i++) { const L = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); if (acc + L >= s || i === p.length - 1) { const u = L ? Math.min(1, Math.max(0, (s - acc) / L)) : 0; return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * u, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * u]; } acc += L; } return p[0].slice(); }
// the part of an edge's path inside a span, resampled
function offs(p, sp) { const out = []; for (let s = sp.a; s < sp.b; s += 3) out.push(at(p, s)); out.push(at(p, sp.b)); return out; }

// Concrete walls on both sides of a road that dips under a bridge, wherever the cut is deeper than a kerb.
function cutWalls(acc, e, row, s0, s1) {
  if (!e || !e.p) return;
  const h = row / 2 + 3; // where the cut's flat floor ends (the same margin levels.js cuts around the road)
  const P = []; for (let s = Math.max(0, s0); s <= Math.min(polyLength(e.p), s1); s += 3) P.push(at(e.p, s));
  if (P.length < 2) return;
  const N = normalsOf(P);
  for (const sgn of [-1, 1]) for (let i = 0; i < P.length - 1; i++) {
    const side = (k) => { const x = P[k][0] + N[k][0] * sgn * h, z = P[k][1] + N[k][1] * sgn * h, bx = P[k][0] + N[k][0] * sgn * (h + 1.5), bz = P[k][1] + N[k][1] * sgn * (h + 1.5), yr = elev(P[k][0], P[k][1]); return [[x, yr, z], [x, Math.min(elev(bx, bz), yr + CLEAR + 1), z]]; }; // the wall rises to the bank just behind it
    const [b0, t0] = side(i), [b1, t1] = side(i + 1);
    if (t0[1] - b0[1] < 0.7 && t1[1] - b1[1] < 0.7) continue;
    t0[1] = Math.max(t0[1], b0[1] + 0.3); t1[1] = Math.max(t1[1], b1[1] + 0.3);
    acc.quad(b0, b1, t1, t0, WALL, [-N[i][0] * sgn, 0, -N[i][1] * sgn]);
  }
}
function polyLength(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }

export { barrierStrip, bridgeParts, cutWalls, deckFn };
