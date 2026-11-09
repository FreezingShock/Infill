// Clock and info-view maths. Runs in plain node against the real default pack.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = manifest.areas.find((a) => a.id === manifest.default) || manifest.areas.find((a) => a.status === 'ready');
globalThis.__RENOVATED_AREAS__ = manifest;
globalThis.__RENOVATED_AREA__ = area;
globalThis.__RENOVATED_PACK__ = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

const clk = await import('../src/game/clock.js');
const { BASE } = await import('../src/engine/commands.js');
const M = await import('../src/views/metrics.js');
const { provide, unprovide } = await import('../src/views/providers.js');

test('clock: speed steps, pause and resume, labels', () => {
  clk.clock.hour = 7; clk.clock.day = 0; clk.setSpeed(1);
  assert.equal(clk.clockLabel().time, '7:00 AM'); assert.equal(clk.weekday(), 'Mon');
  assert.equal(clk.speedIndex(), 1); clk.setSpeed(3); assert.equal(clk.speedIndex(), 3);
  clk.togglePause(); assert.equal(clk.clock.speed, 0); assert.equal(clk.speedIndex(), 0);
  clk.togglePause(); assert.equal(clk.speedIndex(), 3, 'resume restores the last speed');
  clk.clock.speed = 0.2; assert.ok([1, 2].includes(clk.speedIndex()), 'a speed set elsewhere maps to a step');
  clk.clock.speed = 1; clk.clock.hour = 23.5; clk.tickClock(1); assert.equal(clk.clockLabel().time, '12:30 AM'); assert.equal(clk.clock.day, 1);
  assert.equal(clk.weekday(), 'Tue'); clk.clock.speed = 0;
});

test('traffic follows the clock and road edits', () => {
  const facts = M.lotFacts(BASE);
  const rush = M.traffic(BASE, facts, 8 * 60).v, night = M.traffic(BASE, facts, 3 * 60).v;
  let sr = 0, sn = 0; for (const [id, v] of rush) { sr += v; sn += night.get(id); }
  assert.ok(sr > sn * 3, 'rush hour is much busier than 3 AM');
  for (const v of rush.values()) assert.ok(v >= 0 && v <= 1.4);
  const main = [...BASE.edges.values()].find((e) => e.g && e.c === 'primary');
  assert.ok(main, 'the pack has a primary street');
  const before = M.traffic(BASE, facts, 8 * 60).v.get(main.id);
  const diet = { ...main, prof: { k: 'x', els: main.prof.els.filter(([k], i) => !(k === 'lane' && i < 4)) } };
  const S2 = { ...BASE, edges: new Map(BASE.edges).set(main.id, diet) };
  assert.ok(M.traffic(S2, facts, 8 * 60).v.get(main.id) > before, 'taking lanes away raises congestion');
});

test('parking: homes fill at night, shops by day, numbers stay sane', () => {
  assert.ok(M.homeStay(2 * 60) > M.homeStay(13 * 60));
  assert.ok(M.workStay(13 * 60) > M.workStay(3 * 60));
  const facts = M.lotFacts(BASE), p = M.parking(BASE, facts, 22 * 60);
  assert.ok(p.want > 0 && p.have > 0 && p.short >= 0);
  for (const v of [...p.edgeOcc.values(), ...p.lotOcc.values()]) assert.ok(v >= 0 && v <= 1.5);
});

test('a registered provider replaces the estimates', () => {
  const facts = M.lotFacts(BASE);
  provide('edgeFlow', () => new Map([['a', 0.5]]));
  const t = M.traffic(BASE, facts, 600); assert.equal(t.live, true); assert.equal(t.v.get('a'), 0.5);
  unprovide('edgeFlow'); assert.equal(M.traffic(BASE, facts, 600).live, false);
});

test('comfort and summary produce usable values', () => {
  const facts = M.lotFacts(BASE), s = M.summarize(BASE, facts, 8 * 60);
  assert.ok(s.comfort >= 0 && s.comfort <= 1); assert.ok(s.traffic >= 0);
  assert.ok(s.tripsNow > M.tripsAt(3 * 60));
});
