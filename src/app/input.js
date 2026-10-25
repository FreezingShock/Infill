import * as THREE from 'three';
import { AREA, AREAS, PACK } from '../engine/pack.js';
import { $, Acc, C, FT, X0, X1, Z0, Z1, area, clamp, decal, elev, esc, fmt, inPoly, nearestOnLine, polyLen, reduceMotion, ribbon, smoothLine } from '../engine/core.js';
import { LT, PRESETS, ZONE_CODES, rowWidth, zfam } from '../engine/model.js';
import { BASE, uid } from '../engine/commands.js';
import { CAM_OFF, MAT, SUN_OFF, cam, canvas, controls, hemi, renderer, resize, scene, sun } from './render.js';
import { buildProps, buildTerrain, buildWalks, genCached } from './scene.js';
import { CUR, C_SEL, IDX, LOG, STATE, ZONE_COL, beforeW, buildColor, buildEdgeSel, buildSel, commit, describe, helpers, load, loadEdits, ov, overlays, redo, refresh, save, selIds, setBasePark, setHover, setOv, setSel, tickRise, toast, ui, undo, world } from './state.js';
import { areaPreview, clearProfDraft, deleteEdges, renderCard, renderDraw } from './inspector.js';

// =====================================================================
// Tools and input
// =====================================================================
const ICONS = {
  select: '<path d="M3 2l10 6-4 1 3 5-2 1-3-5-3 3z" fill="currentColor"/>',
  box: '<rect x="2" y="3" width="12" height="10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.5 1.5"/>',
  lasso: '<path d="M8 2c4 0 6 2 6 4s-3 4-6 4-6-1.5-6-4S4 2 8 2zM5 10c-1 2 0 4 2 4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  brush: '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  along: '<path d="M1 11c4-6 9-6 14-2" fill="none" stroke="currentColor" stroke-width="2.2"/><rect x="3" y="2" width="3" height="3" fill="currentColor"/><rect x="9" y="1" width="3" height="3" fill="currentColor"/>',
  draw: '<path d="M2 14L14 2M2 14l1-4 3 3z" fill="currentColor" stroke="currentColor" stroke-width="1.6"/>',
  edit: '<path d="M1 12h14M1 6h14" stroke="currentColor" stroke-width="2"/><circle cx="5" cy="12" r="2" fill="currentColor"/><circle cx="11" cy="6" r="2" fill="currentColor"/>',
  area: '<path d="M2 2h12v12H2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.2"/>',
  zone: '<path d="M2 14l3-1 8-8-2-2-8 8z" fill="currentColor"/><path d="M10 14h5" stroke="currentColor" stroke-width="2"/>',
};
const TOOLS = [['select', 'Select', 'V'], ['box', 'Box', 'R'], ['lasso', 'Lasso', 'L'], ['brush', 'Brush', 'P'], ['along', 'Along street', 'S'], ['draw', 'Draw street', 'D'], ['edit', 'Edit streets', 'E'], ['area', 'New area', 'A'], ['zone', 'Paint zones', 'Z']];
const DRAG_TOOLS = new Set(['box', 'lasso', 'brush', 'along', 'zone']);
function renderTools() {
  $('tools').innerHTML = TOOLS.map(([k, n, key]) => `<button class="tool" data-tool="${k}" aria-pressed="${ui.tool === k}" title="${n} (${key})"><svg viewBox="0 0 16 16" aria-hidden="true">${ICONS[k]}</svg>${n}<kbd>${key}</kbd></button>`).join('');
  $('tools').querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
}
function setTool(t, keepArea) {
  if (ui.tool === 'area' && t !== 'area' && !keepArea) { ui.area = null; setOv('area', null); }
  if (t !== 'draw') ui.draw = null;
  ui.tool = t; ui.areaDraw = null;
  const drag = DRAG_TOOLS.has(t);
  controls.mouseButtons.LEFT = drag ? -1 : THREE.MOUSE.PAN; controls.mouseButtons.RIGHT = drag ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.touches.ONE = drag ? -1 : THREE.TOUCH.PAN;
  if (t !== 'edit') { ui.edgeSel.clear(); buildEdgeSel(); }
  setOv('brush', null); setOv('draw', null); setOv('along', null); setOv('zonepaint', null); setHover(null);
  renderTools(); renderHint(); renderCard(); placeHandles();
  if (t === 'area' && ui.area) areaPreview();
  canvas.style.cursor = t === 'select' ? '' : t === 'draw' || t === 'area' ? 'crosshair' : drag ? 'cell' : 'pointer';
}
function renderHint() {
  const h = $('hint'), t = ui.tool;
  const txt = {
    select: null,
    box: '<b>Box</b> Drag a rectangle. Shift adds, Alt removes. Right-drag pans.',
    lasso: '<b>Lasso</b> Draw a loop around lots. Shift adds, Alt removes.',
    brush: `<b>Paint brush</b> Hold and sweep to add lots, Alt to remove. Wheel sets the size (${fmt(ui.brushR * FT)} ft).`,
    along: `<b>Along a street</b> Press on a street and drag along it to pick every lot that fronts that stretch. <label class="check"><input type="checkbox" id="hBoth" ${ui.alongBoth ? 'checked' : ''}> Both sides of the street</label>`,
    draw: '<b>Draw street</b> Click points; double-click or Enter to finish. Drag to pan.',
    edit: '<b>Edit streets</b> Click a street to change its cross-section, Shift-click for more pieces, Delete removes it.',
    area: ui.area ? '<b>New area</b> Adjust the pattern in the panel, then build it.' : '<b>New area</b> Click around the land to clear (a parking lot, a block, the edge of town). Click the first point or double-click to close. Or select lots and use Lot ▸ Clear for new area.',
    zone: `<b>Paint zones</b> Sweep over lots to give them a zone, then fill them with matching templates. <span class="row"><select id="hZone" aria-label="Zone to paint">${ZONE_CODES.map((z) => `<option ${ui.zonePaint === z ? 'selected' : ''}>${z}</option>`).join('')}</select><button class="btn small" id="hFill">Fill painted lots</button></span>`,
  }[t];
  h.hidden = !txt; if (!txt) return; h.innerHTML = txt;
  const b = $('hBoth'); if (b) b.onchange = () => (ui.alongBoth = b.checked);
  const z = $('hZone'); if (z) z.onchange = () => (ui.zonePaint = z.value);
  const f = $('hFill'); if (f) f.onclick = () => { const ids = selIds(); if (!ids.length) return toast('Paint some lots first.'); commit({ op: 'fill', lots: ids, sd: uid('f'), dr: ui.dream ? 1 : 0 }, { anim: ids, label: `Filled ${fmt(ids.length)} lots by zone` }); };
}

