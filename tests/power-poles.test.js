import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBlocked, poleRun, layoutInfra } from '../src/camino/infra-data.js';

const hyp = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

test('poleRun never leaves a span longer than 42 m and keeps clear of buildings', () => {
  const bld = { r: [[40, -5], [60, -5], [60, 5], [40, 5]] };
  const blocked = makeBlocked({ buildings: [bld], edges: [] });
  const run = poleRun([[0, 0], [200, 0]], [], blocked);
  for (let k = 1; k < run.length; k++) assert.ok(hyp(run[k - 1], run[k]) <= 60, 'span ' + hyp(run[k - 1], run[k]));
  assert.ok(run.length >= 5);
  for (const q of run) assert.ok(!blocked(q[0], q[1]));
});

test('mapped poles on the line are reused', () => {
  const mapped = [{ x: 100, z: 1 }];
  const run = poleRun([[0, 0], [200, 0]], mapped, () => false);
  assert.ok(run.some((q) => q[0] === 100 && q[1] === 1));
  assert.ok(mapped[0].used);
});

test('every area: no distribution wire spans more than 80 m and no pole stands in a building', () => {
  const man = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
  for (const a of man.areas.filter((x) => x.pack && x.infra)) {
    const pack = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.pack}`, import.meta.url)));
    const D = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.infra}`, import.meta.url)));
    const I = layoutInfra(D, [], null, { buildings: pack.buildings, edges: pack.edges });
    for (const l of I.plines) for (let k = 1; k < l.p.length; k++) assert.ok(hyp(l.p[k - 1], l.p[k]) <= 80, `${a.id} span ${hyp(l.p[k - 1], l.p[k])}`);
    const blocked = makeBlocked({ buildings: pack.buildings, edges: [] });
    for (const p of I.poles) assert.ok(!blocked(p.x, p.z));
  }
});

test('poles never stand on the roadway or a driveway cut; they go to the strip behind the curb', () => {
  const roadway = { hit: (x, z, pad = 0) => (Math.abs(z) < 7 + pad ? { lat: z } : null), nudge: (x, z, gap = 0.9) => [x, z < 0 ? -7 - gap : 7 + gap] };
  const blocked = makeBlocked({ buildings: [], edges: [], roadway, cuts: [{ x: 100, z: 9, r: 3 }] });
  const run = poleRun([[0, 0], [200, 0]], [], blocked);
  for (const q of run) { assert.ok(!roadway.hit(q[0], q[1], 0.6), 'pole in roadway at ' + q); assert.ok(!blocked(q[0], q[1])); }
  assert.ok(run.every((q) => Math.abs(q[1]) >= 8));
});
