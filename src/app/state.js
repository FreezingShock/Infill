import * as THREE from 'three';
import { AREA } from '../engine/pack.js';
import { $, Acc, C, FT, X0, X1, Z0, Z1, clamp, decal, densify, disposeTree, elev, esc, fmt, hash32, lineGeo, polyLen, reduceMotion, ribbon } from '../engine/core.js';
import { LT, PRESETS, WALKABLE, rowWidth, zfam } from '../engine/model.js';
import { TPL, availability, genLot } from '../engine/templates.js';
import { BASE, exec } from '../engine/commands.js';
import { MAT } from './render.js';
import { LotIndex, World, genCached, lotObject } from './scene.js';
import { renderCard } from './inspector.js';
import { buildLabels, renderViews } from './input.js';

// =====================================================================
// Builder: state, undo, overlays, scores
// =====================================================================
const SAVE_KEY = `renovated.builder.${AREA.id}.v2`;
let STATE = structuredClone(BASE), LOG = [], CUR = 0, SNAPS = [BASE], IDX = null;
const ui = { tool: 'select', sel: new Set(), filters: {}, groups: {}, dream: false, vary: true, tab: 'build', edgeSel: new Set(), splitOn: false, split: 0.5, asbuilt: false, color: 0, lotsOn: true, night: false,
  brushR: 18, alongBoth: true, zonePaint: 'R3-1', draw: null, area: null, skipped: null, scope: 'area', showOther: false, nStep: 3, drawProf: 'local', drawName: '', smooth: true, lastInfo: null,
  item: 'up.floor', copied: null, adv: false, custom: false, pick: [] };
const world = new World(), beforeW = new World();
const overlays = new THREE.Group(), helpers = new THREE.Group();
const C_SEL = C(0x3e9fdc), C_WARN = C(0xd04a32), C_HOVER = C(0xf5f2ea);
const LAND = (X1 - X0) * (Z1 - Z0);
let BASE_PARK = 1;
// the start-up code and the save loader replace the whole edit log through these
function loadEdits(log) { LOG = log.slice(); CUR = LOG.length; SNAPS = [BASE]; STATE = stateAt(CUR); }
function setBasePark(v) { BASE_PARK = v; }

