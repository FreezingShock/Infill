import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchRows } from '../src/camino/cmdmatch.js';

const ROWS = [
  { g: 'Views', t: 'As-built view', w: 'original before today' },
  { g: 'Views', t: 'Lot lines', w: 'outline parcels' },
  { g: 'Tools', t: 'Bulldoze', w: 'tool demolish remove' },
  { g: 'Areas', t: 'Go to Reseda', sub: 'area', w: 'Reseda area switch load' },
];

test('an empty query keeps every row in its original order', () => {
  assert.deepEqual(matchRows(ROWS, ''), ROWS);
  assert.deepEqual(matchRows(ROWS, '   '), ROWS);
  assert.notEqual(matchRows(ROWS, ''), ROWS, 'returns a copy, not the same array');
});

test('every word of the query has to match, ignoring case', () => {
  assert.deepEqual(matchRows(ROWS, 'AS BUILT').map((r) => r.t), ['As-built view']);
  assert.deepEqual(matchRows(ROWS, 'built demolish'), []);
});

test('search words, the group name and the sub line all count', () => {
  assert.deepEqual(matchRows(ROWS, 'demolish').map((r) => r.t), ['Bulldoze']);
  assert.deepEqual(matchRows(ROWS, 'tools').map((r) => r.t), ['Bulldoze']);
  assert.deepEqual(matchRows(ROWS, 'reseda').map((r) => r.t), ['Go to Reseda']);
});

test('matches keep their order, so groups stay together', () => {
  assert.deepEqual(matchRows(ROWS, 'a').map((r) => r.t), ['As-built view', 'Lot lines', 'Go to Reseda']);
});
