// Multi-level roads: bridges, underpasses, tunnels, ramps, the cut under a deck, and traffic that stays on its own level.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// a small flat area at 5 m, 0.6 km a side, with room to cut the ground
const nx = 101, nz = 101, cell = 6;
globalThis.__RENOVATED_PACK__ = { terrain: { minx: -300, minz: -300, cell, nx, nz, base: 0, h: new Array(nx * nz).fill(50) }, edges: [], nodes: [], lots: [], buildings: [], blocks: [], walks: [], props: [], landuse: [], parking: [] };
const core = await import('../src/engine/core.js');
const { planLevels, CLEAR } = await import('../src/engine/levels.js');
const deck = await import('../src/tools/roads/deck.js');
const { buildNet, deckHeight } = await import('../src/sim/net.js');
const { NO_DECK, Sim, STRIDE } = await import('../src/sim/sim.js');

const bbox = (p) => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
const mk = (id, p, c, extra = {}) => ({ id, p, c, g: 1, w: c === 'motorway' ? 14 : 9, bb: bbox(p), a: extra.a ?? null, b: extra.b ?? null, ...extra });
const world = (edges) => ({ edges: new Map(edges.map((e) => [e.id, e])) });
const resetGround = () => core.HG.fill(5);
const FWY = () => mk('F', [[-280, 0], [0, 0], [280, 0]], 'motorway', { oneway: 1, a: 1, b: 2 });
const STREET = () => mk('S', [[0, -250], [0, 250]], 'secondary', { a: 3, b: 4 });

test('an untagged freeway passes over a street it crosses; the street dips under it', () => {
  resetGround();
  const F = FWY(), St = STREET(), S = world([F, St]);
  const r = planLevels(S);
  assert.equal(r.bridges, 1); assert.equal(r.crossings, 1);
  assert.ok(F.dk && !St.dk, 'the freeway carries the deck, the street stays on the ground');
  const sp = F.dk.find((q) => q.L > 0);
  assert.ok(sp.a > 4 && sp.b < deck.polyLen(F.p) - 4, 'the inferred deck rests on both sides and never touches the ends');
  assert.ok(Math.abs(deck.deckY(F.dk, sp.a) - 5) < 0.01, 'the deck is at the ground height where it ends its approach');
  assert.ok(core.elev(0, 0) <= 5 - CLEAR + 0.01, `the ground under the deck is cut to give clearance (${core.elev(0, 0)})`);
  assert.ok(core.elev(0, 120) > 4.9 && core.elev(0, 200) > 4.9, 'the cut stops short of the far approaches');
  assert.ok(core.elev(0, 60) < 5, 'the street dips under the bridge at a gentle grade');
  assert.equal(F.l0 || 0, 0); assert.equal(F.l1 || 0, 0);
});

test('two ordinary streets that cross without a node are left alone', () => {
  resetGround();
  const a = mk('A', [[-200, 0], [200, 0]], 'residential'), b = mk('B', [[0, -200], [0, 200]], 'residential');
  const r = planLevels(world([a, b]));
  assert.equal(r.bridges, 0); assert.ok(!a.dk && !b.dk);
  assert.equal(core.elev(0, 0), 5);
});

test('tagged spans decide which road is on top, whatever the class', () => {
  resetGround();
  const up = mk('U', [[-200, 0], [200, 0]], 'residential', { lv: [[150, 250, 1]], a: 1, b: 2 }), low = mk('L', [[0, -200], [0, 200]], 'primary', { a: 3, b: 4 });
  planLevels(world([up, low]));
  assert.ok(up.dk && !low.dk, 'the tagged residential street bridges the primary road');
  assert.equal(up.dk[0].a, 150); assert.equal(up.dk[0].b, 250);
});

test('a tunnel dips under the ground between its portals and is level with it at both ends', () => {
  resetGround();
  const t = mk('T', [[-200, 100], [200, 100]], 'secondary', { lv: [[100, 300, -1]], a: 1, b: 2 });
  planLevels(world([t]));
  const sp = t.dk.find((q) => q.L < 0);
  assert.equal(sp.L, -1);
  assert.ok(Math.abs(sp.h[0] - 5) < 0.01 && Math.abs(sp.h[sp.h.length - 1] - 5) < 0.01);
  assert.ok(Math.min(...sp.h) < 5 - 5, 'well below the ground in the middle');
});

test('a freeway is graded: smooth grade, ends on the ground, and the ground under the road bed follows it', () => {
  resetGround();
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const x = -300 + i * cell, z = -300 + j * cell; core.HG[j * nx + i] = 5 + 3 * Math.exp(-((x * x) / 900 + ((z - 60) * (z - 60)) / 1600)) + ((i * 7 + j * 3) % 5) * 0.15; } // a hill and some bumps
  const F = mk('F', [[-280, 60], [280, 60]], 'motorway', { oneway: 1, a: 1, b: 2 });
  planLevels(world([F]));
  const g = F.dk.find((q) => q.L === 0 && q.a === 0);
  assert.ok(g && g.b === deck.polyLen(F.p));
  const orig = (x) => 5 + 3 * Math.exp(-((x * x) / 900));
  assert.ok(Math.abs(g.h[0] - orig(-280)) < 0.8 && Math.abs(g.h.at(-1) - orig(280)) < 0.8, 'the ends stay on the ground');
  for (let k = 1; k < g.h.length; k++) assert.ok(Math.abs(g.h[k] - g.h[k - 1]) <= 0.07 * g.d + 1e-6, 'never steeper than 7 percent');
  assert.ok(Math.abs(core.elev(0, 60) - deck.deckY(F.dk, 280)) < 0.3, 'the ground under the road bed meets the road');
  assert.equal(F.l0 || 0, 0);
});