function movesUpTo(i) { const m = {}; for (let k = 0; k < i; k++) if (LOG[k].op === 'street.move') m[LOG[k].id] = LOG[k].pts; return m; }
function stateAt(i) {
  let j = Math.min(i, SNAPS.length - 1); while (j > 0 && !SNAPS[j]) j--;
  const S = structuredClone(SNAPS[j]), moves = movesUpTo(i), info = { skipped: [], notes: [] };
  for (let k = j; k < i; k++) {
    const c = LOG[k], cmd = c.op === 'street.add' && moves[c.id] ? { ...c, pts: moves[c.id] } : c;
    try { exec(S, cmd, info); } catch (e) { console.warn(e); info.notes.push(`Edit ${k + 1} (${c.op}) no longer fits and was skipped`); }
    SNAPS[k + 1] = structuredClone(S);
  }
  ui.lastInfo = info; return S;
}
function dropSnapsAfterAdd(moveCmd) { const a = LOG.findIndex((c) => c.op === 'street.add' && c.id === moveCmd.id); if (a >= 0) SNAPS.length = Math.min(SNAPS.length, a + 1); }
function trimSnaps() { for (let k = 1; k < CUR - 24; k++) SNAPS[k] = undefined; }
function commit(cmd, opts = {}) {
  const before = scores();
  LOG.length = CUR; SNAPS.length = Math.min(SNAPS.length, CUR + 1);
  LOG.push(cmd);
  const info = { skipped: [], notes: [] };
  if (cmd.op === 'street.move') { dropSnapsAfterAdd(cmd); CUR++; STATE = stateAt(CUR); }
  else { try { exec(STATE, cmd, info); } catch (e) { console.warn(e); info.notes.push('That edit could not be applied to these shapes.'); } CUR++; SNAPS[CUR] = structuredClone(STATE); }
  trimSnaps();
  refresh(opts.anim);
  const after = scores();
  showDelta(before, after, opts.label);
  ui.skipped = [...(opts.skipped || []), ...info.skipped];
  if (info.notes.length) toast(info.notes.join(' '));
  save(); renderCard(); renderViews();
}
function undo() { if (!CUR) return toast('Nothing to undo.'); const c = LOG[CUR - 1]; const before = scores(); CUR--; if (c.op === 'street.move') dropSnapsAfterAdd(c); STATE = stateAt(CUR); refresh(); showDelta(before, scores(), 'Undid ' + describe(c).toLowerCase()); save(); renderCard(); renderViews(); }
function redo() { if (CUR >= LOG.length) return toast('Nothing to redo.'); const c = LOG[CUR]; const before = scores(); CUR++; if (c.op === 'street.move') dropSnapsAfterAdd(c); STATE = stateAt(CUR); refresh(); showDelta(before, scores(), 'Redid ' + describe(c).toLowerCase()); save(); renderCard(); renderViews(); }
function describe(c) {
  const n = (c.lots || []).length, L = (k) => `${fmt(k)} lot${k === 1 ? '' : 's'}`;
  switch (c.op) {
    case 'apply': return c.t === 'lot.clear' ? `Bulldozed ${L(n)}` : c.t === 'asb' ? `Restored ${L(n)}` : `${TPL[c.t]?.name || c.t} on ${L(n)}`;
    case 'bump': return `${c.d > 0 ? 'Added' : 'Removed'} a floor on ${L(n)}`;
    case 'tweak': return `Tweaked ${Object.keys(c.f).map((k) => ({ st: 'storeys', rf: 'roof', pl: 'palette', sb: 'setback', adu: 'ADU', trees: 'trees', solar: 'solar', fence: 'fence' }[k] || k)).join(', ')} on ${L(n)}`;
    case 'rezone': return `Rezoned ${L(n)} to ${c.z}`;
    case 'restore': return `Restored ${L(n)} as-built`;
    case 'fill': return `Filled ${L(n)} by zone`;
    case 'merge': return `Merged ${L(n)}`;
    case 'split': return c.mode === 'sb9' ? `SB 9 split of ${L(n)}` : `Split ${L(n)} into ${c.n}`;
    case 'street.add': return `New street${c.name ? ' ' + c.name : ''} (${PRESETS[c.prof.k]?.name || 'custom'})`;
    case 'street.move': return 'Reshaped a drawn street';
    case 'street.del': return `Removed ${c.ids.length} street piece${c.ids.length === 1 ? '' : 's'}`;
    case 'street.prof': return `${PRESETS[c.prof.k]?.name || 'Custom profile'} on ${c.ids.length} street piece${c.ids.length === 1 ? '' : 's'}`;
    case 'area.new': return `New area: ${({ grid: 'grid', curvy: 'curvilinear', super: 'superblock', own: 'your own streets' })[c.pattern]}`;
  }
  return c.op;
}

// ---------- refresh everything derived from STATE ----------
const animating = [];
function refresh(anim) {
  const ids = anim ? anim.filter((id) => STATE.lots.has(id)).slice(0, 450) : [];
  const hold = new Set(reduceMotion ? [] : ids);
  world.sync(STATE, hold);
  IDX = new LotIndex([...STATE.lots.values()]);
  for (const id of [...ui.sel]) if (!STATE.lots.has(id)) ui.sel.delete(id);
  for (const id of [...ui.edgeSel]) if (!STATE.edges.has(id)) ui.edgeSel.delete(id);
  if (hold.size) startRise([...hold]);
  buildLotLines(); buildColor(); buildFlags(); buildSel(); buildEdgeSel(); buildLabels(); renderHud();
}
function startRise(ids) {
  const t0 = performance.now(), span = Math.min(1600, 300 + ids.length * 6), grp = new THREE.Group(); overlays.add(grp);
  const items = ids.map((id, i) => {
    const lot = STATE.lots.get(id), g = world.gens.get(id); if (!lot || !g) return null;
    const o = lotObject([g]); o.traverse((m) => { if (m.geometry) m.geometry.translate(0, -lot.e, 0); }); o.position.y = lot.e; o.scale.y = 0.001; grp.add(o);
    return { o, d: (i / ids.length) * span };
  }).filter(Boolean);
  animating.push({ t0, items, grp, span });
}
function tickRise(now) {
  for (let k = animating.length - 1; k >= 0; k--) {
    const a = animating[k]; let done = true;
    for (const it of a.items) { let t = (now - a.t0 - it.d) / 450; if (t < 1) done = false; t = clamp(t, 0, 1); it.o.scale.y = Math.max(0.001, 1 - Math.pow(1 - t, 3) + Math.sin(t * Math.PI) * 0.06); }
    if (done) { overlays.remove(a.grp); disposeTree(a.grp); animating.splice(k, 1); world.sync(STATE); }
  }
}

