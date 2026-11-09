// Road tools in plain node: shape geometry, roundabout conversion, intersection control, one-ways.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE, replay } = await import('../src/engine/commands.js');
const shapes = await import('../src/tools/roads/shapes.js');
const graph = await import('../src/tools/roads/graph.js');
const { polyLen } = await import('../src/engine/core.js');

test('arc passes through its middle point and ends where asked', () => {
  const a = [0, 0], m = [10, 5], b = [20, 0], p = shapes.arc(a, m, b);
  assert.deepEqual(p[0], a); assert.deepEqual(p[p.length - 1], b);
  assert.ok(p.some((q) => Math.hypot(q[0] - m[0], q[1] - m[1]) < 1.5));
  assert.equal(shapes.arc([0, 0], [5, 0], [10, 0]).length, 2, 'collinear falls back to a line');
});

test('grid fills a rectangle with lines both ways', () => {
  const g = shapes.gridLines([0, 0], [200, 100], 50);
  assert.equal(g.length, 5 + 3);
  assert.equal(shapes.gridLines([0, 0], [5, 5], 50).length, 0);
});

test('parallel street sits beside the original on the cursor side', () => {
  const line = [[0, 0], [100, 0]], g = [50, 30], s = shapes.sideOfLine(line, g);
  const q = shapes.parallel(line, 10, 10, 20, s);
  assert.ok(Math.abs(Math.abs(q[0][1]) - 30) < 1e-6);
  assert.equal(Math.sign(q[0][1]), Math.sign(g[1]));
});

function junction() {
  for (let n = 0; n < BASE.nodes.length; n++) { const es = graph.nodeEdges(BASE, n); if (es.length >= 3 && es.every((e) => e.p.length >= 2 && Math.hypot(e.p[0][0] - e.p.at(-1)[0], e.p[0][1] - e.p.at(-1)[1]) > 40)) return n; }
  return -1;
}

test('every junction has a control; explicit choices win and undo by replay', () => {
  const n = junction(); assert.ok(n >= 0);
  assert.ok(['signal', 'stop', 'allway'].includes(graph.nodeControl(BASE, n)));
  const { S } = replay([{ op: 'node.ctrl', nodes: [n], t: 'yield' }]);
  assert.equal(graph.nodeControl(S, n), 'yield');
  assert.equal(graph.nodeControl(replay([{ op: 'node.ctrl', nodes: [n], t: 'yield' }, { op: 'node.ctrl', nodes: [n], t: 'auto' }]).S, n), graph.nodeControl(BASE, n));
});

test('roundabout turns a junction into a one-way ring', () => {
  const n = junction(), spokes = graph.nodeEdges(BASE, n).length;
  const { S } = replay([{ op: 'node.roundabout', id: 'RB1', node: n, r: 14 }]);
  assert.equal(graph.nodeControl(S, n), 'roundabout');
  const ring = [...S.edges.values()].filter((e) => e.ring);
  assert.equal(ring.length, spokes);
  assert.ok(ring.every((e) => e.oneway === 1));
  const c = S.nodes[n];
  for (const e of ring) for (const p of e.p) assert.ok(Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - 14) < 0.5);
  // ring nodes connect end to end
  const heads = new Set(ring.map((e) => e.a)), tails = new Set(ring.map((e) => e.b));
  assert.deepEqual([...heads].sort(), [...tails].sort());
  // no street still reaches into the island
  for (const e of S.edges.values()) if (e.g && !e.ring && (e.a === n || e.b === n)) assert.fail('spoke left at the old node');
});

test('one-way and speed fields', () => {
  const e = [...BASE.edges.values()].find((q) => q.g);
  const { S } = replay([{ op: 'street.oneway', ids: [e.id], dir: -1 }, { op: 'street.speed', ids: [e.id], v: 15 }]);
  assert.equal(S.edges.get(e.id).oneway, -1); assert.equal(S.edges.get(e.id).speed, 15);
  assert.ok(graph.isOneWay(S.edges.get(e.id)));
});

test('street.batch builds several streets and roundabout.new builds a ring', () => {
  const c = BASE.nodes[0], x = c[0] + 400, z = c[1] + 400;
  const prof = { k: 'local', els: [['walk', 2.2], ['lane', 3], ['lane', 3], ['walk', 2.2]] };
  const before = BASE.edges.size;
  const { S } = replay([{ op: 'street.batch', id: 'B1', streets: [{ pts: [[x, z], [x + 90, z]], prof }, { pts: [[x, z + 40], [x + 90, z + 40]], prof }] }, { op: 'roundabout.new', id: 'RN1', c: [x + 300, z + 300], r: 12 }]);
  assert.ok(S.edges.size >= before + 3);
  assert.ok([...S.edges.values()].some((e) => e.ring));
});