// ---------- picking ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function setRay(e) { const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, cam); }
function groundAt(e) { // walk the view ray down onto the terrain; hit-testing uses 2D lots, not meshes
  setRay(e); const o = ray.ray.origin, d = ray.ray.direction; let h = controls.target.y, x = 0, z = 0;
  for (let k = 0; k < 6; k++) { const t = (h - o.y) / d.y; x = o.x + d.x * t; z = o.z + d.z * t; h = elev(clamp(x, X0, X1), clamp(z, Z0, Z1)); }
  return [x, z];
}
function screenOf(x, y, z) { const v = new THREE.Vector3(x, y, z).project(cam), r = canvas.getBoundingClientRect(); return [(v.x + 1) / 2 * r.width, (1 - v.y) / 2 * r.height]; }
function edgeAt(x, z, pad = 4, onlyGraph = true) {
  let best = null;
  for (const e of STATE.edges.values()) { if (onlyGraph && !e.g) continue; const bb = e.bb; if (x < bb[0] - 30 || x > bb[2] + 30 || z < bb[1] - 30 || z > bb[3] + 30) continue; const q = nearestOnLine(e.p, x, z); const lim = rowWidth(e.prof) / 2 + pad; if (q.d < lim && (!best || q.d < best.d)) best = { e, d: q.d, q }; }
  return best;
}
const modeOf = (e) => (e.altKey ? 'remove' : e.shiftKey ? 'add' : 'replace');

