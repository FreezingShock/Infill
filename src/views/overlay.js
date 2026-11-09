// Draws the active info view as coloured ribbons on streets and coloured decals on lots.
// Geometry is built once per edit; colours are rewritten in place as the clock moves (cheap).
import * as THREE from 'three';
import { Acc, C, decal, ribbon } from '../engine/core.js';
import { rowWidth } from '../engine/model.js';

// ramps: arrays of [t, hex]; t is 0..1
export const RAMPS = {
  traffic: [[0, 0x6fae5a], [0.45, 0xe3c34a], [0.75, 0xe0833a], [1, 0xc9402f]],
  parking: [[0, 0x79a7c9], [0.5, 0x8fbf74], [0.85, 0xe3c34a], [1, 0xc9402f]],
  comfort: [[0, 0xc9402f], [0.4, 0xe3c34a], [0.7, 0x9fc27a], [1, 0x4f9a5a]],
};
const tmp = new THREE.Color(), tmp2 = new THREE.Color();
export function rampColor(ramp, t, out = new THREE.Color()) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 1; i < ramp.length; i++) if (t <= ramp[i][0]) { const [t0, c0] = ramp[i - 1], [t1, c1] = ramp[i]; return out.setHex(c0).lerp(tmp2.setHex(c1), (t - t0) / (t1 - t0 || 1)); }
  return out.setHex(ramp[ramp.length - 1][1]);
}

// A layer is one mesh made of many small shapes; each shape owns a vertex range so it can be recoloured alone.
export class Layer {
  constructor() { this.acc = new Acc(); this.ranges = new Map(); this.mesh = null; }
  add(key, build) { const start = this.acc.p.length / 3; build(this.acc); this.ranges.set(key, [start, this.acc.p.length / 3 - start]); }
  finish(opacity, order) {
    const geo = this.acc.geo(); geo.getAttribute('color').setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -10 }));
    this.mesh.renderOrder = order; this.mesh.frustumCulled = false; return this.mesh;
  }
  paint(key, hex) {
    const r = this.ranges.get(key); if (!r || !this.mesh) return;
    tmp.set(hex); const a = this.mesh.geometry.getAttribute('color');
    for (let i = r[0]; i < r[0] + r[1]; i++) a.setXYZ(i, tmp.r, tmp.g, tmp.b);
    this.dirty = true;
  }
  paintRamp(key, ramp, t) { const r = this.ranges.get(key); if (!r || !this.mesh) return; rampColor(ramp, t, tmp); const a = this.mesh.geometry.getAttribute('color'); for (let i = r[0]; i < r[0] + r[1]; i++) a.setXYZ(i, tmp.r, tmp.g, tmp.b); this.dirty = true; }
  flush() { if (this.dirty && this.mesh) { this.mesh.geometry.getAttribute('color').needsUpdate = true; this.dirty = false; } }
}

export function streetLayer(S, which = (e) => e.g && e.c !== 'motorway' && e.s !== 'driveway') {
  const L = new Layer(), black = C(0x000000);
  for (const e of S.edges.values()) if (which(e)) L.add(e.id, (acc) => { const h = Math.max(rowWidth(e.prof) / 2, 3); ribbon(acc, e.p, -h, h, 1.0, black, 3); });
  return L;
}
export function lotLayer(S, filter = () => true) {
  const L = new Layer(), black = C(0x000000);
  for (const lot of S.lots.values()) if (filter(lot)) L.add(lot.id, (acc) => decal(acc, lot.r, 0.9, black, 14));
  return L;
}
