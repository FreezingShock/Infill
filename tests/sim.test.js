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