let down = null, drag = null;
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, b: e.button, t: performance.now() };
  if (e.button !== 0) return;
  const t = ui.tool;
  if (DRAG_TOOLS.has(t)) {
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top];
    if (t === 'box') drag = { t, a: p, b: p, mode: modeOf(e) };
    else if (t === 'lasso') drag = { t, pts: [p], mode: modeOf(e) };
    else if (t === 'brush' || t === 'zone') { drag = { t, mode: e.altKey ? 'remove' : 'add', got: new Set() }; paintAt(e); }
    else if (t === 'along') { const g = groundAt(e), hit = edgeAt(g[0], g[1], 12); if (!hit) { toast('Press on a street, then drag along it.'); drag = null; return; } drag = { t, e: hit.e, path: [g], mode: modeOf(e), got: new Set() }; alongUpdate(); }
  }
});
canvas.addEventListener('pointermove', (e) => {
  const t = ui.tool;
  if (drag) {
    const r = canvas.getBoundingClientRect(), p = [e.clientX - r.left, e.clientY - r.top];
    if (drag.t === 'box') { drag.b = p; drawSvg(); }
    else if (drag.t === 'lasso') { const l = drag.pts[drag.pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 4) drag.pts.push(p); drawSvg(); }
    else if (drag.t === 'brush' || drag.t === 'zone') paintAt(e);
    else if (drag.t === 'along') { drag.path.push(groundAt(e)); alongUpdate(); }
    return;
  }
  if (e.buttons) return;
  const g = groundAt(e);
  if (t === 'brush' || t === 'zone') brushRing(g);
  if (t === 'draw' || (t === 'area' && !ui.area)) { hoverDraw(g, e); return; }
  if (t === 'edit') { const hit = edgeAt(g[0], g[1]); canvas.style.cursor = hit ? 'pointer' : ''; return; }
  const l = IDX && IDX.at(g[0], g[1]); setHover(l ? l.id : null);
});
canvas.addEventListener('pointerup', (e) => {
  const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
  if (drag) { const d = drag; drag = null; finishDrag(d, e); return; }
  if (!down || down.b !== 0 || moved > 6) return;
  const g = groundAt(e), t = ui.tool;
  if (t === 'select') { const l = IDX.at(g[0], g[1]); if (!l) { if (!e.shiftKey) setSel([]); return; } if (e.altKey) setSel([l.id], 'remove'); else if (e.shiftKey) { if (ui.sel.has(l.id)) setSel([l.id], 'remove'); else setSel([l.id], 'add'); } else setSel([l.id]); }
  else if (t === 'edit') { const hit = edgeAt(g[0], g[1]); if (!hit) { ui.edgeSel.clear(); } else if (e.shiftKey) { if (ui.edgeSel.has(hit.e.id)) ui.edgeSel.delete(hit.e.id); else ui.edgeSel.add(hit.e.id); } else ui.edgeSel = new Set([hit.e.id]); clearProfDraft(); ui.sel.clear(); buildSel(); buildEdgeSel(); renderCard(); }
  else if (t === 'draw') addDrawPoint(g, e);
  else if (t === 'area' && !ui.area) addAreaPoint(g, e);
});
canvas.addEventListener('dblclick', (e) => {
  const g = groundAt(e);
  if (ui.tool === 'select') { const l = IDX.at(g[0], g[1]); if (!l || l.blk < 0) return; const ids = [...STATE.lots.values()].filter((x) => x.blk === l.blk).map((x) => x.id); setSel(ids, e.shiftKey ? 'add' : 'replace'); toast(`Whole block: ${ids.length} lots.`); }
  else if (ui.tool === 'draw') { if (ui.draw) ui.draw.pts.pop(); finishDraw(); }
  else if (ui.tool === 'area' && ui.areaDraw) { ui.areaDraw.pts.pop(); closeArea(); }
});
canvas.addEventListener('wheel', (e) => {
  if ((ui.tool === 'brush' || ui.tool === 'zone') && !e.ctrlKey) { e.preventDefault(); e.stopImmediatePropagation(); ui.brushR = clamp(ui.brushR * (e.deltaY > 0 ? 0.88 : 1.14), 4, 120); brushRing(groundAt(e)); renderHint(); }
}, { capture: true, passive: false });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function finishDrag(d, e) {
  const svg = $('osvg'); svg.innerHTML = '';
  if (d.t === 'box' || d.t === 'lasso') {
    let poly;
    if (d.t === 'box') { const [x0, y0] = d.a, [x1, y1] = d.b; if (Math.abs(x1 - x0) < 4 && Math.abs(y1 - y0) < 4) { const g = groundAt(e), l = IDX.at(g[0], g[1]); if (l) setSel([l.id], d.mode === 'replace' ? 'replace' : d.mode); return; } poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
    else { if (d.pts.length < 3) return; poly = d.pts; }
    const ids = [];
    for (const l of STATE.lots.values()) { const [sx, sy] = screenOf(l.c[0], l.e, l.c[1]); if (inPoly(sx, sy, poly)) ids.push(l.id); }
    setSel(ids, d.mode); if (ids.length) toast(`${d.mode === 'remove' ? 'Removed' : 'Picked'} ${fmt(ids.length)} lots.`);
  } else if (d.t === 'brush') { buildSel(); renderCard(); }
  else if (d.t === 'zone') {
    setOv('zonepaint', null);
    const ids = [...d.got].filter((id) => STATE.lots.get(id)?.z !== ui.zonePaint);
    for (const id of d.got) ui.sel.add(id);
    if (ids.length) commit({ op: 'rezone', lots: ids, z: ui.zonePaint }, { label: `Painted ${fmt(ids.length)} lots ${ui.zonePaint}` }); else { buildSel(); renderCard(); }
  } else if (d.t === 'along') { setOv('along', null); setSel([...d.got], d.mode); toast(`${fmt(d.got.size)} lots front that stretch of ${d.e.n || 'the street'}.`); }
}
function drawSvg() {
  const svg = $('osvg'); if (!drag) { svg.innerHTML = ''; return; }
  const st = 'fill="rgba(62,159,220,.15)" stroke="#2b2420" stroke-width="2" stroke-dasharray="6 4"';
  if (drag.t === 'box') { const [x0, y0] = drag.a, [x1, y1] = drag.b; svg.innerHTML = `<rect x="${Math.min(x0, x1)}" y="${Math.min(y0, y1)}" width="${Math.abs(x1 - x0)}" height="${Math.abs(y1 - y0)}" ${st}/>`; }
  else svg.innerHTML = `<path d="M${drag.pts.map((p) => p.join(',')).join('L')}Z" ${st}/>`;
}
function paintAt(e) {
  const g = groundAt(e); brushRing(g); if (!IDX) return;
  const ls = IDX.near(g[0], g[1], ui.brushR);
  if (drag.t === 'brush') { for (const l of ls) { if (drag.mode === 'remove') ui.sel.delete(l.id); else ui.sel.add(l.id); } if (ls.size) buildSel(); }
  else { for (const l of ls) drag.got.add(l.id); const acc = new Acc(); for (const id of drag.got) decal(acc, STATE.lots.get(id).r, 0.7, C(ZONE_COL[zfam(ui.zonePaint)]), 16); setOv('zonepaint', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false }))); }
}
function brushRing(g) { const acc = new Acc(), pts = []; for (let k = 0; k <= 48; k++) { const a = k / 48 * Math.PI * 2; pts.push([g[0] + Math.cos(a) * ui.brushR, g[1] + Math.sin(a) * ui.brushR]); } ribbon(acc, pts, -0.35, 0.35, 1.2, C(ui.tool === 'zone' ? ZONE_COL[zfam(ui.zonePaint)] : 0x3e9fdc), 2); setOv('brush', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, depthTest: false }))); }
function sideOf(edge, g) { const q = nearestOnLine(edge.p, g[0], g[1]); const a = edge.p[q.i], b = edge.p[q.i + 1]; return Math.sign((b[0] - a[0]) * (g[1] - a[1]) - (b[1] - a[1]) * (g[0] - a[0])) || 1; }
function alongUpdate() {
  const d = drag, name = d.e.n, path = d.path.length > 1 ? d.path : [d.path[0], [d.path[0][0] + 0.1, d.path[0][1]]];
  d.got.clear();
  for (const l of STATE.lots.values()) {
    const e = STATE.edges.get(l.rd); if (!e) continue;
    if (name ? e.n !== name : e.id !== d.e.id) continue;
    if (nearestOnLine(path, l.fp[0], l.fp[1]).d > rowWidth(e.prof) / 2 + 14) continue;
    if (!ui.alongBoth && sideOf(e, l.c) !== sideOf(e, d.path[0])) continue;
    d.got.add(l.id);
  }
  const acc = new Acc(); ribbon(acc, path, -1.2, 1.2, 1.3, C(0xc4613b), 2); for (const id of d.got) decal(acc, STATE.lots.get(id).r, 0.7, C_SEL, 16);
  setOv('along', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })));
}

