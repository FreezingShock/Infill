// Demand: three bars from -1 (too much) to +1 (the city wants more): homes, shops and work.
// Pure maths on counts so it runs anywhere (node tests, a worker, the page).
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const PEOPLE_PER_HOME = 2.4, WORKER_SHARE = 0.5, LOCAL_JOB_SHARE = 0.85, SHOPS_PER_HOME = 0.12;

// What one lot offers: homes, shop units and jobs. `units` is the generated home count for the lot.
function capacity(lot, units, storeys) {
  const st = Math.max(1, storeys || 1), floor = lot.m2 * 0.55 * st;
  if (lot.lt === 'main') return { homes: units, shops: floor / 600, jobs: floor / 110 };
  if (lot.lt === 'civic') return { homes: 0, shops: 0, jobs: lot.m2 / 500 };
  if (lot.lt === 'parking' || lot.lt === 'vacant') return { homes: units, shops: 0, jobs: 0 };
  return { homes: units, shops: 0, jobs: units * 0.05 };
}
function tally(rows) {
  const t = { homes: 0, shops: 0, jobs: 0 };
  for (const r of rows) { t.homes += r.homes; t.shops += r.shops; t.jobs += r.jobs; }
  return t;
}
function demandOf(t) {
  const workers = t.homes * PEOPLE_PER_HOME * WORKER_SHARE, jobsWanted = workers * LOCAL_JOB_SHARE, shopsWanted = t.homes * SHOPS_PER_HOME;
  const work = clamp((jobsWanted - t.jobs) / Math.max(20, jobsWanted), -1, 1);
  const shops = clamp((shopsWanted - t.shops) / Math.max(8, shopsWanted), -1, 1);
  const homes = clamp(0.3 - 0.7 * work, -1, 1);
  return { homes, shops, work, civic: 0.3 };
}
// ease toward the new reading so bars glide instead of jumping
const smooth = (prev, next, k = 0.35) => (prev ? Object.fromEntries(Object.keys(next).map((key) => [key, prev[key] + (next[key] - prev[key]) * k])) : next);

export { PEOPLE_PER_HOME, capacity, demandOf, smooth, tally };
