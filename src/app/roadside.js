import { elev } from '../engine/core.js';
import { spanAt, spansOf } from '../tools/roads/deck.js';

// =====================================================================
// What grows beside a freeway: not a row of street trees but the land the road cut through. Groves and openings come
// from smooth noise, the kind of tree from a second, wider noise (eucalyptus stands, oak and sycamore, dry scrub with
// the odd cypress), and the cover is thicker on steep ground and thins out away from the barrier. One rule for every
// motorway-class road and ramp in every area; the road builder passes in what must stay clear (pavement, lots).
// Returns trees as [x, y, z, scale, kind, colour index] like the other tree lists (kinds: 0 round, 1 cone, 2 tall, 3 shrub).
// =====================================================================
const NAT = { olive: 8, sage: 9, grey: 10, gold: 11, oak: 12, pale: 13 }; // extra entries of scene.js TREE_COLS
const hash = (x, z) => { let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
function noise(x, z) {
  const i = Math.floor(x), j = Math.floor(z), fx = sm(x - i), fz = sm(z - j);
  return (hash(i, j) * (1 - fx) + hash(i + 1, j) * fx) * (1 - fz) + (hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx) * fz;
}
const isFreeway = (e) => e.c === 'motorway' || e.c === 'trunk';

function freewayTrees(edges, rowOf, blocked, cap = 2600) {
  const out = [];
  for (const e of edges) {
    if (!e.g || !isFreeway(e) || !e.p || e.p.length < 2) continue;
    const link = e.s === 'link', half = rowOf(e) / 2, spans = spansOf(e), reach = link ? 22 : 48;
    let s = 0, k = 0;
    for (let i = 1; i < e.p.length; i++) {
      const ax = e.p[i - 1][0], az = e.p[i - 1][1], dx = e.p[i][0] - ax, dz = e.p[i][1] - az, L = Math.hypot(dx, dz); if (L < 1e-6) continue;
      const tx = dx / L, tz = dz / L, nx = -tz, nz = tx;
      for (let u = 0; u < L; u += 4.5, s += 4.5, k++) {
        for (const side of [-1, 1]) {
          const r1 = hash(k * 2 + (side > 0 ? 1 : 0), Math.round(ax * 3 + az)), r2 = hash(Math.round(ax + u * tx) * 7 + side, Math.round(az + u * tz) * 5), r3 = hash(k * 13 + side, 77);
          const d = 2.2 + (-Math.log(1 - r1 * 0.97)) * (link ? 6 : 13) % reach; // thick near the barrier, thinning with distance
          const off = side * (half + d), x = ax + tx * (u + (r2 - 0.5) * 4) + nx * off, z = az + tz * (u + (r2 - 0.5) * 4) + nz * off;
          const dk = spans && spanAt(spans, s); if (dk && dk.L !== 0) continue; // on or under a bridge or tunnel the ground is cut away
          const cover = noise(x / 24 + 7, z / 24) * 0.65 + noise(x / 9, z / 9) * 0.35, y = elev(x, z);
          const slope = (Math.abs(elev(x + 4, z) - elev(x - 4, z)) + Math.abs(elev(x, z + 4) - elev(x, z - 4))) / 8;
          const need = 0.4 + 0.22 * Math.min(1, d / reach) - Math.min(0.14, slope * 0.5); // steeper ground carries more cover
          if (cover < need || blocked(x, z)) continue;
          const stand = noise(x / 70 + 31, z / 70 + 5);
          let kind, sc, col;
          if (stand < 0.32) { kind = 2; sc = 0.95 + r3 * 0.55; col = r2 < 0.5 ? NAT.grey : NAT.olive; } // eucalyptus stand
          else if (stand < 0.68) { kind = r3 < 0.18 ? 1 : 0; sc = 0.9 + r3 * 0.9; col = r2 < 0.34 ? NAT.oak : r2 < 0.7 ? NAT.olive : NAT.sage; } // oak, sycamore, a few cypress
          else { kind = r3 < 0.7 ? 3 : r3 < 0.85 ? 1 : 0; sc = kind === 3 ? 1.1 + r2 * 1.1 : 0.8 + r2 * 0.6; col = kind === 3 ? (r2 < 0.5 ? NAT.gold : NAT.pale) : NAT.sage; } // dry scrub on the slopes
          out.push([x, y, z, sc, kind, col]);
          if (kind !== 3 && r2 < 0.3 && d < 14 && !blocked(x + 2.2, z)) out.push([x + 2.2, elev(x + 2.2, z), z + 1, 0.8 + r1 * 0.7, 3, r1 < 0.5 ? NAT.gold : NAT.sage]); // shrub understory
        }
      }
    }
    if (out.length > cap * 3) break;
  }
  if (out.length <= cap) return out;
  const step = out.length / cap, thin = []; for (let i = 0; i < out.length; i += step) thin.push(out[Math.floor(i)]); return thin;
}

export { freewayTrees };
