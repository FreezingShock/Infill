import * as THREE from 'three';
import PC from 'polygon-clipping';
import { PACK } from './pack.js';

const $ = (id) => document.getElementById(id);
const reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const FT = 3.2808;

// ---------- seeded random ----------
function hash32(str) { let h = 2166136261 >>> 0; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

// ---------- terrain sampling (same bilinear rule as the pack builder) ----------
const T = PACK.terrain;
const HG = Float32Array.from(T.h, (v) => v / 10);
function elev(x, z) {
  const fx = (x - T.minx) / T.cell, fz = (z - T.minz) / T.cell;
  const i = Math.min(Math.max(Math.floor(fx), 0), T.nx - 2), j = Math.min(Math.max(Math.floor(fz), 0), T.nz - 2);
  const dx = Math.min(Math.max(fx - i, 0), 1), dz = Math.min(Math.max(fz - j, 0), 1);
  const a = HG[j * T.nx + i], b = HG[j * T.nx + i + 1], c = HG[(j + 1) * T.nx + i], d = HG[(j + 1) * T.nx + i + 1];
  return a * (1 - dx) * (1 - dz) + b * dx * (1 - dz) + c * (1 - dx) * dz + d * dx * dz;
}
const X0 = T.minx, Z0 = T.minz, X1 = T.minx + (T.nx - 1) * T.cell, Z1 = T.minz + (T.nz - 1) * T.cell;

const C = (hex) => new THREE.Color(hex);

// ---------- geometry accumulator ----------
// Triangles carry a hint direction (roughly outward) so winding and normals are always right,
// whatever handedness the lot's local frame has.
class Acc {
  constructor() { this.p = []; this.c = []; this.l = []; }
  tri(a, b, c, col, hint) {
    if (hint) {
      const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (nx * hint[0] + ny * hint[1] + nz * hint[2] < 0) { const t = b; b = c; c = t; }
    }
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let k = 0; k < 3; k++) this.c.push(col.r, col.g, col.b);
  }
  quad(a, b, c, d, col, hint) { this.tri(a, b, c, col, hint); this.tri(a, c, d, col, hint); }
  line(a, b) { this.l.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
  geo() { return toGeo(this.p, this.c); }
}
function toGeo(p, c) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  g.computeVertexNormals(); return g;
}
function lineGeo(l) { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(l, 3)); return g; }
function disposeTree(o) { o.traverse((m) => { if (m.geometry) m.geometry.dispose(); }); }
function densify(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [x0, z0] = pts[i - 1], [x1, z1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, z1 - z0) / step));
    for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, z0 + (z1 - z0) * k / n]);
  }
  return out;
}
function normals(P) {
  const n = P.length, N = [];
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(i - 1, 0)], b = P[Math.min(i + 1, n - 1)];
    const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1;
    N.push([-dz / L, dx / L]);
  }
  return N;
}
const UP = [0, 1, 0];
function ribbon(acc, pts, o1, o2, y, col, step = 4) {
  if (pts.length < 2) return;
  const P = densify(pts, step), N = normals(P);
  const v = (i, o) => { const x = P[i][0] + N[i][0] * o, z = P[i][1] + N[i][1] * o; return [x, elev(x, z) + y, z]; };
  for (let i = 0; i < P.length - 1; i++) acc.quad(v(i, o1), v(i, o2), v(i + 1, o2), v(i + 1, o1), col, UP);
}
function dashed(acc, pts, o1, o2, y, col, dash, gap) {
  if (pts.length < 2) return;
  const P = densify(pts, 0.5), N = normals(P);
  let d = 0;
  const v = (i, o) => { const x = P[i][0] + N[i][0] * o, z = P[i][1] + N[i][1] * o; return [x, elev(x, z) + y, z]; };
  for (let i = 0; i < P.length - 1; i++) {
    const L = Math.hypot(P[i + 1][0] - P[i][0], P[i + 1][1] - P[i][1]);
    if ((d % (dash + gap)) < dash) acc.quad(v(i, o1), v(i, o2), v(i + 1, o2), v(i + 1, o1), col, UP);
    d += L;
  }
}
function polyLen(p) { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; }
function alongPts(p, step, cb) { // calls cb(x, z, dirx, dirz) every `step` metres
  let acc = step / 2;
  for (let i = 1; i < p.length; i++) {
    const [x0, z0] = p[i - 1], [x1, z1] = p[i], L = Math.hypot(x1 - x0, z1 - z0); if (L < 1e-6) continue;
    while (acc <= L) { const t = acc / L; cb(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, (x1 - x0) / L, (z1 - z0) / L); acc += step; }
    acc -= L;
  }
}
function offsetLine(p, o) { const N = normals(p); return p.map((q, i) => [q[0] + N[i][0] * o, q[1] + N[i][1] * o]); }

