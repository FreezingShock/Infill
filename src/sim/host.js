// Shared by the traffic worker and the main-thread fallback so both react to the same messages the same way.
// Pure JS (no THREE, no DOM), so tests can drive it in node.
import { buildNet } from './net.js';

const DT = 0.05;

// 'net' swaps the lane graph (with the node controls the road tools set); 'cfg' tunes the running sim.
function applyMessage(sim, m) {
  if (m.type === 'zones') sim.setZones(m.zones);
  else if (m.type === 'net') sim.setNet(buildNet(m.edges, { signals: m.signals, control: m.control, bounds: m.bounds }));
  else if (m.type === 'cfg') {
    if (m.density != null) sim.density = m.density;
    if (m.running != null) sim.running = m.running;
    if (m.speed != null) sim.timeScale = m.speed;
    if (m.hour != null) sim.hour = m.hour;
    if (m.max != null) sim.maxCars = m.max;
  }
}

// Advance by `el` real seconds in fixed 20 Hz steps; drops the backlog if it falls more than maxSteps behind.
function advance(sim, el, maxSteps = 4) {
  if (!sim.net || !sim.running) return;
  sim.acc = (sim.acc || 0) + el * (sim.timeScale ?? 1);
  let n = 0;
  while (sim.acc >= DT && n < maxSteps) { sim.step(DT); sim.acc -= DT; n++; }
  if (n === maxSteps) sim.acc = 0;
}

export { DT, advance, applyMessage };
