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

const segDist = (px, pz, a, b) => { const dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (pz - a[1]) * dz) / L2)); return Math.hypot(px - a[0] - dx * t, pz - a[1] - dz * t); };
const polyDist = (px, pz, p) => { let d = Infinity; for (let k = 1; k < p.length; k++) d = Math.min(d, segDist(px, pz, p[k - 1], p[k])); return d; };
function inPoly(x, z, r) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) if ((r[i][1] > z) !== (r[j][1] > z) && x < (r[j][0] - r[i][0]) * (z - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c; return c; }

/** Distance along polyline p of the point on it nearest q. */
function along(p, q) { let best = Infinity, pos = 0, acc = 0; for (let k = 1; k < p.length; k++) { const L = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]) || 1, t = Math.max(0, Math.min(1, ((q[0] - p[k - 1][0]) * (p[k][0] - p[k - 1][0]) + (q[1] - p[k - 1][1]) * (p[k][1] - p[k - 1][1])) / (L * L))), d = Math.hypot(q[0] - p[k - 1][0] - (p[k][0] - p[k - 1][0]) * t, q[1] - p[k - 1][1] - (p[k][1] - p[k - 1][1]) * t); if (d < best) { best = d; pos = acc + L * t; } acc += L; } return pos; }

/** Where a pole must not stand: inside (or hugging) a building, or on a road carriageway. */
export function makeBlocked(world) {
  const cell = 40, G = new Map(), put = (x, z, o) => { const key = Math.floor(x / cell) + ',' + Math.floor(z / cell); (G.get(key) || G.set(key, []).get(key)).push(o); };
  for (const b of (world && world.buildings) || []) { const r = b.r; if (!r || r.length < 3) continue; let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const q of r) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); } for (let i = Math.floor((x0 - 2) / cell); i <= Math.floor((x1 + 2) / cell); i++) for (let j = Math.floor((z0 - 2) / cell); j <= Math.floor((z1 + 2) / cell); j++) (G.get(i + ',' + j) || G.set(i + ',' + j, []).get(i + ',' + j)).push({ r }); }
  for (const e of (world && world.edges) || []) { const p = e.p; if (!p) continue; for (let k = 1; k < p.length; k++) { const n = Math.ceil(Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]) / 20); for (let s = 0; s <= n; s++) { const t = s / (n || 1); put(p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t, { road: p, hw: (e.w || 8) / 2 }); } } }
  return (x, z) => {
    const i = Math.floor(x / cell), j = Math.floor(z / cell), seen = new Set();
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const o of G.get((i + a) + ',' + (j + b)) || []) {
      if (seen.has(o) || (seen.add(o), false)) continue;
      if (o.r && (inPoly(x, z, o.r) || polyDist(x, z, o.r.concat([o.r[0]])) < 1.2)) return true;
      if (o.road && polyDist(x, z, o.road) < o.hw) return true;
    }
    return false;
  };
}

/** Pole run along a distribution line: mapped poles and corners first, then evenly spaced fill (<= max metres),
 *  every pole moved sideways off buildings and roadway. Wires join neighbours only, so no span crosses a block. */
