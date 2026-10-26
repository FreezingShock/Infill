import { fmt, hash32 } from '../engine/core.js';
import { LT, PAL } from '../engine/model.js';
import { CATS, TPL, TPL_BY_CAT, availability, genLot } from '../engine/templates.js';
import { exec, uid } from '../engine/commands.js';
import { genCached } from './scene.js';
import { STATE, ui, world } from './state.js';

// =====================================================================
// The Build palette: every way to change a lot as one clickable item, applied by clicking or dragging across lots.
// Items turn into the same edit-log commands the cards use (apply, tweak, bump, restore), so undo and saves work.
// =====================================================================
const svg = (body) => `<svg viewBox="0 0 44 30" aria-hidden="true">${body}</svg>`;
const HOUSE = '<path d="M10 27V16h24v11z" fill="#f1e2c4" stroke="currentColor" stroke-width="2"/><path d="M7 16L22 7l15 9z" fill="#bb5836" stroke="currentColor" stroke-width="2"/>';
const IC = {
  floorUp: svg('<path d="M10 27V12h18v15z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/><path d="M10 17h18" stroke="currentColor" stroke-width="1.5"/><path d="M36 20V6M31 11l5-5 5 5" fill="none" stroke="#c4613b" stroke-width="2.5"/>'),
  floorDn: svg('<path d="M10 27V17h18v10z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/><path d="M36 6v14M31 15l5 5 5-5" fill="none" stroke="#c4613b" stroke-width="2.5"/>'),
  adu: svg(HOUSE + '<path d="M33 27v-6h8v6z" fill="#dfe3cf" stroke="currentColor" stroke-width="2"/>'),
  solar: svg(HOUSE.replace('#bb5836', '#3b4f7a') + '<path d="M14 13l8-5 8 5" stroke="#9fc3e0" stroke-width="1.5" fill="none"/>'),
  trees: svg('<path d="M3 27h38" stroke="currentColor" stroke-width="2"/><circle cx="13" cy="15" r="7" fill="#8ea67a" stroke="currentColor" stroke-width="2"/><circle cx="29" cy="13" r="8" fill="#6f8f5c" stroke="currentColor" stroke-width="2"/><path d="M13 22v5M29 21v6" stroke="currentColor" stroke-width="2"/>'),
  roof: (k) => svg('<path d="M10 27V16h24v11z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/>' + ({
    hip: '<path d="M7 16l7-8h16l7 8z" fill="#9a5a3c" stroke="currentColor" stroke-width="2"/>',
    gable: '<path d="M7 16L22 6l15 10z" fill="#9a5a3c" stroke="currentColor" stroke-width="2"/>',
    flat: '<path d="M8 16h28v-3H8z" fill="#c9c3b8" stroke="currentColor" stroke-width="2"/>',
    shed: '<path d="M8 16l28-7v7z" fill="#9a5a3c" stroke="currentColor" stroke-width="2"/>',
    garden: '<path d="M8 16h28v-4H8z" fill="#8fae6c" stroke="currentColor" stroke-width="2"/><circle cx="15" cy="10" r="3" fill="#6f8f5c"/><circle cx="28" cy="10" r="3" fill="#6f8f5c"/>',
  }[k])),
  pal: (p) => svg(`<path d="M10 27V15h24v12z" fill="#${p.w.toString(16).padStart(6, '0')}" stroke="currentColor" stroke-width="2"/><path d="M7 15L22 6l15 9z" fill="#${p.r.toString(16).padStart(6, '0')}" stroke="currentColor" stroke-width="2"/>`),
  restore: svg(HOUSE + '<path d="M38 9a7 7 0 1 0 1 6" fill="none" stroke="#c4613b" stroke-width="2"/><path d="M39 4v6h-6" fill="none" stroke="#c4613b" stroke-width="2"/>'),
  copy: svg('<path d="M8 22l12-12 4 4-12 12H8z" fill="#d6ad57" stroke="currentColor" stroke-width="2"/><path d="M24 6l6 6-3 3-6-6z" fill="#2b2420"/><circle cx="34" cy="22" r="5" fill="#c4613b" stroke="currentColor" stroke-width="2"/>'),
  design: svg(HOUSE + '<path d="M36 5l1.8 4 4.2.4-3.2 2.8 1 4.2-3.8-2.2-3.8 2.2 1-4.2-3.2-2.8 4.2-.4z" fill="#d6ad57" stroke="currentColor" stroke-width="1.2"/>'),
};
const ROOF_NAME = { hip: 'Hip roof', gable: 'Gable roof', flat: 'Flat roof', shed: 'Shed roof', garden: 'Green roof' };
const HOMEY = new Set(['house', 'multi']);