// ---------- drawing streets ----------
function snapPoint(g, e, prev, prev2) {
  let [x, z] = g, label = null; const tol = 9 / Math.sqrt(cam.zoom);
  // nodes first, then edge midpoints, then anywhere on a street
  let bn = -1, bd = tol; STATE.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd) { bd = d; bn = i; } });
  if (bn >= 0) return { p: STATE.nodes[bn].slice(), label: 'intersection' };
  for (const ed of STATE.edges.values()) { if (!ed.g) continue; const L = polyLen(ed.p); let acc = 0, mid = null; for (let i = 1; i < ed.p.length && !mid; i++) { const s = Math.hypot(ed.p[i][0] - ed.p[i - 1][0], ed.p[i][1] - ed.p[i - 1][1]); if (acc + s >= L / 2) { const t = (L / 2 - acc) / s; mid = [ed.p[i - 1][0] + (ed.p[i][0] - ed.p[i - 1][0]) * t, ed.p[i - 1][1] + (ed.p[i][1] - ed.p[i - 1][1]) * t]; } acc += s; } if (mid && Math.hypot(mid[0] - x, mid[1] - z) < tol * 0.8) return { p: mid, label: 'street midpoint' }; }
  if (prev) {
    const dx = x - prev[0], dz = z - prev[1], L = Math.hypot(dx, dz); let ang = Math.atan2(dz, dx);
    const ref = prev2 ? Math.atan2(prev[1] - prev2[1], prev[0] - prev2[0]) : null;
    const near = edgeAt(prev[0], prev[1], 3) || null, nearAng = near ? (() => { const a = near.e.p[near.q.i], b = near.e.p[near.q.i + 1]; return Math.atan2(b[1] - a[1], b[0] - a[0]); })() : null;
    const angDiff = (a, b) => { let d = ((a - b) % Math.PI + Math.PI * 1.5) % Math.PI - Math.PI / 2; return d; };
    if (e.shiftKey) { ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12); label = '15° step'; }
    else {
      const cands = []; if (nearAng != null) cands.push([nearAng + Math.PI / 2, '90° to the street'], [nearAng, 'along the street']); if (ref != null) cands.push([ref + Math.PI / 2, '90° turn'], [ref, 'straight on']);
      const par = edgeAt(x, z, 70); if (par && par.e !== near?.e) { const a = par.e.p[par.q.i], b = par.e.p[par.q.i + 1]; cands.push([Math.atan2(b[1] - a[1], b[0] - a[0]), `parallel to ${par.e.n || 'a street'}`]); }
      for (const [a, n] of cands) { const d = angDiff(ang, a); if (Math.abs(d) < 0.07) { ang -= d; label = n; break; } }
    }
    x = prev[0] + Math.cos(ang) * L; z = prev[1] + Math.sin(ang) * L;
  }
  const hit = edgeAt(x, z, 0); if (hit && hit.q.d < 3) { return { p: [hit.q.x, hit.q.z], label: 'onto ' + (hit.e.n || 'a street') }; }
  return { p: [x, z], label };
}
function hoverDraw(g, e) {
  const d = ui.tool === 'draw' ? ui.draw : ui.areaDraw, pts = d ? d.pts : [];
  const s = snapPoint(g, e, pts[pts.length - 1], pts[pts.length - 2]);
  if (ui.tool === 'draw') { ui.draw = ui.draw || { pts: [] }; ui.draw.cursor = s.p; ui.draw.snap = s.label; drawPreview(); }
  else { ui.areaDraw = ui.areaDraw || { pts: [] }; ui.areaDraw.cursor = s.p; areaDrawPreview(); }
  const n = $('card').querySelector('.note:last-of-type'); void n;
}
function addDrawPoint(g, e) {
  ui.draw = ui.draw || { pts: [] }; const pts = ui.draw.pts, s = snapPoint(g, e, pts[pts.length - 1], pts[pts.length - 2]);
  if (pts.length && Math.hypot(s.p[0] - pts[pts.length - 1][0], s.p[1] - pts[pts.length - 1][1]) < 1.5) return;
  pts.push(s.p); ui.draw.snap = s.label; drawPreview(); renderDraw();
}
function drawLine() { const d = ui.draw; if (!d) return []; const p = d.cursor && d.pts.length ? [...d.pts, d.cursor] : d.pts.slice(); return ui.smooth && p.length > 2 ? smoothLine(p) : p; }
function drawPreview() {
  const p = drawLine(); if (p.length < 2) { setOv('draw', null); return; }
  const prof = PRESETS[ui.drawProf], h = rowWidth(prof) / 2, acc = new Acc();
  ribbon(acc, p, -h, h, 1.0, C(0xc4613b), 3); ribbon(acc, p, -0.3, 0.3, 1.1, C(0x2b2420), 3);
  setOv('draw', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })));
}
function finishDraw() {
  const d = ui.draw; if (!d || d.pts.length < 2) { toast('A street needs at least two points.'); return; }
  const pts = ui.smooth && d.pts.length > 2 ? smoothLine(d.pts) : d.pts.slice();
  const id = uid('S'), name = ui.drawName.trim() || `New St ${LOG.filter((c) => c.op === 'street.add').length + 1}`;
  ui.draw = null; setOv('draw', null);
  commit({ op: 'street.add', id, pts: pts.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), raw: d.pts, prof: { k: ui.drawProf, els: structuredClone(PRESETS[ui.drawProf].els) }, name }, { label: `${name} built` });
  ui.drawName = '';
  setTool('edit'); ui.edgeSel = new Set([...STATE.edges.values()].filter((e) => e.grp === id).map((e) => e.id)); buildEdgeSel(); renderCard();
}
function addAreaPoint(g, e) {
  ui.areaDraw = ui.areaDraw || { pts: [] }; const pts = ui.areaDraw.pts, s = snapPoint(g, e, pts[pts.length - 1], pts[pts.length - 2]);
  if (pts.length > 2) { const [sx, sy] = screenOf(pts[0][0], elev(pts[0][0], pts[0][1]), pts[0][1]), r = canvas.getBoundingClientRect(); if (Math.hypot(sx - (e.clientX - r.left), sy - (e.clientY - r.top)) < 14) { closeArea(); return; } }
  pts.push(s.p); areaDrawPreview();
}
function areaDrawPreview() { const d = ui.areaDraw; if (!d) return; const p = d.cursor ? [...d.pts, d.cursor] : d.pts; if (p.length < 2) return; const acc = new Acc(); ribbon(acc, [...p, p[0]], -0.6, 0.6, 1.2, C(0xc4613b), 2); if (p.length > 2) decal(acc, p, 1.0, C(0xf2dfa2), 20); setOv('area', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }))); }
function closeArea() {
  const d = ui.areaDraw; ui.areaDraw = null; if (!d || d.pts.length < 3 || Math.abs(area(d.pts)) < 400) { setOv('area', null); return toast('Draw a bigger area: at least three points around about 4,000 ft².'); }
  ui.area = { region: d.pts.map((p) => [p[0], p[1]]), pattern: 'grid', bs: 80, lw: 14, ld: 30, prof: 'slow', zone: 'mix', fill: true };
  renderHint(); renderCard(); areaPreview();
}

