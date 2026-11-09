// Detail streaming for big areas (page side of src/engine/lod.js). Areas with more than BIG_LOTS lots keep full-detail
// meshes only for the chunks near the camera and any chunk with edits. Everything else shows massing (one merged mesh of
// plain extruded buildings per chunk) and keeps just the numbers the scores need. Small areas run exactly as before.
import * as THREE from 'three';
import { BASE } from '../engine/commands.js';
import { AREA } from '../engine/pack.js';
import { DETAIL, chunkKey, lod, massingChunks } from '../engine/lod.js';
import { prewarm } from '../workers/warm.js';
import { MAT } from './render.js';

const BIG_LOTS = 2500;
const keys = [], keySet = new Set(), masses = new Map();
let group = null, last = null, lastDist = 0, busy = false, again = false, refs = null;

function massGroup() {
  const g = new THREE.Group(); g.name = 'massing';
  for (const [ck, a] of massingChunks(BASE.lots)) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(a.p, 3)); geo.setAttribute('color', new THREE.BufferAttribute(a.c, 3)); geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, MAT.solid); m.receiveShadow = true; m.matrixAutoUpdate = false;
    masses.set(ck, m); g.add(m);
  }
  return g;
}
// massing shows wherever the world has no detailed chunk of its own
function showMassing() { for (const [ck, m] of masses) m.visible = !refs.world.chunks.has(ck); }

// Call once, before the first lot build. Returns whether detail streaming is on for this area.
function initLod({ scene, world, beforeW, getState, target, dist }) {
  const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
  lod.on = q.has('lod') ? q.get('lod') !== '0' : BASE.lots.size > BIG_LOTS;
  if (!lod.on) return false;
  refs = { world, beforeW, getState };
  for (const l of BASE.lots.values()) { const k = chunkKey(l.c); if (!keySet.has(k)) { keySet.add(k); keys.push(k); } }
  const start = target || (() => { const l = [...BASE.lots.values()].find((x) => (x.a || '').includes(AREA.main)) || BASE.lots.values().next().value; return [l.c[0], l.c[1]]; })();
  DETAIL.update(start, dist || 700, keys);
  last = start; lastDist = dist || 700;
  group = massGroup(); scene.add(group); showMassing();
  return true;
}

async function settle() {
  if (busy) { again = true; return; }
  busy = true;
  try {
    do {
      again = false;
      await prewarm(refs.getState(), true); // meshes for the newly near lots, on the worker pool
      refs.world.sync(refs.getState());
      if (refs.beforeW.synced) refs.beforeW.sync(BASE);
      showMassing();
    } while (again);
  } catch (e) { console.warn('detail streaming failed', e); } finally { busy = false; }
}

// Per frame: cheap until the view has moved or zoomed enough to change which chunks are near.
function lodTick(t, dist) {
  if (!lod.on || !refs) return;
  const moved = Math.hypot(t.x - last[0], t.z - last[1]), dd = Math.abs(dist - lastDist) / lastDist;
  if (moved < 30 && dd < 0.15) return;
  last = [t.x, t.z]; lastDist = dist;
  const { added, removed } = DETAIL.update(last, dist, keys);
  if (added.length || removed.length) settle();
}

export { initLod, lodTick };
