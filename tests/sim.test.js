// Traffic sim checks in plain node: a hand-made crossing, then the real Woodland Hills streets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNet, drivableEdges } from '../src/sim/net.js';
import { Sim, STRIDE } from '../src/sim/sim.js';

const LOCAL = [['walk', 2.2], ['park', 2], ['lane', 3.4], ['lane', 3.4], ['park', 2], ['walk', 2.2]];
const MAIN = [['walk', 2.2], ['park', 2], ['lane', 3.3], ['lane', 3.3], ['turn', 3.2], ['lane', 3.3], ['lane', 3.3], ['park', 2], ['walk', 2.2]];
const cross = () => [
  { id: 'W', p: [[-200, 0], [0, 0]], c: 'primary', els: MAIN }, { id: 'E', p: [[0, 0], [200, 0]], c: 'primary', els: MAIN },
  { id: 'N', p: [[0, -200], [0, 0]], c: 'residential', els: LOCAL }, { id: 'S', p: [[0, 0], [0, 200]], c: 'residential', els: LOCAL },
];

function run(sim, secs) {
  let worst = 1e9;
  for (let i = 0; i < secs * 20; i++) {
    sim.step(0.05);
    for (const seg of sim.segs) {
      const c = seg.cars.slice().sort((a, b) => b.s - a.s);
      for (let k = 1; k < c.length; k++) worst = Math.min(worst, c[k - 1].s - c[k - 1].len - c[k].s);
    }
  }
  return worst;
}

test('a crossing builds lanes both ways, turn connectors and a control', () => {
  const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] });
  assert.equal(net.nodes.length, 5);
  const mid = net.nodes.find((n) => n.legs.length === 4);
  assert.ok(mid && mid.control !== 'none');
  assert.ok(mid.conns.some((c) => c.type === 'L') && mid.conns.some((c) => c.type === 'R') && mid.conns.some((c) => c.type === 'S'));
  assert.ok(net.slots.length > 10);
  assert.ok(net.lanes.filter((l) => l.eid === 'W').length === 4);
});

test('cars flow through the crossing without overlapping or stalling', () => {
  const sim = new Sim(3); sim.density = 1.5;
  sim.setNet(buildNet(cross(), { bounds: [-210, -210, 210, 210] }));
  const worst = run(sim, 240);
  assert.ok(worst > -0.5, `cars overlapped by ${worst}`);
  const snap = sim.snapshot();
  assert.ok(snap.length >= STRIDE && snap.every(Number.isFinite));
  const es = sim.edgeStats(); assert.ok(Object.values(es.flow).every(Number.isFinite) && Object.values(es.curb).every((v) => v >= 0 && v <= 1) && Object.keys(es.flow).length === 4);
  assert.ok(sim.stats.moving > 3, `only ${sim.stats.moving} cars`);
  assert.ok(sim.stats.waiting < sim.stats.moving, 'everyone is stopped');
});

test('one-way streets only get lanes in their direction, and set controls win', () => {
  const edges = cross(); edges[0].oneway = 1; edges[1].oneway = 1;
  const net = buildNet(edges, { control: { '0,0': 'allway' } });
  assert.ok(net.lanes.filter((l) => l.eid === 'W').every((l) => l.dir > 0));
  assert.equal(net.nodes.find((n) => n.legs.length === 4).control, 'allway');
  const sim = new Sim(2); sim.setNet(net); assert.ok(run(sim, 60) > -0.5);
});

test('cars park in free curb slots and pull out again', () => {
  const sim = new Sim(5); sim.density = 2;
  const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] });
  sim.setNet(net);
  const before = net.slots.filter((s) => s.state === 1).length;
  for (const c of sim.cars) c.trip = -1;
  let parked = false, left = false;
  for (let i = 0; i < 20 * 600; i++) { sim.step(0.05); if (sim.cars.some((c) => c.park && c.park.phase === 1)) parked = true; if (i % 200 === 0 && net.slots.filter((s) => s.state === 1).length !== before) left = true; }
  assert.ok(parked, 'no car parked');
  assert.ok(left, 'parking never changed');
});

