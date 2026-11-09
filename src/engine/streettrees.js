import { alongPts, elev, offsetLine } from './core.js';

// Street trees from the City of LA street tree inventory (sidecar public/areas/<id>.streets.json, CC0).
// The inventory gives, per named street, how densely it was planted and with what shapes of tree.
// Streets whose profile already has a tree strip are left to that strip.
let DATA = null;
const setStreetTrees = (d) => { DATA = d && d.v === 1 ? d : null; return !!DATA; };
const SUF = { rd: 'road', st: 'street', av: 'avenue', ave: 'avenue', dr: 'drive', bl: 'boulevard', blvd: 'boulevard', ln: 'lane', ct: 'court', pl: 'place', wy: 'way', cir: 'circle', ter: 'terrace' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean).map((w) => SUF[w] || w).join(' ');

// Pure: where would trees go along this street? Returns [x, y, z, scale, kind, colourIx] like the other trees.
function streetTrees(e, walkOuter, rowW) {
  if (!DATA || !e.n || e.s === 'driveway' || !e.prof || e.prof.k === 'plain') return [];
  if (e.prof.els.some((q) => q[0] === 'trees' || q[0] === 'median')) return [];
  const st = DATA.streets[norm(e.n)]; if (!st) return [];
  const out = [], off = rowW / 2 - walkOuter + 0.7;
  const len = e.p.reduce((s, q, i) => (i ? s + Math.hypot(q[0] - e.p[i - 1][0], q[1] - e.p[i - 1][1]) : 0), 0);
  if (len < 14 || off <= 0) return out;
  for (const side of [-1, 1]) {
    let n = 0; const line = offsetLine(e.p, side * off), start = e.p[0], end = e.p[e.p.length - 1];
    alongPts(line, st.sp, (x, z) => {
      if (Math.hypot(x - start[0], z - start[1]) < 8 || Math.hypot(x - end[0], z - end[1]) < 8) return; // keep intersections clear
      const h = Math.abs(Math.round(x * 13 + z * 7 + side * 5)), k = st.k[h % st.k.length];
      out.push([x, elev(x, z) + 0.2, z, 0.75 + (h % 5) * 0.06, k, h % 5]); n++;
    });
    void n;
  }
  return out;
}
export { setStreetTrees, streetTrees, norm };