// ---------- handles for reshaping drawn streets ----------
function placeHandles() {
  const box = $('labels'); box.querySelectorAll('.handle-dot').forEach((h) => h.remove());
  if (ui.tool !== 'edit' || !ui.edgeSel.size) return;
  const grp = STATE.edges.get([...ui.edgeSel][0])?.grp; if (!grp) return;
  const cmd = LOG.slice(0, CUR).find((c) => c.op === 'street.add' && c.id === grp); if (!cmd) return;
  const pts = (LOG.slice(0, CUR).filter((c) => c.op === 'street.move' && c.id === grp).pop()?.raw) || cmd.raw || cmd.pts;
  pts.forEach((p, i) => {
    const h = document.createElement('div'); h.className = 'handle-dot'; h.title = 'Drag to reshape'; h.dataset.i = i; box.appendChild(h);
    h._p = p.slice();
    h.onpointerdown = (ev) => { ev.stopPropagation(); h.setPointerCapture(ev.pointerId); controls.enabled = false; h._drag = true; };
    h.onpointermove = (ev) => { if (!h._drag) return; const g = groundAt(ev); h._p = g; const np = pts.map((q, k) => (k === i ? g : q)); const line = ui.smooth && np.length > 2 ? smoothLine(np) : np; const acc = new Acc(); ribbon(acc, line, -4, 4, 1.0, C(0xc4613b), 3); setOv('draw', new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }))); positionHandles(); };
    h.onpointerup = () => { if (!h._drag) return; h._drag = false; controls.enabled = true; setOv('draw', null); const np = pts.map((q, k) => (k === i ? h._p : q)); const line = np.length > 2 ? smoothLine(np) : np; commit({ op: 'street.move', id: grp, pts: line.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), raw: np }, { label: 'Street reshaped' }); ui.edgeSel = new Set([...STATE.edges.values()].filter((e) => e.grp === grp).map((e) => e.id)); buildEdgeSel(); renderCard(); };
  });
  positionHandles();
}
function positionHandles() { $('labels').querySelectorAll('.handle-dot').forEach((h) => { const p = h._p; const [x, y] = screenOf(p[0], elev(p[0], p[1]) + 1, p[1]); h.style.left = x + 'px'; h.style.top = y + 'px'; }); }

// ---------- keys ----------
window.addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('input, select, textarea')) { if (e.key === 'Escape') e.target.blur(); return; }
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'Escape') { if (!$('areas').hidden || !$('credits').hidden || !$('logm').hidden || !$('keysm').hidden) { closeModals(); return; } if (ui.draw && ui.draw.pts.length) { ui.draw = null; setOv('draw', null); renderCard(); return; } if (ui.areaDraw || ui.area) { ui.areaDraw = null; ui.area = null; setOv('area', null); renderCard(); renderHint(); return; } if (ui.edgeSel.size) { ui.edgeSel.clear(); buildEdgeSel(); renderCard(); return; } setSel([]); return; }
  if (e.key === 'Enter' && ui.tool === 'draw') { finishDraw(); return; }
  if (e.key === 'Enter' && ui.tool === 'area' && ui.areaDraw) { closeArea(); return; }
  if (e.key === 'Backspace' && ui.tool === 'draw' && ui.draw) { ui.draw.pts.pop(); drawPreview(); renderDraw(); e.preventDefault(); return; }
  if ((e.key === 'Delete' || e.key === 'Backspace') && ui.tool === 'edit' && ui.edgeSel.size) { e.preventDefault(); deleteEdges(); return; }
  const tool = TOOLS.find((t) => t[2].toLowerCase() === k); if (tool) { setTool(tool[0]); return; }
  if (k === 'b') toggleView('asbuilt'); else if (k === 'c') toggleView('split'); else if (k === 't') toggleView('color'); else if (k === 'n') toggleView('night');
  else if (k === 'q' || k === 'w') { const off = cam.position.clone().sub(controls.target); off.applyAxisAngle(new THREE.Vector3(0, 1, 0), (k === 'q' ? 1 : -1) * Math.PI / 12); cam.position.copy(controls.target).add(off); }
  else if (e.key === '?') { $('keysm').hidden = false; }
});

// ---------- view toggles ----------
function renderViews() {
  const B = (id, label, on, title) => `<button class="tool" id="${id}" aria-pressed="${on}" title="${title}">${label}</button>`;
  $('views').innerHTML = B('vAsb', 'As-built <kbd>B</kbd>', ui.asbuilt, 'Show the neighbourhood as it is today') + B('vSplit', 'Compare <kbd>C</kbd>', ui.splitOn, 'Before / after slider') +
    B('vColor', ['Colour lots', 'By lot type', 'By zone'][ui.color] + ' <kbd>T</kbd>', ui.color > 0, 'Colour lots by type or zone') + B('vLines', 'Lot lines', ui.lotsOn, 'Show lot lines') + B('vNight', 'Night <kbd>N</kbd>', ui.night, 'Night lighting') +
    `<button class="tool" id="vUndo" ${CUR ? '' : 'disabled'} title="Undo (Ctrl+Z)">Undo</button><button class="tool" id="vRedo" ${CUR < LOG.length ? '' : 'disabled'} title="Redo (Ctrl+Y)">Redo</button>` +
    `<button class="tool" id="vLog" title="Every edit, export and import">Edit log · ${CUR}</button><button class="tool" id="vKeys" title="Keys and mouse">?</button><button class="tool" id="vCred">Credits</button>`;
  const on = (id, f) => ($(id).onclick = f);
  on('vAsb', () => toggleView('asbuilt')); on('vSplit', () => toggleView('split')); on('vColor', () => toggleView('color')); on('vLines', () => toggleView('lines')); on('vNight', () => toggleView('night'));
  on('vUndo', undo); on('vRedo', redo); on('vLog', openLog); on('vKeys', () => ($('keysm').hidden = false)); on('vCred', () => ($('credits').hidden = false));
}
let lampMat = null;
function toggleView(k) {
  if (k === 'asbuilt') { ui.asbuilt = !ui.asbuilt; if (ui.asbuilt) ui.splitOn = false; $('asbTag').hidden = !ui.asbuilt; }
  else if (k === 'split') { ui.splitOn = !ui.splitOn; if (ui.splitOn) ui.asbuilt = false; $('asbTag').hidden = true; placeSplit(); }
  else if (k === 'color') { ui.color = (ui.color + 1) % 3; buildColor(); }
  else if (k === 'lines') { ui.lotsOn = !ui.lotsOn; if (ov.lines) ov.lines.visible = ui.lotsOn; }
  else if (k === 'night') {
    ui.night = !ui.night; $('app').classList.toggle('night', ui.night);
    hemi.intensity = ui.night ? 0.35 : 1.15; sun.intensity = ui.night ? 0.45 : 2.1; sun.color.set(ui.night ? 0x9fb4e8 : 0xfff1d6);
    MAT.glass.emissive.set(ui.night ? 0x9a7a40 : 0x000000); if (lampMat) lampMat.emissive.set(ui.night ? 0xffd27a : 0x000000);
  }
  placeSplit(); renderViews();
}
const splitEl = $('split'), handle = $('splitHandle');
function placeSplit() { splitEl.hidden = !ui.splitOn; splitEl.style.left = ui.split * 100 + '%'; handle.setAttribute('aria-valuenow', Math.round(ui.split * 100)); }
handle.addEventListener('pointerdown', (e) => {
  handle.setPointerCapture(e.pointerId);
  const mv = (ev) => { const r = canvas.getBoundingClientRect(); ui.split = clamp((ev.clientX - r.left) / r.width, 0.05, 0.95); placeSplit(); };
  const upf = () => { handle.removeEventListener('pointermove', mv); handle.removeEventListener('pointerup', upf); };
  handle.addEventListener('pointermove', mv); handle.addEventListener('pointerup', upf);
});
handle.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') ui.split = Math.max(0.05, ui.split - 0.05); if (e.key === 'ArrowRight') ui.split = Math.min(0.95, ui.split + 0.05); placeSplit(); });

