// Pure layout of the real infrastructure sidecar (public/areas/<id>.infra.json): no THREE, runs in node tests.
// Every item carries the source it came from, so tags can name it. Nothing here is modelled or guessed.
export const SRC = { lights: 'CITY OF LA', hydrants: 'CITY OF LA', stops: 'METRO', transmission: 'CEC', power: 'OSM' };
const pairs = (flat) => { const out = []; for (let i = 0; i + 1 < flat.length; i += 2) out.push([flat[i], flat[i + 1]]); return out; };
const len = (p) => { let s = 0; for (let k = 1; k < p.length; k++) s += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); return s; };
function at(p, s) { let acc = 0; for (let k = 0; k < p.length - 1; k++) { const L = Math.hypot(p[k + 1][0] - p[k][0], p[k + 1][1] - p[k][1]); if (acc + L >= s) { const t = (s - acc) / (L || 1); return [p[k][0] + (p[k + 1][0] - p[k][0]) * t, p[k][1] + (p[k + 1][1] - p[k][1]) * t]; } acc += L; } return p[p.length - 1].slice(); }

/** Tower spots along a line: every vertex at least `gap` metres after the last tower, plus both ends. */
export function towerSpots(p, gap = 170) {
  const out = []; let acc = 0;
  for (let k = 0; k < p.length; k++) {
    if (k) acc += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    if (k === 0 || k === p.length - 1 || acc >= gap) { out.push(p[k]); acc = 0; }
  }
  return out;
}

/** Sidecar -> everything the scene draws. lamps: [x, z] street lamps the pack already has, so city lights are not doubled. */
export function layoutInfra(D, lamps = [], bounds = null) {
  if (!D) return null;
  const inB = (x, z) => !bounds || (x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]);
  const cell = 10, grid = new Set(lamps.map(([x, z]) => Math.round(x / cell) + ',' + Math.round(z / cell)));
  const nearLamp = (x, z) => { const i = Math.round(x / cell), j = Math.round(z / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (grid.has(i + a + ',' + (j + b))) return true; return false; };
  const lights = (D.lights || []).filter(([x, z]) => inB(x, z)).map(([x, z, w, led]) => ({ x, z, w: w || 0, led: !!led, pole: !nearLamp(x, z) }));
  const hydrants = (D.hydrants || []).filter(([x, z]) => inB(x, z)).map(([x, z, size, st]) => ({ x, z, size: String(size || '').replace(/\s+/g, ''), st: st || '' }));
  const stops = (D.stops || []).map(([x, z, name, lines, ons]) => ({ x, z, name: name || 'Bus stop', lines: (lines || []).map(String), ons: Math.round(ons || 0) }));
  const trans = (D.transmission || []).map((t) => { const p = pairs(t.p); return { kv: t.kv || null, owner: t.owner || '', p, towers: towerSpots(p), mid: at(p, len(p) / 2), len: len(p) }; }).filter((t) => t.p.length > 1);
  const plines = ((D.power && D.power.lines) || []).map((l) => { const p = pairs(l.p); const v = l.kv ? Math.round(+String(l.kv).split(';')[0] / 1000) : null; return { k: l.k, kv: Number.isFinite(v) && v > 0 ? v : null, p, mid: at(p, len(p) / 2), len: len(p) }; }).filter((l) => l.p.length > 1);
  const ppts = ((D.power && D.power.pts) || []).map(([k, x, z]) => ({ k, x, z }));
  return { lights, hydrants, stops, trans, plines, poles: ppts.filter((q) => q.k === 'power_pole'), towers: ppts.filter((q) => q.k === 'power_tower'), subs: ppts.filter((q) => q.k === 'substation' || q.k === 'plant') };
}

/** Area totals for the load summary. */
export function infraTotals(I) {
  if (!I) return null;
  const kv = [...new Set(I.trans.map((t) => t.kv).filter(Boolean))].sort((a, b) => b - a);
  return { lights: I.lights.length, led: I.lights.length ? Math.round(100 * I.lights.filter((l) => l.led).length / I.lights.length) : 0, hydrants: I.hydrants.length, stops: I.stops.length, boardings: I.stops.reduce((a, s) => a + s.ons, 0), kv };
}