test('divided boulevards import as one-way carriageways with a median, never overlapping', () => {
  const div = [...BASE.edges.values()].filter((e) => e.divided);
  assert.ok(div.length >= 2, 'Topanga has a divided section');
  for (const e of div) {
    assert.equal(e.oneway, 1);
    assert.ok(e.prof.els.some((x) => x[0] === 'median') || e.prof.els.every((x) => x[0] === 'lane'));
    const half = e.prof.els.reduce((s, x) => s + x[1], 0) / 2;
    assert.ok(half < 22, 'row width stays sane');
  }
  // two carriageways of a pair must not overlap each other
  const E = [...BASE.edges.values()].filter((e) => e.divided && e.prof.els.some((x) => x[0] === 'median'));
  for (const e of E) for (const f of E) {
    if (e === f || e.n !== f.n || e.prof.els.length < 4 || f.prof.els.length < 4 || e.p.length < 3 || polyLen(e.p) < 80 || polyLen(f.p) < 80) continue;
    const d = (x) => [x.p.at(-1)[0] - x.p[0][0], x.p.at(-1)[1] - x.p[0][1]];
    if (d(e)[0] * d(f)[0] + d(e)[1] * d(f)[1] >= 0) continue;
    const m = e.p[Math.floor(e.p.length / 2)], q = nearestOnLineOf(f.p, m);
    if (q < 30) assert.ok(q >= (e.prof.els.reduce((s, x) => s + x[1], 0) + f.prof.els.reduce((s, x) => s + x[1], 0)) / 2 - 1.5 || q < 3, `${e.id}/${f.id} overlap`);
  }
});
function nearestOnLineOf(p, m) { let b = 1e9; for (let i = 1; i < p.length; i++) { const [ax, az] = p[i - 1], [bx, bz] = p[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((m[0] - ax) * dx + (m[1] - az) * dz) / (dx * dx + dz * dz || 1))); b = Math.min(b, Math.hypot(m[0] - ax - dx * t, m[1] - az - dz * t)); } return b; }

const lat = (p, q) => { let b = 1e9; for (let i = 1; i < q.length; i++) { const [ax, az] = q[i - 1], [bx, bz] = q[i], dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((p[0] - ax) * dx + (p[1] - az) * dz) / (dx * dx + dz * dz || 1))); b = Math.min(b, Math.hypot(p[0] - ax - dx * t, p[1] - az - dz * t)); } return b; };
const rowOf = (e) => e.prof.els.reduce((s, x) => s + x[1], 0);

test('road classes: Topanga is an arterial, Avenue San Luis a collector or local, and both read from the map class', async () => {
  const { roadClassOf, rankOf } = await import('../src/tools/roads/classes.js');
  const g = (id) => BASE.edges.get(id);
  assert.equal(roadClassOf(g('E118')), 'arterial');
  assert.ok(['collector', 'local'].includes(roadClassOf(g('E103'))));
  assert.ok(rankOf(g('E118')) > rankOf(g('E103')));
  assert.equal(roadClassOf({ c: 'residential', w: 9 }), 'local');
  assert.equal(roadClassOf({ c: 'tertiary', w: 11 }), 'collector');
  for (const e of BASE.edges.values()) if (e.g) assert.ok(['arterial', 'collector', 'local', 'freeway'].includes(e.rc), `${e.id} has a class`);
});

test('a divided road is two carriageways exactly one row apart, so their medians meet and make one', () => {
  const a = BASE.edges.get('E113'), b = BASE.edges.get('E114'), T = (rowOf(a) + rowOf(b)) / 2;
  for (const q of a.p) assert.ok(Math.abs(lat(q, b.p) - T) < 0.6, `E113 vertex ${q} is ${lat(q, b.p).toFixed(2)} from E114, wanted ${T}`);
  // the median is one narrow strip, the same width as the centre turn lane it replaces
  const med = a.prof.els.filter((x) => x[0] === 'median').reduce((s, x) => s + x[1], 0) * 2;
  assert.ok(med >= 2.5 && med <= 4, `median ${med} m`);
  const two = BASE.edges.get('E118').prof.els.reduce((s, x) => s + x[1], 0);
  assert.ok(Math.abs(rowOf(a) + rowOf(b) - two) < 0.8, `divided ${rowOf(a) + rowOf(b)} m vs undivided ${two} m: same total width`);
});

