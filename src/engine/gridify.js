// Gridify: put a real area onto a square tile grid, the way Nexus lays out its towns.
// The grid is turned to match the area's main street direction, so most real streets fall on tile rows and columns.
// Streets become 4-connected road tiles; every lot becomes a record that owns the tiles whose centers fall inside it.
// Pure data: runs in node and in the browser, no THREE.
import { BLD } from './model.js';
import { inPoly } from './core.js';

const TILE = 12; // metres per tile (Nexus labels its tiles 12 m)
const ROAD = { none: 0, street: 1, avenue: 2, freeway: 3 };
const ROAD_OF = { residential: ROAD.street, tertiary: ROAD.street, unknown: ROAD.street, service: ROAD.street, secondary: ROAD.avenue, primary: ROAD.avenue, motorway: ROAD.freeway };
// what a lot becomes on the grid; level is 1 to 5 like a Nexus lot
const KIND_OF = { house: 'home', multi: 'home', apts: 'home', main: 'shop', civic: 'civic', parking: 'parking', vacant: 'empty' };
const CELL = { yard: 0, bld: 1, park: 2 }; // what each tile of a record shows

// Main street direction in [0, 90) degrees, from a length-weighted histogram of segment angles folded onto a quarter turn.
function mainAngle(edges) {
  const bins = new Float64Array(90);
  for (const e of edges) for (let i = 1; i < e.p.length; i++) {
    const dx = e.p[i][0] - e.p[i - 1][0], dz = e.p[i][1] - e.p[i - 1][1], L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const deg = ((Math.atan2(dz, dx) * 180 / Math.PI) % 90 + 90) % 90;
    bins[Math.floor(deg) % 90] += L;
  }
  let best = 0, bestV = -1; // smooth over +-2 degrees, wrapping
  for (let d = 0; d < 90; d++) { let v = 0; for (let k = -2; k <= 2; k++) v += bins[(d + k + 90) % 90]; if (v > bestV) { bestV = v; best = d; } }
  let sum = 0, w = 0; for (let k = -2; k <= 2; k++) { const v = bins[(best + k + 90) % 90]; sum += (best + k) * v; w += v; }
  return (w ? sum / w : best) * Math.PI / 180;
}