// One item: { id, name, icon, blurb, cmd(ids) -> command or null, fits(lot) -> null | reason }
const tweakItem = (id, name, icon, blurb, f, fits) => ({ id, name, icon, blurb, fits, cmd: (ids) => ({ op: 'tweak', lots: ids, f }) });
const tplItem = (t) => ({
  id: 'tpl:' + t.id, name: t.name, icon: t.icon, blurb: t.blurb, tpl: t.id,
  fits: (lot) => { const a = availability(t, lot, ui.dream); return a.ok ? null : a.why; },
  cmd: (ids) => ({ op: 'apply', lots: ids, t: t.id, p: {}, vary: ui.vary ? 1 : 0, sd: uid('s'), dr: ui.dream ? 1 : 0 }),
});
// a saved look: a template with its tweaks, or tweaks on top of the as-built buildings
const lookItem = (id, d) => d.t === 'asb'
  ? { id, name: d.name, icon: IC.design, blurb: 'Your saved look, on the buildings already there', look: d, fits: () => null, cmd: (ids) => ({ op: 'tweak', lots: ids, f: d.p }) }
  : { id, name: d.name, icon: TPL[d.t]?.icon || IC.design, blurb: `Your saved ${TPL[d.t]?.name || 'design'}, refitted to each lot`, look: d, tpl: d.t,
    fits: (lot) => { const t = TPL[d.t]; if (!t) return 'That template is gone'; const a = availability(t, lot, ui.dream); return a.ok ? null : a.why; },
    cmd: (ids) => ({ op: 'apply', lots: ids, t: d.t, p: { ...d.p }, vary: ui.vary ? 1 : 0, sd: uid('s'), dr: ui.dream ? 1 : 0 }) };

const UPGRADES = [
  { id: 'up.floor', name: 'Add a floor', icon: IC.floorUp, blurb: 'One more storey on what is there', fits: () => null, cmd: (ids) => ({ op: 'bump', lots: ids, d: 1 }) },
  { id: 'dn.floor', name: 'Remove a floor', icon: IC.floorDn, blurb: 'One storey lower', fits: () => null, cmd: (ids) => ({ op: 'bump', lots: ids, d: -1 }) },
  tweakItem('up.adu', 'Backyard ADU', IC.adu, 'A small home behind the house', { adu: 1 }, (l) => (HOMEY.has(l.lt) || TPL[l.prog.t]?.cat === 'house' ? null : 'ADUs go on house and small multi lots')),
  tweakItem('up.solar', 'Solar', IC.solar, 'Panels on every roof', { solar: 1 }),
  tweakItem('up.trees', 'More trees', IC.trees, 'Four more yard trees', { trees: 1 }),
  { id: 'restore', name: 'As-built', icon: IC.restore, blurb: 'Back to what is there today', fits: () => null, cmd: (ids) => ({ op: 'restore', lots: ids }) },
];
const ROOFS = ['hip', 'gable', 'flat', 'shed', 'garden'].map((k) => tweakItem('rf.' + k, ROOF_NAME[k], IC.roof(k), `${ROOF_NAME[k]} on every building`, { rf: k }));
const COLOURS = Object.entries(PAL).map(([k, p]) => tweakItem('pl.' + k, k[0].toUpperCase() + k.slice(1), IC.pal(p), `${k} walls and roof`, { pl: k }));
for (const it of [...UPGRADES, ...ROOFS, ...COLOURS]) it.fits = it.fits || (() => null);

// ---------- my designs (kept across areas, in this browser) ----------
const DKEY = 'renovated.designs.v1';
let designs = [];
try { designs = JSON.parse(localStorage.getItem(DKEY) || '[]'); if (!Array.isArray(designs)) designs = []; } catch (e) { designs = []; }
const saveDesigns = () => { try { localStorage.setItem(DKEY, JSON.stringify(designs)); } catch (e) { /* storage unavailable: designs last for this visit */ } };
const LOOK_KEYS = ['st', 'rf', 'pl', 'adu', 'trees', 'solar', 'fence', 'sb'];
function lookOf(lot, name) {
  const p = {}; for (const k of LOOK_KEYS) if (lot.prog[k] != null) p[k] = lot.prog[k];
  if (lot.prog.t === 'asb') delete p.st; // storeys of real buildings belong to that lot
  return { name, t: lot.prog.t, p };
}
function addDesign(lot, name) { const d = lookOf(lot, name); designs.push(d); saveDesigns(); return 'my:' + (designs.length - 1); }
function removeDesign(k) { designs.splice(k, 1); saveDesigns(); if (ui.item && ui.item.startsWith('my:')) ui.item = 'up.floor'; }
function copyLook(lot) { ui.copied = lookOf(lot, `Look of ${lot.a || 'this lot'}`); ui.item = 'copied'; }

