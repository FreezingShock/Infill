// Pure helpers for choosing and naming an area (no DOM, no THREE): shared by the picker and the tests.
export const MAX_SIDE_M = 3400; // the pack builder refuses anything bigger, so the picker never offers it
export const MIN_SIDE_M = 400;

const kx = (lat) => Math.cos((lat * Math.PI) / 180) * 111320;
const KY = 110540;

/** [W,S,E,N] -> [width, height] in metres. */
export function bboxSizeM(b) {
  return [(b[2] - b[0]) * kx((b[1] + b[3]) / 2), (b[3] - b[1]) * KY];
}

/** A box `sideM` metres on a side centred on a point. */
export function bboxAround(lon, lat, sideM = 1200) {
  const dx = sideM / 2 / kx(lat), dy = sideM / 2 / KY;
  return [lon - dx, lat - dy, lon + dx, lat + dy].map((v) => Math.round(v * 1e5) / 1e5);
}

/** Two dragged corners -> a box, grown to the minimum size and limited to the maximum. */
export function bboxFromCorners(a, b) {
  let [W, E] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])], [S, N] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
  const lat = (S + N) / 2, cx = (W + E) / 2, cy = (S + N) / 2;
  const w = Math.min(MAX_SIDE_M, Math.max(MIN_SIDE_M, (E - W) * kx(lat))), h = Math.min(MAX_SIDE_M, Math.max(MIN_SIDE_M, (N - S) * KY));
  W = cx - w / 2 / kx(lat); E = cx + w / 2 / kx(lat); S = cy - h / 2 / KY; N = cy + h / 2 / KY;
  return [W, S, E, N].map((v) => Math.round(v * 1e5) / 1e5);
}

export function bboxProblem(b, region) {
  if (!b || b.length !== 4 || b.some((v) => !Number.isFinite(v))) return 'Pick a spot on the map first.';
  const [w, h] = bboxSizeM(b);
  if (w > MAX_SIDE_M + 1 || h > MAX_SIDE_M + 1) return `That is ${Math.round(w)} × ${Math.round(h)} m. Keep each side under ${MAX_SIDE_M} m.`;
  if (w < MIN_SIDE_M - 1 || h < MIN_SIDE_M - 1) return `That is smaller than ${MIN_SIDE_M} m a side.`;
  if (region) {
    const r = region.bbox, cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    if (cx < r[0] || cx > r[2] || cy < r[1] || cy > r[3]) return `Pick somewhere inside the ${region.name}.`;
  }
  return null;
}

export function boxesOverlap(a, b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}

/** "Canoga Park, CA" -> "canoga-park"; unique against the ids already in the manifest. */
export function slugify(name, taken = []) {
  const base = String(name || 'area').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32).replace(/-+$/, '') || 'area';
  let id = base.length < 2 ? `${base}-area` : base, n = 2;
  while (taken.includes(id)) id = `${base}-${n++}`;
  return id;
}

/** Lon/lat <-> canvas pixels for the Valley frame the area map draws, from two sample projections. */
export function frameFrom(LL, rb) {
  const p0 = LL(rb[0], rb[3]), p1 = LL(rb[2], rb[1]);
  const sx = (p1[0] - p0[0]) / (rb[2] - rb[0]), sy = (p1[1] - p0[1]) / (rb[1] - rb[3]);
  return { toPx: LL, toLL: (x, y) => [rb[0] + (x - p0[0]) / sx, rb[3] + (y - p0[1]) / sy] };
}
