// Engine checks in plain node: load the Woodland Hills pack, replay a log that touches every
// command, and regenerate every lot. No browser and no WebGL; the app layer is not loaded here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default);
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const { BASE, replay } = await import('../src/engine/commands.js');
const { PRESETS } = await import('../src/engine/model.js');
const { genLot, TPL, availability } = await import('../src/engine/templates.js');

test('manifest lists a ready default area with a pack file', () => {
  assert.equal(area.status, 'ready');
  for (const a of manifest.areas) {
    assert.equal(a.bbox.length, 4, `${a.id} bbox`);
    if (a.status === 'ready') assert.ok(fs.existsSync(new URL(`../public/areas/${a.pack}`, import.meta.url)), `${a.id} pack file`);
  }
});

test('base state builds from the pack', () => {
  assert.ok(BASE.lots.size > 500, `lots: ${BASE.lots.size}`);
  assert.ok(BASE.edges.size > 50, `edges: ${BASE.edges.size}`);
});

test('every as-built lot generates', () => {
  let units = 0;
  for (const lot of BASE.lots.values()) { const g = genLot(lot, BASE); assert.ok(g.s && g.d); units += g.units; }
  assert.ok(units > 0);
});

test('every template is either buildable or explains why not on a sample of lots', () => {
  const lots = [...BASE.lots.values()].filter((_, i) => i % 40 === 0);
  for (const t of Object.values(TPL)) for (const lot of lots) {
    const v = availability(t, lot, true);
    assert.ok(v.ok || typeof v.why === 'string', `${t.id} on ${lot.id}`);
  }
});

test('a log touching every command replays and regenerates', () => {
  const ids = [...BASE.lots.keys()], log = [];
  log.push({ op: 'apply', lots: ids.slice(0, 200), t: 'sfr.adu', p: {}, vary: 1, sd: 'a1', dr: 0 });
  log.push({ op: 'merge', lots: [ids[300], ids[301]], id: 'M1' });
  log.push({ op: 'split', lot: ids[400], mode: 'sb9', id: 'P1' });
  log.push({ op: 'split', lot: ids[401], mode: 'n', n: 3, id: 'P2' });
  const main = [...BASE.edges.values()].find((e) => e.n && area.main && e.n.includes(area.main));
  if (main) log.push({ op: 'street.prof', ids: [main.id], prof: { k: 'complete', els: PRESETS.complete.els } });
  const c = BASE.lots.get(ids[600]).c;
  log.push({ op: 'street.add', id: 'S1', pts: [[c[0] - 120, c[1] - 5], [c[0] + 120, c[1] + 5]], prof: { k: 'slow', els: PRESETS.slow.els }, name: 'New St' });
  const res = [...BASE.edges.values()].find((e) => e.c === 'residential');
  log.push({ op: 'street.del', ids: [res.id], id: 'D1' });
  const pk = ids.filter((i) => BASE.lots.get(i).lt === 'parking');
  if (pk.length) log.push({ op: 'area.new', lots: pk.slice(0, 3), pattern: 'grid', bs: 70, lw: 12, ld: 28, prof: 'slow', zone: 'mix', fill: 1, sd: 'x', id: 'N1', name: 'Infill' });
  log.push({ op: 'area.new', region: [[c[0] + 150, c[1] + 150], [c[0] + 300, c[1] + 150], [c[0] + 300, c[1] + 300], [c[0] + 150, c[1] + 300]], pattern: 'super', bs: 70, lw: 12, ld: 28, prof: 'slow', zone: 'R3-1', fill: 1, sd: 'y', id: 'N2' });
  log.push({ op: 'fill', lots: ids.slice(700, 760), sd: 'f', dr: 0 });
  log.push({ op: 'rezone', lots: ids.slice(700, 710), z: 'R3-1' });
  log.push({ op: 'tweak', lots: ids.slice(0, 50), f: { st: 2, solar: 1, fence: 'hedge', trees: 1 } });

  const { S, info } = replay(log);
  assert.equal(info.notes.filter((n) => n.includes('skipped')).length, 0, info.notes.join(' | '));
  assert.ok([...S.edges.values()].some((e) => e.grp === 'S1'), 'drawn street exists');
  for (const lot of S.lots.values()) genLot(lot, S);
});
