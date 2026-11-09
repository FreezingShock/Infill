// Trip demand and route choice: how many cars are out, where they go, and which roads they take. Plain node.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNet } from '../src/sim/net.js';
import { Router, connCost } from '../src/sim/route.js';
import { Demand, activity, tripMix } from '../src/sim/demand.js';
import { Sim } from '../src/sim/sim.js';
import { rng } from '../src/sim/geom.js';

const LOCAL = [['walk', 2.2], ['park', 2], ['lane', 3.4], ['lane', 3.4], ['park', 2], ['walk', 2.2]];
const MAIN = [['walk', 2.2], ['park', 2], ['lane', 3.3], ['lane', 3.3], ['turn', 3.2], ['lane', 3.3], ['lane', 3.3], ['park', 2], ['walk', 2.2]];
// a ladder: an arterial that bows 60 m out of the way along the top, a straight residential street along the bottom, residential rungs at the ends
const ladder = () => [
  { id: 'A1', p: [[-300, 0], [0, -60]], c: 'primary', els: MAIN }, { id: 'A2', p: [[0, -60], [300, 0]], c: 'primary', els: MAIN },
  { id: 'R1', p: [[-300, 100], [0, 100]], c: 'residential', els: LOCAL }, { id: 'R2', p: [[0, 100], [300, 100]], c: 'residential', els: LOCAL },
  { id: 'L', p: [[-300, 0], [-300, 100]], c: 'residential', els: LOCAL }, { id: 'M', p: [[300, 0], [300, 100]], c: 'residential', els: LOCAL },
  { id: 'X', p: [[0, -60], [0, 100]], c: 'residential', els: LOCAL },
];
const walk = (R, from, to) => {
  const tab = R.table(to); let lane = R.bestOut(from, tab); const path = [lane];
  for (let i = 0; i < 100 && lane.to !== to; i++) { const c = R.next(lane, tab, () => 0); if (!c) break; lane = c.to; path.push(lane); }
  return path;
};

test('the busy hours follow the day: quiet at night, morning and evening peaks, home-to-work then work-to-home', () => {
  assert.ok(activity(3) < 0.3, `night ${activity(3)}`);
  assert.ok(activity(17.3) > activity(12.5) && activity(12.5) > activity(3) && activity(8) > activity(10.5));
  const am = tripMix(8), pm = tripMix(17.3);
  assert.ok(am.HJ > am.JH * 2 && pm.JH > pm.HJ * 2);
});

test('drivers take the faster arterial even when it is longer, and not the residential street', () => {
  const net = buildNet(ladder(), { bounds: [-310, -80, 310, 110] }), R = new Router(net);
  const a = net.nodes.find((n) => n.x === -300 && n.z === 0), b = net.nodes.find((n) => n.x === 300 && n.z === 0);
  const path = walk(R, a, b);
  assert.equal(path.at(-1).to, b);
  assert.deepEqual(path.map((l) => l.eid), ['A1', 'A2']);
  // the other way round, and from the residential corner to the arterial end: still the arterial for the long part
  const back = walk(R, b, a); assert.deepEqual(back.map((l) => l.eid), ['A2', 'A1']);
});

test('leaving an arterial onto a residential street costs a detour, so cut-throughs only win when the destination is there', () => {
  const net = buildNet(ladder(), { bounds: [-310, -80, 310, 110] }), R = new Router(net);
  const into = net.connectors.find((c) => c.from.rank >= 3 && c.to.rank <= 1), along = net.connectors.find((c) => c.from.rank <= 1 && c.to.rank <= 1);
  assert.ok(into && along && connCost(into) > connCost(along) + 10);
  // a destination on the rung (residential) is still reachable from the arterial
  const m = net.nodes.find((n) => n.x === 300 && n.z === 100), a = net.nodes.find((n) => n.x === -300 && n.z === 0);
  assert.equal(walk(R, a, m).at(-1).to, m);
});

// a small town: homes on the local streets, shops and jobs on the arterial
function town() {
  const edges = [
    { id: 'W', p: [[-400, 0], [0, 0]], c: 'primary', els: MAIN }, { id: 'E', p: [[0, 0], [400, 0]], c: 'primary', els: MAIN },
    { id: 'N1', p: [[0, -300], [0, 0]], c: 'residential', els: LOCAL }, { id: 'S1', p: [[0, 0], [0, 300]], c: 'residential', els: LOCAL },
    { id: 'N2', p: [[-200, -300], [-200, 0]], c: 'residential', els: LOCAL }, { id: 'S2', p: [[200, 0], [200, 300]], c: 'residential', els: LOCAL },
  ];
  const zones = [[0, -290, 60, 0], [0, 290, 60, 0], [-200, -290, 40, 0], [200, 290, 40, 0], [0, 0, 0, 40], [200, 0, 0, 20], [-200, 0, 0, 20]];
  return { net: buildNet(edges, { bounds: [-410, -1000, 410, 1000] }), zones };
}

