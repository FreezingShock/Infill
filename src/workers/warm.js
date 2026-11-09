// Builds lot geometry on the worker pool and drops it in the shared lot cache (app/scene.js GEN), so the
// main thread only has to merge ready meshes. Every caller still works without workers: it just builds in slices.
import { AREA, PACK } from '../engine/pack.js';
import { GEN, genCached, lotHash, wantsGeo } from '../app/scene.js';
import { work } from '../app/store.js';
import { bootProgress } from '../app/loader.js';
import { decodeBatch } from './codec.js';
import { WorkerPool } from './pool.js';

const BIG = 40; // more new lots than this and a commit waits for the workers instead of freezing the frame
let pool; // undefined = not started, null = unavailable

function getPool() {
  if (pool !== undefined && (pool === null || !pool.dead)) return pool;
  if (typeof Worker === 'undefined') return (pool = null);
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2));
  const p = new WorkerPool(() => new Worker(new URL('./genlot.worker.js', import.meta.url), { type: 'module' }), size, { type: 'init', pack: PACK, area: AREA, looks: globalThis.__RENOVATED_LOOKS__ || null });
  return (pool = p.dead ? null : p);
}

function missing(S) {
  const out = [];
  for (const lot of S.lots.values()) {
    const h = lotHash(lot, S), have = GEN.get(h), geo = wantsGeo(lot, S, h);
    if (!have || (have.slim && geo)) out.push({ h, lot, geo, demo: lot.b.filter((i) => S.demo.has(i)) }); // geo false = numbers only (far lots of a big area)
  }
  return out;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

// Generate every lot of S that is not cached yet. Resolves with how many were built.
async function prewarm(S, quiet = false) {
  const jobs = missing(S);
  if (!jobs.length) return 0;
  const p = getPool(), t0 = performance.now();
  if (!quiet) work.start(jobs.length, p ? p.size : 0);
  if (p) {
    const per = Math.max(6, Math.min(40, Math.ceil(jobs.length / (p.size * 4)))), batches = [];
    for (let i = 0; i < jobs.length; i += per) batches.push(jobs.slice(i, i + per));
    try {
      await Promise.all(batches.map(async (b) => {
        const r = await p.run({ type: 'gen', jobs: b });
        decodeBatch(r.buf, r.metas).forEach((g) => GEN.set(g.h, g));
        if (!quiet) work.progress(b.length);
      }));
    } catch (err) { console.warn('worker build failed, finishing on the page thread', err); }
  }
  // no workers, or a worker failed: build what is left in short slices so the page keeps moving
  let slice = performance.now();
  for (const j of jobs) {
    const have = GEN.get(j.h); if (have && !(have.slim && j.geo)) continue;
    genCached(j.lot, S, j.geo, j.h); if (!quiet) work.progress(1);
    if (performance.now() - slice > 12) { await tick(); slice = performance.now(); }
  }
  const ms = performance.now() - t0;
  if (!quiet) work.finish(ms);
  console.info(`[infill] built ${jobs.length} lots in ${Math.round(ms)} ms on ${p ? p.size + ' workers' : 'the page thread'}`);
  return jobs.length;
}

// Run fn once S is ready. Small edits run it straight away; a big one (paint a whole district, a growth step)
// builds on the workers first. Calls stay in order. onBusy(total) fires when a wait starts.
let chain = Promise.resolve(), pending = 0;
function warmFor(S, fn, onBusy) {
  if (!pending) {
    let n = 0;
    for (const lot of S.lots.values()) if (!GEN.has(lotHash(lot, S)) && ++n > BIG) break;
    if (n <= BIG) { fn(); return; }
    if (onBusy) onBusy(n);
  }
  pending++;
  chain = chain.then(() => prewarm(S)).catch((e) => console.warn(e)).then(() => { pending--; fn(); });
}

// Start-up: build the first view with the boot screen showing progress instead of a frozen tab.
// main.js has the bar at 25% when this starts; lot building fills it up to 90%.
async function warmStart(S) {
  const off = work.subscribe((s) => { if (s.total) bootProgress(25 + (65 * s.done) / s.total); });
  try { await prewarm(S); } finally { off(); }
}

export { prewarm, warmFor, warmStart };
