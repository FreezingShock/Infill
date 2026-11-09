import { elev } from './core.js';
import { PACK } from './pack.js';

// Cul-de-sac bulbs (pack.bulbs = [[x, z, r, node]], found by tools/pack/bulbs.py from the parcels around each dead end).
// Drawn as road with a sidewalk ring while the street still ends at that node, so editing the street removes the bulb.
const SEG = 28, UPV = [0, 1, 0];
function addBulbs(acc, S, asphalt, walkCol, walkW = 2.2) {
  const bulbs = PACK.bulbs; if (!bulbs || !bulbs.length) return 0;
  const deg = new Map();
  for (const e of S.edges.values()) { if (e.s === 'driveway' || e.s === 'parking_aisle') continue; deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
  let n = 0;
  for (const [cx, cz, r, node] of bulbs) {
    if (deg.get(node) !== 1) continue; // street was joined, removed or extended
    const ra = Math.max(3, r - walkW), P = (rad, a, y) => { const x = cx + Math.cos(a) * rad, z = cz + Math.sin(a) * rad; return [x, elev(x, z) + y, z]; };
    for (let i = 0; i < SEG; i++) {
      const a0 = i / SEG * Math.PI * 2, a1 = (i + 1) / SEG * Math.PI * 2;
      acc.tri([cx, elev(cx, cz) + 0.27, cz], P(ra, a0, 0.27), P(ra, a1, 0.27), asphalt, UPV);
      acc.quad(P(ra, a0, 0.16), P(r, a0, 0.16), P(r, a1, 0.16), P(ra, a1, 0.16), walkCol, UPV);
    }
    n++;
  }
  return n;
}
export { addBulbs };
