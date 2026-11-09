// Small 2D helpers for the traffic sim. Pure functions, no THREE, no pack: safe inside a worker.
// World axes: x east, z south. "Right of travel" for direction (dx, dz) is (-dz, dx).

function normals(P) {
  const n = P.length, N = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    N.push([-dz / L, dx / L]);
  }
  return N;
}
function offsetLine(p, o) { const N = normals(p); return p.map((q, i) => [q[0] + N[i][0] * o, q[1] + N[i][1] * o]); }
function cumLen(p) { const c = [0]; for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1])); return c; }

// Cut d0 metres off the start and d1 off the end of a polyline.
function trimLine(p, d0, d1) {
  const c = cumLen(p), L = c[c.length - 1];
  if (L < 0.5) return p.slice();
  const a = Math.min(Math.max(d0, 0), L * 0.45), b = L - Math.min(Math.max(d1, 0), L * 0.45);
  const at = (d) => { let i = 1; while (i < c.length - 1 && c[i] < d) i++; const t = (d - c[i - 1]) / ((c[i] - c[i - 1]) || 1); return [p[i - 1][0] + (p[i][0] - p[i - 1][0]) * t, p[i - 1][1] + (p[i][1] - p[i - 1][1]) * t]; };
  const out = [at(a)];
  for (let i = 1; i < p.length - 1; i++) if (c[i] > a + 0.01 && c[i] < b - 0.01) out.push(p[i]);
  out.push(at(b));
  return out;
}

// Position and unit direction at distance s along a polyline (cum = cumLen(p)).
function sampleAt(p, cum, s) {
  const n = p.length;
  if (s <= 0) { const d = dirOf(p, 0); return [p[0][0], p[0][1], d[0], d[1]]; }
  if (s >= cum[n - 1]) { const d = dirOf(p, n - 2); return [p[n - 1][0], p[n - 1][1], d[0], d[1]]; }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= s) lo = m; else hi = m; }
  const t = (s - cum[lo]) / ((cum[hi] - cum[lo]) || 1), d = dirOf(p, lo);
  return [p[lo][0] + (p[hi][0] - p[lo][0]) * t, p[lo][1] + (p[hi][1] - p[lo][1]) * t, d[0], d[1]];
}
function dirOf(p, i) { const a = p[i], b = p[i + 1], dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1; return [dx / L, dz / L]; }

function bezier(p0, c, p1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * p0[0] + 2 * u * t * c[0] + t * t * p1[0], u * u * p0[1] + 2 * u * t * c[1] + t * t * p1[1]]); }
  return out;
}
function cubic(p0, c0, c1, p1, n = 14) {
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push([u * u * u * p0[0] + 3 * u * u * t * c0[0] + 3 * u * t * t * c1[0] + t * t * t * p1[0], u * u * u * p0[1] + 3 * u * u * t * c0[1] + 3 * u * t * t * c1[1] + t * t * t * p1[1]]); }
  return out;
}
function segCross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]], den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den, u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  return t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98;
}
function pathsCross(A, B) {
  for (let i = 0; i < A.length - 1; i++) for (let j = 0; j < B.length - 1; j++) if (segCross(A[i], A[i + 1], B[j], B[j + 1])) return true;
  return false;
}
// Seeded random, same generator as the engine (copied so the sim has no engine imports).
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export { bezier, cubic, cumLen, offsetLine, pathsCross, rng, sampleAt, trimLine };