// ---------- overlays ----------
const ov = {};
function setOv(key, obj) { if (ov[key]) { overlays.remove(ov[key]); disposeTree(ov[key]); } ov[key] = obj; if (obj) overlays.add(obj); }
function buildLotLines() {
  const p = [];
  for (const l of STATE.lots.values()) { const P = densify([...l.r, l.r[0]], 3); for (let i = 0; i < P.length - 1; i++) p.push(P[i][0], elev(P[i][0], P[i][1]) + 0.55, P[i][1], P[i + 1][0], elev(P[i + 1][0], P[i + 1][1]) + 0.55, P[i + 1][1]); }
  const o = new THREE.LineSegments(lineGeo(p), new THREE.LineBasicMaterial({ color: 0x5d5148, transparent: true, opacity: 0.3 })); o.visible = ui.lotsOn; setOv('lines', o);
}
const ZONE_COL = { R1: 0xf2dfa2, RE11: 0xe9d38a, R2: 0xf0b27a, R3: 0xe08a5a, RAS4: 0xc9735b, C2: 0xd3615a, P: 0x9a948c, PF: 0x7d9fc9, OS: 0x7fb069 };
function buildColor() {
  if (!ui.color) { setOv('color', null); return; }
  const acc = new Acc();
  for (const l of STATE.lots.values()) { const col = C(ui.color === 1 ? LT[l.lt]?.col ?? 0xcccccc : ZONE_COL[zfam(l.z)] ?? 0xcccccc); decal(acc, l.r, 0.62, col, 14); }
  const m = new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 })); m.renderOrder = 2; setOv('color', m);
}
function outlineMesh(rings, col, w = 0.45, y = 0.7) {
  const acc = new Acc(); for (const r of rings) ribbon(acc, [...r, r[0]], -w, w, y, col, 2);
  const m = new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8, depthTest: true })); m.renderOrder = 3; return m;
}
function buildFlags() { const rings = []; for (const l of STATE.lots.values()) { const g = world.gens.get(l.id); if (g && g.warn) rings.push(l.r); } setOv('flags', rings.length ? outlineMesh(rings, C_WARN, 0.35, 0.75) : null); }
function buildSel() {
  const ids = selIds(); if (!ids.length) { setOv('sel', null); return; }
  const grp = new THREE.Group(), acc = new Acc();
  for (const id of ids) decal(acc, STATE.lots.get(id).r, 0.66, C_SEL, 16);
  const fill = new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -9 }));
  grp.add(fill, outlineMesh(ids.map((id) => STATE.lots.get(id).r), C_SEL, 0.5, 0.8)); setOv('sel', grp);
}
function buildEdgeSel() {
  if (!ui.edgeSel.size) { setOv('edges', null); return; }
  const acc = new Acc();
  for (const id of ui.edgeSel) { const e = STATE.edges.get(id); const h = rowWidth(e.prof) / 2; ribbon(acc, e.p, -h, h, 0.9, C_SEL, 3); }
  const m = new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.42, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 3; setOv('edges', m);
}
let hoverId = null;
function setHover(id) { if (id === hoverId) return; hoverId = id; const l = id && STATE.lots.get(id); setOv('hover', l ? outlineMesh([l.r], C_HOVER, 0.3, 0.78) : null); }
function ghost(tid) { // a template over the whole selection (the Build tab's hover)
  if (!tid) { setOv('ghost', null); return; }
  const t = TPL[tid], list = [];
  for (const id of selIds()) { if (list.length >= 260) break; const lot = STATE.lots.get(id); if (availability(t, lot, ui.dream).ok) list.push([lot, { t: tid, sd: ui.vary ? hash32('ghost' + id) : 7, dr: ui.dream ? 1 : 0 }]); }
  ghostLots(list);
}
// see-through preview of lots with new programs: [[lot, prog], ...]
function ghostLots(list) {
  if (!list || !list.length) { setOv('ghost', null); return; }
  const s = new Acc();
  for (const [lot, prog] of list.slice(0, 260)) {
    const g = genLot({ ...lot, prog }, STATE);
    for (let k = 0; k < g.s.p.length; k++) s.p.push(g.s.p[k]); for (let k = 0; k < g.g.p.length; k++) s.p.push(g.g.p[k]); for (let k = 0; k < g.s.l.length; k++) s.l.push(g.s.l[k]);
  }
  const grp = new THREE.Group(); if (s.p.length) { const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(s.p, 3)); const m = new THREE.Mesh(geo, MAT.ghost); m.renderOrder = 5; grp.add(m); grp.add(new THREE.LineSegments(lineGeo(s.l), MAT.ghostLine)); }
  setOv('ghost', grp);
}