// ---------- modals: area picker, credits, log, keys ----------
function closeModals() { for (const id of ['areas', 'credits', 'logm', 'keysm']) $(id).hidden = true; }
for (const [m, b] of [['credits', 'credClose'], ['logm', 'logClose'], ['keysm', 'keysClose']]) { $(b).onclick = () => ($(m).hidden = true); $(m).addEventListener('click', (e) => { if (e.target.id === m) $(m).hidden = true; }); }
let areaPick = AREA.id;
$('areaBtn').onclick = () => openAreas();
$('areaGo').onclick = () => {
  if (areaPick === AREA.id) { $('areas').hidden = true; save(); canvas.focus(); return; }
  save(); location.search = '?area=' + encodeURIComponent(areaPick);
};
function openAreas() { areaPick = AREA.id; renderAreaList(); drawAreaMap(); $('areas').hidden = false; }
function renderAreaList() {
  const list = AREAS.areas;
  $('alist').innerHTML = list.map((a) => `<button class="aitem${a.id === areaPick ? ' on' : ''}${a.status === 'ready' ? '' : ' planned'}" data-area="${esc(a.id)}" aria-pressed="${a.id === areaPick}"><b>${esc(a.name)}</b>${esc(a.sub || '')} · ${a.id === AREA.id ? 'loaded' : a.status === 'ready' ? 'ready' : 'needs a pack'}</button>`).join('');
  $('alist').querySelectorAll('[data-area]').forEach((b) => (b.onclick = () => { areaPick = b.dataset.area; renderAreaList(); drawAreaMap(); }));
  const pick = list.find((a) => a.id === areaPick), go = $('areaGo');
  go.disabled = !pick || pick.status !== 'ready';
  go.textContent = !pick ? 'Open' : pick.id === AREA.id ? `Back to ${pick.name}` : pick.status === 'ready' ? `Open ${pick.name}` : `${pick.name} needs a pack`;
}
function drawAreaMap() { // the Valley as a lon/lat frame with every area's rectangle; the loaded one shows its streets
  const cv = $('areaMap'), g = cv.getContext('2d'), W = cv.width, H = cv.height, pad = 18;
  const rb = AREAS.region?.bbox || AREA.bbox || [-118.68, 34.13, -118.33, 34.31], ky = 1 / Math.cos(((rb[1] + rb[3]) / 2) * Math.PI / 180);
  const s = Math.min((W - 2 * pad) / (rb[2] - rb[0]), (H - 2 * pad) / ((rb[3] - rb[1]) * ky)), ox = (W - (rb[2] - rb[0]) * s) / 2, oy = (H - (rb[3] - rb[1]) * ky * s) / 2;
  const LL = (lon, lat) => [ox + (lon - rb[0]) * s, oy + (rb[3] - lat) * ky * s];
  g.fillStyle = '#e7e1cf'; g.fillRect(0, 0, W, H);
  g.strokeStyle = 'rgba(93,81,72,.18)'; g.lineWidth = 1;
  for (let lon = Math.ceil(rb[0] * 50) / 50; lon < rb[2]; lon += 0.02) { const a = LL(lon, rb[1]), b = LL(lon, rb[3]); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  for (let lat = Math.ceil(rb[1] * 50) / 50; lat < rb[3]; lat += 0.02) { const a = LL(rb[0], lat), b = LL(rb[2], lat); g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); }
  // the loaded pack's streets, placed by its lon/lat origin (x east, z south, metres)
  const o = PACK.origin, KX = Math.cos(o[1] * Math.PI / 180) * 111320, KY = 110540;
  const M = (x, z) => LL(o[0] + x / KX, o[1] - z / KY);
  g.lineCap = 'round';
  for (const e of BASE.edges.values()) { if (!e.g) continue; g.strokeStyle = e.c === 'primary' ? '#c4613b' : '#8a7f72'; g.lineWidth = e.c === 'primary' ? 1.6 : 0.7; g.beginPath(); e.p.forEach((p, i) => { const q = M(p[0], p[1]); i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]); }); g.stroke(); }
  for (const a of AREAS.areas) {
    if (!a.bbox) continue;
    const p = LL(a.bbox[0], a.bbox[3]), q = LL(a.bbox[2], a.bbox[1]), on = a.id === areaPick;
    g.setLineDash(a.status === 'ready' ? [] : [4, 3]); g.lineWidth = on ? 3 : 1.5; g.strokeStyle = on ? '#c4613b' : '#2b2420';
    g.fillStyle = on ? 'rgba(196,97,59,.22)' : a.status === 'ready' ? 'rgba(142,166,122,.35)' : 'rgba(246,237,217,.6)';
    g.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); g.strokeRect(p[0], p[1], q[0] - p[0], q[1] - p[1]);
    g.setLineDash([]); g.fillStyle = '#2b2420'; g.font = `${on ? 700 : 500} ${on ? 13 : 11}px Fraunces, Georgia, serif`; g.fillText(a.name, p[0], p[1] - 4);
  }
  g.font = '12px Capriola, sans-serif'; g.fillStyle = '#5d5148'; g.fillText(AREAS.region?.name || '', pad, H - 10); g.fillText('N ↑', W - 40, 22);
}
function openLog() {
  $('logList').innerHTML = LOG.length ? LOG.map((c, i) => `<li class="${i >= CUR ? 'undone' : ''}"><b>${i + 1}.</b> ${esc(describe(c))} <code>${esc(c.op)}</code></li>`).join('') : '<li>No edits yet. The city is the base pack.</li>';
  $('logm').hidden = false;
}
$('logExport').onclick = () => {
  const txt = JSON.stringify({ kind: 'renovated-save', pack: `${AREA.id}.v2`, saved: new Date().toISOString(), log: LOG.slice(0, CUR), groups: ui.groups });
  const ta = $('saveTxt'); ta.value = txt; ta.focus(); ta.select();
  try { navigator.clipboard.writeText(txt).then(() => toast('Save file copied. Paste it into a .json file to keep it.'), () => toast('Save text is selected below; copy it with Ctrl+C.')); } catch (e) { toast('Save text is selected below; copy it with Ctrl+C.'); }
};
$('logPaste').onclick = () => { try { const d = JSON.parse($('saveTxt').value); if (!Array.isArray(d.log)) throw new Error('no log'); loadLog(d.log, d.groups || {}); $('logm').hidden = true; toast(`Loaded ${d.log.length} edits.`); } catch (e) { toast('Paste a Renovated save into the box first.'); } };
$('logImport').onclick = () => $('file').click();
$('file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  try { const d = JSON.parse(await f.text()); if (!Array.isArray(d.log)) throw new Error('no log'); loadLog(d.log, d.groups || {}); $('logm').hidden = true; toast(`Loaded ${d.log.length} edits.${ui.lastInfo?.notes.length ? ' ' + ui.lastInfo.notes.length + ' no longer fit the base data and were flagged.' : ''}`); }
  catch (err) { toast('That file is not a Renovated save.'); }
});
$('logClear').onclick = () => { loadLog([], ui.groups); $('logm').hidden = true; toast('Back to the base pack. Your saved groups are kept.'); };
function loadLog(log, groups) { loadEdits(log); ui.groups = groups; ui.sel.clear(); ui.edgeSel.clear(); refresh(); save(); renderCard(); renderViews(); }
$('mReal').onclick = () => setMode(false); $('mDream').onclick = () => setMode(true);
function setMode(d) { ui.dream = d; $('mReal').classList.toggle('on', !d); $('mDream').classList.toggle('on', d); $('mReal').setAttribute('aria-checked', !d); $('mDream').setAttribute('aria-checked', d); save(); renderCard(); toast(d ? 'Dream mode: no setbacks, up to 8 storeys, any template on any lot.' : 'Real rules: simplified LA zoning for setbacks, height and uses.'); }

