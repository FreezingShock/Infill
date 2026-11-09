// Packs generated lots into one Float32Array so a worker can hand a whole batch back with a single transfer,
// and unpacks it into the same shape genLot returns (typed-array views instead of plain arrays).
// Pure: no engine, THREE or DOM imports, so it runs the same in a worker, the page and node tests.

const KEYS = ['s', 'g', 'd']; // solid, glass, ground meshes
const FIELDS = ['p', 'c', 'l', 'n']; // positions, colours, ink lines, normals

// flat per-triangle normals, the same numbers THREE's computeVertexNormals gives a non-indexed mesh
function faceNormals(p) {
  const n = new Float32Array(p.length);
  for (let i = 0; i + 8 < p.length; i += 9) {
    const ax = p[i], ay = p[i + 1], az = p[i + 2];
    const ux = p[i + 3] - ax, uy = p[i + 4] - ay, uz = p[i + 5] - az, vx = p[i + 6] - ax, vy = p[i + 7] - ay, vz = p[i + 8] - az;
    let x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx;
    const len = Math.hypot(x, y, z) || 1; x /= len; y /= len; z /= len;
    for (let k = 0; k < 9; k += 3) { n[i + k] = x; n[i + k + 1] = y; n[i + k + 2] = z; }
  }
  return n;
}

// items: [{ h, g }] with g as genLot returns it. Returns { buf, metas } (buf is transferable).
function encodeBatch(items) {
  let total = 0;
  const arrays = items.map(({ g }) => KEYS.map((k) => {
    const a = g[k], p = Float32Array.from(a.p);
    return { p, c: Float32Array.from(a.c), l: Float32Array.from(a.l), n: faceNormals(p) };
  }));
  for (const a of arrays) for (const m of a) for (const f of FIELDS) total += m[f].length;
  const buf = new Float32Array(total), metas = [];
  let o = 0;
  items.forEach(({ h, g }, i) => {
    const spans = [];
    for (const m of arrays[i]) for (const f of FIELDS) { buf.set(m[f], o); spans.push(o, m[f].length); o += m[f].length; }
    metas.push({ h, spans, trees: g.trees, cars: g.cars, units: g.units, floor: g.floor, cost: g.cost, park: g.park, stalls: g.stalls, warn: g.warn, ok: g.ok });
  });
  return { buf, metas };
}

function decodeLot(buf, meta) {
  const g = { h: meta.h, trees: meta.trees, cars: meta.cars, units: meta.units, floor: meta.floor, cost: meta.cost, park: meta.park, stalls: meta.stalls, warn: meta.warn, ok: meta.ok };
  let s = 0;
  for (const k of KEYS) {
    g[k] = {};
    for (const f of FIELDS) { const off = meta.spans[s++], len = meta.spans[s++]; g[k][f] = buf.subarray(off, off + len); }
  }
  return g;
}
const decodeBatch = (buf, metas) => metas.map((m) => decodeLot(buf, m));

export { decodeBatch, decodeLot, encodeBatch, faceNormals };
