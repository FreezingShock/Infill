// Growth: once a day the city looks at its demand bars and decides which painted lots build or level up.
// planGrowth is pure and deterministic: same state, demand and day give the same plan, so it is easy to test
// and a save is still just the edit log (the plan becomes one `grow` command).
import { hash32, rng } from '../engine/core.js';
import { zfam, zrule } from '../engine/model.js';
import { ZONE_LT, storeysOf } from '../engine/commands.js';
import { KIND_OF_FAMILY } from './zoning/zones.js';

const NO_LEVEL = new Set(['civic', 'parking', 'vacant']);

// Which demand bar a lot's zone listens to.
function barFor(lot, dem) {
  const kind = KIND_OF_FAMILY[zfam(lot.z)] || 'homes';
  return kind === 'shops' ? Math.max(dem.shops, dem.work) : kind === 'civic' ? dem.civic : dem.homes;
}
// day: game day number; max: most lots one day may change.
function planGrowth(lots, dem, day, max = 6) {
  const fill = [], up = [];
  for (const lot of lots) {
    if (!lot.gz) continue;
    const want = ZONE_LT[zfam(lot.z)], d = barFor(lot, dem);
    if (!want || d < 0.05) continue;
    const roll = rng(hash32(`g${day}:${lot.id}`))();
    if (lot.lt !== want) { if (roll < 0.15 + d * 0.5) fill.push({ id: lot.id, k: roll }); }
    else if (!NO_LEVEL.has(lot.lt) && d > 0.3 && storeysOf(lot) < zrule(lot.z).st && roll < d * 0.25) up.push({ id: lot.id, k: roll });
  }
  const top = (a, n) => a.sort((p, q) => p.k - q.k).slice(0, Math.max(0, n)).map((x) => x.id);
  const peak = Math.max(dem.homes, dem.shops, dem.work, 0);
  const budget = Math.max(1, Math.ceil(max * peak));
  const f = top(fill, budget), u = top(up, budget - f.length);
  return f.length || u.length ? { op: 'grow', fill: f, up: u, sd: 'd' + day } : null;
}

export { planGrowth };
