// Web Worker host for the traffic sim: owns the Sim, steps it at a fixed 20 Hz and posts snapshots.
import { Sim } from './sim.js';
import { buildNet } from './net.js';

const DT = 0.05;
const sim = new Sim(7);
let timeScale = 1, last = 0, acc = 0, cost = 0, timer = 0;

function tick() {
  const now = performance.now(), el = Math.min(0.25, (now - last) / 1000); last = now;
  if (!sim.net) return;
  const t0 = performance.now();
  if (sim.running) { acc += el * timeScale; let n = 0; while (acc >= DT && n < 4) { sim.step(DT); acc -= DT; n++; } if (n === 4) acc = 0; }
  const buf = sim.snapshot();
  cost = cost * 0.9 + (performance.now() - t0) * 0.1;
  postMessage({ type: 'snap', buf, stats: { ...sim.stats, ms: cost, t: sim.t } }, [buf.buffer]);
}
onmessage = (e) => {
  const m = e.data;
  if (m.type === 'net') { sim.setNet(buildNet(m.edges, { signals: m.signals, bounds: m.bounds })); }
  else if (m.type === 'cfg') { if (m.density != null) sim.density = m.density; if (m.running != null) sim.running = m.running; if (m.speed != null) timeScale = m.speed; if (m.max != null) sim.maxCars = m.max; }
  if (!timer) { last = performance.now(); timer = setInterval(tick, 50); }
};
