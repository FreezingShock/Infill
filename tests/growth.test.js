// Zoning and growth in plain node: demand maths, the growth planner, and the `grow` and `rezone` commands.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE, exec, storeysOf } = await import('../src/engine/commands.js');
const { genLot } = await import('../src/engine/templates.js');
const { capacity, demandOf, smooth, tally } = await import('../src/game/zoning/demand.js');
const { planGrowth } = await import('../src/game/growth.js');
const { ZONE_PAINTS } = await import('../src/game/zoning/zones.js');

const fresh = () => structuredClone(BASE);
const info = () => ({ skipped: [], notes: [] });

test('demand: shops and work are wanted in a city of only homes, and fall as they appear', () => {
  const lonely = demandOf({ homes: 1000, shops: 0, jobs: 0 });
  assert.ok(lonely.shops > 0.9 && lonely.work > 0.9);
  const balanced = demandOf({ homes: 1000, shops: 120, jobs: 1020 });
  assert.ok(Math.abs(balanced.shops) < 0.05 && Math.abs(balanced.work) < 0.05);
  const jobsHeavy = demandOf({ homes: 100, shops: 50, jobs: 5000 });
  assert.ok(jobsHeavy.homes > 0.9 && jobsHeavy.work < 0);
  for (const v of Object.values(lonely)) assert.ok(v >= -1 && v <= 1);
});

test('demand on the loaded area is finite and smooths toward its target', () => {
  const rows = [...BASE.lots.values()].map((l) => capacity(l, genLot(l, BASE).units, storeysOf(l)));
  const d = demandOf(tally(rows));
  for (const v of Object.values(d)) assert.ok(Number.isFinite(v) && v >= -1 && v <= 1);
  const s = smooth({ homes: 0, shops: 0, work: 0, civic: 0 }, { homes: 1, shops: 1, work: 1, civic: 1 }, 0.5);
  assert.equal(s.homes, 0.5);
});

test('painting with g marks lots as growth targets; plain rezone does not', () => {
  const S = fresh(), ids = [...S.lots.keys()].slice(0, 5);
  exec(S, { op: 'rezone', lots: ids.slice(0, 3), z: 'R3-1', g: 1 }, info());
  exec(S, { op: 'rezone', lots: ids.slice(3), z: 'R3-1' }, info());
  assert.deepEqual(ids.map((id) => !!S.lots.get(id).gz), [true, true, true, false, false]);
});

test('nothing grows without painted lots or without demand', () => {
  const S = fresh();
  assert.equal(planGrowth(S.lots.values(), { homes: 1, shops: 1, work: 1, civic: 1 }, 1), null);
  const ids = [...S.lots.keys()].slice(0, 20);
  exec(S, { op: 'rezone', lots: ids, z: 'R3-1', g: 1 }, info());
  assert.equal(planGrowth(S.lots.values(), { homes: -0.5, shops: -1, work: -1, civic: -1 }, 1), null);
});

test('painted apartment zone fills in, then levels up to the zone cap, deterministically', () => {
  const S = fresh();
  const ids = [...S.lots.values()].filter((l) => l.m2 > 400 && l.lt === 'house').slice(0, 30).map((l) => l.id);
  assert.ok(ids.length > 10);
  exec(S, { op: 'rezone', lots: ids, z: 'R3-1', g: 1 }, info());
  const dem = { homes: 0.9, shops: 0, work: 0, civic: 0.3 };
  assert.deepEqual(planGrowth(S.lots.values(), dem, 7), planGrowth(S.lots.values(), dem, 7));
  let changed = 0;
  for (let day = 1; day <= 400; day++) {
    const cmd = planGrowth(S.lots.values(), dem, day, 6);
    if (!cmd) continue;
    assert.ok(cmd.fill.length + cmd.up.length <= 6);
    exec(S, cmd, info()); changed += cmd.fill.length + cmd.up.length;
  }
  assert.ok(changed > 0);
  for (const id of ids) {
    const lot = S.lots.get(id);
    assert.equal(lot.lt, 'apts', `${id} converted`);
    assert.ok(storeysOf(lot) <= 4, `${id} within the R3 cap`);
    assert.ok(genLot(lot, S).units >= 0);
  }
});

test('a grow command only touches lots it names and tolerates ids that are gone', () => {
  const S = fresh(), [a, b] = [...S.lots.keys()];
  const before = JSON.stringify(S.lots.get(b));
  exec(S, { op: 'grow', fill: [a, 'nope'], up: ['nada'], sd: 'd1' }, info());
  assert.equal(JSON.stringify(S.lots.get(b)), before);
});

test('every zone paint is a real zone code with a kind', () => {
  for (const p of ZONE_PAINTS) { assert.ok(/^[A-Z0-9]+-/.test(p.z)); assert.ok(['homes', 'shops', 'civic'].includes(p.kind)); }
});

