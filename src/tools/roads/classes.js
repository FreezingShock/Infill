import { nearestOnLine, polyLen } from '../../engine/core.js';

// =====================================================================
// Road-class model. One place that says what kind of road a piece of the map is, and what cross-section,
// markings and junction behaviour that implies. Pure data, no THREE, runs in node and workers.
//
//   local      residential street: narrow, parking both sides, nothing marked, gives way
//   collector  tertiary / wide residential: one lane each way, parking, centre line, stops the locals
//   arterial   the stroad (Topanga at 45 mph): two lanes each way plus a centre turn lane or median,
//              a curbside parking/bus lane, flows through every junction with a smaller street
//   freeway    ramps and motorways, left as the map draws them
//
// The class comes from the OSM class, the posted speed and the width; the frontage (what zoning faces the
// street) only changes the outer strip: commercial fronts get a wide plain sidewalk, residential fronts
// keep the planted parkway. Total width never changes with frontage, so lots stay where the importer cut them.
// =====================================================================
const RANK = { freeway: 5, arterial: 4, collector: 2, local: 1 };

function roadClassOf(e) {
  if (e.rc) return e.rc;
  if (e.c === 'motorway' || e.c === 'trunk') return 'freeway';
  if (e.c === 'primary') return 'arterial';
  if (e.c === 'secondary') return (e.speed || 0) >= 35 || (e.w || 0) >= 17 ? 'arterial' : 'collector';
  if (e.c === 'tertiary') return 'collector';
  if ((e.c === 'residential' || e.c === 'unclassified') && (e.w || 0) >= 12) return 'collector';
  return 'local';
}
const rankOf = (e) => RANK[roadClassOf(e)] ?? 1;

// What faces each street: 'commercial' | 'residential' | 'mixed' | 'open'. Lots remember the street they front (lot.rd);
// lots within reach of the street's samples count too, so split pieces and cut streets still read right.
const isCommercial = (l) => l.lt === 'main' || l.lt === 'civic' || /^(C|M|PF)/.test(l.z || '') || l.lt === 'parking' && /^C/.test(l.z || '');
function frontage(S) {
  const cell = 40, grid = new Map();
  for (const l of S.lots.values()) { const k = Math.floor(l.c[0] / cell) + ',' + Math.floor(l.c[1] / cell); (grid.get(k) || grid.set(k, []).get(k)).push(l); }
  const out = new Map();
  for (const e of S.edges.values()) {
    if (!e.g) continue;
    const seen = new Set(); let com = 0, res = 0;
    const len = polyLen(e.p), n = Math.max(2, Math.ceil(len / 14));
    for (let i = 0; i <= n; i++) {
      const t = len * i / n; let acc = 0, x = e.p[0][0], z = e.p[0][1];
      for (let j = 1; j < e.p.length; j++) { const L = Math.hypot(e.p[j][0] - e.p[j - 1][0], e.p[j][1] - e.p[j - 1][1]); if (acc + L >= t || j === e.p.length - 1) { const u = L ? Math.min(1, (t - acc) / L) : 0; x = e.p[j - 1][0] + (e.p[j][0] - e.p[j - 1][0]) * u; z = e.p[j - 1][1] + (e.p[j][1] - e.p[j - 1][1]) * u; break; } acc += L; }
      for (let a = Math.floor((x - 32) / cell); a <= Math.floor((x + 32) / cell); a++) for (let b = Math.floor((z - 32) / cell); b <= Math.floor((z + 32) / cell); b++) for (const l of grid.get(a + ',' + b) || []) {
        if (seen.has(l.id) || Math.hypot(l.c[0] - x, l.c[1] - z) > 32) continue;
        if (l.rd && l.rd !== e.id && S.edges.get(l.rd)?.g && nearestOnLine(S.edges.get(l.rd).p, l.c[0], l.c[1]).d < nearestOnLine(e.p, l.c[0], l.c[1]).d) continue; // fronts a nearer street
        seen.add(l.id); if (isCommercial(l)) com++; else res++;
      }
    }
    const tot = com + res;
    out.set(e.id, tot < 2 ? 'open' : com / tot > 0.6 ? 'commercial' : com / tot < 0.2 ? 'residential' : 'mixed');
  }
  return out;
}

// Commercial frontage: the planted strip becomes plain sidewalk (people walk to the door). Same total width.
function withFrontage(els, kind) {
  if (kind !== 'commercial') return els;
  const out = [], n = els.length;
  let moved = 0;
  els.forEach(([k, w], i) => { if (k === 'trees' && (i < 3 || i >= n - 3)) moved += w; else out.push([k, w]); });
  if (!moved) return els;
  const half = moved / 2; // give each outer sidewalk its share
  const f = out.findIndex((q) => q[0] === 'walk'); let l = -1; out.forEach((q, i) => { if (q[0] === 'walk') l = i; });
  if (f >= 0) { if (f === l) out[f] = ['walk', out[f][1] + moved]; else { out[f] = ['walk', out[f][1] + half]; out[l] = ['walk', out[l][1] + half]; } }
  return out;
}

// Gives every street its class and frontage. Profiles the importer or a player drew by hand are left alone;
// default ('asbuilt') ones get the frontage rule. Runs once while the base city is built.
function classify(S) {
  const front = frontage(S);
  for (const e of S.edges.values()) {
    if (!e.g) continue;
    e.rc = roadClassOf(e); e.front = front.get(e.id) || 'open';
    if (e.prof && e.prof.k === 'asbuilt' && e.s !== 'driveway') e.prof = { k: 'asbuilt', els: withFrontage(e.prof.els, e.front) };
  }
}

// The cross-section of one half of an arterial, outside in: sidewalk, curbside parking/bus lane, lanes.
// Divided and undivided carriageways come from the same numbers, so the road is the same width where the
// raised median stops and the centre turn lane starts.
const ARTERIAL = { walk: 2.2, park: 2, lane: 3.25, n: 2, median: 3 };

export { ARTERIAL, RANK, classify, frontage, rankOf, roadClassOf, withFrontage };
