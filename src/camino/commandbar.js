// sfvOS command bar (Camino only). Press / (or Ctrl+K) to run a view, tool, light, speed, area or address.
// Each row calls the same code as the game's buttons and keys, so it adds no new edit-log entries of its own.
import './commandbar.css';
import { esc } from '../engine/core.js';
import { clock, SPEEDS, setSpeed, togglePause } from '../game/clock.js';
import { closeModals, goToLot, openAreas, openLog, pickTool, searchLots, setLightHour, toggleView } from '../app/input.js';
import { redo, save, ui, undo } from '../app/state.js';
import { VIEWS, current, cycleView, setView } from '../views/index.js';
import { scanOn, setScan } from './scan.js';
import { matchRows } from './cmdmatch.js';
import { askResetTown } from './reset.js';

const $ = (id) => document.getElementById(id);
const MODALS = ['areas', 'credits', 'logm', 'keysm'];
const near = (h) => Math.abs(clock.hour - h) < 0.5;

// Every command: group, label, key hint, search words, optional "on" state, and what it runs.
function commands() {
  const area = globalThis.__RENOVATED_AREA__ || {};
  const areas = (globalThis.__RENOVATED_AREAS__?.areas || []).filter((a) => a.status === 'ready' && a.pack && a.id !== area.id);
  const tool = (t, label, key, words) => ({ g: 'Tools', t: label, k: key, w: `tool ${words}`, on: () => ui.tool === t, run: () => pickTool(t) });
  const view = (label, key, words, on, run) => ({ g: 'Views', t: label, k: key, w: words, on, run });
  const speed = (i, label, key) => ({ g: 'Time', t: label, k: key, w: 'speed time fast slow', on: () => clock.speed === SPEEDS[i], run: () => setSpeed(i) });
  const light = (h, label, words) => ({ g: 'Light', t: label, w: `light ${words}`, on: () => near(h), run: () => setLightHour(h) });
  const info = VIEWS.map((v) => ({ g: 'Info views', t: `${v.name} view`, w: `info overlay ${v.id}`, on: () => current()?.id === v.id, run: () => setView(v.id) }));

  return [
    { g: 'Mode', t: 'Street view', k: '', w: 'street realistic city', on: () => !scanOn(), run: () => setScan(false) },
    { g: 'Mode', t: 'Scan view', k: 'F', w: 'scan wireframe data infra', on: () => scanOn(), run: () => setScan(true) },
    tool('select', 'Look', 'V', 'select inspect'),
    tool('build', 'Build', 'P', 'template lot place'),
    tool('roads', 'Roads', 'G', 'draw street road'),
    tool('doze', 'Bulldoze', 'X', 'demolish remove'),
    tool('box', 'Box select', 'R', 'rectangle lots advanced'),
    tool('lasso', 'Lasso select', 'L', 'advanced'),
    tool('brush', 'Brush', '', 'advanced paint'),
    tool('along', 'Along a street', 'J', 'advanced'),
    tool('edit', 'Edit streets', 'K', 'advanced move'),
    tool('area', 'New area', 'U', 'advanced draw'),
    tool('zone', 'Paint zones', 'Z', 'advanced zoning'),
    view('As-built view', 'B', 'original before today', () => ui.asbuilt, () => toggleView('asbuilt')),
    view('Compare before and after', 'C', 'split slider', () => ui.splitOn, () => toggleView('split')),
    view(`Colour lots: ${['off', 'by type', 'by zone'][ui.color]}`, 'T', 'colour color type zone', () => ui.color > 0, () => toggleView('color')),
    view('Lot lines', '', 'outline parcels', () => ui.lotsOn, () => toggleView('lines')),
    ...info,
    { g: 'Info views', t: 'Next info view', k: 'I', w: 'cycle next', run: cycleView },
    { g: 'Info views', t: 'No info view', w: 'off clear none', on: () => !current(), run: () => { const c = current(); if (c) setView(c.id); } },
    light(14, 'Day light', 'day noon sun'),
    light(19.5, 'Dusk light', 'dusk evening sunset'),
    light(22, 'Night light', 'night dark lamps'),
    { g: 'Time', t: clock.speed ? 'Pause' : 'Resume', k: 'Space', w: 'pause resume play stop time', run: togglePause },
    speed(1, 'Normal speed', '1'),
    speed(2, 'Fast', '2'),
    speed(3, 'Faster', '3'),
    { g: 'Edit', t: 'Undo', k: 'Ctrl Z', w: 'undo back', run: undo },
    { g: 'Edit', t: 'Redo', k: 'Ctrl Y', w: 'redo forward', run: redo },
    { g: 'Edit', t: 'Edit log and save file', w: 'log save history export import', run: openLog },
    { g: 'Edit', t: 'Reset town', w: 'reset town start over clear restart as built original fresh', run: askResetTown },
    { g: 'Areas', t: 'Change area', w: 'area map pick switch', run: openAreas },
    ...areas.map((a) => ({ g: 'Areas', t: `Go to ${a.name}`, sub: a.sub || 'area', w: `${a.name} area switch load`, run: () => { save(); location.search = `?area=${encodeURIComponent(a.id)}`; } })),
    { g: 'Help', t: 'Keys and mouse', k: '?', w: 'help keys shortcuts', run: () => { closeModals(); $('keysm').hidden = false; } },
    { g: 'Help', t: 'Credits and data sources', w: 'credits sources license data', run: () => { closeModals(); $('credits').hidden = false; } },
  ];
}

