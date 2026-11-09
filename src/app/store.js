// Tiny shared store for background work (worker builds). Anything can read it; the HUD and loader subscribe.
// Fires `infill:work` on window so views that do not import this module can listen too.
const state = { busy: false, done: 0, total: 0, workers: 0, last: null };
const subs = new Set();

function set(patch) {
  Object.assign(state, patch);
  for (const fn of subs) fn(state);
  if (typeof dispatchEvent === 'function' && typeof Event === 'function') dispatchEvent(new Event('infill:work'));
}
const work = {
  get: () => state,
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  start(total, workers) { set({ busy: true, done: 0, total, workers }); },
  progress(n) { set({ done: Math.min(state.total, state.done + n) }); },
  finish(ms) { set({ busy: false, done: state.total, last: { lots: state.total, ms, workers: state.workers } }); },
};

export { work };
