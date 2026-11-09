// The one running area build, seen from anywhere in the game. The picker feeds it the builder's progress lines;
// the Camino HUD chip, the picker's progress view and the finish toast all read it. Closing the picker does not
// touch the build: the stream is owned by the page, not by the picker window.
// Past stage timings live in localStorage (this computer only) and make the next ETA better.
import { STAGE_IDS, etaNow, predictStages, recordRun } from './eta.js';

const KEY = 'sfvos.buildTimes.v1';
let st = null, tick = 0;
const subs = new Set();

const load = () => { try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const save = (h) => { try { localStorage.setItem(KEY, JSON.stringify(h)); } catch { /* private mode */ } };
const now = () => Date.now() / 1000;
const emit = () => { refresh(); for (const f of subs) f(st); };

function refresh() {
  if (!st || st.status !== 'run') return;
  const t = now(), ids = st.ids;
  st.elapsed = t - st.t0;
  st.eta = etaNow({ pred: st.pred, done: st.times, cur: st.cur, inStage: st.cur >= 0 ? t - st.stageT : t - st.t0, elapsed: st.elapsed, pct: st.pct });
  st.stage = st.cur >= 0 ? st.labels[ids[st.cur]] || '' : '';
}

export const watch = {
  get: () => st,
  subscribe(f) { subs.add(f); return () => subs.delete(f); },
  /** A build begins. `km2` sizes the first estimate. */
  start({ id, name, refresh: isRefresh, km2 }) {
    clearInterval(tick);
    const ids = STAGE_IDS;
    st = { id, name, refresh: !!isRefresh, km2, status: 'run', t0: now(), stageT: now(), ids, labels: {}, cur: -1, times: {}, pct: 0, msg: 'Starting', pred: predictStages(km2, load(), ids), elapsed: 0, eta: 0, stage: '' };
    tick = setInterval(emit, 1000); emit();
  },
  /** One progress line from the builder. */
  event(ev) {
    if (!st || st.status !== 'run') return;
    if (ev.stages) { st.ids = ev.stages.map((s) => s.id); st.labels = Object.fromEntries(ev.stages.map((s) => [s.id, s.label])); st.pred = predictStages(st.km2, load(), st.ids); }
    if (ev.msg) st.msg = ev.msg;
    if (ev.pct != null) st.pct = Math.max(st.pct, Math.min(100, ev.pct));
    if (ev.stage) {
      const i = st.ids.indexOf(ev.stage), t = now();
      if (i > st.cur) { if (st.cur >= 0) st.times[st.ids[st.cur]] = t - st.stageT; st.cur = i; st.stageT = t; }
    }
    emit();
  },
  /** The builder finished: remember the timings. */
  finish(area) {
    if (!st) return; clearInterval(tick);
    const t = now(); if (st.cur >= 0) st.times[st.ids[st.cur]] = t - st.stageT;
    save(recordRun(load(), { km2: st.km2, stages: st.times }));
    st = { ...st, status: 'ok', pct: 100, eta: 0, elapsed: t - st.t0, area }; for (const f of subs) f(st);
  },
  fail(msg, cancelled) { if (!st) return; clearInterval(tick); st = { ...st, status: cancelled ? 'cancel' : 'fail', msg, eta: 0 }; for (const f of subs) f(st); },
  clear() { clearInterval(tick); st = null; for (const f of subs) f(st); },
};
