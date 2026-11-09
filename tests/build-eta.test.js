// Build ETA: first guesses grow with area, learn from past builds, and shrink as stages finish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STAGE_IDS, clock, etaNow, km2Of, predictStages, recordRun, say } from '../src/areas/eta.js';

const total = (p) => p.reduce((a, b) => a + b.sec, 0);

test('a bigger area is predicted to take longer', () => {
  assert.ok(total(predictStages(4)) > total(predictStages(1)));
  assert.equal(predictStages(1).length, STAGE_IDS.length);
});

test('past builds scale the prediction toward what this computer did', () => {
  const slow = recordRun([], { km2: 1.44, stages: Object.fromEntries(predictStages(1.44).map((p) => [p.id, p.sec * 2])) });
  const a = total(predictStages(1.44)), b = total(predictStages(1.44, slow));
  assert.ok(Math.abs(b / a - 2) < 0.05, `${b} vs ${a}`);
  assert.equal(recordRun(Array(20).fill({ km2: 1, stages: { data: 3 } }), { km2: 1, stages: { data: 3 } }).length, 8);
  assert.deepEqual(recordRun([], { km2: 0, stages: { data: 3 } }), []);
});

test('the ETA falls as stages finish and speeds up or slows down with the real pace', () => {
  const pred = predictStages(1.44), t0 = total(pred);
  const start = etaNow({ pred, cur: 0 });
  assert.ok(Math.abs(start - t0) < t0 * 0.2);
  const done = { data: pred[0].sec, streets: pred[1].sec };
  const mid = etaNow({ pred, done, cur: 2, inStage: 0, elapsed: done.data + done.streets, pct: 0 });
  assert.ok(mid < start);
  const slowDone = { data: pred[0].sec * 3, streets: pred[1].sec * 3 };
  assert.ok(etaNow({ pred, done: slowDone, cur: 2 }) > mid);
  assert.ok(etaNow({ pred, done, cur: 5, inStage: 999, pct: 100, elapsed: 40 }) < 2);
  assert.ok(etaNow({ pred, cur: 5, inStage: 999 }) >= 0);
});

test('the builder percent pulls the estimate toward elapsed pace', () => {
  const pred = predictStages(1.44);
  const slow = etaNow({ pred, cur: 2, elapsed: 200, pct: 50 }), plain = etaNow({ pred, cur: 2, elapsed: 20, pct: 50 });
  assert.ok(slow > plain);
});

test('wording and clocks', () => {
  assert.equal(say(42), 'about 40 sec'); assert.equal(say(80), 'about 1 min 20 sec'); assert.equal(say(120), 'about 2 min');
  assert.equal(clock(65), '1:05'); assert.ok(km2Of(1200, 1200) > 1.4);
});

test('the stage ids match build_area.py', () => {
  const py = fs.readFileSync(new URL('../tools/pack/build_area.py', import.meta.url), 'utf8');
  for (const id of STAGE_IDS) assert.ok(py.includes(`('${id}',`), id);
});
