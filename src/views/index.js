// Info views (Cities: Skylines style): Traffic, Parking, Zones, Comfort. One is on at a time.
// Needs the app loaded (reads STATE and world from the app); the maths is in metrics.js, drawing in overlay.js.
import * as THREE from 'three';
import { minuteOfDay } from '../game/clock.js';
import { STATE, ZONE_COL, setOv, world } from '../app/state.js';
import { lotFacts, parking, traffic, comfort, summarize, zoneOf } from './metrics.js';
import { RAMPS, lotLayer, rampColor, streetLayer } from './overlay.js';

export const VIEWS = [
  { id: 'traffic', name: 'Traffic', key: 'I', icon: '<path d="M2 11l2-5h8l2 5v3h-3v-2H5v2H2z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5" cy="9.5" r="1" fill="currentColor"/><circle cx="11" cy="9.5" r="1" fill="currentColor"/>', ramp: 'traffic', lo: 'Free flowing', hi: 'Jammed', what: 'How full each street is for the time of day. Narrow a road and watch it turn red at rush hour.' },
  { id: 'parking', name: 'Parking', icon: '<rect x="2.5" y="2.5" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 11.5v-7h2.2a2 2 0 010 4H6.5" fill="none" stroke="currentColor" stroke-width="1.6"/>', ramp: 'parking', lo: 'Plenty free', hi: 'Full', what: 'Curb stalls and lots. Homes fill up at night, shops by day. Red means drivers circle looking for a spot.' },
  { id: 'zones', name: 'Zones', icon: '<path d="M2 3h5v5H2zM9 3h5v3H9zM9 8h5v5H9zM2 10h5v3H2z" fill="currentColor"/>', what: 'What each lot is zoned for. Painting a different zone changes what can grow there.' },
  { id: 'comfort', name: 'Happiness', icon: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5.2 9.5c.7 1.4 1.6 2 2.8 2s2.1-.6 2.8-2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="5.8" cy="6.5" r=".9" fill="currentColor"/><circle cx="10.2" cy="6.5" r=".9" fill="currentColor"/>', ramp: 'comfort', lo: 'Unhappy', hi: 'Happy', what: 'A shop and a park close by, trees out front and a calm street make a home happier.' },
];
const ZONE_NAMES = { R1: 'One-family', RE11: 'Estate', R2: 'Two-family', R3: 'Multi-family', RAS4: 'Mixed', C2: 'Commercial', P: 'Parking', PF: 'Public', OS: 'Open space' };

let active = null, layers = null, facts = null, lastPaint = 0, lastKey = '';
const subs = new Set();
export const current = () => VIEWS.find((v) => v.id === active) || null;
export const onChange = (fn) => { subs.add(fn); return () => subs.delete(fn); };
const info = (lot) => world.gens.get(lot.id) || null;
export const getFacts = () => facts || (facts = lotFacts(STATE, info));

function activate(id) { active = VIEWS.some((v) => v.id === id) ? id : null; rebuild(); for (const f of subs) f(current()); }
export const setView = (id) => activate(active === id ? null : id); // clicking the active view turns it off
export const cycleView = () => { const i = VIEWS.findIndex((v) => v.id === active); activate(i + 1 < VIEWS.length ? VIEWS[i + 1].id : null); };
export function legend() {
  const v = current(); if (!v) return null;
  if (v.id === 'zones') { const seen = new Set(); for (const l of STATE.lots.values()) seen.add(zoneOf(l)); return { ...v, chips: [...seen].filter((z) => ZONE_COL[z]).map((z) => ({ name: ZONE_NAMES[z] || z, hex: ZONE_COL[z] })) }; }
  const stops = RAMPS[v.ramp].map(([, c]) => '#' + c.toString(16).padStart(6, '0'));
  return { ...v, gradient: `linear-gradient(90deg, ${stops.join(', ')})` };
}
export function stats() { return summarize(STATE, getFacts(), minuteOfDay()); }

function rebuild() {
  facts = null; layers = null; lastKey = '';
  if (!active) { setOv('infoview', null); return; }
  facts = lotFacts(STATE, info);
  const grp = new THREE.Group();
  layers = {};
  if (active === 'traffic') layers.street = streetLayer(STATE);
  else if (active === 'parking') { layers.street = streetLayer(STATE); layers.lot = lotLayer(STATE, (l) => facts.get(l.id)?.stalls > 0); }
  else layers.lot = lotLayer(STATE, (l) => (active === 'zones' ? true : facts.get(l.id)?.units > 0 || facts.get(l.id)?.shop || facts.get(l.id)?.park));
  if (layers.street) grp.add(layers.street.finish(0.8, 6));
  if (layers.lot) grp.add(layers.lot.finish(active === 'zones' ? 0.6 : 0.7, 5));
  setOv('infoview', grp); paint(true);
}
function paint(force) {
  if (!active || !layers) return;
  const min = minuteOfDay(), now = performance.now(), key = Math.floor(min / 5) + ':' + active;
  if (!force && (key === lastKey || now - lastPaint < 250)) return;
  lastKey = key; lastPaint = now;
  const hex = (t, r) => rampColor(r, t).getHex();
  if (active === 'traffic') { const t = traffic(STATE, facts, min); for (const id of layers.street.ranges.keys()) layers.street.paint(id, hex((t.v.get(id) ?? 0) / 1.2, RAMPS.traffic)); }
  else if (active === 'parking') {
    const p = parking(STATE, facts, min);
    for (const id of layers.street.ranges.keys()) { const o = p.edgeOcc.get(id); if (o == null) layers.street.paint(id, 0x9a948c); else layers.street.paint(id, hex(o / 1.1, RAMPS.parking)); }
    for (const id of layers.lot.ranges.keys()) layers.lot.paint(id, hex((p.lotOcc.get(id) ?? 0) / 1.1, RAMPS.parking));
  } else if (active === 'zones') { for (const [id] of layers.lot.ranges) layers.lot.paint(id, ZONE_COL[zoneOf(STATE.lots.get(id))] ?? 0xcccccc); }
  else if (active === 'comfort') { const t = traffic(STATE, facts, min), c = comfort(STATE, facts, min, t.v); for (const id of layers.lot.ranges.keys()) layers.lot.paint(id, hex(c.get(id) ?? 0, RAMPS.comfort)); }
  for (const L of Object.values(layers)) L.flush();
}
// the app announces edits; the clock moves colours
addEventListener('infill:state', () => { if (active) rebuild(); else facts = null; });
(function loop() { paint(false); requestAnimationFrame(loop); })(); // colours follow the clock; paint() throttles itself
