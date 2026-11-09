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
  const el = document.createElement('section'); el.className = 'camdos'; el.setAttribute('aria-live', 'polite');
  const row = (k, v) => `<div><span>${k}</span><b>${v}</b></div>`;
  const sig = PACK.props.filter((p) => p[0] === 'signal').length;
  const idx = (globalThis.__RENOVATED_AREAS__?.areas || []).findIndex((a) => a.id === area.id) + 1;
  el.innerHTML = `<div class="band"><h2>${esc(area.name)}</h2><i></i></div>
    <div class="meta"><div class="idx">${String(Math.max(1, idx)).padStart(2, '0')}</div>
      <div class="col">${row('Parcels', nf.format(STATE.lots.size))}${row('Structures', nf.format(PACK.buildings?.length || 0))}${row('Streets', nf.format(STATE.edges.size))}${row('Traffic signals', sig)}</div>
      <div class="col">${T ? row('Street lights', `${nf.format(T.lights)} · ${T.led}% LED`) + row('Hydrants', nf.format(T.hydrants)) + row('Bus stops', nf.format(T.stops)) + row('Boardings / day', nf.format(T.boardings)) : row('Infrastructure', 'not linked')}</div>
      <div class="foot">${T && T.kv.length ? `Transmission ${T.kv.join(' / ')} kV · ` : ''}City of LA · LA Metro · CEC · Overture / OSM · click to close</div></div>`;
  $('app').appendChild(el);
  let t = 0; const close = () => { clearTimeout(t); if (reduce) { el.remove(); return; } el.classList.add('out'); setTimeout(() => el.remove(), 460); };
  el.onclick = close; t = setTimeout(close, 8000);
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
