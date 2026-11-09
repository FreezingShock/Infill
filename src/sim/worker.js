// Web Worker host for the traffic sim: owns the Sim, steps it at a fixed 20 Hz and posts snapshots.
import { Sim } from './sim.js';
import { advance, applyMessage } from './host.js';

const sim = new Sim(7);
let last = 0, cost = 0, timer = 0, n = 0;

function tick() {
  const now = performance.now(), el = Math.min(0.25, (now - last) / 1000); last = now;
  if (!sim.net) return;
  const t0 = performance.now();
  advance(sim, el);
  const buf = sim.snapshot();
  cost = cost * 0.9 + (performance.now() - t0) * 0.1;
  postMessage({ type: 'snap', buf, stats: { ...sim.stats, ms: cost, t: sim.t }, edges: n++ % 20 === 0 ? sim.edgeStats() : null }, [buf.buffer]);
}
onmessage = (e) => {
  applyMessage(sim, e.data);
  if (!timer) { last = performance.now(); timer = setInterval(tick, 50); }
};
