import { alongPts, bbox, elev, inPoly, offsetLine, segDist2 } from './core.js';
import { PACK } from './pack.js';

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

// ---------- tree crowns read from overhead imagery (public/areas/<id>.canopy.json, USGS NAIP, public domain) ----------
// [x, z, radius] in pack metres. Crowns inside a lot become that lot's yard trees; crowns outside every lot and
// close to a street become that street's trees, so both follow edits (a removed street takes its trees with it).
let CAN = null, CGRID = null; const CS = 40;
function setCanopy(d) {
  if (!d || d.v !== 1 || !Array.isArray(d.t)) { CAN = null; CGRID = null; return false; }
  CAN = d.t.map((t) => ({ x: t[0], z: t[1], r: t[2], lot: false })); CGRID = new Map();
  for (const t of CAN) { const k = Math.floor(t.x / CS) + ',' + Math.floor(t.z / CS); (CGRID.get(k) || CGRID.set(k, []).get(k)).push(t); }
  const lots = PACK.lots.map((l) => ({ r: l.r, bb: bbox(l.r) }));
  for (const t of CAN) for (const l of lots) if (t.x >= l.bb[0] && t.x <= l.bb[2] && t.z >= l.bb[1] && t.z <= l.bb[3] && inPoly(t.x, t.z, l.r)) { t.lot = true; break; }
  return true;
}
const hasCanopy = () => !!CAN;
function near(bb, pad) { // crowns whose cell touches the box
  const out = [];
  for (let u = Math.floor((bb[0] - pad) / CS); u <= Math.floor((bb[2] + pad) / CS); u++) for (let v = Math.floor((bb[1] - pad) / CS); v <= Math.floor((bb[3] + pad) / CS); v++) for (const t of CGRID.get(u + ',' + v) || []) out.push(t);
  return out;
}
function crown(t, seed) {
  const h = Math.abs(Math.round(t.x * 13 + t.z * 7 + seed)), small = t.r < 2.1;
  return [t.x, elev(t.x, t.z) + (small ? 0 : 0.1), t.z, small ? Math.max(0.8, Math.min(1.8, t.r / 1.1)) : Math.max(0.55, Math.min(2.1, t.r / 2.5)), small ? 3 : 0, h % 5];
}
// yard trees for one lot: crowns inside its ring (buildings were screened out when the file was made)
function yardCanopy(lot) {
  if (!CAN) return null;
  return near(lot.bb, 0).filter((t) => t.lot && t.x >= lot.bb[0] && t.x <= lot.bb[2] && t.z >= lot.bb[1] && t.z <= lot.bb[3] && inPoly(t.x, t.z, lot.r)).map((t) => crown(t, 1));
}
// street trees for all edges: each street crown goes to its nearest edge within the corridor
function streetCanopy(edges, rowOf) {
  const out = [], list = [...edges];
  for (const t of CAN) {
    if (t.lot) continue;
    let best = null, bd = 1e9;
    for (const e of list) {
      if (!e.bb || t.x < e.bb[0] - 20 || t.x > e.bb[2] + 20 || t.z < e.bb[1] - 20 || t.z > e.bb[3] + 20) continue;
      for (let i = 1; i < e.p.length; i++) { const d = segDist2(t.x, t.z, e.p[i - 1][0], e.p[i - 1][1], e.p[i][0], e.p[i][1]); if (d < bd) { bd = d; best = e; } }
    }
    if (best && Math.sqrt(bd) <= rowOf(best) / 2 + 5 && Math.sqrt(bd) >= 2.5 && best.s !== 'driveway') out.push(crown(t, 3));
  }
  return out;
}
// everything the road builder needs: imagery crowns where we have them, else the inventory density per named street
function streetTreesAll(edges, rowOf, walkOf) {
  if (CAN) return streetCanopy(edges.filter((e) => e.c !== 'motorway'), rowOf);
  const out = []; for (const e of edges) for (const t of streetTrees(e, walkOf(e), rowOf(e))) out.push(t);
  return out;
}
export { setStreetTrees, streetTrees, norm, setCanopy, hasCanopy, yardCanopy, streetTreesAll };