// ---------- 2D polygon helpers ----------
function area(r) { let a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }
function centroid(r) { let x = 0, z = 0, a = 0; for (let i = 0, n = r.length; i < n; i++) { const p = r[i], q = r[(i + 1) % n], k = p[0] * q[1] - q[0] * p[1]; a += k; x += (p[0] + q[0]) * k; z += (p[1] + q[1]) * k; } if (Math.abs(a) < 1e-9) return r[0].slice(); return [x / (3 * a), z / (3 * a)]; }
function inPoly(x, z, r) {
  let ins = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i], [xj, zj] = r[j];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) ins = !ins;
  }
  return ins;
}
function bbox(r) { let a = 1e9, b = 1e9, c = -1e9, d = -1e9; for (const [x, z] of r) { if (x < a) a = x; if (z < b) b = z; if (x > c) c = x; if (z > d) d = z; } return [a, b, c, d]; }
function segDist2(px, pz, ax, az, bx, bz) { const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz; let t = L ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const x = ax + dx * t - px, z = az + dz * t - pz; return x * x + z * z; }
function nearestOnLine(p, x, z) { let best = 1e18, bx = p[0][0], bz = p[0][1], bi = 0, bt = 0; for (let i = 1; i < p.length; i++) { const [ax, az] = p[i - 1], [cx, cz] = p[i], dx = cx - ax, dz = cz - az, L = dx * dx + dz * dz; let t = L ? ((x - ax) * dx + (z - az) * dz) / L : 0; t = clamp(t, 0, 1); const qx = ax + dx * t, qz = az + dz * t, d = (qx - x) ** 2 + (qz - z) ** 2; if (d < best) { best = d; bx = qx; bz = qz; bi = i - 1; bt = t; } } return { d: Math.sqrt(best), x: bx, z: bz, i: bi, t: bt }; }
function ringDistToLine(r, p) { let m = 1e9; for (const q of r) m = Math.min(m, nearestOnLine(p, q[0], q[1]).d); for (const q of p) for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; m = Math.min(m, Math.sqrt(segDist2(q[0], q[1], a[0], a[1], b[0], b[1]))); } return m; }
function segX(a, b, c, d) { // segment intersection -> [t, u, x, z] or null
  const r0 = b[0] - a[0], r1 = b[1] - a[1], s0 = d[0] - c[0], s1 = d[1] - c[1], den = r0 * s1 - r1 * s0;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s1 - (c[1] - a[1]) * s0) / den, u = ((c[0] - a[0]) * r1 - (c[1] - a[1]) * r0) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u, a[0] + r0 * t, a[1] + r1 * t];
}
function hull(pts) {
  const p = pts.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop(); return lo.concat(up);
}
function obb(r) { // minimum-area oriented rectangle: {x,z,ux,uz,vx,vz,hw,hd}
  const h = hull(r); let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length]; const L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1e-6) continue;
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, vx = -uz, vz = ux;
    let s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
    for (const q of h) { const s = q[0] * ux + q[1] * uz, t = q[0] * vx + q[1] * vz; s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
    const A = (s1 - s0) * (t1 - t0);
    if (!best || A < best.A) { const sc = (s0 + s1) / 2, tc = (t0 + t1) / 2; best = { A, x: ux * sc + vx * tc, z: uz * sc + vz * tc, ux, uz, vx, vz, hw: (s1 - s0) / 2, hd: (t1 - t0) / 2 }; }
  }
  if (best && best.hw < best.hd) { const b = best; best = { A: b.A, x: b.x, z: b.z, ux: b.vx, uz: b.vz, vx: -b.ux, vz: -b.uz, hw: b.hd, hd: b.hw }; }
  return best;
}
// polygon-clipping wrappers: rings are open [[x,z],...]; results keep outer rings only
const toPC = (r) => [[...r.map((p) => [p[0], p[1]]), [r[0][0], r[0][1]]]];
function fromPC(mp) { return mp.map((poly) => poly[0].slice(0, -1)).filter((r) => r.length >= 3 && Math.abs(area(r)) > 0.5); }
// polygon-clipping can trip on near-collinear float edges (real parcel lines); snap to 1 cm and retry, else skip that cut
const snapPC = (g) => JSON.parse(JSON.stringify(g), (k, v) => typeof v === 'number' ? Math.round(v * 100) / 100 : v);
function pcDiff(a, b) { try { return snapPC(PC.difference(a, b)); } catch (e) { try { return snapPC(PC.difference(snapPC(a), snapPC(b))); } catch (e2) { console.warn('clip skipped', e2); return a; } } }
function pcSafe(fn, ...args) { try { return fromPC(fn(...args)); } catch (e) { console.warn('clip failed', e); return null; } }
function bufferLine(p, r) {
  const parts = [];
  for (let i = 1; i < p.length; i++) {
    const [ax, az] = p[i - 1], [bx, bz] = p[i], L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
    const nx = -(bz - az) / L * r, nz = (bx - ax) / L * r;
    parts.push(toPC([[ax + nx, az + nz], [bx + nx, bz + nz], [bx - nx, bz - nz], [ax - nx, az - nz]]));
  }
  for (let i = 1; i < p.length - 1; i++) { const oc = []; for (let k = 0; k < 10; k++) { const a = k / 10 * Math.PI * 2; oc.push([p[i][0] + Math.cos(a) * r, p[i][1] + Math.sin(a) * r]); } parts.push(toPC(oc)); }
  if (!parts.length) return [];
  try { return PC.union(...parts); } catch (e) { return parts; }
}
function smoothLine(p, step = 4) { // Catmull-Rom through the clicked points
  if (p.length < 3) return p;
  const out = [];
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[Math.max(i - 1, 0)], p1 = p[i], p2 = p[i + 1], p3 = p[Math.min(i + 2, p.length - 1)];
    const n = Math.max(2, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(p[p.length - 1]); return out;
}

// ---------- draped ground decal ----------
function decal(acc, ring, y, col, maxEdge = 10) {
  if (ring.length < 3) return;
  const contour = ring.map((p) => new THREE.Vector2(p[0], p[1]));
  let tris;
  try { tris = THREE.ShapeUtils.triangulateShape(contour, []); } catch (e) { return; }
  const emit = (a, b, c, depth) => {
    const e1 = Math.hypot(a[0] - b[0], a[1] - b[1]), e2 = Math.hypot(b[0] - c[0], b[1] - c[1]), e3 = Math.hypot(c[0] - a[0], c[1] - a[1]);
    if (depth < 4 && Math.max(e1, e2, e3) > maxEdge) {
      const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
      emit(a, ab, ca, depth + 1); emit(ab, b, bc, depth + 1); emit(ca, bc, c, depth + 1); emit(ab, bc, ca, depth + 1); return;
    }
    const v = (p) => [p[0], elev(p[0], p[1]) + y, p[1]];
    acc.tri(v(a), v(b), v(c), col, UP);
  };
  for (const t of tris) emit(ring[t[0]], ring[t[1]], ring[t[2]], 0);
}

// ---------- oriented solids (R = {x,z,ux,uz,vx,vz,hw,hd}) ----------
function rcorners(R, grow = 0) {
  const { x, z, ux, uz, vx, vz } = R, hw = R.hw + grow, hd = R.hd + grow;
  return [[x - ux * hw - vx * hd, z - uz * hw - vz * hd], [x + ux * hw - vx * hd, z + uz * hw - vz * hd], [x + ux * hw + vx * hd, z + uz * hw + vz * hd], [x - ux * hw + vx * hd, z - uz * hw + vz * hd]];
}
function obox(acc, R, y0, h, col, lines = true, top = null) {
  const cs = rcorners(R), y1 = y0 + h, cx = R.x, cz = R.z, cy = y0 + h / 2;
  for (let k = 0; k < 4; k++) {
    const a = cs[k], b = cs[(k + 1) % 4];
    const hint = [(a[0] + b[0]) / 2 - cx, 0, (a[1] + b[1]) / 2 - cz];
    acc.quad([a[0], y0, a[1]], [b[0], y0, b[1]], [b[0], y1, b[1]], [a[0], y1, a[1]], col, hint);
    if (lines) { acc.line([a[0], y1, a[1]], [b[0], y1, b[1]]); acc.line([a[0], y0, a[1]], [a[0], y1, a[1]]); }
  }
  acc.quad([cs[0][0], y1, cs[0][1]], [cs[1][0], y1, cs[1][1]], [cs[2][0], y1, cs[2][1]], [cs[3][0], y1, cs[3][1]], top || col, UP);
  void cy;
}
function subR(R, s0, t0, w, d) { // sub-rectangle in R's local (s from -hw, t from -hd)
  const s = -R.hw + s0 + w / 2, t = -R.hd + t0 + d / 2;
  return { x: R.x + R.ux * s + R.vx * t, z: R.z + R.uz * s + R.vz * t, ux: R.ux, uz: R.uz, vx: R.vx, vz: R.vz, hw: w / 2, hd: d / 2 };
}
function oroof(acc, R, y, type, roofCol, wallCol, pitch = 0.3) {
  const o = 0.45, hw = R.hw + o, hd = R.hd + o;
  const P = (s, t, yy) => [R.x + R.ux * s + R.vx * t, yy, R.z + R.uz * s + R.vz * t];
  const ctr = [R.x, y - 1, R.z];
  const hintOf = (...pts) => { const m = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length, a[2] + p[2] / pts.length], [0, 0, 0]); return [m[0] - ctr[0], m[1] - ctr[1], m[2] - ctr[2]]; };
  const F = (pts, col) => { const h = hintOf(...pts); if (pts.length === 3) acc.tri(pts[0], pts[1], pts[2], col, h); else acc.quad(pts[0], pts[1], pts[2], pts[3], col, h); for (let i = 0; i < pts.length; i++) acc.line(pts[i], pts[(i + 1) % pts.length]); };
  const along = R.hw >= R.hd; // ridge runs along the longer side
  if (type === 'flat' || type === 'garden') {
    const r = { ...R }; obox(acc, r, y, 0.7, roofCol, true, type === 'garden' ? C(0x8fae6c) : C(0xb9b2a6)); return;
  }
  if (type === 'shed') {
    const rise = Math.max(1, R.hd * 2 * 0.16);
    const a = P(-hw, -hd, y + rise), b = P(hw, -hd, y + rise), c = P(hw, hd, y), d = P(-hw, hd, y);
    F([a, b, c, d], roofCol);
    F([P(-R.hw, -R.hd, y), P(-R.hw, -R.hd, y + rise - 0.05), P(-R.hw, R.hd, y)], wallCol);
    F([P(R.hw, -R.hd, y), P(R.hw, -R.hd, y + rise - 0.05), P(R.hw, R.hd, y)], wallCol);
    F([P(-R.hw, -R.hd, y), P(R.hw, -R.hd, y), P(R.hw, -R.hd, y + rise - 0.05), P(-R.hw, -R.hd, y + rise - 0.05)], wallCol);
    return;
  }
  const short = along ? hd : hw, rise = short * pitch * 2;
  if (type === 'gable') {
    if (along) {
      const r0 = P(-hw, 0, y + rise), r1 = P(hw, 0, y + rise);
      F([P(-hw, -hd, y), P(hw, -hd, y), r1, r0], roofCol); F([P(-hw, hd, y), P(hw, hd, y), r1, r0], roofCol);
      F([P(-R.hw, -R.hd, y), P(-R.hw, R.hd, y), P(-R.hw, 0, y + rise * (R.hd / hd))], wallCol);
      F([P(R.hw, -R.hd, y), P(R.hw, R.hd, y), P(R.hw, 0, y + rise * (R.hd / hd))], wallCol);
    } else {
      const r0 = P(0, -hd, y + rise), r1 = P(0, hd, y + rise);
      F([P(-hw, -hd, y), P(-hw, hd, y), r1, r0], roofCol); F([P(hw, -hd, y), P(hw, hd, y), r1, r0], roofCol);
      F([P(-R.hw, -R.hd, y), P(R.hw, -R.hd, y), P(0, -R.hd, y + rise * (R.hw / hw))], wallCol);
      F([P(-R.hw, R.hd, y), P(R.hw, R.hd, y), P(0, R.hd, y + rise * (R.hw / hw))], wallCol);
    }
    return;
  }
  // hip
  if (along) {
    const k = Math.max(0, hw - hd), r0 = P(-k, 0, y + rise), r1 = P(k, 0, y + rise);
    F([P(-hw, -hd, y), P(hw, -hd, y), r1, r0], roofCol); F([P(-hw, hd, y), P(hw, hd, y), r1, r0], roofCol);
    F([P(-hw, -hd, y), P(-hw, hd, y), r0], roofCol); F([P(hw, -hd, y), P(hw, hd, y), r1], roofCol);
  } else {
    const k = Math.max(0, hd - hw), r0 = P(0, -k, y + rise), r1 = P(0, k, y + rise);
    F([P(-hw, -hd, y), P(-hw, hd, y), r1, r0], roofCol); F([P(hw, -hd, y), P(hw, hd, y), r1, r0], roofCol);
    F([P(-hw, -hd, y), P(hw, -hd, y), r0], roofCol); F([P(-hw, hd, y), P(hw, hd, y), r1], roofCol);
  }
}
// windows and doors on the four walls of R; the street side is t = -hd
function ofacade(glass, R, y0, floors, fh, o = {}) {
  const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]]; const out = 0.07;
  const col = C(o.glassCol || 0x2f4753), door = C(0x6d4a33), shop = C(0x3b5866);
  for (const [ss, tt] of sides) {
    const len = ss ? R.hd * 2 : R.hw * 2; if (len < 2.5) continue;
    const front = tt === -1;
    // wall basis: c = wall centre, e = along-wall unit, n = outward
    const nx = R.ux * ss + R.vx * tt, nz = R.uz * ss + R.vz * tt;
    const ex = ss ? R.vx : R.ux, ez = ss ? R.vz : R.uz;
    const cx = R.x + R.ux * ss * R.hw + R.vx * tt * R.hd + nx * out, cz = R.z + R.uz * ss * R.hw + R.vz * tt * R.hd + nz * out;
    const W = (u, yy) => [cx + ex * u, yy, cz + ez * u];
    const hint = [nx, 0, nz];
    const bay = o.bay || 3.4, n = Math.max(1, Math.floor(len / bay)), step = len / n;
    for (let f = 0; f < floors; f++) {
      const yb = y0 + f * fh;
      if (f === 0 && front && o.shop) {
        const u0 = -len / 2 + 0.6, u1 = len / 2 - 0.6;
        glass.quad(W(u0, yb + 0.2), W(u1, yb + 0.2), W(u1, yb + Math.min(3, fh - 0.6)), W(u0, yb + Math.min(3, fh - 0.6)), shop, hint);
        continue;
      }
      if (f === 0 && o.podium && !front) continue;
      for (let i = 0; i < n; i++) {
        const uc = -len / 2 + step * (i + 0.5);
        if (f === 0 && front && i === Math.floor(n / 2) && !o.noDoor) { glass.quad(W(uc - 0.55, yb), W(uc + 0.55, yb), W(uc + 0.55, yb + 2.2), W(uc - 0.55, yb + 2.2), door, hint); continue; }
        if (f === 0 && o.podium) { glass.quad(W(uc - step * 0.4, yb), W(uc + step * 0.4, yb), W(uc + step * 0.4, yb + 2.4), W(uc - step * 0.4, yb + 2.4), C(0x2b2420), hint); continue; }
        const ww = Math.min(step * (o.wide ? 0.72 : 0.42), o.wide ? 3 : 1.6), wh = Math.min(fh * 0.45, 1.5), yy = yb + fh * 0.32;
        glass.quad(W(uc - ww / 2, yy), W(uc + ww / 2, yy), W(uc + ww / 2, yy + wh), W(uc - ww / 2, yy + wh), col, hint);
      }
    }
  }
}

export {
  $,
  Acc,
  C,
  FT,
  HG,
  T,
  UP,
  X0,
  X1,
  Z0,
  Z1,
  alongPts,
  area,
  bbox,
  bufferLine,
  centroid,
  clamp,
  dashed,
  decal,
  densify,
  disposeTree,
  elev,
  esc,
  fmt,
  fromPC,
  hash32,
  inPoly,
  lineGeo,
  nearestOnLine,
  obb,
  obox,
  ofacade,
  offsetLine,
  oroof,
  pcDiff,
  pcSafe,
  pick,
  polyLen,
  rcorners,
  reduceMotion,
  ribbon,
  ringDistToLine,
  rng,
  segDist2,
  segX,
  smoothLine,
  subR,
  toPC,
};
