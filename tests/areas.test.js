// Area loading checks in plain node: picker geometry, dev-server request validation, rebase notes,
// and the shape of every ready pack (ids unique, references resolve) so a rebuilt pack cannot break saves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MAX_SIDE_M, bboxAround, bboxFromCorners, bboxProblem, bboxSizeM, frameFrom, slugify } from '../src/areas/geo.js';
import { rebaseNote } from '../src/areas/rebase.js';
import { buildArgs } from '../tools/vite-areas.js';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));

test('bboxAround gives the requested size and drag corners are clamped', () => {
  const [w, h] = bboxSizeM(bboxAround(-118.6, 34.2, 1200));
  assert.ok(Math.abs(w - 1200) < 5 && Math.abs(h - 1200) < 5);
  const huge = bboxFromCorners([-118.7, 34.1], [-118.3, 34.3]);
  assert.ok(bboxSizeM(huge).every((v) => v <= MAX_SIDE_M + 1));
  const tiny = bboxFromCorners([-118.6, 34.2], [-118.5999, 34.2001]);
  assert.equal(bboxProblem(tiny, manifest.region), null);
});

test('bboxProblem rejects boxes outside the Valley or the wrong size', () => {
  assert.match(bboxProblem(null), /Pick a spot/);
  assert.match(bboxProblem(bboxAround(-118.2, 34.05, 1200), manifest.region), /inside the San Fernando Valley/);
  assert.match(bboxProblem([-118.6, 34.2, -118.5, 34.3], manifest.region), /Keep each side/);
});

test('slugify makes unique, safe ids', () => {
  assert.equal(slugify('Canoga Park, CA'), 'canoga-park-ca');
  assert.equal(slugify('Reseda', ['reseda']), 'reseda-2');
  assert.match(slugify('!!'), /^[a-z0-9][a-z0-9-]{1,39}$/);
  assert.match(slugify('Ünïcode Ävenue'), /^[a-z0-9-]+$/);
});

test('frameFrom inverts the map projection', () => {
  const rb = manifest.region.bbox, LL = (lon, lat) => [20 + (lon - rb[0]) * 900, 30 + (rb[3] - lat) * 1500];
  const f = frameFrom(LL, rb), p = LL(-118.5, 34.2), q = f.toLL(...p);
  assert.ok(Math.abs(q[0] + 118.5) < 1e-9 && Math.abs(q[1] - 34.2) < 1e-9);
});

test('build requests are validated before anything runs', () => {
  assert.deepEqual(buildArgs({ id: 'a-1', bbox: [-118.6, 34.1, -118.5, 34.2], refresh: false }), ['--id', 'a-1', '--bbox=-118.6,34.1,-118.5,34.2']);
  assert.ok(buildArgs({ id: 'wh-topanga', refresh: true }).includes('--refresh'));
  for (const bad of [null, { id: '../x' }, { id: 'ok id' }, { id: '-x' }, { id: 'abc', bbox: [1, 2, 3] }, { id: 'abc', bbox: [-118, 34, -119, 35] }, { id: 'abc', bbox: ['a', 1, 2, 3] }]) assert.throws(() => buildArgs(bad));
  assert.deepEqual(buildArgs({ id: 'abc', name: 'x\ny' }).slice(-2), ['--name', 'x y']);
});

test('rebaseNote reports carried-over and skipped edits only when the pack changed', () => {
  const area = { name: 'Woodland Hills', built: '2026-11-09' };
  assert.equal(rebaseNote({ log: [1], built: '2026-11-09' }, area, {}), null);
  assert.equal(rebaseNote({ log: [1] }, area, {}), null);
  assert.match(rebaseNote({ log: [1, 2, 3], built: '2026-10-25' }, area, { notes: ['x'], skipped: [] }), /2 of your 3 edits carried over; 1 no longer fit/);
  assert.match(rebaseNote({ log: [1, 2], built: '2026-10-25' }, area, { notes: [], skipped: [] }), /All 2 of your edits/);
});

test('every ready pack has unique ids and resolvable references', () => {
  const ready = manifest.areas.filter((a) => a.status === 'ready');
  assert.ok(ready.length >= 1);
  for (const a of ready) {
    const P = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.pack}`, import.meta.url)));
    const lots = new Set(P.lots.map((l) => l.id)), edges = new Set(P.edges.map((e) => e.id));
    assert.equal(lots.size, P.lots.length, `${a.id} lot ids unique`); assert.equal(edges.size, P.edges.length, `${a.id} edge ids unique`);
    for (const l of P.lots) assert.ok(edges.has(l.rd), `${a.id} ${l.id} street ${l.rd}`);
    const nodes = P.nodes.length; for (const e of P.edges) assert.ok(e.a < nodes && e.b < nodes, `${a.id} ${e.id} nodes`);
    for (const b of P.buildings) if (b.l !== undefined) assert.ok(b.l < P.lots.length, `${a.id} building lot`);
  }
});

test('imported one-way streets and recognised paving are sane in every ready pack', () => {
  for (const a of manifest.areas.filter((x) => x.status === 'ready')) {
    const P = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.pack}`, import.meta.url)));
    const ow = P.edges.filter((e) => e.ow);
    for (const e of ow) assert.equal(e.ow, 1, `${a.id} ${e.id}: one-way edges are stored along their direction of travel`);
    if (a.id === 'wh-topanga') assert.ok(ow.length >= 8, 'Topanga has one-way carriageways');
    for (const e of P.edges) if (e.sp) assert.ok(e.sp >= 5 && e.sp <= 85, `${a.id} ${e.id} speed`);
    const shoelace = (r) => Math.abs(r.reduce((t, p, i) => t + p[0] * r[(i + 1) % r.length][1] - r[(i + 1) % r.length][0] * p[1], 0)) / 2;
    for (const r of P.parkingInf || []) assert.ok(shoelace(r) <= 2500, `${a.id} recognised lot stays under 2500 m2`);
    for (const r of P.parkingInf || []) assert.ok(r.length >= 3 && r.every((p) => p.length === 2 && p.every(Number.isFinite)), `${a.id} paving ring`);
    const inf = new Set((P.lots || []).filter((l) => l.pvi).map((l) => l.id));
    assert.equal(inf.size > 0, (P.parkingInf || []).length > 0, `${a.id} lots carry pvi where paving was recognised`);
  }
});

test('backdrop files line up with their pack and stay small', () => {
  for (const a of manifest.areas.filter((x) => x.status === 'ready' && x.bg)) {
    const D = JSON.parse(fs.readFileSync(new URL(`../public/areas/${a.bg}`, import.meta.url)));
    const T = D.terrain;
    assert.equal(T.h.length, T.nx * T.nz, `${a.id} terrain grid`);
    assert.equal(D.cells.length % 4, 0, `${a.id} cell records`);
    assert.ok(D.core[0] > T.minx && D.core[2] < T.minx + T.nx * T.cell, `${a.id} ring surrounds the playable box`);
    assert.ok(fs.statSync(new URL(`../public/areas/${a.bg}`, import.meta.url)).size < 2.5e6, `${a.id} backdrop under 2.5 MB`);
  }
});
