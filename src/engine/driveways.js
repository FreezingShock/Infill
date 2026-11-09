// Frontage rule: every house lot gets a driveway on its street-facing front, a curb cut across the footpath and a
// front yard. One general rule that reads only the lot ring, its live buildings and the street it fronts, so it
// works on any area on load and on lots made later by cuts, merges and splits. Pure data, no THREE (runs in workers).
//
// The plan is stored on the lot as `lot.dw`, in the lot frame (s along the street, t from the front line inward):
//   { s, w, te, a, y, ws, es, sd, rd }
//   s    driveway centre along the front, w width, te depth of the strip (to the garage door or the rear limit)
//   a    curb cut depth: front line out to the parking strip, across footpath and planting strip
//   y    depth of the front yard (front line to the nearest facade), ws walkway centre (null when none)
//   es   arclength of the driveway along the street edge, sd which side of it (+1 or -1): the sim parks around it
import PC from 'polygon-clipping';
import { clamp, inPoly, pcSafe, rng, toPC } from './core.js';

const HOUSING = new Set(['house', 'multi']);
const MAX_DRIVE = 25;

// Smallest t of the lot outline at s (the real front boundary there, whatever its slant or kink).
function tFront(loc, s) {
  let best = null;
  for (let i = 0; i < loc.length; i++) {
    const a = loc[i], b = loc[(i + 1) % loc.length];
    if ((a[0] > s) === (b[0] > s)) continue;
    const t = a[1] + (s - a[0]) / (b[0] - a[0]) * (b[1] - a[1]);
    if (best === null || t < best) best = t;
  }
  return best;
}

// How far the curb cut must reach: footpath and planting strip on the lot's side of the street, plus any gap
// between the lot line and the right of way. `side` is +1 when the lot sits on the later-listed side of the profile.
function cutDepth(prof, side, gap) {
  if (!prof || prof.k === 'plain' || !prof.els) return 0;
  const els = side > 0 ? prof.els.slice().reverse() : prof.els;
  let sum = 0;
  for (const [k, w] of els) { if (k === 'walk' || k === 'trees') sum += w; else break; }
  return clamp(sum + Math.max(0, gap), 0, 8);
}

// F is frameOf(lot); rings are the live building footprints. info = { prof, side, gap, es, rd } from the street.
function planDriveway(lot, F, rings, info) {
  if (!HOUSING.has(lot.lt) || !rings.length || lot.flags?.noaccess || !info) return null;
  const loc = lot.r.map(([x, z]) => F.L(x, z)), bl = rings.map((r) => r.map(([x, z]) => F.L(x, z)));
  const front = F.smax - F.smin;
  if (front < 7 || (lot.fr || front) < 7) return null;
  const w = front < 12 ? 2.8 : front < 20 ? 3.2 : front < 26 ? 3.6 : 5.2;
  const r = rng((lot.sd || 1) + 4421);
  let best = null;
  for (let s = F.smin + w / 2 + 0.8; s <= F.smax - w / 2 - 0.8 + 1e-6; s += 0.5) {
    const ta = tFront(loc, s - w / 2), tb = tFront(loc, s + w / 2), tc = tFront(loc, s);
    if (ta === null || tb === null || tc === null) continue;
    const tf = Math.max(ta, tb, tc);
    let te = tf;
    for (let t = tf + 0.25; t <= tf + MAX_DRIVE; t += 0.5) {
      const pts = [[s - w / 2 - 0.5, t], [s, t], [s + w / 2 + 0.5, t]];
      if (pts.some(([ps, pt]) => !inPoly(ps, pt, loc) || bl.some((b) => inPoly(ps, pt, b)))) break;
      te = t;
    }
    const len = te - tf;
    if (len < 3) continue;
    const score = Math.min(len, 14) - Math.min(s - F.smin, F.smax - s) * 0.5 + r() * 0.3;
    if (!best || score > best.score) best = { score, s, te, tf };
  }
  if (!best) return null;
  // front yard: out to the frontmost facade; walkway to the middle of that facade, kept clear of the driveway
  let y = 1e9, ws = null, face = null;
  for (const b of bl) { const m = Math.min(...b.map((p) => p[1])); if (m < y) { y = m; face = b; } }
  if (face) { const near = face.filter((p) => p[1] < y + 1.5); ws = near.reduce((q, p) => q + p[0], 0) / near.length; }
  const need = best.s - w / 2 - 1.3, hi = best.s + w / 2 + 1.3;
  if (ws !== null && ws > need && ws < hi) ws = (best.s - F.smin) > (F.smax - best.s) ? need - 0.2 : hi + 0.2;
  if (ws !== null && (ws < F.smin + 1 || ws > F.smax - 1)) ws = null;
  const round = (v) => Math.round(v * 10) / 10;
  return { s: round(best.s), w, te: round(best.te), a: round(cutDepth(info.prof, info.side, info.gap)), y: y < 1e8 ? round(y) : 0, ws: ws === null ? null : round(ws), es: round(info.es), sd: info.side, rd: info.rd };
}

