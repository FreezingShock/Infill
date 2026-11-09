// Signal phasing and mast layout: general rules checked on hand-made junctions, then on every signalized junction of the real area.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNet, drivableEdges, keyOf } from '../src/sim/net.js';
import { Sim } from '../src/sim/sim.js';
import { exportSignals, stateAt } from '../src/sim/signals.js';

const LOCAL = [['walk', 2.2], ['park', 2], ['lane', 3.4], ['lane', 3.4], ['park', 2], ['walk', 2.2]];
const MAIN = [['walk', 2.2], ['park', 2], ['lane', 3.3], ['lane', 3.3], ['turn', 3.2], ['lane', 3.3], ['lane', 3.3], ['park', 2], ['walk', 2.2]];
const BIG = [['walk', 2.2], ['lane', 3.3], ['lane', 3.3], ['lane', 3.3], ['turn', 3.2], ['lane', 3.3], ['lane', 3.3], ['lane', 3.3], ['walk', 2.2]];
const B = [-210, -210, 210, 210];
const cross = (a, b, ca = 'primary', cb = 'primary') => [
  { id: 'W', p: [[-200, 0], [0, 0]], c: ca, els: a }, { id: 'E', p: [[0, 0], [200, 0]], c: ca, els: a },
  { id: 'N', p: [[0, -200], [0, 0]], c: cb, els: b }, { id: 'S', p: [[0, 0], [0, 200]], c: cb, els: b },
];
const mid = (net) => net.nodes.find((n) => n.legs.length >= 3);

test('a big arterial crossing gets dual protected lefts, a medium one a lead-lag arrow, a side street permissive lefts', () => {
  const big = mid(buildNet(cross(BIG, BIG, 'primary', 'primary'), { bounds: B, control: { '0,0': 'signal' } }));
  assert.equal(big.sig.mode, 'dual');
  const med = mid(buildNet(cross(MAIN, MAIN, 'secondary', 'secondary'), { bounds: B, control: { '0,0': 'signal' } }));
  assert.equal(med.sig.mode, 'leadlag');
  const side = mid(buildNet(cross(MAIN, LOCAL, 'secondary', 'residential'), { bounds: B, control: { '0,0': 'signal' } }));
  assert.equal(side.sig.mode, 'permissive');
});

test('a T junction runs the stem alone and nothing ever conflicts', () => {
  const t = cross(MAIN, LOCAL, 'secondary', 'residential').slice(0, 3);
  const n = mid(buildNet(t, { bounds: B, control: { '0,0': 'signal' } }));
  assert.ok(n.sig.phases.length >= 2);
  const stem = n.legs.findIndex((l) => l.item.e.id === 'N');
  assert.ok(n.sig.phases.some((p) => p.go[stem + 'T'] === 2 && Object.keys(p.go).length <= 2), 'the stem gets its own phase');
});

test('movements that cross never both have a protected green at the same time', () => {
  for (const [a, b, ca, cb] of [[BIG, BIG, 'primary', 'primary'], [MAIN, MAIN, 'secondary', 'secondary'], [MAIN, LOCAL, 'secondary', 'residential'], [LOCAL, LOCAL, 'tertiary', 'tertiary']]) {
    const n = mid(buildNet(cross(a, b, ca, cb), { bounds: B, control: { '0,0': 'signal' } }));
    for (let t = 0; t < n.sig.cycle; t += 0.5) {
      for (const x of n.conns) for (const y of n.conns) {
        if (x === y || !x.conflicts.includes(y)) continue;
        const sx = stateAt(n.sig, t, x.leg, x.mv), sy = stateAt(n.sig, t, y.leg, y.mv);
        const clash = (sx === 2 && sy === 2) || (sx === 2 && sy === 1) || (sx === 1 && sy === 2);
        if (clash && x.from !== y.from && x.to !== y.to) {
          // only straight-through meets permissive left (yielding) may overlap; protected greens never meet a crossing path
          assert.ok(sx === 1 || sy === 1, `${x.id} and ${y.id} are both green at ${t}`);
          assert.ok(x.mv === 'L' || y.mv === 'L');
        }
      }
    }
    for (const lg of n.legs.keys()) if (n.ins.some((l) => l.eid === n.legs[lg].item.e.id)) for (const mv of ['T']) assert.ok([...Array(Math.ceil(n.sig.cycle))].some((_, t) => stateAt(n.sig, t, lg, mv) === 2), 'every approach goes');
  }
});

