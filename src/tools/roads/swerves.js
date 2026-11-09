import { bbox } from '../../engine/core.js';
import { roadClassOf } from './classes.js';

// =====================================================================
// Swerves. Map data draws a road that shifts sideways (a jog, a swerve around a median or a school, a sweeping
// bend) as a polyline with sharp corners. Real arterials and collectors are built with curves: round every
// corner on them to a radius that suits the class, so lanes, kerbs and markings follow a smooth line and the
// traffic sim steers gently. Endpoints never move (nodes and junctions stay put); local streets keep their corners.
// Pure data, no THREE.
// =====================================================================
const RADIUS = { arterial: 40, collector: 22, freeway: 60 };
const MIN_TURN = 0.1; // rad: gentler than this is already smooth

function round(p, R) {
  if (p.length < 3) return p;
  const out = [p[0].slice()];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const ux = b[0] - a[0], uz = b[1] - a[1], vx = c[0] - b[0], vz = c[1] - b[1], lu = Math.hypot(ux, uz), lv = Math.hypot(vx, vz);
    if (lu < 0.5 || lv < 0.5) { out.push(b.slice()); continue; }
    const turn = Math.abs(Math.atan2(ux * vz - uz * vx, ux * vx + uz * vz));
    if (turn < MIN_TURN || turn > 2.4) { out.push(b.slice()); continue; }
    // cut back along both legs by the tangent length of a circle of radius R, but never more than 45% of a leg
    const cut = Math.min(R * Math.tan(turn / 2), lu * 0.45, lv * 0.45);
    const p0 = [b[0] - ux / lu * cut, b[1] - uz / lu * cut], p1 = [b[0] + vx / lv * cut, b[1] + vz / lv * cut];
    const k = Math.max(3, Math.ceil(turn * 6));
    for (let s = 0; s <= k; s++) { const t = s / k, m = 1 - t; out.push([m * m * p0[0] + 2 * m * t * b[0] + t * t * p1[0], m * m * p0[1] + 2 * m * t * b[1] + t * t * p1[1]]); }
  }
  out.push(p[p.length - 1].slice());
  return out;
}

function smoothSwerves(S) {
  let n = 0;
  for (const e of S.edges.values()) {
    if (!e.g || e.ring || e.s === 'driveway' || e.s === 'alley') continue;
    const R = RADIUS[roadClassOf(e)]; if (!R || e.p.length < 3) continue;
    const q = round(e.p, R); if (q.length !== e.p.length) { e.p = q; e.bb = bbox(q); n++; }
  }
  return n;
}

export { round, smoothSwerves };
