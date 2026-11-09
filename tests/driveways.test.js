// Frontage rule: driveways, curb cuts and front yards on every house lot, and curb parking in islands between them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildNet, drivableEdges } from '../src/sim/net.js';

const LOCAL = [['walk', 2.2], ['park', 2], ['lane', 3.4], ['lane', 3.4], ['park', 2], ['walk', 2.2]];

test('curb parking leaves a gap at each driveway and fills the islands between', () => {
  const e = { id: 'A', p: [[0, 0], [200, 0]], c: 'residential', els: LOCAL };
  const none = buildNet([e], {}), withDw = buildNet([{ ...e, dw: [{ s: 60, hw: 1.6, side: 1 }, { s: 100, hw: 1.6, side: 1 }] }], {});
  const side = (n) => n.slots.filter((s) => s.lane.eid === 'A' && s.lane.dir > 0);
  const a = side(none), b = side(withDw);
  assert.ok(a.length > 20 && b.length < a.length && b.length > 10, `${a.length} -> ${b.length}`);
  const xs = b.map((s) => s.lane.pts[0][0] + s.s * (s.lane.pts.at(-1)[0] - s.lane.pts[0][0]) / s.lane.len);
  for (const x of xs) for (const d of [60, 100]) assert.ok(Math.abs(x - d) > 3.1 + 1.6, `slot at ${x.toFixed(1)} blocks the driveway at ${d}`);
  assert.equal(side(buildNet([{ ...e, dw: [{ s: 60, hw: 1.6, side: -1 }] }], {})).length, a.length, 'a driveway on the far side leaves this side alone');
});

test('every real area gets driveways on its house lots and they fit inside the lot', async () => {
  const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  const area = manifest.areas.find((a) => a.id === manifest.default);
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));
  const { BASE } = await import('../src/engine/commands.js');
  const { frameOf } = await import('../src/engine/model.js');
  const { frontageRings, drivewaysByEdge } = await import('../src/engine/driveways.js');
  const { inPoly } = await import('../src/engine/core.js');
  const houses = [...BASE.lots.values()].filter((l) => l.lt === 'house' && l.b.length && !l.flags.noaccess);
  const withDw = houses.filter((l) => l.dw);
  console.log(`  ${withDw.length} of ${houses.length} house lots have a driveway`);
  assert.ok(houses.length > 50 && withDw.length / houses.length > 0.5, 'most house lots should get a driveway');
  for (const l of withDw.slice(0, 400)) {
    const rg = frontageRings(l, frameOf(l));
    assert.ok(rg.drive, `lot ${l.id} drive`);
    const mid = rg.drive.reduce((q, p) => [q[0] + p[0] / 4, q[1] + p[1] / 4], [0, 0]);
    assert.ok(inPoly(mid[0], mid[1], l.r), `lot ${l.id} drive centre is inside the lot`);
    assert.ok(l.dw.w >= 2.8 && l.dw.te > 0 && l.dw.a >= 0 && l.dw.a <= 8);
  }
  const m = drivewaysByEdge(BASE.lots.values());
  assert.ok(m.size > 10);
  const net = buildNet(drivableEdges(BASE.edges, m), {}), plain = buildNet(drivableEdges(BASE.edges), {});
  console.log(`  slots ${plain.slots.length} -> ${net.slots.length}`);
  assert.ok(net.slots.length < plain.slots.length && net.slots.length > plain.slots.length * 0.4);
});