// ---------- search ----------
let hits = [], hi = 0;
const ABBR = { st: 'street', ave: 'avenue', av: 'avenue', dr: 'drive', blvd: 'boulevard', rd: 'road', ln: 'lane', pl: 'place' };
function search(q) {
  const toks = q.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).map((t) => ABBR[t] || t); if (!toks.length) return [];
  const out = []; for (const l of STATE.lots.values()) { if (!l.a) continue; const k = l.a.toLowerCase(); if (toks.every((t) => k.includes(t))) out.push(l); }
  return out.sort((a, b) => (a.a.toLowerCase().startsWith(toks[0]) ? 0 : 1) - (b.a.toLowerCase().startsWith(toks[0]) ? 0 : 1) || parseInt(a.a) - parseInt(b.a)).slice(0, 6);
}
function renderResults() { const ul = $('results'); ul.innerHTML = hits.map((l, k) => `<li><button type="button" role="option" data-k="${k}" class="${k === hi ? 'active' : ''}">${esc(l.a)}<small>${LT[l.lt].name}</small></button></li>`).join(''); ul.querySelectorAll('button').forEach((b) => (b.onclick = () => choose(+b.dataset.k))); }
function choose(k) { const l = hits[k]; if (!l) return; $('addr').value = l.a; hits = []; renderResults(); setTool('select'); setSel([l.id]); flyTo(l.c[0], l.c[1], Math.max(cam.zoom, 3.4)); }
$('addr').addEventListener('input', (e) => { hits = search(e.target.value); hi = 0; renderResults(); });
$('addr').addEventListener('keydown', (e) => { if (e.key === 'ArrowDown') { hi = Math.min(hi + 1, hits.length - 1); renderResults(); e.preventDefault(); } if (e.key === 'ArrowUp') { hi = Math.max(hi - 1, 0); renderResults(); e.preventDefault(); } if (e.key === 'Escape') { hits = []; renderResults(); } });
$('searchForm').addEventListener('submit', (e) => { e.preventDefault(); if (!hits.length) hits = search($('addr').value); if (hits.length) choose(hi); else toast('No address like that in this pack. Try Celes St or Don Pio Dr.'); });