let bar, input, list, items = [], active = 0, returnFocus = null;

function render() {
  const q = input.value.trim();
  const cmds = matchRows(commands(), q);
  const addr = q.length >= 2 ? searchLots(q).map((l) => ({ g: 'Addresses', t: l.a, sub: 'address', run: () => goToLot(l) })) : [];
  items = [...cmds, ...addr];
  active = Math.min(active, Math.max(0, items.length - 1));
  let html = '', last = null;
  items.forEach((c, i) => {
    if (c.g !== last) { html += `<li class="cmdhead" role="presentation">${esc(c.g)}</li>`; last = c.g; }
    html += `<li role="presentation"><button type="button" role="option" id="cmdo${i}" class="cmdrow${i === active ? ' on' : ''}" aria-selected="${i === active}" data-i="${i}">`
      + `<span class="cmdlabel">${esc(c.t)}</span>${c.on?.() ? '<em class="cmdon">On</em>' : ''}${c.sub ? `<small class="cmdsub">${esc(c.sub)}</small>` : ''}${c.k ? `<kbd>${esc(c.k)}</kbd>` : ''}</button></li>`;
  });
  list.innerHTML = html || '<li class="cmdempty" role="presentation">Nothing matches. Try a view, a tool, an area or an address.</li>';
  input.setAttribute('aria-activedescendant', items.length ? `cmdo${active}` : '');
}

function paintActive() {
  list.querySelectorAll('.cmdrow').forEach((b) => {
    const on = +b.dataset.i === active;
    b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on));
    if (on) b.scrollIntoView({ block: 'nearest' });
  });
  input.setAttribute('aria-activedescendant', items.length ? `cmdo${active}` : '');
}

function move(d) { if (!items.length) return; active = (active + d + items.length) % items.length; paintActive(); }

function open() {
  returnFocus = document.activeElement;
  bar.hidden = false; input.value = ''; active = 0; render(); input.focus();
}

function close() {
  bar.hidden = true; input.blur();
  const target = $('view') || returnFocus; target?.focus?.();
}

function run(i) {
  const c = items[i]; if (!c) return;
  close(); c.run();
}

export function mountCommandBar() {
  bar = document.createElement('div');
  bar.className = 'cmdbar'; bar.id = 'cmdBar'; bar.hidden = true;
  bar.innerHTML = `<div class="cmdpanel" role="dialog" aria-modal="true" aria-label="Command bar">
    <label class="cmdsearch"><kbd class="cmdkey">/</kbd><input id="cmdInput" type="text" autocomplete="off" spellcheck="false" placeholder="Run a view, tool, area or address" role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="cmdList" aria-label="Command bar"></label>
    <ul class="cmdlist" id="cmdList" role="listbox" aria-label="Commands"></ul>
    <div class="cmdfoot"><span>Up / Down move</span><span>Enter run</span><span>Esc close</span></div>
  </div>`;
  $('app').appendChild(bar);
  input = $('cmdInput'); list = $('cmdList');

  input.addEventListener('input', () => { active = 0; render(); });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown') { move(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { move(-1); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); run(active); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') e.preventDefault(); // keep focus in the bar while it is open
  });
  list.addEventListener('click', (e) => { const b = e.target.closest?.('button[data-i]'); if (b) run(+b.dataset.i); });
  list.addEventListener('pointermove', (e) => { const b = e.target.closest?.('button[data-i]'); if (b && +b.dataset.i !== active) { active = +b.dataset.i; paintActive(); } });
  bar.addEventListener('pointerdown', (e) => { if (e.target === bar) close(); });

  // "/" opens it anywhere except in a text field or an open dialog; Ctrl+K also works from the address box.
  addEventListener('keydown', (e) => {
    if (e.repeat || e.altKey || !bar.hidden) return;
    const ctrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    const slash = e.key === '/' && !e.ctrlKey && !e.metaKey;
    if (!ctrlK && !slash) return;
    if (slash && e.target.closest?.('input, select, textarea, [contenteditable]')) return;
    if (MODALS.some((id) => $(id) && !$(id).hidden)) return;
    e.preventDefault(); open();
  });
}
