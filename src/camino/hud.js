// Camino HUD parts: sfvOS title with the Camino subtitle, the Street / Scan switch, the area dossier on load,
// an FPS readout, and the extra key help. Built into the existing page, nothing is moved out of its dock.
import { esc } from '../engine/core.js';
import { PACK } from '../engine/pack.js';
import { STATE } from '../app/state.js';

const $ = (id) => document.getElementById(id);
const nf = new Intl.NumberFormat('en-US');
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function mountTitle() {
  const b = document.querySelector('.brand'); if (!b) return;
  b.innerHTML = '<h1>sfvOS</h1><span>Camino</span>'; b.setAttribute('aria-label', 'sfvOS, Camino');
}

export function mountSwitch(setScan) {
  const bar = document.createElement('div'); bar.className = 'plaque bar camswitch'; bar.id = 'camBar'; bar.setAttribute('role', 'radiogroup'); bar.setAttribute('aria-label', 'View mode');
  bar.innerHTML = '<button class="tool" id="camStreet" role="radio" aria-checked="true" aria-pressed="true" title="Street view: the real city">Street</button><button class="tool" id="camScan" role="radio" aria-checked="false" aria-pressed="false" title="Scan view: traffic, signals and real infrastructure (F)">Scan <kbd>F</kbd></button>';
  const bl = document.querySelector('.bl'); (bl || $('app')).appendChild(bar);
  $('camStreet').onclick = () => setScan(false); $('camScan').onclick = () => setScan(true);
  const ring = document.createElement('div'); ring.className = 'camring'; ring.setAttribute('aria-hidden', 'true'); $('app').appendChild(ring);
  return (on) => {
    for (const [id, v] of [['camStreet', !on], ['camScan', on]]) { $(id).setAttribute('aria-checked', String(v)); $(id).setAttribute('aria-pressed', String(v)); }
    if (reduce) return; ring.classList.remove('go', 'off'); void ring.offsetWidth; ring.classList.add('go'); if (!on) ring.classList.add('off');
  };
}

export function showDossier(area, T) {
  // Every number here is counted from the loaded area or its real sidecars. Nothing is estimated: a layer that is not linked says so.
  const areas = globalThis.__RENOVATED_AREAS__?.areas || [];
  const at = areas.findIndex((a) => a.id === area.id);
  const kick = at >= 0 ? `Area ${String(at + 1).padStart(2, '0')} / ${String(areas.length).padStart(2, '0')}` : 'Area';
  const sig = PACK.props.filter((p) => p[0] === 'signal').length;
  const tile = (cls, value, label, sub = '', i = 0) => `<div class="tile ${cls}" style="--i:${i}"><b>${value}</b><span>${label}</span>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const headline = [
    tile('k-land', nf.format(STATE.lots.size), 'Parcels', '', 0),
    tile('k-bldg', nf.format(PACK.buildings?.length || 0), 'Structures', '', 1),
    tile('k-street', nf.format(STATE.edges.size), 'Streets', '', 2),
    tile('k-signal', nf.format(sig), 'Traffic signals', '', 3),
  ].join('');
  const infra = T
    ? [
      tile('k-light', nf.format(T.lights), 'Street lights', `${T.led}% LED`, 4),
      tile('k-hydrant', nf.format(T.hydrants), 'Hydrants', '', 5),
      tile('k-stop', nf.format(T.stops), 'Bus stops', '', 6),
      tile('k-board', nf.format(T.boardings), 'Boardings / day', '', 7),
    ].join('')
    : '';
  // Only name the sources whose data is in this area.
  const src = ['City of LA parcels', 'Overture / OSM roads and buildings'];
  if (T) {
    if (T.lights || T.hydrants) src.push('City of LA lights and hydrants');
    if (T.stops) src.push('LA Metro');
    if (T.kv.length) src.push(`CEC transmission ${T.kv.join(' / ')} kV`);
  }

  const el = document.createElement('section');
  el.className = 'camdos'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', `Area summary: ${area.name}`);
  el.innerHTML = `<div class="sheet">
    <header class="hero"><p class="kick"><span>${esc(kick)}</span><span>San Fernando Valley</span></p><h2>${esc(area.name)}</h2></header>
    <section class="grp"><p class="glabel">Land and streets</p><div class="tiles big">${headline}</div></section>
    <section class="grp"><p class="glabel">Real infrastructure</p>${T ? `<div class="tiles">${infra}</div>` : '<p class="nolink">Infrastructure layers are not linked for this area. Nothing is estimated.</p>'}</section>
    <footer class="src">${src.map((s) => `<span>${esc(s)}</span>`).join('')}</footer>
    <div class="close" aria-hidden="true"><span>Any click or key closes</span><i></i></div>
  </div>`;
  $('app').appendChild(el);
  document.body.classList.add('camdos-up');

  let closing = false, timer = 0, swallow = 0;
  const finish = () => {
    if (reduce) { el.remove(); return; }
    el.classList.add('out'); setTimeout(() => el.remove(), 760);
  };
  const close = () => {
    if (closing) return; closing = true; clearTimeout(timer);
    removeEventListener('pointerdown', onPointer, true); removeEventListener('keydown', onKey, true);
    document.body.classList.remove('camdos-up');
    finish();
  };
  // A click on the card dismisses it and is not passed on, so it does not also press a button or pick a lot underneath.
  const eatClick = (e) => { e.stopPropagation(); e.preventDefault(); removeEventListener('click', eatClick, true); clearTimeout(swallow); };
  const onPointer = (e) => {
    e.stopPropagation();
    addEventListener('click', eatClick, true);
    swallow = setTimeout(() => removeEventListener('click', eatClick, true), 500);
    close();
  };
  // Keys close the card but still reach the game, so F or Space still does what it says.
  const onKey = () => close();
  addEventListener('pointerdown', onPointer, true);
  addEventListener('keydown', onKey, true);
  timer = setTimeout(close, 8000);
}

/** FPS and frame time over the last second, plus the worst frame. Shown bottom right. */
export function mountFps() {
  const el = document.createElement('div'); el.className = 'camfps'; el.id = 'camFps'; el.title = 'Frames per second over the last second, and the slowest frame';
  const br = document.querySelector('.br'); (br || $('app')).appendChild(el);
  let n = 0, t0 = performance.now(), last = t0, worst = 0;
  return (now) => {
    n++; worst = Math.max(worst, now - last); last = now;
    if (now - t0 < 1000) return;
    const fps = n * 1000 / (now - t0); el.textContent = `${Math.round(fps)} FPS · ${(1000 / fps).toFixed(1)} ms · max ${Math.round(worst)} ms`;
    el.classList.toggle('slow', fps < 40); globalThis.__sfvosFps = { fps, worst };
    n = 0; t0 = now; worst = 0;
  };
}

export function mountKeys() {
  const keys = document.querySelector('#keysm .keys');
  if (keys) keys.insertAdjacentHTML('beforeend', '<div><kbd>F</kbd> Street / Scan view</div><div><kbd>/</kbd> Command bar: views, tools, areas, addresses</div><div>Classic paper look: add <code>?theme=nexus</code></div>');
}