test('a deck over a deck clears it by a full storey', () => {
  resetGround();
  const top = mk('T', [[-250, 0], [250, 0]], 'motorway', { oneway: 1, lv: [[200, 300, 1]], a: 1, b: 2 }), ramp = mk('R', [[0, -200], [0, 200]], 'motorway', { s: 'link', lv: [[150, 250, 1]], a: 3, b: 4 });
  planLevels(world([top, ramp]));
  const dTop = deck.deckY(top.dk, 250), dRamp = deck.deckY(ramp.dk, 200);
  assert.ok(dTop - dRamp >= 6.1, `upper ${dTop} lower ${dRamp}`);
});

test('an edge end is elevated only where the deck carries on across the node', () => {
  resetGround();
  const a = mk('A', [[-250, 0], [0, 0]], 'motorway', { oneway: 1, lv: [[100, 250, 1]], a: 1, b: 2 }), b = mk('B', [[0, 0], [250, 0]], 'motorway', { oneway: 1, lv: [[0, 150, 1]], a: 2, b: 3 });
  planLevels(world([a, b]));
  assert.equal(a.l1, 1); assert.equal(b.l0, 1, 'a bridge that runs on past a node stays one level');
  assert.equal(a.l0 || 0, 0); assert.equal(b.l1 || 0, 0, 'the far ends come down to the ground');
  // a bridge meeting a ground road at a node comes down to meet it
  resetGround();
  const c = mk('C', [[-250, 0], [0, 0]], 'secondary', { lv: [[100, 250, 1]], a: 1, b: 2 }), d = mk('D', [[0, 0], [250, 0]], 'secondary', { a: 2, b: 3 });
  planLevels(world([c, d]));
  assert.equal(c.l1 || 0, 0);
});

test('traffic on a bridge never meets traffic beneath it, even where the ends share a spot', () => {
  const els = [['lane', 3.3], ['lane', 3.3]];
  const ground = { id: 'G', p: [[-100, 0], [0, 0]], c: 'secondary', els }, over = { id: 'O', p: [[0, 0], [100, 0]], c: 'secondary', els, l0: 1 }, under = { id: 'U', p: [[0, 0], [0, 100]], c: 'secondary', els };
  const net = buildNet([ground, over, under], {});
  const lv = net.nodes.filter((n) => n.x === 0 && n.z === 0);
  assert.equal(lv.length, 2, 'the elevated end is its own node');
  const upper = lv.find((n) => n.id.endsWith('^1'));
  assert.equal(upper.legs.length, 1, 'nothing else connects to the bridge end');
  assert.ok(lv.find((n) => !n.id.endsWith('^1')).legs.length === 2);
});

test('cars on a deck are lifted onto it, cars on the ground are not', () => {
  const els = [['lane', 3.3], ['lane', 3.3]], dk = [{ a: 20, b: 80, L: 1, h: [8, 8, 8, 8], d: 20 }];
  const e = { id: 'O', p: [[0, 0], [100, 0]], c: 'secondary', els, dk };
  const net = buildNet([e, { id: 'G', p: [[0, 50], [100, 50]], c: 'secondary', els }], {});
  assert.equal(deckHeight(net, 'O', 50, 1), 8);
  assert.ok(Number.isNaN(deckHeight(net, 'O', 10, 1)), 'before the deck starts');
  assert.ok(Number.isNaN(deckHeight(net, 'G', 50, 51)));
  const sim = new Sim(3); sim.density = 1; sim.setNet(net);
  for (let i = 0; i < 400; i++) sim.step(0.05);
  const snap = sim.snapshot(); let onDeck = 0;
  for (let o = 0; o < snap.length; o += STRIDE) if (snap[o] < 1e6 && snap[o + 7] === 8) onDeck++;
  assert.ok(sim.stats.moving > 0 && snap.every(Number.isFinite), 'the snapshot stays finite');
  for (let o = 0; o < snap.length; o += STRIDE) if (snap[o] < 1e6) { const y = snap[o + 7], x = snap[o + 1]; assert.ok(y === NO_DECK || y === 8, `a car at x ${x} is at height ${y}`); if (x > 22 && x < 78 && Math.abs(snap[o + 2]) < 6) assert.equal(y, 8, 'on the deck'); }
  assert.ok(onDeck > 0, 'some car was on the deck');
});

test('deck reading helpers', () => {
  const e = { p: [[0, 0], [100, 0]], dk: [{ a: 20, b: 60, L: 1, h: [4, 6, 8], d: 20 }], dkp: 100 };
  assert.equal(deck.deckYAt(e, 40, 3), 6); assert.equal(deck.deckYAt(e, 30, 0), 5);
  assert.ok(Number.isNaN(deck.deckYAt(e, 80, 0)));
  assert.equal(deck.levelAt(e.dk, 30), 1); assert.equal(deck.levelAt(e.dk, 90), 0);
  e.p = [[0, 0], [140, 0]]; assert.equal(deck.spansOf(e), null, 'a reshaped edge drops a deck it no longer has');
});

test('every pack stores well-formed level spans, and the real freeway bridges are in them', () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  let spans = 0, bridges = 0;
  for (const a of manifest.areas) {
    if (a.status !== 'ready') continue;
    const pack = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.pack}`, import.meta.url)));
    for (const e of pack.edges) {
      if (!e.lv) continue;
      const len = deck.polyLen(e.p);
      for (const [s0, s1, L] of e.lv) { spans++; if (L > 0) bridges++; assert.ok(s0 >= 0 && s1 > s0 && s1 <= len + 1 && Number.isInteger(L) && L !== 0, `${a.id} ${e.id}: ${JSON.stringify(e.lv)} on ${len.toFixed(0)} m`); }
    }
  }
  assert.ok(spans > 0 && bridges > 0, 'the importer found the mapped bridges');
});
