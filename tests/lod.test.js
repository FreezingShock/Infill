// Detail streaming for big areas: which chunks get meshes, the massing that stands in for the rest, and slim lots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE } = await import('../src/engine/commands.js');
const { genLot } = await import('../src/engine/templates.js');
const { DETAIL, DetailSet, CH, chunkCenter, chunkKey, massingChunks } = await import('../src/engine/lod.js');
const { decodeBatch, encodeBatch, slimOf } = await import('../src/workers/codec.js');

const keys = [...new Set([...BASE.lots.values()].map((l) => chunkKey(l.c)))];

test('chunk keys round-trip to centres inside their own chunk', () => {
  for (const k of keys.slice(0, 20)) { const [x, z] = chunkCenter(k); assert.equal(chunkKey([x, z]), k); }
});

test('detail set: near chunks on, far chunks off, hysteresis keeps edge chunks', () => {
  const d = new DetailSet(), t = chunkCenter(keys[0]);
  const a = d.update(t, 600, keys);
  assert.ok(a.added.includes(keys[0]));
  const R = d.radius(600);
  for (const k of keys) { const [x, z] = chunkCenter(k), dist = Math.hypot(x - t[0], z - t[1]); if (dist - CH * 0.7 < R) assert.ok(d.near.has(k)); }
  assert.equal(d.update(t, 600, keys).added.length, 0, 'no change when the view stays put');
  const far = [t[0] + 5000, t[1]]; const b = d.update(far, 600, keys);
  assert.ok(b.removed.includes(keys[0]), 'the old chunk is dropped once the view is far away');
  d.pinned.add(keys[0]); assert.ok(d.has(keys[0]), 'a pinned (edited) chunk always has detail');
});

test('detail radius is bounded, so zooming far out cannot build the whole area', () => {
  const d = new DetailSet();
  assert.ok(d.radius(30) >= 320 && d.radius(1700) <= 700);
});

test('massing covers every building once and stays far lighter than full detail', () => {
  const m = massingChunks(BASE.lots);
  let verts = 0; for (const a of m.values()) { assert.equal(a.p.length, a.c.length); assert.equal(a.p.length % 9, 0); verts += a.p.length / 3; }
  assert.ok(m.size > 0 && verts > 0);
  const lots = [...BASE.lots.values()].filter((l) => l.b.length).slice(0, 60);
  let full = 0; for (const l of lots) { const g = genLot(l, BASE); full += g.s.p.length + g.g.p.length + g.d.p.length; }
  const mass = massingChunks(lots); let light = 0; for (const a of mass.values()) light += a.p.length;
  assert.ok(light < full / 2, `massing ${light} floats vs ${full} for full detail`);
});

test('a slim lot keeps every number the scores read and ships no meshes', () => {
  const lots = [...BASE.lots.values()].slice(0, 40);
  const items = lots.map((l, i) => ({ h: 'h' + i, g: genLot(l, BASE), geo: i % 2 === 0 }));
  const out = decodeBatch(...Object.values(encodeBatch(items)));
  out.forEach((g, i) => {
    const full = items[i].g;
    for (const k of ['units', 'floor', 'cost', 'park', 'stalls', 'warn', 'ok']) assert.equal(g[k], full[k]);
    assert.equal(g.trees.length, full.trees.length); assert.equal(g.cars.length, full.cars.length);
    assert.equal(g.slim, !items[i].geo);
    if (g.slim) for (const k of ['s', 'g', 'd']) assert.equal(g[k].p.length, 0); else assert.equal(g.s.p.length, full.s.p.length);
  });
  const s = slimOf(items[0].g); assert.equal(s.s.p.length, 0); assert.equal(s.park, items[0].g.park);
});

test('the shared detail set exists for the page and workers to read', () => { assert.ok(DETAIL instanceof DetailSet); });