// Rings to paint for a planned frontage, in world coordinates: { drive, apron, walk, lawn: [rings] }.
// o.te caps the driveway at a new building's facade; o.lawn false leaves the yard to the caller.
function frontageRings(lot, F, o = {}) {
  const dw = lot.dw; if (!dw) return null;
  const loc = lot.r.map(([x, z]) => F.L(x, z)), P = (s, t) => F.P(s, t);
  const w = dw.w, tf = (s) => tFront(loc, s) ?? 0;
  const ta = tf(dw.s - w / 2), tb = tf(dw.s + w / 2), tm = tf(dw.s), te = Math.min(dw.te, o.te ?? 1e9);
  const out = { drive: null, apron: null, walk: null, lawn: [] };
  if (te - Math.max(ta, tb) >= 2) out.drive = [P(dw.s - w / 2, ta - 0.1), P(dw.s + w / 2, tb - 0.1), P(dw.s + w / 2, te), P(dw.s - w / 2, te)];
  if (dw.a > 0.4) out.apron = [P(dw.s - w / 2, ta), P(dw.s + w / 2, tb), P(dw.s + w / 2 + 0.9, tm - dw.a), P(dw.s - w / 2 - 0.9, tm - dw.a)];
  if (dw.ws !== null) { const tw = tf(dw.ws); if (dw.y - tw > 1.5) out.walk = [P(dw.ws - 0.55, tw - 0.1), P(dw.ws + 0.55, tw - 0.1), P(dw.ws + 0.55, dw.y + 0.1), P(dw.ws - 0.55, dw.y + 0.1)]; }
  if (o.lawn !== false && dw.y > 2) {
    const yard = [P(F.smin - 1, -4), P(F.smax + 1, -4), P(F.smax + 1, dw.y - 0.2), P(F.smin - 1, dw.y - 0.2)];
    const sub = [...(out.drive ? [toPC([P(dw.s - w / 2 - 0.25, -4), P(dw.s + w / 2 + 0.25, -4), P(dw.s + w / 2 + 0.25, dw.y + 6), P(dw.s - w / 2 - 0.25, dw.y + 6)])] : []), ...(out.walk ? [toPC([P(dw.ws - 0.8, -4), P(dw.ws + 0.8, -4), P(dw.ws + 0.8, dw.y + 6), P(dw.ws - 0.8, dw.y + 6)])] : [])];
    const inLot = pcSafe(PC.intersection, toPC(yard), toPC(lot.r));
    if (inLot) for (const ring of inLot) { const res = sub.length ? pcSafe(PC.difference, toPC(ring), ...sub) : [ring]; if (res) out.lawn.push(...res); }
  }
  return out;
}

// Driveways grouped by the street edge they open onto: Map edgeId -> [{ s, hw, side }] (the sim leaves these kerb gaps unparked).
function drivewaysByEdge(lots) {
  const m = new Map();
  for (const l of lots) { const d = l.dw; if (!d || d.a <= 0 && d.es === undefined) continue; let a = m.get(d.rd); if (!a) m.set(d.rd, a = []); a.push({ s: d.es, hw: d.w / 2, side: d.sd }); }
  for (const a of m.values()) a.sort((p, q) => p.s - q.s);
  return m;
}

// Curb cut mouths as [x, z, radius] for things that must stay clear of them (utility poles, street trees).
function driveCuts(lots, frameOf) {
  const out = [];
  for (const l of lots) { const d = l.dw; if (!d) continue; const p = frameOf(l).P(d.s, -Math.min(d.a, 4)); out.push([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round((d.w / 2 + 1.2) * 10) / 10]); }
  return out;
}

export { HOUSING, driveCuts, cutDepth, drivewaysByEdge, frontageRings, planDriveway, tFront };
