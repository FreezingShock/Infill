// Building looks: classification is pure, the sidecar must match the pack, and every as-built lot still generates with looks on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));
const sidecar = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack.replace('.json', '.looks.json')}`, import.meta.url)));

const looks = await import('../src/engine/looks.js');
const { PACK } = await import('../src/engine/pack.js');
const { BASE } = await import('../src/engine/commands.js');
const { genLot } = await import('../src/engine/templates.js');

test('classify picks sensible kinds', () => {
  const geo = { aspect: 1.5 };
  assert.equal(looks.classify({ a: 150, t: 'residential' }, { c: 'house' }, geo, 1), 'house');
  assert.equal(looks.classify({ a: 300, t: 'commercial' }, { c: 'retail' }, geo, 1), 'store');
  assert.equal(looks.classify({ a: 900, t: 'commercial' }, { c: 'retail' }, { aspect: 4 }, 1), 'strip');
  assert.equal(looks.classify({ a: 4000, t: 'commercial' }, { c: 'retail' }, geo, 1), 'bigbox');
  assert.equal(looks.classify({ a: 20, t: 'residential' }, { c: 'garage' }, geo, 1), 'outbuilding');
  assert.equal(looks.classify({ a: 500, t: 'residential' }, { c: 'apartments' }, geo, 3), 'apt');
});

test('the shipped sidecar matches the pack', () => {
  assert.equal(looks.setLooksData(sidecar, PACK.buildings.length, looks.packChecksum(PACK.buildings)), true);
  assert.equal(looks.setLooksData(sidecar, PACK.buildings.length + 1, null), false);
  looks.setLooksData(sidecar, PACK.buildings.length, null);
});

test('every lot generates finite geometry with looks on', () => {
  for (const lot of BASE.lots.values()) {
    const g = genLot(lot, BASE);
    for (const arr of [g.s.p, g.g.p]) for (const v of arr) assert.ok(Number.isFinite(v), `lot ${lot.id}`);
  }
});

test('street trees follow the inventory sidecar and stay off streets that already have a tree strip', async () => {
  const st = await import('../src/engine/streettrees.js');
  const data = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack.replace('.json', '.streets.json')}`, import.meta.url)));
  assert.equal(st.setStreetTrees(data), true);
  const named = [...BASE.edges.values()].filter((e) => e.n && data.streets[st.norm(e.n)] && e.prof.k === 'asbuilt');
  assert.ok(named.length > 5, `planted streets: ${named.length}`);
  const n = named.reduce((s, e) => s + st.streetTrees(e, 2.2, e.prof.els.reduce((a, q) => a + q[1], 0)).length, 0);
  assert.ok(n > 50, `trees: ${n}`);
  const e = { ...named[0], prof: { k: 'complete', els: [['walk', 3], ['trees', 1.6], ['lane', 3]] } };
  assert.equal(st.streetTrees(e, 3, 7.6).length, 0);
});

test('imagery crowns become yard trees and street trees', async () => {
  const st = await import('../src/engine/streettrees.js');
  const data = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack.replace('.json', '.canopy.json')}`, import.meta.url)));
  assert.equal(st.setCanopy(data), true);
  let yard = 0; for (const lot of BASE.lots.values()) yard += st.yardCanopy(lot).length;
  assert.ok(yard > 500, `yard crowns ${yard}`);
  const street = st.streetTreesAll([...BASE.edges.values()], (e) => e.prof.els.reduce((a, q) => a + q[1], 0), () => 2.2);
  assert.ok(street.length > 100, `street crowns ${street.length}`);
  for (const t of street) assert.ok(t.every(Number.isFinite));
  st.setCanopy(null);
});
