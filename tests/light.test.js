import test from 'node:test';
import assert from 'node:assert/strict';
import { lightAt } from '../src/views/light.js';
import { clock, fmtHour, setHour, tickClock } from '../src/game/clock.js';
import { distForZoom, fogRange, nearFar, zoomForDist } from '../src/app/camera.js';

test('noon is bright and night is dark', () => {
  const noon = lightAt(13), night = lightAt(23);
  assert.ok(noon.sunI > 1.8 && noon.hemiI > 1.0 && !noon.isNight);
  assert.ok(night.sunI < 0.6 && night.hemiI < 0.5 && night.isNight);
  assert.ok(night.glow > 0.9 && noon.glow < 0.05);
});

test('sun always points up so shadows stay finite, and moves east to west', () => {
  for (let h = 0; h < 24; h += 0.5) assert.ok(lightAt(h).dir[1] > 0.1, `hour ${h}`);
  assert.ok(lightAt(8).dir[0] < lightAt(17).dir[0]);
});

test('light wraps around midnight', () => {
  assert.deepEqual(lightAt(-1).dir, lightAt(23).dir);
});

test('clock ticks, wraps and formats', () => {
  setHour(23.5); clock.speed = 1; tickClock(1); clock.speed = 0;
  assert.equal(fmtHour(clock.hour), '00:30');
  assert.equal(tickClock(1), false);
});

test('camera zoom and distance round-trip, clip planes follow distance', () => {
  assert.ok(Math.abs(zoomForDist(distForZoom(3)) - 3) < 1e-9);
  const close = nearFar(40, 1), far = nearFar(1200, 1);
  assert.ok(close.near < far.near && close.far < far.far);
  assert.ok(fogRange(400, 1.4).near < fogRange(400, 0.3).near);
});

test('sky has the sun up by day and the moon up by night', () => {
  assert.ok(lightAt(13).skyDir[1] > 0.5);
  assert.ok(lightAt(23).skyDir[1] < 0 && lightAt(23).moonDir[1] > 0.2);
  assert.ok(lightAt(19.2).golden > 0.5 && lightAt(13).golden < 0.1);
});