export function poleRun(p, mapped = [], blocked = () => false, max = 42) {
  const chain = [];
  for (let k = 0; k < p.length; k++) {
    if (k) {
      const a = p[k - 1], b = p[k], L = Math.hypot(b[0] - a[0], b[1] - a[1]), ex = mapped.filter((q) => segDist(q.x, q.z, a, b) < 4 && q.used !== true);
      const pts = ex.map((q) => { const t = Math.max(0, Math.min(1, ((q.x - a[0]) * (b[0] - a[0]) + (q.z - a[1]) * (b[1] - a[1])) / (L * L || 1))); return { t, x: q.x, z: q.z, q }; }).sort((u, v) => u.t - v.t);
      const marks = [0, ...pts.map((u) => u.t), 1]; const out = [];
      for (let m = 1; m < marks.length; m++) {
        const t0 = marks[m - 1], t1 = marks[m], n = Math.ceil(((t1 - t0) * L) / max);
        for (let s = 1; s < n; s++) { const t = t0 + (t1 - t0) * s / n; out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
        if (m < marks.length - 1) { const u = pts[m - 1]; u.q.used = true; out.push([u.x, u.z]); }
      }
      for (const q of out) chain.push(q);
    }
    chain.push(p[k].slice());
  }
  // drop doubles closer than 6 m, then lift each pole clear of buildings and the carriageway
  const run = [];
  for (const q of chain) if (!run.length || Math.hypot(q[0] - run[run.length - 1][0], q[1] - run[run.length - 1][1]) > 6) run.push(q);
  return run.map((q, i) => {
    if (!blocked(q[0], q[1])) return q;
    const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, nx = -dz / L, nz = dx / L;
    for (let d = 1.5; d <= 14; d += 1.5) for (const sgn of [1, -1]) { const x = q[0] + nx * d * sgn, z = q[1] + nz * d * sgn; if (!blocked(x, z)) return [x, z]; }
    for (let d = 2; d <= 10; d += 2) for (const sgn of [1, -1]) { const x = q[0] + dx / L * d * sgn, z = q[1] + dz / L * d * sgn; if (!blocked(x, z)) return [x, z]; }
    return q;
  });
}

/** Sidecar -> everything the scene draws. lamps: [x, z] street lamps the pack already has, so city lights are not doubled. */
export function layoutInfra(D, lamps = [], bounds = null, world = null) {
  if (!D) return null;
  const inB = (x, z) => !bounds || (x >= bounds[0] && x <= bounds[2] && z >= bounds[1] && z <= bounds[3]);
  const cell = 10, grid = new Set(lamps.map(([x, z]) => Math.round(x / cell) + ',' + Math.round(z / cell)));
  const nearLamp = (x, z) => { const i = Math.round(x / cell), j = Math.round(z / cell); for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (grid.has(i + a + ',' + (j + b))) return true; return false; };
  const lights = (D.lights || []).filter(([x, z]) => inB(x, z)).map(([x, z, w, led]) => ({ x, z, w: w || 0, led: !!led, pole: !nearLamp(x, z) }));
  const hydrants = (D.hydrants || []).filter(([x, z]) => inB(x, z)).map(([x, z, size, st]) => ({ x, z, size: String(size || '').replace(/\s+/g, ''), st: st || '' }));
  const stops = (D.stops || []).map(([x, z, name, lines, ons]) => ({ x, z, name: name || 'Bus stop', lines: (lines || []).map(String), ons: Math.round(ons || 0) }));
  const trans = (D.transmission || []).map((t) => { const p = pairs(t.p); return { kv: t.kv || null, owner: t.owner || '', p, towers: towerSpots(p), mid: at(p, len(p) / 2), len: len(p) }; }).filter((t) => t.p.length > 1);
  const blocked = makeBlocked(world);
  const ppts = ((D.power && D.power.pts) || []).filter(([, x, z]) => inB(x, z)).map(([k, x, z]) => ({ k, x, z }));
  const mappedPoles = ppts.filter((q) => q.k === 'power_pole'), mappedTowers = ppts.filter((q) => q.k === 'power_tower');
  const plines = []; const runs = [];
  for (const l of (D.power && D.power.lines) || []) {
    const p = pairs(l.p); if (p.length < 2) continue;
    const v = l.kv ? Math.round(+String(l.kv).split(';')[0] / 1000) : null, kv = Number.isFinite(v) && v > 0 ? v : null;
    const longSpan = p.length > 1 && len(p) / (p.length - 1) > 90;
    if (l.k === 'power_line' && (longSpan || (kv && kv >= 66))) {
      // high voltage: lattice towers at mapped tower nodes on the line, otherwise every ~170 m; skip what CEC already draws
      if (p.every((q) => trans.some((t) => polyDist(q[0], q[1], t.p) < 25))) continue;
      const near = mappedTowers.filter((q) => polyDist(q.x, q.z, p) < 12);
      let tp = towerSpots(p).filter((q) => !near.some((t) => Math.hypot(t.x - q[0], t.z - q[1]) < 60));
      tp = tp.concat(near.map((t) => [t.x, t.z])).sort((a, b) => along(p, a) - along(p, b));
      trans.push({ kv, owner: 'OSM', p, towers: tp, mid: at(p, len(p) / 2), len: len(p), osm: true });
      continue;
    }
    const run = poleRun(p, mappedPoles, blocked);
    runs.push(run);
    plines.push({ k: l.k, kv, p: run, mid: at(run, len(run) / 2), len: len(run) });
  }
  const poles = []; const seen = new Set();
  for (const run of runs) for (const q of run) { const key = Math.round(q[0]) + ',' + Math.round(q[1]); if (!seen.has(key)) { seen.add(key); poles.push({ k: 'power_pole', x: q[0], z: q[1] }); } }
  for (const q of mappedPoles) if (!q.used && !seen.has(Math.round(q.x) + ',' + Math.round(q.z))) {
    let x = q.x, z = q.z;
    if (blocked(x, z)) { let fixed = false; for (let d = 1.5; d <= 12 && !fixed; d += 1.5) for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!blocked(x + ox * d, z + oz * d)) { x += ox * d; z += oz * d; fixed = true; break; } }
    poles.push({ k: 'power_pole', x, z });
  }
  return { lights, hydrants, stops, trans, plines, poles, towers: mappedTowers.filter((q) => !trans.some((t) => t.osm && polyDist(q.x, q.z, t.p) < 12)), subs: ppts.filter((q) => q.k === 'substation' || q.k === 'plant') };
}

/** Area totals for the load summary. */
export function infraTotals(I) {
  if (!I) return null;
  const kv = [...new Set(I.trans.map((t) => t.kv).filter(Boolean))].sort((a, b) => b - a);
  return { lights: I.lights.length, led: I.lights.length ? Math.round(100 * I.lights.filter((l) => l.led).length / I.lights.length) : 0, hydrants: I.hydrants.length, stops: I.stops.length, boardings: I.stops.reduce((a, s) => a + s.ons, 0), kv };
}
