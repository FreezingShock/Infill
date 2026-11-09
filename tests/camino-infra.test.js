// Builds the Camino real-infrastructure meshes for the default area in plain node (no WebGL needed).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const man = JSON.parse(fs.readFileSync(new URL('../public/areas/index.json', import.meta.url)));
const area = man.areas.find((a) => a.id === 'canoga-park' && a.pack && a.infra) || man.areas.find((a) => a.pack && a.infra);
globalThis.__RENOVATED_PACK__ ??= JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.pack}`, import.meta.url)));

test('infra layer builds poles, hydrants, towers and wires, and swaps to scan colours', async () => {
  const { layoutInfra } = await import('../src/camino/infra-data.js');
  const { buildInfra } = await import('../src/camino/infra.js');
  const D = JSON.parse(fs.readFileSync(new URL(`../public/areas/${area.infra}`, import.meta.url)));
  const I = layoutInfra(D, []);
  const L = buildInfra(I);
  const kids = L.group.children;
  assert.ok(kids.length >= 6);
  const hyd = kids[2]; assert.equal(hyd.count, I.hydrants.length);
  const wires = kids.find((o) => o.isLineSegments); assert.ok(wires.geometry.getAttribute('position').count > 0 || !I.trans.length);
  L.setGlow(1); L.setScan(true); assert.equal(hyd.material, hyd.userData.scanMat); L.setScan(false); assert.notEqual(hyd.material, hyd.userData.scanMat);
});
