import test from 'node:test';
import assert from 'node:assert/strict';
import { lightAt } from '../src/views/light.js';
import { gradeFor } from '../src/camino/palette.js';

test('grade is muted by day and cooler and dimmer at night', () => {
  const d = gradeFor(lightAt(13)), n = gradeFor(lightAt(23));
  assert.ok(d.sat < 1 && d.sat > 0.85 && d.tint.every((v) => v <= 1));
  assert.ok(n.sat < d.sat && n.tint[2] > n.tint[0] && n.mark < d.mark);
});

test('grade changes smoothly through the day', () => {
  let prev = gradeFor(lightAt(0));
  for (let h = 0.1; h <= 24; h += 0.1) {
    const g = gradeFor(lightAt(h));
    assert.ok(Math.abs(g.sat - prev.sat) < 0.08 && g.tint.every((v, i) => Math.abs(v - prev.tint[i]) < 0.12), `hour ${h.toFixed(1)}`);
    prev = g;
  }
});
