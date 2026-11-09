// Real infrastructure sidecars (tools/pack/infra.py): every area that names one has a well-formed file in pack coordinates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const dir = new URL('../public/areas/', import.meta.url);
const index = JSON.parse(fs.readFileSync(new URL('index.json', dir)));
const withInfra = index.areas.filter((a) => a.infra);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

test('areas with packs list an infra sidecar', () => {
  assert.ok(withInfra.length >= 1);
  for (const a of withInfra) assert.ok(fs.existsSync(new URL(a.infra, dir)), `${a.id}: ${a.infra} missing`);
});

for (const a of withInfra) {
  test(`${a.id}: infra layers are real-sourced and inside the area`, () => {
    const I = JSON.parse(fs.readFileSync(new URL(a.infra, dir)));
    const P = JSON.parse(fs.readFileSync(new URL(a.pack, dir)));
    assert.equal(I.v, 1);
    assert.ok(I.sources.length >= 5 && I.sources.every((s) => s.name && s.layer));
    const kx = Math.cos((P.origin[1] * Math.PI) / 180) * 111320, span = Math.max((a.bbox[2] - a.bbox[0]) * kx, (a.bbox[3] - a.bbox[1]) * 110540);
    const near = (x, z, m) => Math.abs(x) < span + m && Math.abs(z) < span + m;
    for (const l of I.lights) { assert.equal(l.length, 5); assert.ok(num(l[0]) && num(l[1]) && near(l[0], l[1], 100)); }
    for (const h of I.hydrants) { assert.ok(num(h[0]) && num(h[1]) && near(h[0], h[1], 100) && typeof h[2] === 'string'); }
    for (const s of I.stops) { assert.ok(num(s[0]) && near(s[0], s[1], 100) && typeof s[2] === 'string' && Array.isArray(s[3]) && num(s[4])); }
    for (const t of I.transmission) { assert.ok(t.p.length >= 4 && t.p.length % 2 === 0 && t.p.every(num)); }
    for (const l of I.power.lines) { assert.ok(['power_line', 'minor_line', 'cable'].includes(l.k) && l.p.length >= 4); }
    for (const p of I.power.pts) { assert.ok(typeof p[0] === 'string' && num(p[1]) && num(p[2])); }
  });
}
