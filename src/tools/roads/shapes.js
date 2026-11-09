import { offsetLine, polyLen } from '../../engine/core.js';

// =====================================================================
// Road-building shapes (Cities: Skylines 2 style). Pure geometry: every mode turns a few clicked
// points into the polyline(s) that go into the normal `street.add` command, so undo, saves and
// the traffic graph need nothing new.
// =====================================================================
const MODES = {
  free: { name: 'Freeform', hint: 'Click points. It smooths a curve through them. Double-click or Enter to finish.', need: 0 },
  line: { name: 'Straight', hint: 'Click the start, then the end.', need: 2 },
  curve: { name: 'Curve', hint: 'Click the start, then the end, then drag the bend by clicking where the road should pass.', need: 3 },
  parallel: { name: 'Parallel', hint: 'Click a street to copy it alongside. The side follows your cursor.', need: 1 },
  round: { name: 'Roundabout', hint: 'Click open ground for a new roundabout, or an intersection to convert it.', need: 1 },
  grid: { name: 'Street grid', hint: 'Click two opposite corners. Streets fill the rectangle at your block size.', need: 2 },
};

// Circular arc from a, through m, to b. Falls back to a straight line when the three are collinear.
function arc(a, m, b, step = 3) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-6) return [a, b];
  const a2 = a[0] ** 2 + a[1] ** 2, m2 = m[0] ** 2 + m[1] ** 2, b2 = b[0] ** 2 + b[1] ** 2;
  const cx = (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d;
  const cz = (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d;
  const r = Math.hypot(a[0] - cx, a[1] - cz);
  if (r > 4000) return [a, b];
  const ang = (p) => Math.atan2(p[1] - cz, p[0] - cx), a0 = ang(a), a1 = ang(b), am = ang(m);
  const TAU = Math.PI * 2, wrap = (x) => ((x % TAU) + TAU) % TAU;
  // go the way that passes through m
  let sweep = wrap(a1 - a0); if (wrap(am - a0) > sweep) sweep -= TAU;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) * r / step)), out = [];
  for (let k = 0; k <= n; k++) { const t = a0 + sweep * k / n; out.push([cx + Math.cos(t) * r, cz + Math.sin(t) * r]); }
  out[0] = a.slice(); out[n] = b.slice();
  return out;
}

// A closed ring of points around c. `dir` is 1 for increasing angle, -1 for decreasing.
function ring(c, r, n = 24, dir = 1) {
  const out = []; for (let k = 0; k < n; k++) { const t = dir * (k / n) * Math.PI * 2; out.push([c[0] + Math.cos(t) * r, c[1] + Math.sin(t) * r]); }
  out.push(out[0].slice()); return out;
}

// A street copied alongside p, `gap` metres between the two rights-of-way, on the side of `side` (+1 / -1).
function parallel(p, widthA, widthB, gap, side) {
  return offsetLine(p, side * ((widthA + widthB) / 2 + gap));
}

// Which side (+1 / -1, in offsetLine's convention) of polyline p the point g is on.
function sideOfLine(p, g) {
  const d = (o) => offsetLine(p, o).reduce((m, q) => Math.min(m, Math.hypot(q[0] - g[0], q[1] - g[1])), 1e18);
  return d(1) <= d(-1) ? 1 : -1;
}

// Axis-aligned grid of straight streets inside the rectangle spanned by two corners. Returns an array of 2-point lines.
function gridLines(a, b, spacing) {
  const x0 = Math.min(a[0], b[0]), x1 = Math.max(a[0], b[0]), z0 = Math.min(a[1], b[1]), z1 = Math.max(a[1], b[1]);
  const w = x1 - x0, h = z1 - z0, out = [];
  if (w < 20 || h < 20) return out;
  const nx = Math.max(1, Math.round(w / spacing)), nz = Math.max(1, Math.round(h / spacing));
  for (let i = 0; i <= nx; i++) { const x = x0 + w * i / nx; out.push([[x, z0], [x, z1]]); }
  for (let j = 0; j <= nz; j++) { const z = z0 + h * j / nz; out.push([[x0, z], [x1, z]]); }
  return out;
}

// The polyline a mode builds from its clicked points plus the cursor. Used by the live preview and the final command.
function shapePath(mode, pts, smooth, smoothFn) {
  if (mode === 'line') return pts.length >= 2 ? [pts[0], pts[pts.length - 1]] : pts;
  if (mode === 'curve') return pts.length >= 3 ? arc(pts[0], pts[2], pts[1]) : pts.length === 2 ? pts.slice() : pts;
  return smooth && smoothFn && pts.length > 2 ? smoothFn(pts) : pts;
}
const pathLen = polyLen;

export { MODES, arc, gridLines, parallel, pathLen, ring, shapePath, sideOfLine };
