import { bbox, nearestOnLine } from '../../engine/core.js';
import { drawPath } from './divided.js';

// =====================================================================
// "Is this point on the roadway?" One test for everything that must stay off the pavement: street trees,
// props, anything a generator drops near a street. The roadway is the part of the cross-section that cars use
// (lanes, parking, turn lanes, bike lanes); sidewalks, planting strips and medians are not.
// Pure data, no THREE.
// =====================================================================
const NOT_ROADWAY = new Set(['walk', 'trees', 'median', 'plaza']);
const CELL = 40;

function roadwayIndex(edges) {
  const grid = new Map(), items = [];
  for (const e of edges) {
    if (!e.g || e.xmed || !e.prof || !e.p || e.p.length < 2 || e.s === 'driveway') continue;
    let o = 0, lo = Infinity, hi = -Infinity;
    const row = e.prof.els.reduce((s, q) => s + q[1], 0); o = -row / 2;
    for (const [k, w] of e.prof.els) { if (!NOT_ROADWAY.has(k) || (k === 'median' && e.nose)) { lo = Math.min(lo, o); hi = Math.max(hi, o + w); } o += w; }
    if (lo === Infinity) continue;
    const P = drawPath(e), reach = Math.max(Math.abs(lo), Math.abs(hi)) + 1, b = bbox(P), it = { e, P, lo, hi, reach };
    items.push(it);
    for (let i = Math.floor((b[0] - reach) / CELL); i <= Math.floor((b[2] + reach) / CELL); i++) for (let j = Math.floor((b[1] - reach) / CELL); j <= Math.floor((b[3] + reach) / CELL); j++) { const k = i + ',' + j; (grid.get(k) || grid.set(k, []).get(k)).push(it); }
  }
  // the roadway piece that covers (x, z) within pad metres, as { lat, q, n, it }, or null
  function hit(x, z, pad = 0) {
    for (const it of grid.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL)) || []) {
      const q = nearestOnLine(it.P, x, z); if (q.d > it.reach + pad) continue;
      const a = it.P[q.i], c = it.P[q.i + 1], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1, n = [-(c[1] - a[1]) / L, (c[0] - a[0]) / L];
      const lat = n[0] * (x - q.x) + n[1] * (z - q.z);
      if (lat > it.lo - pad && lat < it.hi + pad) return { lat, q, n, it };
    }
    return null;
  }
  // the nearest point just off the pavement (a gap beyond the roadway edge), or the point itself when it is already clear
  function nudge(x, z, gap = 0.9) {
    // pushed off one roadway a point can land in the next (a junction wedge between two roads), so try both sides of
    // each roadway in the way, a few levels deep, and keep the nearest point that is clear of all of them
    const x0 = x, z0 = z; let best = null;
    const go = (px, pz, depth) => {
      const h = hit(px, pz, 0);
      if (!h) { const d = Math.hypot(px - x0, pz - z0); if (!best || d < best.d) best = { d, p: [px, pz] }; return; }
      if (depth === 0) return;
      for (const t of [h.it.lo - gap, h.it.hi + gap]) go(h.q.x + h.n[0] * t, h.q.z + h.n[1] * t, depth - 1);
    };
    go(x, z, 4);
    return best ? best.p : [x, z];
  }
  // A mapped footpath runs across the street in the data. Keep only the parts off the pavement; the crosswalks are drawn at junctions.
  function clipWalk(p) {
    const out = []; let cur = [];
    const pts = []; for (let i = 1; i < p.length; i++) { const a = p[i - 1], b = p[i], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 1.5)); for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]); }
    const flush = () => { if (cur.length >= 2) out.push(cur); cur = []; };
    for (const q of pts) { if (hit(q[0], q[1], -0.2)) flush(); else cur.push(q); }
    flush(); return out;
  }
  return { hit, nudge, clipWalk, count: items.length };
}

export { roadwayIndex };