// ---------- shelves ----------
function shelves() {
  const out = [];
  const mine = [...(ui.copied ? [lookItem('copied', ui.copied)] : []), ...designs.map((d, k) => lookItem('my:' + k, d))];
  if (mine.length) out.push({ k: 'mine', name: 'Copied and my designs', items: mine });
  out.push({ k: 'up', name: 'Upgrade what is there', items: UPGRADES });
  out.push({ k: 'roof', name: 'Roofs', items: ROOFS });
  out.push({ k: 'pal', name: 'Colours', items: COLOURS });
  for (const c of CATS) out.push({ k: c, name: 'Rebuild · ' + LT[c].name.replace(' lot', ''), items: TPL_BY_CAT[c].map(tplItem), col: LT[c].col });
  return out;
}
function itemById(id) {
  if (!id) return null;
  if (id === 'copied') return ui.copied ? lookItem('copied', ui.copied) : null;
  if (id.startsWith('my:')) { const d = designs[+id.slice(3)]; return d ? lookItem(id, d) : null; }
  if (id.startsWith('tpl:')) { const t = TPL[id.slice(4)]; return t ? tplItem(t) : null; }
  return [...UPGRADES, ...ROOFS, ...COLOURS].find((i) => i.id === id) || null;
}

// ---------- applying and previewing ----------
// Split lots into those the item fits and those it skips (with the reason), and build the command for the first group.
function plan(item, lots) {
  const ok = [], skipped = [];
  for (const l of lots) { const why = item.fits(l); if (why) skipped.push({ id: l.id, why }); else ok.push(l.id); }
  return { ok, skipped, cmd: ok.length ? item.cmd(ok) : null };
}
// What one lot would become: run the real command on a copy of the lot, then generate it.
function progAfter(item, lot) {
  const S = { lots: new Map([[lot.id, { ...lot, prog: { ...lot.prog } }]]) };
  try { exec(S, item.cmd([lot.id]), { skipped: [], notes: [] }); } catch (e) { return null; }
  const p = S.lots.get(lot.id).prog; if (p.sd == null) p.sd = hash32('ghost' + lot.id); return p;
}
// Homes and cost change over a set of lots (up to 40 counted exactly, the rest scaled)
function preview(item, lots) {
  let dh = 0, dc = 0, n = 0, skip = 0; const sample = lots.slice(0, 40);
  for (const l of sample) {
    if (item.fits(l)) { skip++; continue; }
    const p = progAfter(item, l); if (!p) continue;
    const g0 = world.gens.get(l.id) || genCached(l, STATE), g1 = genLot({ ...l, prog: p }, STATE);
    dh += g1.units - g0.units; dc += Math.max(0, g1.cost - g0.cost); n++;
  }
  const k = sample.length ? lots.length / sample.length : 1;
  return { homes: Math.round(dh * k), cost: dc * k, fits: Math.round(n * k), skip: Math.round(skip * k) };
}
const money = (v) => (v >= 1e6 ? '$' + (v / 1e6).toFixed(1) + 'M' : v >= 1e3 ? '$' + fmt(v / 1e3) + 'k' : v > 0 ? '$' + fmt(v) : 'free');
const previewText = (pv) => `${pv.homes ? `${pv.homes > 0 ? '+' : '−'}${fmt(Math.abs(pv.homes))} home${Math.abs(pv.homes) === 1 ? '' : 's'} · ` : ''}${money(pv.cost)}${pv.skip ? ` · ${fmt(pv.skip)} won't fit` : ''}`;

// ---------- suggestions for the Look card ----------
const SUGGEST = {
  house: ['up.adu', 'up.floor', 'tpl:sb9.duplex', 'tpl:mf.court4'],
  multi: ['up.floor', 'up.solar', 'tpl:mf.stacked', 'tpl:apt.court'],
  apts: ['up.floor', 'rf.garden', 'up.solar', 'tpl:apt.mid'],
  main: ['tpl:ms.mixed', 'up.floor', 'tpl:ms.market', 'tpl:pk.park'],
  parking: ['tpl:pk.solar', 'tpl:pk.plaza', 'tpl:pk.park', 'tpl:pk.apts'],
  civic: ['up.trees', 'tpl:cv.library', 'tpl:cv.play', 'tpl:cv.garden'],
  vacant: ['tpl:garden.house', 'tpl:cottage.pair', 'tpl:pk.park', 'tpl:cv.garden'],
};
function suggestions(lots) {
  const m = {}; for (const l of lots) m[l.lt] = (m[l.lt] || 0) + 1;
  const lt = Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] || 'house';
  return (SUGGEST[lt] || SUGGEST.house).map(itemById).filter(Boolean);
}

export { addDesign, copyLook, designs, itemById, plan, preview, previewText, progAfter, removeDesign, shelves, suggestions };
