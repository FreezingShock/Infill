// Perspective orbit camera maths (pure, no THREE): the old orthographic "zoom" maps to a distance,
// so existing code that thinks in zoom (labels, snapping, shadow size) keeps working.
export const FOV = 35;
export const REF_H = 420; // world metres visible top to bottom at zoom 1
const K = 2 * Math.tan((FOV * Math.PI) / 360);

export const distForZoom = (z) => REF_H / (K * z);
export const zoomForDist = (d) => REF_H / (K * d);
/** Metres visible top to bottom at the orbit target. */
export const viewHeightAt = (d) => K * d;

export const MIN_DIST = 22;
export const MAX_DIST = 1700;
export const MIN_POLAR = 0.12; // almost straight down
export const MAX_POLAR = 1.42; // near street level, like CS2's low angle

/** Clip planes that follow the distance, so close-ups stay sharp and the far map edge stays in view. */
export function nearFar(dist, polar) {
  const near = Math.max(1.5, dist * 0.04);
  const far = dist * (3 + 6 * Math.sin(Math.min(polar, MAX_POLAR))) + 1500;
  return { near, far };
}

/** Fog band: starts past the target, hides the map edge when tilted toward the horizon. */
export function fogRange(dist, polar) {
  const tilt = Math.max(0, Math.sin(polar) - 0.55) / 0.45;
  return { near: dist * (1.6 + (1 - tilt) * 6), far: dist * (4.5 + (1 - tilt) * 14) + 900 };
}

/** Intro orbit framing: a bird's-eye ring that fits a whole area. bounds = [minx, minz, maxx, maxz], aspect = width / height. */
export const ORBIT_POLAR = 0.95;
export const ORBIT_PERIOD = 90; // seconds per full turn
export function fitOrbit(bounds, aspect) {
  const [x0, z0, x1, z1] = bounds;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  // Half the diagonal covers the area at any heading; the 0.9 trims empty corners of a long thin box.
  const r = Math.max(60, Math.hypot(x1 - x0, z1 - z0) / 2 * 0.9);
  const half = Math.min(FOV * Math.PI / 360, Math.atan(Math.tan(FOV * Math.PI / 360) * Math.max(aspect, 0.2)));
  const dist = Math.min(MAX_DIST, Math.max(MIN_DIST, (r / Math.sin(half)) * 1.05));
  return { cx, cz, r, dist, polar: ORBIT_POLAR };
}