test('editing the streets keeps cars that still have their lane', () => {
  const sim = new Sim(9); sim.setNet(buildNet(cross(), { bounds: [-210, -210, 210, 210] }));
  run(sim, 30);
  const n0 = sim.cars.length;
  const edges = cross(); edges[2].els = [['walk', 2], ['lane', 3], ['lane', 3], ['walk', 2]];
  sim.setNet(buildNet(edges, { bounds: [-210, -210, 210, 210] }));
  assert.ok(sim.cars.length > n0 * 0.5);
  run(sim, 60);
});

test('the real Woodland Hills streets run for ten minutes of traffic', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  const area = manifest.areas.find((a) => a.id === manifest.default);
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));
  const { BASE } = await import('../src/engine/commands.js');
  const T = globalThis.__RENOVATED_PACK__.terrain;
  const bounds = [T.minx, T.minz, T.minx + (T.nx - 1) * T.cell, T.minz + (T.nz - 1) * T.cell];
  const { nodeControl } = await import('../src/tools/roads/graph.js');
  const { keyOf } = await import('../src/sim/net.js');
  const control = {};
  for (const e of BASE.edges.values()) if (e.g) for (const n of [e.a, e.b]) control[keyOf(BASE.nodes[n])] = nodeControl(BASE, n);
  const net = buildNet(drivableEdges(BASE.edges), { control, bounds });
  assert.ok(net.lanes.length > 100 && net.connectors.length > 100, `lanes ${net.lanes.length} connectors ${net.connectors.length}`);
  const sim = new Sim(11); sim.setNet(net);
  const t0 = Date.now();
  const worst = run(sim, 600);
  const ms = (Date.now() - t0) / (600 * 20);
  sim.snapshot();
  console.log(`  ${net.lanes.length} lanes, ${net.connectors.length} connectors, ${net.slots.length} slots, ${sim.cars.length} cars, ${ms.toFixed(2)} ms/step, worst gap ${worst.toFixed(2)}, moving ${sim.stats.moving} waiting ${sim.stats.waiting}`);
  assert.ok(worst > -1, `cars overlapped by ${worst}`);
  assert.ok(sim.stats.waiting < sim.stats.moving * 0.8, 'traffic is gridlocked');
  assert.ok(sim.snapshot().every(Number.isFinite));
});

test('a divided road drawn as two parallel two-way edges becomes two one-way carriageways with right-hand traffic', async () => {
  const { inferDivided } = await import('../src/sim/net.js');
  const A = { id: 'A', p: [[0, 0], [100, 0]], c: 'primary', els: MAIN }, B = { id: 'B', p: [[0, 12], [100, 12]], c: 'primary', els: MAIN };
  const C = { id: 'C', p: [[0, 80], [100, 80]], c: 'primary', els: MAIN };
  inferDivided([A, B, C]);
  // x east, z south: heading east the right-hand side is south (+z), so B (z = 12) carries traffic east, A carries it west
  assert.equal(B.oneway, 1); assert.equal(A.oneway, -1); assert.equal(C.oneway, undefined);
});

// ---------- the host shared by the worker and the main-thread fallback ----------
import { advance, applyMessage } from '../src/sim/host.js';

test('host: a net message carries the node controls through to the lane graph', () => {
  const sim = new Sim(3);
  const edges = JSON.parse(JSON.stringify(drivableEdges(new Map(cross().map((e) => [e.id, { ...e, g: true, prof: { k: e.c, els: e.els }, a: e.id + 'a', b: e.id + 'b' }])))));
  applyMessage(sim, { type: 'net', edges, control: { '0,0': 'allway' }, bounds: [-300, -300, 300, 300] });
  assert.equal(sim.net.nodes.find((n) => n.legs.length === 4).control, 'allway');
});

test('host: cfg sets density, running and speed; advance steps in fixed ticks', () => {
  const sim = new Sim(3);
  applyMessage(sim, { type: 'cfg', density: 0.5, running: true, speed: 2, max: 10 });
  assert.equal(sim.density, 0.5); assert.equal(sim.timeScale, 2); assert.equal(sim.maxCars, 10);
  advance(sim, 1); // no net yet: a no-op, must not throw
});

