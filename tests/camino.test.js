import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { infraTotals, layoutInfra, towerSpots } from '../src/camino/infra-data.js';
import { caminoSkyColors } from '../src/camino/sky.js';

const man = JSON.parse(fs.readFileSync('public/areas/index.json', 'utf8'));

test('tower spots keep both ends and space the rest', () => {
  const p = [[0, 0], [50, 0], [100, 0], [200, 0], [400, 0]];
  const t = towerSpots(p, 170);
  assert.deepEqual(t[0], [0, 0]); assert.deepEqual(t.at(-1), [400, 0]);
  assert.ok(t.length < p.length);
});

test('every infra sidecar lays out with sources and sane totals', () => {
  for (const a of man.areas.filter((x) => x.infra)) {
    const D = JSON.parse(fs.readFileSync(`public/areas/${a.infra}`, 'utf8'));
    const I = layoutInfra(D, []);
    const T = infraTotals(I);
    assert.ok(T.lights >= 0 && T.hydrants >= 0 && T.stops >= 0, a.id);
    for (const s of I.stops) { assert.ok(Array.isArray(s.lines)); assert.ok(Number.isFinite(s.ons)); }
    for (const t of I.trans) assert.ok(t.towers.length >= 2, a.id);
  }
});

test('pack lamps suppress doubled city light poles', () => {
  const I = layoutInfra({ lights: [[0, 0, 100, 1, 1], [500, 500, 80, 0, 1]] }, [[2, 1]]);
  assert.equal(I.lights[0].pole, false); assert.equal(I.lights[1].pole, true);
});

test('camino sky goes from blue day to dark night', () => {
  const day = caminoSkyColors({ golden: 0, night: 0 }), night = caminoSkyColors({ golden: 0, night: 1 });
  assert.ok(day[0][2] > 0.6 && night[0][2] < 0.1);
});