test('lead-lag: the left arrow of one side ends while the other direction keeps going', () => {
  const n = mid(buildNet(cross(MAIN, MAIN, 'secondary', 'secondary'), { bounds: B, control: { '0,0': 'signal' } }));
  assert.equal(n.sig.phases.length, 6, 'three phases per axis: lead arrow, both through, lag arrow');
  const first = n.sig.phases[0], second = n.sig.phases[1];
  const arrow = Object.keys(first.go).find((k) => k.endsWith('L')), thru = arrow.replace('L', 'T');
  assert.equal(second.go[thru], 2, 'its through traffic continues');
  assert.equal(second.go[arrow], undefined, 'the arrow is off');
});

test('lanes: a protected left makes the inner lane a left-turn pocket and cars still flow', () => {
  const net = buildNet(cross(BIG, BIG), { bounds: B, control: { '0,0': 'signal' } });
  const pockets = net.lanes.filter((l) => l.leftOnly);
  assert.ok(pockets.length >= 2 && pockets.every((l) => l.conns.every((c) => c.type === 'L' || c.type === 'U')));
  const sim = new Sim(4); sim.density = 0.6; sim.setNet(net);
  let wait = 0, mov = 0;
  for (let i = 0; i < 20 * 400; i++) { sim.step(0.05); if (i % 100 === 0 && i > 400) { sim.snapshot(); wait += sim.stats.waiting; mov += sim.stats.moving; } }
  assert.ok(wait < mov * 0.7, `cars wait ${wait} of ${mov}`);
  assert.ok(sim.snapshot().every(Number.isFinite));
});

test('exported masts stand clear of the lanes with one head per approach lane', () => {
  const net = buildNet(cross(MAIN, MAIN, 'secondary', 'secondary'), { bounds: B, control: { '0,0': 'signal' } });
  const [sg] = exportSignals(net);
  assert.equal(sg.masts.length, 4);
  for (const m of sg.masts) {
    const lane = net.lanes.filter((l) => l.to.id === '0,0').map((l) => Math.hypot(l.pts.at(-1)[0] - m.x, l.pts.at(-1)[1] - m.z));
    assert.ok(Math.min(...lane) > 3.5, 'a pole stands in the street');
    assert.ok(Math.hypot(m.ax - m.x, m.az - m.z) > 4, 'the arm reaches out over the lanes');
  }
  assert.ok(sg.heads.length >= 8 && sg.heads.every((h) => Number.isFinite(h.x + h.z)));
  assert.ok(JSON.stringify(sg).length > 100);
});

test('every signalized junction of the real area gets a rule-made plan, masts and a working sim', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  const area = manifest.areas.find((a) => a.id === manifest.default);
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));
  const { BASE } = await import('../src/engine/commands.js');
  const { nodeControl } = await import('../src/tools/roads/graph.js');
  const control = {};
  for (const e of BASE.edges.values()) if (e.g) for (const n of [e.a, e.b]) control[keyOf(BASE.nodes[n])] = nodeControl(BASE, n);
  const net = buildNet(drivableEdges(BASE.edges), { control });
  const sigs = net.nodes.filter((n) => n.control === 'signal');
  const modes = {}; for (const n of sigs) modes[n.sig.mode] = (modes[n.sig.mode] || 0) + 1;
  console.log(`  ${sigs.length} signals`, JSON.stringify(modes));
  assert.ok(sigs.length > 0);
  for (const n of sigs) {
    assert.ok(n.sig && Number.isFinite(n.sig.cycle));
    for (const c of n.conns) assert.ok([...Array(Math.ceil(n.sig.cycle))].some((_, t) => { const s = stateAt(n.sig, t, c.leg, c.mv); return s === 1 || s === 2; }), `${c.id} never gets a green`);
  }
  const ex = exportSignals(net); assert.ok(ex.length > 0 && JSON.stringify(ex).length < 5e6);
  const { roadwayIndex } = await import('../src/tools/roads/roadway.js');
  const rw = roadwayIndex([...BASE.edges.values()]);
  let over = 0, total = 0, clear = 0, poles = 0;
  for (const sg of ex) {
    for (const h of sg.heads) { total++; if (rw.hit(h.x, h.z, 1.5)) over++; }
    for (const m of sg.masts) { poles++; const [x, z] = rw.nudge(m.x, m.z, 0.5); if (!rw.hit(x, z, -0.3)) clear++; }
  }
  console.log(`  ${total} heads, ${(over / total * 100).toFixed(0)}% over the roadway; ${poles} poles, ${clear} off the pavement`);
  assert.ok(over / total > 0.8, 'heads hang over the street');
  assert.equal(clear, poles);
  const sim = new Sim(11); sim.setNet(net);
  for (let i = 0; i < 20 * 600; i++) sim.step(0.05);
  sim.snapshot();
  assert.ok(sim.stats.waiting < sim.stats.moving * 0.8, 'traffic is gridlocked');
});
