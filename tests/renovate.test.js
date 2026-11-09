// Repurposing keeps the shell and changes the use: checked in plain node on the real pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE, replay } = await import('../src/engine/commands.js');
const { genLot } = await import('../src/engine/templates.js');
const { liveBuildings } = await import('../src/engine/model.js');
const { USES, addedFloors } = await import('../src/engine/renovate.js');

const withBuildings = [...BASE.lots.values()].filter((l) => l.prog.t === 'asb' && liveBuildings(l, BASE).length);

test('every use generates on a sample of real lots, and keeps the shell', () => {
  for (const use of Object.keys(USES)) for (const lot of withBuildings.filter((_, i) => i % 25 === 0)) {
    const { S } = replay([{ op: 'tweak', lots: [lot.id], f: { use } }]);
    const l = S.lots.get(lot.id), g = genLot(l, S), g0 = genLot(BASE.lots.get(lot.id), BASE);
    assert.ok(g.s && g.g, `${use} on ${lot.id}`);
    assert.ok(g.floor >= g0.floor, `${use} never removes floor area`);
  }
});

test('shops add no homes; homes convert shops into homes; mixed adds floors on low buildings', () => {
  const shop = withBuildings.find((l) => l.lt === 'main' && l.st0 <= 2) || withBuildings.find((l) => l.st0 <= 2);
  const run = (use) => { const { S } = replay([{ op: 'tweak', lots: [shop.id], f: { use } }]); return genLot(S.lots.get(shop.id), S); };
  assert.equal(run('shops').units, 0);
  assert.equal(run('office').units, 0);
  assert.ok(run('mixed').units >= 0 && run('mixed').floor > genLot(shop, BASE).floor, 'mixed builds up');
  assert.ok(run('homes').units > 0 || shop.b.length === 0);
  assert.equal(addedFloors({ t: 'asb', use: 'mixed' }, 1), 2);
  assert.equal(addedFloors({ t: 'asb', use: 'mixed' }, 5), 0);
  assert.equal(addedFloors({ t: 'asb' }, 1), 0);
});

test('restore clears a repurpose, and a null tweak removes the use', () => {
  const lot = withBuildings[0];
  const a = replay([{ op: 'tweak', lots: [lot.id], f: { use: 'shops' } }, { op: 'restore', lots: [lot.id] }]).S.lots.get(lot.id);
  assert.equal(a.prog.use, undefined);
  const b = replay([{ op: 'tweak', lots: [lot.id], f: { use: 'shops' } }, { op: 'tweak', lots: [lot.id], f: { use: null } }]).S.lots.get(lot.id);
  assert.equal(b.prog.use, undefined);
});