test('where the divided road meets the undivided one the carriageways stay parallel, the median narrows to a nose and the pavement never widens into a V', async () => {
  const { drawPath, medianKeep } = await import('../src/tools/roads/divided.js');
  const tapers = [...BASE.edges.values()].filter((e) => e.taper);
  assert.ok(tapers.length >= 2);
  for (const e of tapers) {
    assert.equal(e.oneway, 1);
    assert.ok(e.prof.els.some((x) => x[0] === 'median') && e.prof.els.some((x) => x[0] === 'walk'), `${e.id} keeps its full cross-section`);
    assert.ok(e.nose && e.nose.to > e.nose.from, `${e.id} has a nose`);
    const P = drawPath(e); assert.ok(P !== e.p, 'drawn along the axis, not the traffic path');
  }
  const [a, b] = tapers.filter((e) => e.id === 'E116' || e.id === 'E117');
  assert.ok(a && b);
  const T = (rowOf(a) + rowOf(b)) / 2, A = drawPath(a), B = drawPath(b);
  for (const q of A) assert.ok(Math.abs(lat(q, B) - T) < 0.4, `separation ${lat(q, B).toFixed(2)} stays ${T.toFixed(2)} all the way: no wedge`);
  // the median only ever narrows towards the merge, and ends in a point
  const L = a.nose.len; let prev = 1;
  for (let d = 0; d <= L; d += L / 20) { const k = medianKeep(a, a.nose.rev ? L - d : d); const s = a.nose.rev ? L - d : d; void s; assert.ok(k <= prev + 1e-9 || a.nose.rev, 'monotonic'); prev = k; }
  assert.equal(medianKeep(a, a.nose.rev ? 0 : L), 0);
  assert.equal(medianKeep(a, a.nose.rev ? L : 0), 1);
  // the traffic polyline still ends on the merge node, so cars flow from the two-way road into each carriageway
  const m = a.a === b.a || a.a === b.b ? a.a : a.b, M = BASE.nodes[m];
  for (const e of [a, b]) { const end = e.a === m ? e.p[0] : e.p.at(-1); assert.ok(Math.hypot(end[0] - M[0], end[1] - M[1]) < 0.01); }
});

test('streets bend smoothly and the lane polyline never leaves the paved width at a merge', async () => {
  const { drawPath } = await import('../src/tools/roads/divided.js');
  for (const e of BASE.edges.values()) if (e.nose) {
    const P = drawPath(e); let worst = 0;
    for (const q of e.p) worst = Math.max(worst, lat(q, P));
    assert.ok(worst <= rowOf(e) / 2 + 1, `${e.id} traffic path strays ${worst.toFixed(1)} m from the drawn road`);
  }
});

test('the roadway test knows lanes from sidewalks, and furniture is moved off the pavement', async () => {
  const { roadwayIndex } = await import('../src/tools/roads/roadway.js');
  const e = { id: 'T', g: 1, p: [[0, 0], [100, 0]], prof: { k: 'asbuilt', els: [['walk', 2], ['lane', 3], ['lane', 3], ['walk', 2]] } };
  const R = roadwayIndex([e]);
  assert.ok(R.hit(50, 0)); assert.ok(R.hit(50, 2.5), 'a lane');
  assert.ok(!R.hit(50, 4.5), 'the sidewalk is not roadway'); assert.ok(!R.hit(150, 0), 'beyond the end');
  const [x, z] = R.nudge(50, 1); assert.ok(!R.hit(x, z, 0) && Math.abs(z) >= 3);
});

test('no street tree, prop or lane is placed on the Topanga roadway', async () => {
  const { roadwayIndex } = await import('../src/tools/roads/roadway.js');
  const R = roadwayIndex([...BASE.edges.values()]);
  for (const [k, x, z] of globalThis.__RENOVATED_PACK__.props) { if (k === 'signal') continue; const [nx, nz] = R.nudge(x, z); assert.ok(!R.hit(nx, nz, -0.3), `${k} at ${x},${z}`); }
});

test('junction control follows road class: side streets stop, a divided road is not two signals', async () => {
  const E103 = BASE.edges.get('E103'), n = E103.a; // Avenue San Luis meets a Topanga carriageway here
  assert.notEqual(graph.nodeControl(BASE, n), 'signal');
  assert.ok(graph.givesWay(BASE, n, E103), 'the side street gives way');
  assert.ok(!graph.givesWay(BASE, n, BASE.edges.get('E114')), 'the arterial flows through');
});