test('demand: mornings start at home, evenings start at work, more homes mean more cars', () => {
  const { net, zones } = town(), R = new Router(net), D = new Demand(net, zones, R), r = rng(3);
  const count = (h) => { const c = {}; for (let i = 0; i < 600; i++) { const t = D.pickTrip(h, r); if (t) c[t.type] = (c[t.type] || 0) + 1; } return c; };
  const am = count(8), pm = count(17.3);
  assert.ok(am.HJ > am.JH * 2, JSON.stringify(am)); assert.ok(pm.JH > pm.HJ * 2, JSON.stringify(pm));
  assert.ok(D.want(17.3) > D.want(3) * 4);
  const big = new Demand(net, zones.map((z) => [z[0], z[1], z[2] * 2, z[3] * 2]), R);
  assert.ok(big.want(17.3) > D.want(17.3) * 1.25);
  // through traffic goes between edge portals
  const tt = []; for (let i = 0; i < 300; i++) { const t = D.pickTrip(8, r); if (t?.type === 'TT') tt.push(t); }
  assert.ok(tt.length > 5 && tt.every((t) => t.origin.portal && t.dest.portal && t.origin !== t.dest));
});

test('sim: every car has a destination and a route, and the count follows the hour', () => {
  const { net, zones } = town();
  const sim = new Sim(4); sim.zones = zones; sim.hour = 17.3; sim.setNet(net);
  const peak = sim.target(); sim.hour = 3; const night = sim.target();
  assert.ok(night < peak * 0.5, `night ${night} peak ${peak}`);
  sim.hour = 17.3;
  for (let i = 0; i < 20 * 180; i++) {
    sim.step(0.05);
  }
  assert.ok(sim.cars.length > 5 && sim.cars.every((c) => c.dest && c.tab), 'cars without a destination');
  assert.ok(sim.cars.length >= peak * 0.5, `only ${sim.cars.length} of ${peak} cars out`);
});

test('real streets: every trip finds a route and the routes lean on arterials', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  const area = manifest.areas.find((a) => a.id === manifest.default);
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));
  const { BASE } = await import('../src/engine/commands.js');
  const { nodeControl } = await import('../src/tools/roads/graph.js');
  const { drivableEdges, keyOf } = await import('../src/sim/net.js');
  const T = globalThis.__RENOVATED_PACK__.terrain;
  const bounds = [T.minx, T.minz, T.minx + (T.nx - 1) * T.cell, T.minz + (T.nz - 1) * T.cell];
  const control = {}; for (const e of BASE.edges.values()) if (e.g) for (const n of [e.a, e.b]) control[keyOf(BASE.nodes[n])] = nodeControl(BASE, n);
  const net = buildNet(drivableEdges(BASE.edges), { control, bounds }), R = new Router(net);
  const zones = [];
  for (const lot of BASE.lots.values()) {
    const at = lot.fp || lot.c, t = lot.lt, m2 = lot.m2 || 0;
    const homes = t === 'house' || t === 'multi' || t === 'apts' ? Math.max(lot.u0 || 0, t === 'house' && lot.b.length ? 1 : 0) : 0;
    const jobs = t === 'main' ? m2 / 55 : t === 'civic' ? m2 / 220 : t === 'parking' ? m2 / 260 : 0;
    if (homes > 0 || jobs > 0.2) zones.push([at[0], at[1], homes, jobs]);
  }
  const D = new Demand(net, zones, R), r = rng(5);
  const m = { res: 0, art: 0, all: 0 }; let trips = 0, lost = 0;
  for (let i = 0; i < 300; i++) {
    const t = D.pickTrip(8, r); if (!t) continue; trips++;
    const path = walk(R, t.origin, t.dest);
    if (path.at(-1).to !== t.dest) { lost++; continue; }
    for (const l of path) { m.all += l.len; if (l.rank <= 1) m.res += l.len; else if (l.rank >= 3) m.art += l.len; }
  }
  let lanes = 0, artLanes = 0; for (const l of net.lanes) { lanes += l.len; if (l.rank >= 3) artLanes += l.len; }
  console.log(`  ${trips} trips, ${lost} lost, route meters ${(m.art / m.all * 100).toFixed(0)}% arterial (${(artLanes / lanes * 100).toFixed(0)}% of lane metres), ${(m.res / m.all * 100).toFixed(0)}% residential, want ${D.want(17.3).toFixed(0)} cars at peak`);
  assert.ok(trips > 200 && lost === 0, `${lost} of ${trips} trips have no route`);
  assert.ok(m.art / m.all > artLanes / lanes + 0.15, 'routes do not favour the arterials');
  assert.ok(D.want(17.3) > 30 && D.want(17.3) < 400);
});