function gridify(S, o = {}) {
  const T = o.tile || TILE, graph = [...S.edges.values()].filter((e) => e.g && ROAD_OF[e.c]);
  const th = o.angle ?? mainAngle(graph), cos = Math.cos(th), sin = Math.sin(th);
  // world -> grid frame: rotate by -th about the area's middle
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const l of S.lots.values()) for (const p of l.r) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); }
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const toG = (x, z) => { const dx = x - cx, dz = z - cz; return [dx * cos + dz * sin, -dx * sin + dz * cos]; };
  const toW = (u, v) => [cx + u * cos - v * sin, cz + u * sin + v * cos];
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { const [u, v] = toG(x, z); u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
  const NX = Math.ceil((u1 - u0) / T), NZ = Math.ceil((v1 - v0) / T);
  const tileOfG = (u, v) => [Math.floor((u - u0) / T), Math.floor((v - v0) / T)];
  const centerW = (gx, gz) => toW(u0 + (gx + 0.5) * T, v0 + (gz + 0.5) * T);
  const ok = (gx, gz) => gx >= 0 && gz >= 0 && gx < NX && gz < NZ;
  const idx = (gx, gz) => gz * NX + gx;
  const road = new Uint8Array(NX * NZ), lot = new Int32Array(NX * NZ), cell = new Uint8Array(NX * NZ), names = new Map();

  // ---- streets: sample each polyline, then join consecutive tiles 4-connected ----
  const setRoad = (gx, gz, k, n) => { if (!ok(gx, gz)) return; const i = idx(gx, gz); if (k > road[i]) road[i] = k; if (n && !names.has(i)) names.set(i, n); };
  for (const e of graph) {
    const k = ROAD_OF[e.c]; let prev = null;
    for (let i = 1; i < e.p.length; i++) {
      const a = toG(...e.p[i - 1]), b = toG(...e.p[i]), L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / (T / 4)));
      for (let s = 0; s <= n; s++) {
        const u = a[0] + (b[0] - a[0]) * s / n, v = a[1] + (b[1] - a[1]) * s / n, t = tileOfG(u, v);
        if (prev && (t[0] !== prev[0] || t[1] !== prev[1])) {
          // step one axis at a time, so the road stays 4-connected; take the corner tile nearer the line
          let [px, pz] = prev;
          while (px !== t[0] || pz !== t[1]) {
            const sx = Math.sign(t[0] - px), sz = Math.sign(t[1] - pz);
            if (sx && sz) {
              const cA = [u0 + (px + sx + 0.5) * T, v0 + (pz + 0.5) * T], cB = [u0 + (px + 0.5) * T, v0 + (pz + sz + 0.5) * T];
              const dA = Math.abs((b[0] - a[0]) * (cA[1] - a[1]) - (b[1] - a[1]) * (cA[0] - a[0])), dB = Math.abs((b[0] - a[0]) * (cB[1] - a[1]) - (b[1] - a[1]) * (cB[0] - a[0]));
              if (dA <= dB) px += sx; else pz += sz;
            } else { px += sx; pz += sz; }
            setRoad(px, pz, k, e.n);
          }
        } else setRoad(t[0], t[1], k, e.n);
        prev = t;
      }
    }
  }

  // ---- lots: each lot owns the free tiles whose centers fall inside it ----
  const recs = [], lots = [...S.lots.values()];
  const recOf = new Map();
  const mkRec = (l) => {
    const kind = KIND_OF[l.lt] || 'empty', st = l.st0 || 0;
    const level = kind === 'home' ? (l.lt === 'house' ? (st >= 2 ? 2 : 1) : l.lt === 'multi' ? 2 : Math.min(5, Math.max(3, st))) : kind === 'shop' ? Math.min(5, Math.max(1, st)) : 1;
    const r = { id: l.id, kind, level, tiles: [], lt: l.lt, a: l.a || null, units: l.u0 || 0, z: l.z };
    recs.push(r); recOf.set(l.id, r); return r;
  };
  for (let gz = 0; gz < NZ; gz++) for (let gx = 0; gx < NX; gx++) {
    const i = idx(gx, gz); if (road[i]) continue;
    const [x, z] = centerW(gx, gz);
    for (const l of lots) {
      const bb = l.bb; if (x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3] || !inPoly(x, z, l.r)) continue;
      const r = recOf.get(l.id) || mkRec(l); r.tiles.push(i); lot[i] = recs.indexOf(r) + 1;
      cell[i] = l.b.some((b) => inPoly(x, z, BLD[b].r)) ? CELL.bld : l.pk.some((p) => inPoly(x, z, p)) || l.lt === 'parking' ? CELL.park : CELL.yard;
      break;
    }
  }
  // small lots that missed every tile center take the free tile under their middle, if any
  for (const l of lots) {
    if (recOf.has(l.id)) continue;
    const [gx, gz] = tileOfG(...toG(l.c[0], l.c[1])); if (!ok(gx, gz)) continue;
    const i = idx(gx, gz); if (road[i] || lot[i]) continue;
    const r = mkRec(l); r.tiles.push(i); lot[i] = recs.length; cell[i] = l.b.length ? CELL.bld : CELL.yard;
  }
  for (const r of recs) if (r.tiles.some((i) => cell[i] === CELL.bld) === false && r.kind === 'home') r.kind = 'empty';
  return { NX, NZ, T, angle: th, origin: [cx, cz], u0, v0, road, lot, cell, recs, names, centerW, toG, idx };
}

// Share of road tiles in the largest 4-connected network: a quick sense of whether the streets still join up.
function roadConnectivity(G) {
  const seen = new Uint8Array(G.road.length); let best = 0, total = 0;
  for (let s = 0; s < G.road.length; s++) {
    if (!G.road[s] || seen[s]) continue;
    let n = 0; const st = [s]; seen[s] = 1;
    while (st.length) { const i = st.pop(); n++; const gx = i % G.NX, gz = (i - gx) / G.NX;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = gx + dx, z = gz + dz; if (x < 0 || z < 0 || x >= G.NX || z >= G.NZ) continue; const j = z * G.NX + x; if (G.road[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    total += n; best = Math.max(best, n);
  }
  return total ? best / total : 0;
}

export { CELL, ROAD, TILE, gridify, mainAngle, roadConnectivity };