// ---------- camera ----------
let anim = null;
function flyTo(x, z, zoom) {
  const from = controls.target.clone(), to = new THREE.Vector3(x, elev(x, z), z).add(cardShift(zoom)), z0 = cam.zoom, off = cam.position.clone().sub(controls.target), t0 = performance.now(), dur = reduceMotion ? 1 : 900;
  anim = (now) => { let k = Math.min((now - t0) / dur, 1); k = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; controls.target.lerpVectors(from, to, k); cam.position.copy(controls.target).add(off); cam.zoom = z0 + (zoom - z0) * k; cam.updateProjectionMatrix(); if (k >= 1) anim = null; };
}
function cardShift(zoom) { if (canvas.clientWidth < 760) return new THREE.Vector3(); const viewW = (cam.right - cam.left) / zoom, right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0); right.y = 0; right.normalize(); return right.multiplyScalar(viewW * 0.12); }

// ---------- street labels ----------
let labels = [];
function buildLabels() {
  const box = $('labels'); box.querySelectorAll('.st-label').forEach((l) => l.remove()); labels = [];
  const best = new Map();
  for (const e of STATE.edges.values()) { if (!e.n || !e.g || e.c === 'motorway') continue; const L = polyLen(e.p); if (!best.has(e.n) || best.get(e.n).L < L) best.set(e.n, { e, L }); }
  for (const [n, { e, L }] of best) {
    if (L < 50) continue;
    let acc = 0, pt = e.p[0]; for (let i = 1; i < e.p.length; i++) { const s = Math.hypot(e.p[i][0] - e.p[i - 1][0], e.p[i][1] - e.p[i - 1][1]); if (acc + s >= L / 2) { const t = (L / 2 - acc) / s; pt = [e.p[i - 1][0] + (e.p[i][0] - e.p[i - 1][0]) * t, e.p[i - 1][1] + (e.p[i][1] - e.p[i - 1][1]) * t]; break; } acc += s; }
    const el = document.createElement('span'); el.className = 'st-label' + (['primary', 'secondary'].includes(e.c) && !e.drawn ? ' major' : '') + (e.drawn ? ' new' : '');
    el.textContent = n.replace(/ Street$/, ' St').replace(/ Avenue$/, ' Ave').replace(/ Drive$/, ' Dr').replace(/ Boulevard$/, ' Blvd').replace(/ Road$/, ' Rd'); box.appendChild(el);
    labels.push({ el, v: new THREE.Vector3(pt[0], elev(pt[0], pt[1]) + 2, pt[1]), major: el.classList.contains('major') || e.drawn });
  }
}
function placeLabels() {
  const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3();
  for (const l of labels) { v.copy(l.v).project(cam); const show = Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05 && (l.major || cam.zoom > 0.8); l.el.style.display = show ? '' : 'none'; if (show) l.el.style.transform = `translate(${(v.x + 1) / 2 * w}px, ${(1 - v.y) / 2 * h}px) translate(-50%, -50%)`; }
}
function updateScale() {
  const per = (cam.right - cam.left) / cam.zoom / canvas.clientWidth, nice = [5, 10, 20, 25, 50, 100, 200, 250, 500];
  let m = nice[0]; for (const n of nice) if (n / per <= 110) m = n;
  $('scaleBar').style.width = m / per + 'px'; $('scaleTxt').textContent = `${m} m · ${fmt(m * FT)} ft`;
  $('needle').style.transform = `rotate(${controls.getAzimuthalAngle()}rad)`;
}

// =====================================================================
// Start
// =====================================================================
const [terrain, skirt] = buildTerrain();
const walks = buildWalks(), props = buildProps(); lampMat = props.userData.lampMat;
scene.add(terrain, skirt, walks, props, beforeW.group, world.group, overlays, helpers);
beforeW.sync(BASE);
const saved = load();
if (saved && Array.isArray(saved.log) && saved.log.length) { loadEdits(saved.log); ui.groups = saved.groups || {}; if (saved.dream) setMode(true); }
else if (saved) ui.groups = saved.groups || {};
setBasePark(Math.max(1, [...BASE.lots.values()].reduce((s, l) => s + genCached(l, BASE).park, 0)));
refresh();
renderTools(); renderViews(); renderHint(); renderCard(); placeSplit();
const start = (AREA.main && [...STATE.lots.values()].find((l) => (l.a || '').includes(AREA.main))) || STATE.lots.values().next().value;
controls.target.set(start.c[0], start.e, start.c[1]); cam.position.copy(controls.target).add(CAM_OFF);
resize(); cam.zoom = 1.5; cam.updateProjectionMatrix(); cam.updateMatrixWorld();
$('loading').remove();
if (!saved) openAreas();
addEventListener('resize', resize);
if (saved && saved.log && saved.log.length) toast(`Welcome back: ${saved.log.length} edits restored from this browser.`);

let lastShadowZoom = 0;
function frame(now) {
  if (anim) anim(now);
  controls.update(); tickRise(now);
  const t = controls.target; t.x = clamp(t.x, X0, X1); t.z = clamp(t.z, Z0, Z1);
  sun.position.copy(t).add(SUN_OFF); sun.target.position.copy(t);
  if (Math.abs(cam.zoom - lastShadowZoom) > 0.05) { const half = Math.min(500, Math.max(70, 330 / cam.zoom)); Object.assign(sun.shadow.camera, { left: -half, right: half, top: half, bottom: -half, near: 1, far: 1600 }); sun.shadow.camera.updateProjectionMatrix(); lastShadowZoom = cam.zoom; }
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (ui.splitOn) {
    const sx = Math.round(w * ui.split); renderer.setScissorTest(true);
    beforeW.group.visible = true; world.group.visible = false; overlays.visible = false; renderer.setScissor(0, 0, sx, h); renderer.setViewport(0, 0, w, h); renderer.render(scene, cam);
    beforeW.group.visible = false; world.group.visible = true; overlays.visible = true; renderer.setScissor(sx, 0, w - sx, h); renderer.render(scene, cam);
    renderer.setScissorTest(false);
  } else { beforeW.group.visible = ui.asbuilt; world.group.visible = !ui.asbuilt; overlays.visible = !ui.asbuilt; renderer.render(scene, cam); }
  placeLabels(); updateScale(); positionHandles();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

export {
  buildLabels,
  drawPreview,
  finishDraw,
  placeHandles,
  renderViews,
  setTool,
};
