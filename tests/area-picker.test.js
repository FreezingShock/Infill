// Area picker checks in plain node: address and street suggestions, custom-area files (export, install, remove), the baked Valley map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fromPhoton, intersections, mergeSuggestions, nameFor, norm, nearestPoint, photon, searchLocal, streetIndex } from '../src/areas/search.js';
import { allAreas, bundleFor, checkBundle, installBundle, removeCustom } from '../tools/areas-store.js';
import { buildArgs } from '../tools/vite-areas.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const map = JSON.parse(fs.readFileSync(new URL('../public/areas/valley.map.json', import.meta.url)));
const streets = streetIndex(map.roads);
const ctx = { areas: manifest.areas, streets, region: manifest.region };

test('norm treats Boulevard and Blvd the same', () => {
  assert.equal(norm('Reseda Boulevard'), 'reseda blvd');
  assert.equal(norm('  Topanga Canyon Blvd. '), 'topanga canyon blvd');
});

test('the baked Valley map frames the same region as the manifest and carries named arterials', () => {
  assert.deepEqual(map.bbox, manifest.region.bbox);
  assert.ok(map.roads.length > 100 && streets.length > 100);
  for (const f of ['valley.webp', 'valley-sat.jpg']) assert.ok(fs.statSync(new URL(`../public/areas/${f}`, import.meta.url)).size > 100_000, f);
});

test('cross streets resolve to a real intersection inside the Valley', () => {
  const hits = searchLocal('Reseda Blvd & Sherman Way', ctx);
  const x = hits.find((h) => h.kind === 'cross');
  assert.ok(x, 'an intersection suggestion');
  const r = manifest.region.bbox;
  assert.ok(x.lon > r[0] && x.lon < r[2] && x.lat > r[1] && x.lat < r[3]);
  assert.ok(Math.abs(x.lat - 34.2011) < 0.01, 'Sherman Way is near 34.20 N');
  assert.ok(searchLocal('reseda and sherman', ctx).some((h) => h.kind === 'cross'));
});

test('typing part of a name finds areas and streets, and coordinates are accepted', () => {
  const kinds = (q) => searchLocal(q, ctx).map((h) => h.kind);
  assert.ok(kinds('woodl').includes('area'));
  assert.ok(kinds('ventura bl').includes('street'));
  const c = searchLocal('34.2011, -118.5990', ctx)[0];
  assert.equal(c.kind, 'coord'); assert.ok(Math.abs(c.lon + 118.599) < 1e-9);
  assert.deepEqual(searchLocal('34.2011, -118.5990', { ...ctx, region: { bbox: [-118.4, 34, -118.3, 34.1] } }), []);
  assert.deepEqual(searchLocal('x', ctx), []);
});

test('intersections and nearestPoint work on simple streets', () => {
  const S = streetIndex([{ n: 'A St', c: 'p', l: [[-118.5, 34.2, -118.5, 34.21]] }, { n: 'B Ave', c: 'p', l: [[-118.51, 34.205, -118.49, 34.205]] }]);
  const pts = intersections(S[0], S[1]); assert.equal(pts.length, 1); assert.ok(Math.abs(pts[0][1] - 34.205) < 1e-9);
  assert.deepEqual(nearestPoint(S[0], [-118.5, 34.2101]), [-118.5, 34.21]);
});

test('online results are parsed and merged without duplicating local ones', async () => {
  const f = { geometry: { coordinates: [-118.5361, 34.2011] }, properties: { housenumber: '18000', street: 'Sherman Way', city: 'Los Angeles', district: 'Reseda', postcode: '91335', osm_key: 'place' } };
  const s = fromPhoton(f); assert.equal(s.kind, 'address'); assert.equal(s.label, '18000 Sherman Way'); assert.match(s.sub, /Reseda/);
  assert.equal(fromPhoton({ geometry: { coordinates: [] }, properties: {} }), null);
  const calls = [];
  const got = await photon('18000 sherman', { bbox: manifest.region.bbox, near: [-118.5, 34.2], fetchImpl: async (u) => { calls.push(String(u)); return { ok: true, json: async () => ({ features: [f] }) }; } });
  assert.equal(got.length, 1); assert.match(calls[0], /bbox=-118\.68/); assert.match(calls[0], /lat=34\.2/);
  await assert.rejects(photon('x', { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  const m = mergeSuggestions([{ kind: 'street', label: 'Sherman Way', lon: -118.5, lat: 34.2 }], [{ kind: 'street', label: 'sherman way', lon: -118.5, lat: 34.2 }, s]);
  assert.equal(m.length, 2);
  assert.equal(nameFor(s), 'Sherman Way');
  assert.equal(nameFor({ kind: 'cross', label: 'Reseda Blvd & Sherman Way' }), 'Reseda');
});

test('build requests can ask for a custom area', () => {
  assert.ok(buildArgs({ id: 'my-spot', bbox: [-118.6, 34.2, -118.59, 34.21], custom: true }).includes('--custom'));
  assert.ok(!buildArgs({ id: 'my-spot', bbox: [-118.6, 34.2, -118.59, 34.21] }).includes('--custom'));
});

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sfvos-areas-'));
  fs.mkdirSync(path.join(root, 'public', 'areas'), { recursive: true });
  const first = manifest.areas.find((a) => a.status === 'ready');
  fs.writeFileSync(path.join(root, 'public', 'areas', 'index.json'), JSON.stringify({ areas: [first] }));
  const pack = { origin: [-118.6, 34.2], edges: [], lots: [{ id: 1 }], buildings: [] };
  fs.writeFileSync(path.join(root, 'public', 'areas', first.pack), JSON.stringify(pack));
  return { root, first, pack };
}

test('a custom area can be exported, installed, listed and removed', () => {
  const { root, first, pack } = sandbox();
  try {
    const b = bundleFor(root, first.id); assert.equal(b.kind, 'sfvos-area'); assert.equal(b.files.pack.lots.length, 1);
    const entry = installBundle(root, b); // same id as a shared area: it gets its own
    assert.notEqual(entry.id, first.id); assert.equal(entry.custom, true); assert.match(entry.pack, /^custom\//);
    assert.ok(fs.existsSync(path.join(root, 'public', 'areas', entry.pack)));
    assert.equal(allAreas(root).length, 2);
    assert.equal(bundleFor(root, entry.id).files.pack.lots.length, pack.lots.length);
    assert.throws(() => removeCustom(root, first.id), /Built-in/);
    removeCustom(root, entry.id);
    assert.equal(allAreas(root).length, 1); assert.ok(!fs.existsSync(path.join(root, 'public', 'areas', entry.pack)));
    assert.throws(() => removeCustom(root, entry.id), /No such/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('bundles are checked before anything is written', () => {
  assert.throws(() => checkBundle(null), /not an sfvOS area/);
  assert.throws(() => checkBundle({ kind: 'sfvos-area', v: 1, area: { id: '../evil', bbox: [0, 0, 1, 1] }, files: { pack: {} } }), /usable id/);
  assert.throws(() => checkBundle({ kind: 'sfvos-area', v: 1, area: { id: 'ok-id', bbox: [0, 0, 1, 1] }, files: { pack: { edges: [] } } }), /missing streets/);
  const ok = { kind: 'sfvos-area', v: 1, area: { id: 'ok-id', bbox: [0, 0, 1, 1], name: 'Ok' }, files: { pack: { edges: [], lots: [], origin: [0, 0], buildings: [] } } };
  assert.equal(checkBundle(ok, ['ok-id']).id, 'ok-id-2');
});