test('snapshot gives every parked car a stable slot id', () => {
  const sim = new Sim(5);
  const net = buildNet(drivableEdges(new Map(cross().map((e) => [e.id, { ...e, g: true, prof: { k: e.c, els: e.els }, a: e.id + 'a', b: e.id + 'b' }]))), {});
  sim.setNet(net);
  const buf = sim.snapshot();
  const ids = [];
  for (let o = 0; o < buf.length; o += STRIDE) if (buf[o] >= 1e6) ids.push(buf[o]);
  assert.equal(new Set(ids).size, ids.length);
  for (const s of net.slots) assert.equal(net.slots[s.ix], s);
});

// ---------- junction behaviour: smooth turns, gap acceptance, clear box ----------
test('turn connectors are slower than the street they leave, from the bend, never below a crawl', () => {
  const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] });
  const mid = net.nodes.find((n) => n.legs.length === 4);
  for (const c of mid.conns) {
    assert.ok(c.speed >= 2.8 && c.speed <= Math.min(c.from.speed, c.to.speed) + 1e-9, `${c.type} ${c.speed}`);
    if (c.type !== 'S') assert.ok(c.speed < c.from.speed, `${c.type} turn is not slower than ${c.from.speed}`);
  }
});

test('cars move smoothly through junctions: no jumps back or sideways, no sudden heading changes', () => {
  const sim = new Sim(4); sim.density = 1.4;
  sim.setNet(buildNet(cross(), { bounds: [-210, -210, 210, 210] }));
  const prev = new Map(); let jumps = 0, snaps = 0;
  for (let i = 0; i < 20 * 300; i++) {
    sim.step(0.05);
    if (i % 2) continue;
    const b = sim.snapshot();
    for (let o = 0; o < b.length; o += STRIDE) {
      const id = b[o]; if (id >= 1e6) continue;
      const p = prev.get(id);
      if (p) {
        const d = Math.hypot(b[o + 1] - p[0], b[o + 2] - p[1]); let dh = Math.abs(b[o + 3] - p[2]); if (dh > Math.PI) dh = 2 * Math.PI - dh;
        if (d > Math.hypot(b[o + 4], b[o + 5]) * 0.1 + 0.8 || dh > 0.3) jumps++;
        snaps++;
      }
      prev.set(id, [b[o + 1], b[o + 2], b[o + 3]]);
    }
  }
  assert.ok(snaps > 1000);
  assert.ok(jumps / snaps < 0.002, `${jumps} of ${snaps} snapshot steps jumped`);
});

test('the side street gets out onto a busy main road, and nobody sits inside the junction', () => {
  const sim = new Sim(8); sim.density = 1.6;
  const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] });
  sim.setNet(net);
  const through = new Set(); let boxStill = 0, boxSeen = 0;
  for (let i = 0; i < 20 * 1200; i++) {
    sim.step(0.05);
    for (const c of sim.cars) if (c.isConn) { boxSeen++; if (c.v < 0.3) boxStill++; if (c.seg.from.eid === 'N' || c.seg.from.eid === 'S') through.add(c.id); }
  }
  assert.ok(through.size >= 5, `only ${through.size} side-street cars crossed`);
  assert.ok(boxStill / Math.max(1, boxSeen) < 0.05, `${boxStill} of ${boxSeen} box samples were standing`);
});

test('gap acceptance counts time, not distance: a slow car 40 m out does not block a pull-out, a fast one does', () => {
  const sim = new Sim(1); const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] }); sim.setNet(net);
  const mid = net.nodes.find((n) => n.legs.length === 4);
  const k = mid.conns.find((c) => c.type === 'S' && c.from.eid === 'W'); // main-road through movement
  for (const c of sim.cars.slice()) { c.seg.cars.splice(c.seg.cars.indexOf(c), 1); } sim.cars = [];
  const car = { s: k.from.len - 40, v: 3, i: 0, wait: 0, len: 4.4 }; k.from.cars.push(car);
  assert.equal(sim.gapClear(k, 4.2), true); // 40 m at 3 m/s is far longer than 4 s
  car.v = 14; assert.equal(sim.gapClear(k, 4.2), false); // under 3 s
  car.v = 0; car.wait = 10; car.s = k.from.len - 1; assert.equal(sim.gapClear(k, 4.2), true); // a long-standing queue is not arriving
});