// ---------- scores ----------
function scores() {
  let homes = 0, park = 0, cost = 0, active = 0, mainish = 0, parks = 0;
  for (const lot of STATE.lots.values()) {
    const g = world.gens.get(lot.id) || genCached(lot, STATE);
    homes += g.units; park += g.park; cost += g.cost;
    if (lot.lt === 'main' || lot.lt === 'parking') { mainish++; if (['ms.shop', 'ms.mixed', 'ms.market', 'pk.plaza'].includes(lot.prog.t)) active++; }
    if (['pk.plaza', 'pk.park', 'cv.play', 'cv.garden', 'cv.court'].includes(lot.prog.t)) parks++;
  }
  let walkLen = 0, totLen = 0, streetCost = 0;
  for (const e of STATE.edges.values()) { if (!e.g || e.c === 'motorway') continue; const L = polyLen(e.p); totLen += L; if (WALKABLE.has(e.prof.k)) walkLen += L; if (e.prof.k !== 'asbuilt' && e.prof.k !== 'plain') streetCost += L * rowWidth(e.prof) * 900; }
  const trees = world.treeCount || 0;
  const walk = clamp(22 + 30 * active / Math.max(1, mainish) + 25 * walkLen / Math.max(1, totLen) + 12 * Math.min(1, parks / 10) + 11 * Math.max(0, 1 - park / BASE_PARK), 0, 100);
  return { homes, trees, shade: trees * 28 / LAND * 100, walk, park: park / 4046.86, budget: 500e6 - cost - streetCost };
}
const money = (v) => (v < 0 ? '−' : '') + '$' + (Math.abs(v) >= 1e6 ? (Math.abs(v) / 1e6).toFixed(Math.abs(v) >= 1e8 ? 0 : 1) + 'M' : fmt(Math.abs(v) / 1e3) + 'k');
function renderHud() {
  const s = scores();
  $('hud').innerHTML = `<div class="stat"><b>${fmt(s.homes)}</b><small>Homes</small></div><div class="stat"><b>${fmt(s.trees)}</b><small>Trees</small></div>
  <div class="stat"><b>${s.shade.toFixed(1)}%</b><small>Shade</small></div><div class="stat"><small>Walkability</small><div class="meter" title="${Math.round(s.walk)} of 100"><i style="width:${s.walk}%"></i></div></div>
  <div class="stat"><b>${s.park.toFixed(1)} ac</b><small>Parking</small></div><div class="stat"><b>${money(s.budget)}</b><small>Budget left</small></div>`;
}
let deltaT;
function showDelta(a, b, label) {
  const parts = [], d = (v, unit, good, f = (x) => fmt(Math.abs(x))) => { if (Math.abs(v) < (unit === 'ac' ? 0.05 : unit === '%' ? 0.05 : unit === 'walk' ? 0.5 : 0.5)) return; parts.push(`<span class="${(v > 0) === good ? 'up' : 'down'}">${v > 0 ? '+' : '−'}${f(v)}${unit === 'ac' ? ' ac parking' : unit === 'walk' ? ' walk' : unit === '%' ? '% shade' : ' ' + unit}</span>`); };
  d(b.homes - a.homes, 'homes', true); d(b.trees - a.trees, 'trees', true); d(b.park - a.park, 'ac', false, (x) => Math.abs(x).toFixed(1)); d(b.walk - a.walk, 'walk', true, (x) => Math.round(Math.abs(x)));
  const db = b.budget - a.budget; if (Math.abs(db) > 5000) parts.push(`<span class="${db > 0 ? 'up' : 'down'}">${db > 0 ? '+' : '−'}${money(Math.abs(db))}</span>`);
  const el = $('delta'); if (!parts.length && !label) { el.hidden = true; return; }
  el.innerHTML = (label ? `<span style="font:13px var(--body);color:var(--ink-soft)">${esc(label)}</span>` : '') + parts.join('');
  el.hidden = false; el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  clearTimeout(deltaT); deltaT = setTimeout(() => (el.hidden = true), 4200);
}
let toastT;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), 4200); }

