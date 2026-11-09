import { nearestOnLine, offsetLine, polyLen } from '../../engine/core.js';

// =====================================================================
// Divided roads. Map data draws a boulevard with a median as two one-way pieces. Left alone, each piece
// gets a full two-way cross-section, so they overlap and the cars on them drive both ways.
// markDivided turns each such pair into two one-way carriageways with a planted median between them,
// and the short connector pieces that merge them back into the two-way road into one-way lanes.
// Runs once while the base city is built. Pure data, no THREE.
// =====================================================================
const MAJOR = new Set(['primary', 'secondary', 'tertiary', 'trunk']);
const WALK = 2.2, PARK = 2, LANE = 3.3;

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
  if (against < 3 || Math.max(...ds) - Math.min(...ds) > 7) return null;
  return ds.reduce((a, b) => a + b, 0) / ds.length;
}
function profileFor(e, d) {
  const park = d >= 14 && e.c !== 'trunk', outer = WALK + (park ? PARK : 0);
  const n = Math.max(1, Math.min(4, Math.round((d - 2 * outer) / LANE)));
  const lw = Math.max(2.8, Math.min(4.2, (d - 2 * outer) / n)), med = Math.max(1, d / 2 - (n * lw) / 2);
  const els = [['median', med], ...Array.from({ length: n }, () => ['lane', lw])]; if (park) els.push(['park', PARK]); els.push(['walk', WALK]);
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
      const d = gapTo(e1, e2); if (d != null && d < bd) { bd = d; best = e2; }
    }
    if (best && bd >= 7) found.set(e1.id, { e: e1, partner: best, d: bd });
  }
  const done = new Set();
  for (const { e, partner, d } of found.values()) {
    if (!found.has(partner.id)) continue; // both halves must agree
    const { els, n, lw } = profileFor(e, d);
    e.prof = { k: 'asbuilt', els: oriented(e, partner, els) }; e.oneway = 1; e.divided = 1; e.w = n * lw; done.add(e.id);
  }
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

export { markDivided };
