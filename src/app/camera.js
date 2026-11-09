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
