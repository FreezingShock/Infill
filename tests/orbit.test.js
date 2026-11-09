import test from 'node:test';
import assert from 'node:assert/strict';
import { FOV, MAX_DIST, fitOrbit } from '../src/app/camera.js';

test('orbit framing is centred and fits the area', () => {
  const f = fitOrbit([-300, -200, 500, 400], 16 / 9);
  assert.equal(f.cx, 100); assert.equal(f.cz, 100);
  assert.ok(f.dist > f.r && f.dist <= MAX_DIST);
});
test('bigger areas and narrower screens sit farther back', () => {
  const small = fitOrbit([0, 0, 400, 400], 16 / 9), big = fitOrbit([0, 0, 800, 800], 16 / 9), tall = fitOrbit([0, 0, 400, 400], 0.5);
  assert.ok(big.dist > small.dist); assert.ok(tall.dist > small.dist);
  assert.ok(FOV > 0);
});
