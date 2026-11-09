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
    if (!e.g || !e.prof || !e.p || e.p.length < 2 || e.s === 'driveway') continue;
    let o = 0, lo = Infinity, hi = -Infinity;
    const row = e.prof.els.reduce((s, q) => s + q[1], 0); o = -row / 2;
    for (const [k, w] of e.prof.els) { if (!NOT_ROADWAY.has(k)) { lo = Math.min(lo, o); hi = Math.max(hi, o + w); } o += w; }
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
    const h = hit(x, z, 0); if (!h) return [x, z];
    const t = h.lat < (h.it.lo + h.it.hi) / 2 ? h.it.lo - gap : h.it.hi + gap;
    return [h.q.x + h.n[0] * t, h.q.z + h.n[1] * t];
  }
  return { hit, nudge, count: items.length };
}

export { roadwayIndex };