test('junction details: ladders and stop bars set back from the box, markings and medians trimmed', async () => {
  const { plan, trimPath } = await import('../src/tools/roads/markings.js');
  const P = plan(BASE, globalThis.__RENOVATED_PACK__.walks);
  assert.ok(P.ladders.length > 50 && P.bars.length > 10, `ladders ${P.ladders.length} bars ${P.bars.length}`);
  for (const l of P.ladders) { assert.ok(Number.isFinite(l.o1) && Number.isFinite(l.o2) && l.o2 > l.o1); assert.ok(l.p.every((q) => q.every(Number.isFinite))); }
  // trimmed markings stay on the road and shorter than the street
  let trimmed = 0;
  for (const e of BASE.edges.values()) { const r = P.info.get(e.id); if (!r) continue; const mp = trimPath(e.p, r.t0, r.t1); assert.ok(mp.length === 0 || polyLen(mp) <= polyLen(e.p) + 1e-6); if (r.t0 || r.t1) trimmed++; }
  assert.ok(trimmed > 20);
  // divided roads end their median with a nose before the crosswalk
  assert.ok(P.noses.length >= 2, `noses ${P.noses.length}`);
});

test('a main road meeting only minor streets keeps its lines and has no crosswalk or stop bar of its own', async () => {
  const { plan } = await import('../src/tools/roads/markings.js');
  const P = plan(BASE, []);
  const topanga = [...BASE.edges.values()].filter((e) => e.divided && e.oneway === 1 && e.prof.els.some((x) => x[0] === 'median'));
  assert.ok(topanga.length);
  for (const id of ['E113', 'E114']) { const r = P.info.get(id); assert.ok(r && r.t0 === 0 && r.t1 === 0, `${id} lines run through the Avenue San Luis junction`); }
  assert.ok(P.ladders.every((l) => !l.e || !['E113', 'E114'].includes(l.e.id)), 'no ladder across Topanga at Avenue San Luis');
  assert.ok(topanga.every((e) => e.speed >= 45), 'boulevard is 45 mph');
});

test('swerves: sharp corners on arterials round off, endpoints stay on their nodes, local streets keep theirs', async () => {
  const { round } = await import('../src/tools/roads/swerves.js');
  const kinked = [[0, 0], [50, 0], [50, 50]], r = round(kinked, 30);
  assert.deepEqual(r[0], [0, 0]); assert.deepEqual(r.at(-1), [50, 50]);
  assert.ok(r.length > 4, 'corner became a curve');
  const turn = (a, b, c) => Math.abs(Math.atan2((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]), (b[0] - a[0]) * (c[0] - b[0]) + (b[1] - a[1]) * (c[1] - b[1])));
  for (let i = 1; i < r.length - 1; i++) assert.ok(turn(r[i - 1], r[i], r[i + 1]) < 0.6, 'no sharp turn left');
  for (const e of BASE.edges.values()) { if (!e.g) continue; assert.ok(e.p.every((q) => q.every(Number.isFinite))); assert.deepEqual(e.p[0], BASE.nodes[e.a]); assert.deepEqual(e.p.at(-1), BASE.nodes[e.b]); }
});

test('Avenue San Luis onto Topanga: side-street traffic only turns right, Topanga traffic may turn left into the street', async () => {
  const { buildNet, drivableEdges } = await import('../src/sim/net.js');
  assert.ok(BASE.edges.get('E115').xmed, 'the box between the carriageways is marked');
  const net = buildNet(drivableEdges(BASE.edges), {});
  let leftsIn = 0;
  for (const id of [129, 145]) {
    const nd = net.nodes.find((n) => Math.hypot(n.x - BASE.nodes[id][0], n.z - BASE.nodes[id][1]) < 1);
    const out = nd.conns.filter((c) => c.from.eid === 'E103' || c.from.eid === 'E152');
    assert.ok(out.length >= 1, 'side street can leave');
    for (const c of out) assert.equal(c.type, 'R', `${c.from.eid}>${c.to.eid}: leaving San Luis is a right turn, no crossing, no left`);
    assert.ok(!nd.conns.some((c) => (c.from.eid === 'E103' || c.from.eid === 'E152') && c.to.eid === 'E115'), 'nothing crosses the box from the side street');
    leftsIn += nd.conns.filter((c) => c.to.eid === 'E115' && (c.from.eid === 'E114' || c.from.eid === 'E117')).length;
  }
  assert.ok(leftsIn >= 1, 'Topanga traffic can turn into San Luis through the box');
});

test('lane count is a property of the class: every Topanga carriageway and merge piece has the same lanes', () => {
  const lanes = [...BASE.edges.values()].filter((e) => e.divided && e.n === 'Topanga Canyon Boulevard').map((e) => e.prof.els.filter((x) => x[0] === 'lane').length);
  assert.ok(lanes.length >= 6 && new Set(lanes).size === 1, `lanes ${lanes}`);
  const two = BASE.edges.get('E118').prof.els.filter((x) => x[0] === 'lane').length;
  assert.equal(two, lanes[0] * 2, 'the two-way road has the same lanes in total');
});
