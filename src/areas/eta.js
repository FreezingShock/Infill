// Build time estimates for the area picker. Pure (no DOM), so it runs in plain node and is tested.
// A build is six stages (the ids build_area.py names). Each has a rough cost that grows with the area's size;
// every finished build is remembered, so the next estimate scales those costs by how this computer really did.
// While a build runs, the estimate is refined by how fast the finished stages went and by the builder's own percent.
export const STAGE_IDS = ['data', 'streets', 'lots', 'imagery', 'extras', 'save'];
// seconds = base + perKm2 * km2, a first guess before any build has been timed
const BASE = { data: [8, 6], streets: [4, 3], lots: [6, 10], imagery: [4, 4], extras: [5, 4], save: [1, 1] };
const HISTORY_MAX = 8;
const median = (a) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const guess = (id, km2) => { const [b, k] = BASE[id] || [5, 4]; return b + k * km2; };

/** Area of a [W,S,E,N]-sized box in square kilometres, from its width and height in metres. */
export const km2Of = (w, h) => Math.max(0.05, (w * h) / 1e6);

/** Expected seconds for every stage of a build of `km2`, scaled by this computer's past builds (`history`). */
export function predictStages(km2, history = [], ids = STAGE_IDS) {
  const runs = (history || []).filter((r) => r && r.stages && r.km2 > 0);
  const all = [];
  const per = new Map(ids.map((id) => [id, []]));
  for (const r of runs) for (const id of ids) { const s = r.stages[id]; if (s > 0) { const q = s / guess(id, r.km2); per.get(id).push(q); all.push(q); } }
  const overall = all.length ? median(all) : 1;
  return ids.map((id) => { const q = per.get(id).length ? median(per.get(id)) : overall; return { id, sec: Math.max(0.5, guess(id, km2) * q) }; });
}

/**
 * Seconds still to go.
 *   pred     predictStages(...) output
 *   done     { stageId: seconds } for finished stages
 *   cur      index of the running stage (-1 before the first stage event)
 *   inStage  seconds spent in the running stage
 *   elapsed  seconds since the build started
 *   pct      the builder's own overall percent, 0..100
 */
export function etaNow({ pred, done = {}, cur = -1, inStage = 0, elapsed = 0, pct = 0 }) {
  let exp = 0, got = 0;
  pred.forEach((p, i) => { if (i < cur && done[p.id] != null) { exp += p.sec; got += done[p.id]; } });
  const speed = exp > 0 ? Math.min(3, Math.max(0.4, (got + exp * 0.5) / (exp * 1.5))) : 1; // leans on the prediction until stages finish
  let left = 0;
  pred.forEach((p, i) => {
    if (i < cur) return;
    if (i === cur) left += Math.max(p.sec * 0.15, p.sec * speed - inStage);
    else left += p.sec * speed;
  });
  if (pct >= 12 && elapsed > 3) { const byPct = (elapsed * (100 - pct)) / pct, w = Math.min(0.6, pct / 120); left = left * (1 - w) + byPct * w; }
  return Math.max(0, left);
}

/** The history with one finished build added (newest last, capped). */
export function recordRun(history, { km2, stages }) {
  const clean = {}; for (const id of STAGE_IDS) if (stages?.[id] > 0) clean[id] = Math.round(stages[id] * 10) / 10;
  if (!(km2 > 0) || !Object.keys(clean).length) return history || [];
  return [...(history || []), { km2: Math.round(km2 * 100) / 100, stages: clean }].slice(-HISTORY_MAX);
}

/** "about 40 sec", "about 1 min 20 sec" for the picker; a plain m:ss clock is `clock`. */
export function say(sec) {
  if (!Number.isFinite(sec)) return '';
  const s = Math.max(1, Math.round(sec / 5) * 5 || 1);
  if (s < 60) return `about ${s} sec`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `about ${m} min ${r} sec` : `about ${m} min`;
}
export const clock = (sec) => { const s = Math.max(0, Math.round(sec)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
