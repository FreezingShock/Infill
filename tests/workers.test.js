// The lot-geometry worker job: what a worker builds and ships back must match what the page would build itself.
// Runs the worker core and codec in plain node (no Worker needed): same functions, same pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE } = await import('../src/engine/commands.js');
const { genLot } = await import('../src/engine/templates.js');
const { genBatch } = await import('../src/workers/genlot-core.js');
const { decodeBatch, encodeBatch, faceNormals } = await import('../src/workers/codec.js');

const same = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-4 * (1 + Math.abs(b[i])));

test('face normals match THREE computeVertexNormals', () => {
  const g = genLot([...BASE.lots.values()].find((l) => l.b.length), BASE);
  const p = Float32Array.from(g.s.p), geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3)); geo.computeVertexNormals();
  assert.ok(p.length > 0);
  assert.ok(same(faceNormals(p), geo.getAttribute('normal').array));
});

test('a worker batch decodes to what genLot builds on the page, with demolitions', () => {
  const S = structuredClone(BASE), lots = [...S.lots.values()].filter((l, i) => i % 7 === 0).slice(0, 120);
  for (const l of lots.slice(0, 10)) for (const i of l.b) S.demo.add(i); // demolished buildings must reach the worker
  const jobs = lots.map((lot) => ({ h: lot.id, lot, demo: lot.b.filter((i) => S.demo.has(i)) }));
  const { buf, metas } = genBatch(jobs);
  assert.ok(buf instanceof Float32Array);
  const out = decodeBatch(buf, metas);
  assert.equal(out.length, lots.length);
  lots.forEach((lot, i) => {
    const want = genLot(lot, S), got = out[i];
    assert.equal(got.h, lot.id);
    for (const k of ['s', 'g', 'd']) for (const f of ['p', 'c', 'l']) assert.ok(same(got[k][f], want[k][f]), `${lot.id} ${k}.${f}`);
    assert.equal(got.s.n.length, got.s.p.length);
    for (const k of ['units', 'floor', 'cost', 'park', 'stalls', 'warn', 'ok']) assert.deepEqual(got[k], want[k], `${lot.id} ${k}`);
    assert.deepEqual(got.trees, want.trees); assert.deepEqual(got.cars, want.cars);
  });
});

test('empty meshes and a lot with no output survive the codec', () => {
  const empty = { s: { p: [], c: [], l: [] }, g: { p: [], c: [], l: [] }, d: { p: [], c: [], l: [] }, trees: [], cars: [], units: 0, floor: 0, cost: 0, park: 0, stalls: 0, warn: undefined, ok: true };
  const { buf, metas } = encodeBatch([{ h: 'x', g: empty }]);
  const [g] = decodeBatch(buf, metas);
  assert.equal(g.s.p.length, 0); assert.equal(g.h, 'x');
});
