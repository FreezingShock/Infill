// Toasts: the notice kind is read from the copy, the stack lives in src/ui/toasts.js, and no emoji reaches the UI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kindOf } from '../src/ui/toasts.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

test('plain copy is a notice, past-tense results are done, refusals and instructions are holds', () => {
  assert.equal(kindOf('Add a floor on 1 lot'), 'note');
  assert.equal(kindOf('Dream mode: no setbacks, up to 8 storeys, any template on any lot.'), 'note');
  assert.equal(kindOf('Building 300+ lots…'), 'note');
  assert.equal(kindOf('Saved "Corner" (3 lots).'), 'done');
  assert.equal(kindOf('Loaded 12 edits.'), 'done');
  assert.equal(kindOf('Whole block: 9 lots.'), 'done');
  assert.equal(kindOf('Nothing to undo.'), 'warn');
  assert.equal(kindOf('Pick something on the Build palette first.'), 'warn');
  assert.equal(kindOf('Give the group a name first.'), 'warn');
  assert.equal(kindOf("Build doesn't fit this lot: too narrow."), 'warn');
  assert.equal(kindOf('That file is not a Renovated save.'), 'warn');
});

test('an explicit kind wins over the copy', () => {
  assert.equal(kindOf('Nothing to undo.', { kind: 'note' }), 'warn');
});

test('the toast module and the notify styles stay emoji-free and the state module imports the stack', () => {
  const mod = read('src/ui/toasts.js');
  assert.doesNotMatch(mod, /\p{Extended_Pictographic}/u);
  assert.match(read('src/camino/notify.css'), /\.tn-row/);
  const state = read('src/app/state.js');
  assert.match(state, /import \{ toast \} from '\.\.\/ui\/toasts\.js';/);
  assert.doesNotMatch(state, /function toast\(/);
});
