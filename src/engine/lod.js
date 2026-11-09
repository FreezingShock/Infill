// Level of detail for big areas. A pack of 8,000 lots cannot hold full-detail meshes for every lot at once
// (about 34 KB of mesh per lot), so detail is built only for the chunks near the camera and edits, and every
// other chunk shows cheap massing: one merged mesh per chunk of plain extruded building footprints and
// parking pads. Pure data and no DOM, so it runs in node tests. The page side is src/app/lod.js.
import { Acc, C, X0, Z0, decal, elev } from './core.js';
import { BLD } from './model.js';

const CH = 110; // chunk size in metres (same grid the lot chunks use)
const chunkKey = (c) => Math.floor((c[0] - X0) / CH) + ',' + Math.floor((c[1] - Z0) / CH);
const chunkCenter = (key) => { const [i, j] = key.split(',').map(Number); return [X0 + (i + 0.5) * CH, Z0 + (j + 0.5) * CH]; };

// which chunks get full detail: those inside the radius around the view centre (a bigger radius to drop than to add,
// so a chunk on the edge does not flicker), plus the chunks that hold edits.
class DetailSet {
  constructor() { this.near = new Set(); this.pinned = new Set(); }
  has(ck) { return this.near.has(ck) || this.pinned.has(ck); }
  radius(dist) { return Math.min(700, Math.max(320, 200 + dist * 0.6)); } // zoomed out: still bounded
  // keys: every chunk key of the area. Returns { added, removed } (chunks that changed state).
  update(target, dist, keys) {
    const R = this.radius(dist), keep = R * 1.35, added = [], removed = [];
    for (const k of keys) {
      const [cx, cz] = chunkCenter(k), d = Math.hypot(cx - target[0], cz - target[1]) - CH * 0.7;
      const on = this.near.has(k);
      if (!on && d < R) { this.near.add(k); added.push(k); }
      else if (on && d > keep) { this.near.delete(k); removed.push(k); }
    }
    return { added, removed };
  }
}

// shared by the page and its workers' callers: on = this area is big enough to need detail streaming
const lod = { on: false };
const DETAIL = new DetailSet();

const WALL = [0xd9cdb6, 0xcdbfa6, 0xd6c3a4, 0xc9c2b4, 0xe0d4be, 0xbfb6a6, 0xd2b8a0];
const ROOF = [0x8a6f5d, 0x9b8774, 0x7d7a74, 0xa48b72, 0x6f6b66];
const BIG = { retail: 0xcfc4b0, commercial: 0xc9c0b2, industrial: 0xb9b2a6, education: 0xd2b78f, civic: 0xcbbfa8 };
const PAD = C(0x77716b);
const hash = (i) => ((i * 2654435761) >>> 0);

// massing arrays per chunk: { p, c } Float32Arrays (non-indexed triangles, the page computes flat normals)
function massingChunks(lots) {
  const by = new Map();
  const acc = (ck) => { let a = by.get(ck); if (!a) by.set(ck, a = new Acc()); return a; };
  const walled = new Set();
  for (const lot of lots.values ? lots.values() : lots) {
    const ck = chunkKey(lot.c), a = acc(ck);
    for (const i of lot.b) {
      if (walled.has(i)) continue; walled.add(i);
      const b = BLD[i]; if (!b || b.t === 'outbuilding' || b.r.length < 3) continue;
      const hsh = hash(i), wall = C(BIG[b.t] ?? WALL[hsh % WALL.length]), roof = C(ROOF[(hsh >> 5) % ROOF.length]);
      const y0 = b.b - 0.5, y1 = b.b + Math.max(2.8, b.h), r = b.r, n = r.length;
      for (let k = 0; k < n; k++) { const p = r[k], q = r[(k + 1) % n]; a.quad([p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y1, q[1]], [p[0], y1, p[1]], wall); }
      const flat = r.map((p) => [p[0], p[1]]);
      decal(a, flat, y1 - elev(flat[0][0], flat[0][1]) + 0.02, roof, 1e9);
    }
    for (const ring of lot.pk || []) if (ring.length >= 3) decal(a, ring, 0.3, PAD, 14);
  }
  const out = new Map();
  for (const [ck, a] of by) if (a.p.length) out.set(ck, { p: Float32Array.from(a.p), c: Float32Array.from(a.c) });
  return out;
}

export { CH, DETAIL, DetailSet, chunkCenter, chunkKey, lod, massingChunks };