// ---------- save / load ----------
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ log: LOG.slice(0, CUR), groups: ui.groups, dream: ui.dream })); } catch (e) { /* storage unavailable: edits last for this visit */ } }
function load() { try { return JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { return null; } }

// ---------- selection ----------
function passes(lot) {
  const f = ui.filters;
  if (f.lt && f.lt.size && !f.lt.has(lot.lt)) return false;
  const ft2 = lot.m2 * 10.764;
  if (f.minA != null && ft2 < f.minA) return false; if (f.maxA != null && ft2 > f.maxA) return false;
  if (f.minY != null && lot.yr < f.minY) return false; if (f.maxY != null && lot.yr > f.maxY) return false;
  const st = lotStories(lot); if (f.minSt != null && st < f.minSt) return false; if (f.maxSt != null && st > f.maxSt) return false;
  if (f.zone && zfam(lot.z) !== f.zone) return false;
  if (f.maxD != null && Math.hypot(lot.fp[0] - lot.c[0], lot.fp[1] - lot.c[1]) * FT > f.maxD) return false;
  return true;
}
const anyFilter = () => { const f = ui.filters; return (f.lt && f.lt.size) || ['minA', 'maxA', 'minY', 'maxY', 'minSt', 'maxSt', 'zone', 'maxD'].some((k) => f[k] != null && f[k] !== ''); };
function selIds() { const out = []; for (const id of ui.sel) { const l = STATE.lots.get(id); if (l && passes(l)) out.push(id); } return out; }
function setSel(ids, mode = 'replace') {
  if (mode === 'replace') ui.sel = new Set(ids);
  else if (mode === 'add') for (const id of ids) ui.sel.add(id);
  else for (const id of ids) ui.sel.delete(id);
  ui.skipped = null; ui.edgeSel.clear(); buildEdgeSel(); buildSel(); renderCard();
}
function lotStories(lot) { if (lot.prog.t === 'asb') return lot.prog.st || 0; const g = world.gens.get(lot.id); const t = TPL[lot.prog.t]; return lot.prog.st ?? (t ? t.st[2] : 1) ?? (g ? 1 : 0); }

export {
  CUR,
  C_SEL,
  IDX,
  LOG,
  STATE,
  ZONE_COL,
  anyFilter,
  beforeW,
  buildColor,
  buildEdgeSel,
  buildSel,
  commit,
  describe,
  ghost,
  ghostLots,
  helpers,
  load,
  loadEdits,
  lotStories,
  outlineMesh,
  ov,
  overlays,
  redo,
  refresh,
  save,
  scores,
  selIds,
  setBasePark,
  setHover,
  setOv,
  setSel,
  startRise,
  tickRise,
  toast,
  ui,
  undo,
  world,
};
