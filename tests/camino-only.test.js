// Guard: the classic paper look is gone for good. Camino is the only look, so no theme switch,
// cream stylesheet, or toon-only material path should come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const sources = [...walk('src'), 'index.html'].filter((f) => /\.(js|css|html)$/.test(f));

test('no classic paper theme switch or stylesheet is left', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'src/styles/nexus.css')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/camino/theme.js')), false);
  assert.equal(fs.existsSync(path.join(ROOT, 'src/views/sky.js')), false);
  for (const f of sources) {
    const s = read(f);
    assert.doesNotMatch(s, /\?theme=nexus|'nexus'|"nexus"|setTheme\(|renovated\.theme|Classic paper/, f);
    assert.doesNotMatch(s, /MeshToonMaterial|gradientMap|Fraunces|Capriola/, f);
    assert.doesNotMatch(s, /camino\/theme\.js|views\/sky\.js|nexus\.css/, f);
  }
});

test('the page is Camino from the first paint', () => {
  const html = read('index.html');
  assert.match(html, /<html lang="en" data-theme="camino">/);
  assert.match(html, /href="\/src\/styles\/base\.css"/);
  assert.doesNotMatch(html, /data-theme=camino\]/); // the boot variant used to hide these rules
});