// ---------- ramp terminals ----------
test('a freeway ramp gives way to the surface street where they meet, and cars do not overlap', () => {
  const edges = [
    { id: 'A', p: [[-200, 0], [0, 0]], c: 'primary', els: MAIN }, { id: 'B', p: [[0, 0], [200, 0]], c: 'primary', els: MAIN },
    { id: 'R', p: [[0, 0], [0, 200]], c: 'motorway', lk: 1, els: LOCAL }, // ramp ending at the street
    { id: 'S', p: [[0, -200], [0, 0]], c: 'residential', els: LOCAL },
  ];
  const net = buildNet(edges, { bounds: [-210, -210, 210, 210], control: { '0,0': 'priority' } });
  const mid = net.nodes.find((n) => n.legs.length === 4);
  assert.ok(mid.ramp);
  assert.equal(mid.rank, 4, 'the surface street decides the junction, not the ramp class');
  for (const c of mid.conns.filter((q) => q.from.eid === 'R')) assert.equal(c.rank, 0, 'ramp traffic is the minor flow');
  const out = mid.conns.filter((q) => q.from.eid === 'A' && q.type === 'S')[0];
  assert.ok(out.pv > mid.conns.find((q) => q.from.eid === 'R').pv);
  const sim = new Sim(6); sim.density = 1.6; sim.setNet(net);
  assert.ok(run(sim, 300) > -0.5);
  // ramp-only junctions (ramp meets freeway) keep free flow
  const free = buildNet([{ id: 'F', p: [[-200, 0], [0, 0]], c: 'motorway', els: MAIN }, { id: 'G', p: [[0, 0], [200, 0]], c: 'motorway', els: MAIN }, { id: 'R2', p: [[0, 0], [0, 200]], c: 'motorway', lk: 1, els: LOCAL }], {});
  assert.ok(!free.nodes.find((n) => n.legs.length === 3).ramp);
});

test('a car does not drive into a long vehicle that has left a short lane but still overlaps its end', () => {
  const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] });
  const sim = new Sim(1); sim.setNet(net);
  const k = net.connectors.find((c) => c.to.len > 20), lane = k.to;
  const out = { cars: [] }; lane.conns = [out]; // a short lane between close junctions: one onward connector
  for (const c of sim.cars.slice()) c.seg.cars.splice(c.seg.cars.indexOf(c), 1); sim.cars = [];
  assert.equal(sim.tail(lane), null);
  out.cars.push({ s: 4, len: 10.5, v: 2.8 }); // a bus 4 m into the next connector: its tail is 6.5 m back inside `lane`
  const t = sim.tail(lane);
  assert.ok(Math.abs(t.pos - (lane.len - 6.5)) < 1e-9 && t.v === 2.8, `tail ${t && t.pos}`);
  assert.equal(sim.roomFor(k, { len: 4.4, v: 5 }), lane.len - 6.5 >= 4.4 + 1.5 + 2);
});

test('a head car with nowhere to go does not hold up the road it crosses', () => {
  const sim = new Sim(1); const net = buildNet(cross(), { bounds: [-210, -210, 210, 210] }); sim.setNet(net);
  const mid = net.nodes.find((n) => n.legs.length === 4);
  const k = mid.conns.find((c) => c.type === 'S' && c.from.eid === 'W');
  for (const c of sim.cars.slice()) c.seg.cars.splice(c.seg.cars.indexOf(c), 1); sim.cars = [];
  k.to.cars.push({ s: k.to.len, len: 4.4, v: 0 }); k.to.cars.push({ s: k.to.len - 5.9, len: 4.4, v: 0 }); // exit lane is jammed solid
  k.to.cars.push({ s: k.to.len - 11.8, len: 4.4, v: 0 }); k.to.cars.push({ s: k.to.len - 17.7, len: 4.4, v: 0 });
  const head = { s: k.from.len - 2, v: 1.5, i: 0, wait: 0, len: 4.4, granted: null };
  k.from.cars.push(head);
  const full = sim.roomFor(k, head);
  assert.equal(sim.gapClear(k, 4.2), full ? false : true);
});
