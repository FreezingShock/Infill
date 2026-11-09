// Wires growth into the running game: advances the clock, reads demand, and once a day commits one `grow`
// command to the edit log. This is the only zoning file that touches the app layer.
import { reduceMotion } from '../../engine/core.js';
import { storeysOf } from '../../engine/commands.js';
import { STATE, commit, ui, world } from '../../app/state.js';
import { genCached } from '../../app/scene.js';
import { clock } from '../clock.js';
import { planGrowth } from '../growth.js';
import { capacity, demandOf, smooth, tally } from './demand.js';
import './zoning.css';

// Growth follows the shared game clock: one growth step every STEP_HOURS of game time (Run / Fast in the clock bar).
const STEP_HOURS = 6;
let dem = null, on = true, el = null;

function readDemand() {
  const rows = [];
  for (const lot of STATE.lots.values()) {
    const g = world.gens.get(lot.id) || genCached(lot, STATE);
    rows.push(capacity(lot, g.units, storeysOf(lot)));
  }
  dem = smooth(dem, demandOf(tally(rows)));
  return dem;
}
const growthTargets = () => { let n = 0; for (const l of STATE.lots.values()) if (l.gz) n++; return n; };

function dayTick(day) {
  const d = readDemand();
  if (on && !ui.draw && !document.hidden) {
    const cmd = planGrowth(STATE.lots.values(), d, day);
    if (cmd) { const ids = [...cmd.fill, ...cmd.up]; commit(cmd, { anim: reduceMotion ? null : ids, label: `The city grew ${ids.length} lot${ids.length === 1 ? '' : 's'}` }); }
  }
  render();
}

function bar(label, v) {
  const w = Math.abs(v) * 50;
  return `<span>${label}</span><div class="bar" title="${label}: ${v > 0 ? 'wants more' : 'has enough'} (${Math.round(v * 100)})"><i class="${v < 0 ? 'neg' : ''}" style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%"></i></div>`;
}
function render() {
  if (!el) return;
  const d = dem || readDemand(), n = growthTargets();
  el.innerHTML = `<h4>City <small>day ${clock.day + 1}</small></h4>
  <div class="dem">${bar('Homes', d.homes)}${bar('Shops', d.shops)}${bar('Work', d.work)}</div>
  <div class="row"><button id="gGrow" aria-pressed="${on}" title="Painted zones fill in and level up as demand allows">Grow</button><span>${!clock.speed ? 'press Run to grow' : n ? n + ' painted' : 'paint zones (Z)'}</span></div>`;
  el.querySelector('#gGrow').onclick = () => { on = !on; render(); };
}

function startGrowth() {
  const host = document.getElementById('rcol') || document.querySelector('.tr'); if (!host) return;
  el = document.createElement('section'); el.className = 'plaque city'; el.setAttribute('aria-label', 'City growth'); host.prepend(el);
  render();
  const stepOf = () => Math.floor((clock.day * 24 + clock.hour) / STEP_HOURS);
  let last = stepOf(), shown = clock.speed;
  const loop = () => {
    const k = stepOf();
    if (k !== last) { const fwd = k - last === 1; last = k; if (fwd) dayTick(k); }
    if (clock.speed !== shown) { shown = clock.speed; render(); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

export { startGrowth };
