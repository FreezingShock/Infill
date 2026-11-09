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

test('where a divided road meets the undivided one, the taper has lanes only (no median across the V)', () => {
  const tapers = [...BASE.edges.values()].filter((e) => e.taper);
  assert.ok(tapers.length >= 2);
  for (const e of tapers) { assert.equal(e.oneway, 1); assert.ok(e.prof.els.every((x) => x[0] === 'lane'), `${e.id} lanes only`); }
});
