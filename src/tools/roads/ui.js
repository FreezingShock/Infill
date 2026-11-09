import * as THREE from 'three';
import { Acc, C, FT, decal, esc, fmt, nearestOnLine, offsetLine, ribbon, smoothLine } from '../../engine/core.js';
import { PRESETS, rowWidth } from '../../engine/model.js';
import { uid } from '../../engine/commands.js';
import { STATE, commit, setOv, toast, ui } from '../../app/state.js';
import { CONTROLS, isJunction, nearestNode, nodeControl, nodeEdges } from './graph.js';
import { MODES, gridLines, parallel as parallelPath, shapePath, sideOfLine } from './shapes.js';

// =====================================================================
// Road tools UI: build modes (straight, curve, parallel, roundabout, street grid), intersection card,
// one-way and speed buttons, and the small markers that show each junction's control.
// input.js and inspector.js call in through roadClick / roadHover / roadsCard / roadModeBar / roadEdgeExtras.
// =====================================================================
const R = { mode: 'free', gap: 6, r: 14, gridSp: 70, node: -1, gridA: null, side: 1 };
const rd = (p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10];
const prof = () => ({ k: ui.drawProf, els: structuredClone(PRESETS[ui.drawProf].els) });
const overlay = (acc, op = 0.55) => new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: op, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
const ACC = 0xc4613b;

// the polyline the current mode builds from clicked points (used by preview and by finishDraw)
function roadPath(pts) { return shapePath(R.mode, pts, ui.smooth, smoothLine); }
const clickNeeded = () => (R.mode === 'line' ? 2 : R.mode === 'curve' ? 3 : 0);
const modeActive = () => R.mode !== 'free';

// ---------- parallel: the street the cursor is over, and its neighbours along the same road ----------
function chain(S, e0) {
  const out = [{ e: e0, s: 1 }], seen = new Set([e0.id]); const q = [{ e: e0, s: 1 }];
  while (q.length) {
    const { e, s } = q.shift();
    for (const [nd, atEnd] of [[e.b, true], [e.a, false]]) {
      for (const o of nodeEdges(S, nd)) {
        if (seen.has(o.id) || !e0.n || o.n !== e0.n || o.ring) continue;
        const flows = atEnd ? o.a === nd : o.b === nd; // does o continue in the same direction as e?
        const so = flows ? s : -s; seen.add(o.id); out.push({ e: o, s: so }); q.push({ e: o, s: so });
      }
    }
  }
  return out;
}
function parallelPlan(hit, g) {
  const side = sideOfLine(hit.e.p, g), wB = rowWidth(PRESETS[ui.drawProf]), plan = [];
  for (const { e, s } of chain(STATE, hit.e)) plan.push({ e, pts: parallelPath(e.p, rowWidth(e.prof), wB, R.gap, side * s) });
  return plan;
}

// ---------- hooks for input.js ----------
// Returns true when the click was used. ctx = { edgeAt, addDrawPoint, finishDraw, snapPoint }
function roadClick(g, e, ctx) {
  const drawing = ui.draw && ui.draw.pts.length;
  if (R.mode === 'free') {
    if (drawing || e.shiftKey) return false;
    const n = nearestNode(STATE, g[0], g[1], 7);
    if (n >= 0 && isJunction(STATE, n)) { selectNode(n); ctx.renderCard(); return true; }
    return false;
  }
  if (ui.edgeSel.size) { ui.edgeSel.clear(); ctx.clearSel(); }
  R.node = -1;
  if (R.mode === 'line' || R.mode === 'curve') { ctx.addDrawPoint(g, e); if (ui.draw.pts.length >= clickNeeded()) ctx.finishDraw(); return true; }
  if (R.mode === 'round') {
    const n = nearestNode(STATE, g[0], g[1], 10);
    if (n >= 0 && isJunction(STATE, n) && nodeControl(STATE, n) !== 'roundabout') commit({ op: 'node.roundabout', id: uid('RB'), node: n, r: R.r, rl: 'Junction became a roundabout' }, { label: 'Roundabout built' });
    else { const s = ctx.snapPoint(g, e, null, null); commit({ op: 'roundabout.new', id: uid('RB'), c: rd(s.p), r: R.r, rl: 'New roundabout' }, { label: 'Roundabout built' }); }
    setOv('draw', null); return true;
  }
  if (R.mode === 'grid') {
    const s = ctx.snapPoint(g, e, null, null).p;
    if (!R.gridA) { R.gridA = s; return true; }
    const lines = gridLines(R.gridA, s, R.gridSp), a = R.gridA; R.gridA = null; setOv('draw', null);
    if (!lines.length) { toast('Drag a bigger rectangle: at least 20 m each way.'); return true; }
    commit({ op: 'street.batch', id: uid('G'), streets: lines.map((p, k) => ({ pts: p.map(rd), prof: prof(), name: null, k })), rl: `Street grid (${lines.length} streets)` }, { label: `${lines.length} streets built` });
    void a; return true;
  }
  if (R.mode === 'parallel') {
    const hit = ctx.edgeAt(g[0], g[1], 6); if (!hit) { toast('Click an existing street to build alongside it.'); return true; }
    const plan = parallelPlan(hit, g); if (!plan.length) return true;
    commit({ op: 'street.batch', id: uid('P'), streets: plan.map((p) => ({ pts: p.pts.map(rd), prof: prof(), name: hit.e.n ? `${hit.e.n} parallel` : null })), rl: `Parallel street${plan.length > 1 ? ` (${plan.length} pieces)` : ''}` }, { label: 'Parallel street built' });
    setOv('draw', null); return true;
  }
  return false;
}
function roadHover(g, e, ctx) {
  if (R.mode === 'free') return false;
  if (R.mode === 'parallel') {
    const hit = ctx.edgeAt(g[0], g[1], 6); if (!hit) { setOv('draw', null); return true; }
    const acc = new Acc(), h = rowWidth(PRESETS[ui.drawProf]) / 2;
    for (const p of parallelPlan(hit, g)) { ribbon(acc, p.pts, -h, h, 1.0, C(ACC), 3); }
    setOv('draw', overlay(acc)); return true;
  }
  if (R.mode === 'round') {
    const n = nearestNode(STATE, g[0], g[1], 10), junc = n >= 0 && isJunction(STATE, n), c = junc ? STATE.nodes[n] : ctx.snapPoint(g, e, null, null).p;
    const acc = new Acc(), pts = []; for (let k = 0; k <= 32; k++) { const t = k / 32 * Math.PI * 2; pts.push([c[0] + Math.cos(t) * R.r, c[1] + Math.sin(t) * R.r]); }
    ribbon(acc, pts, -3.5, 3.5, 1.0, C(ACC), 3); setOv('draw', overlay(acc)); return true;
  }
  if (R.mode === 'grid') {
    if (!R.gridA) return false;
    const s = ctx.snapPoint(g, e, null, null).p, acc = new Acc();
    for (const p of gridLines(R.gridA, s, R.gridSp)) ribbon(acc, p, -3, 3, 1.0, C(ACC), 6);
    setOv('draw', overlay(acc)); return true;
  }
  return false; // line and curve use the normal draw preview
}

// ---------- mode bar (top of the Draw card) ----------
function roadModeBar(card, rerender) {
  const m = MODES[R.mode];
  const html = `<div class="row" role="radiogroup" aria-label="Road tool">${Object.entries(MODES).map(([k, v]) => `<button class="chipb ${R.mode === k ? 'on' : ''}" data-rmode="${k}">${v.name}</button>`).join('')}</div>
  <p class="note">${m.hint}</p>
  ${R.mode === 'parallel' ? `<div class="ctrl"><label for="rGap">Gap</label><input type="range" id="rGap" min="0" max="40" step="1" value="${R.gap}"><output>${fmt(R.gap * FT)} ft</output></div>` : ''}
  ${R.mode === 'round' ? `<div class="ctrl"><label for="rRad">Radius</label><input type="range" id="rRad" min="8" max="30" step="1" value="${R.r}"><output>${fmt(R.r * FT)} ft</output></div>` : ''}
  ${R.mode === 'grid' ? `<div class="ctrl"><label for="rSp">Block size</label><input type="range" id="rSp" min="40" max="160" step="5" value="${R.gridSp}"><output>${fmt(R.gridSp * FT)} ft</output></div>` : ''}`;
  card.insertAdjacentHTML('afterbegin', html);
  card.querySelectorAll('[data-rmode]').forEach((b) => (b.onclick = () => { R.mode = b.dataset.rmode; R.gridA = null; ui.draw = null; setOv('draw', null); rerender(); }));
  const bind = (id, key) => { const el = card.querySelector(id); if (el) el.oninput = (ev) => { R[key] = +ev.target.value; el.nextElementSibling.textContent = fmt(R[key] * FT) + ' ft'; }; };
  bind('#rGap', 'gap'); bind('#rRad', 'r'); bind('#rSp', 'gridSp');
}

// ---------- intersection ----------
function selectNode(n) { R.node = n; ui.sel.clear(); ui.edgeSel.clear(); ui.draw = null; setOv('draw', null); }
// Replaces the card while an intersection is selected. Returns true when it drew something.
function roadsCard(card, renderCard) {
  drawMarkers();
  if (ui.edgeSel.size || (ui.draw && ui.draw.pts.length)) R.node = -1;
  if (R.node < 0 || !STATE.nodes[R.node]) { R.node = -1; return false; }
  const n = R.node, es = nodeEdges(STATE, n), cur = nodeControl(STATE, n), auto = !(STATE.ctrl && STATE.ctrl[n]);
  const isRound = cur === 'roundabout';
  const names = [...new Set(es.map((e) => e.n || 'unnamed street'))].slice(0, 3).map(esc).join(' × ');
  card.innerHTML = `<div><div class="eyebrow">Intersection · ${es.length} streets${isRound ? ' · roundabout' : ''}</div><h2>${names || 'Intersection'}</h2></div>
  <h3>How cars cross <small>${auto ? 'automatic' : 'your choice'}</small></h3>
  <div class="row">${Object.entries(CONTROLS).filter(([k]) => k !== 'roundabout').map(([k, v]) => `<button class="chipb ${(k === 'auto' ? auto : !auto && cur === k) ? 'on' : ''}" data-ctrl="${k}" title="${v.hint}" ${isRound ? 'disabled' : ''}>${v.name}</button>`).join('')}</div>
  <div class="note">${isRound ? 'This junction is a roundabout. Undo to get the old junction back.' : `Now: ${CONTROLS[cur]?.name || cur}. ${CONTROLS[cur]?.hint || ''}`}</div>
  ${isRound ? '' : `<h3>Roundabout</h3><div class="ctrl"><label for="rRad">Radius</label><input type="range" id="rRad" min="8" max="30" step="1" value="${R.r}"><output>${fmt(R.r * FT)} ft</output></div>
  <div class="row"><button class="btn small" id="nRound">Make a roundabout</button><button class="btn ghost small" id="nTurn">Add left-turn lanes</button></div>`}
  <div class="row"><button class="btn ghost small" id="nDone">Done</button></div>
  <div class="src">A roundabout shortens each street where it meets the ring and clips lots under the ring. Turn lanes widen the streets that lack one, clipping lots beside them.</div>`;
  const q = (s) => card.querySelector(s);
  card.querySelectorAll('[data-ctrl]').forEach((b) => (b.onclick = () => { const t = b.dataset.ctrl; commit({ op: 'node.ctrl', nodes: [n], t, rl: `${CONTROLS[t].name} at an intersection` }, { label: `${CONTROLS[t].name} set` }); }));
  const rr = q('#rRad'); if (rr) rr.oninput = (ev) => { R.r = +ev.target.value; rr.nextElementSibling.textContent = fmt(R.r * FT) + ' ft'; };
  const rb = q('#nRound'); if (rb) rb.onclick = () => { commit({ op: 'node.roundabout', id: uid('RB'), node: n, r: R.r, rl: 'Junction became a roundabout' }, { label: 'Roundabout built' }); R.node = -1; renderCard(); };
  const tb = q('#nTurn'); if (tb) tb.onclick = () => addTurnLanes(es);
  q('#nDone').onclick = () => { R.node = -1; renderCard(); };
  void renderCard; return true;
}
// Insert a turn lane in the middle of every approaching street that has two or more car lanes and no turn lane yet.
function addTurnLanes(es) {
  const items = [];
  for (const e of es) {
    const els = e.prof.els; if (els.some((x) => x[0] === 'turn') || els.filter((x) => x[0] === 'lane').length < 2) continue;
    const next = structuredClone(els), idx = next.map((x) => x[0]), mid = Math.floor((idx.indexOf('lane') + idx.lastIndexOf('lane') + 1) / 2);
    next.splice(mid, 0, ['turn', 3.2]); items.push({ id: e.id, prof: { k: 'custom', els: next } });
  }
  if (!items.length) return toast('Every street here already has a turn lane, or is too narrow for one.');
  commit({ op: 'street.profs', id: uid('T'), items, rl: `Turn lanes on ${items.length} streets` }, { label: 'Turn lanes added' });
}

// ---------- one-way and speed, inside the street card ----------
function roadEdgeExtras(es) {
  const e = es[0], ow = e.oneway || 0, sp = e.speed || 0;
  return `<h3>Traffic <small>direction and speed</small></h3>
  <div class="row"><button class="chipb ${!ow ? 'on' : ''}" data-ow="0">Two-way</button><button class="chipb ${ow === 1 ? 'on' : ''}" data-ow="1" title="Cars drive the way the street was drawn">One-way ▸</button><button class="chipb ${ow === -1 ? 'on' : ''}" data-ow="-1">◂ One-way</button><button class="chipb" id="rFlip" ${ow ? '' : 'disabled'}>Flip</button></div>
  <div class="row">${[[0, 'Auto'], [15, '15 mph'], [25, '25 mph'], [35, '35 mph'], [45, '45 mph']].map(([v, n]) => `<button class="chipb ${sp === v ? 'on' : ''}" data-spd="${v}">${n}</button>`).join('')}</div>`;
}
function bindRoadEdgeExtras(card, es) {
  const ids = es.map((x) => x.id), ow = es[0].oneway || 0;
  const set = (dir) => commit({ op: 'street.oneway', ids, dir, rl: dir ? 'One-way street' : 'Two-way street' }, { label: dir ? 'One-way set' : 'Two-way set' });
  card.querySelectorAll('[data-ow]').forEach((b) => (b.onclick = () => set(+b.dataset.ow)));
  const f = card.querySelector('#rFlip'); if (f) f.onclick = () => set(-ow);
  card.querySelectorAll('[data-spd]').forEach((b) => (b.onclick = () => commit({ op: 'street.speed', ids, v: +b.dataset.spd, rl: 'Speed limit changed' }, { label: 'Speed limit set' })));
}

// ---------- markers: control at each junction, arrows on one-ways ----------
const CTRL_COL = { signal: 0x59b36a, allway: 0xd04a32, stop: 0xd04a32, yield: 0xe0b85a, roundabout: 0x3e9fdc };
function drawMarkers() {
  if (ui.tool !== 'roads') { setOv('rmarks', null); return; }
  const acc = new Acc(), seen = new Map();
  for (const e of STATE.edges.values()) if (e.g) for (const n of [e.a, e.b]) seen.set(n, (seen.get(n) || 0) + 1);
  const disc = (c, r, col) => decal(acc, Array.from({ length: 10 }, (_, k) => [c[0] + Math.cos(k / 10 * 6.2832) * r, c[1] + Math.sin(k / 10 * 6.2832) * r]), 1.1, C(col), 20);
  for (const [n, k] of seen) {
    if (k < 3 || !STATE.nodes[n]) continue;
    const t = nodeControl(STATE, n); if (t === 'none') continue;
    if (R.node === n) disc(STATE.nodes[n], 4.2, 0x3e9fdc);
    if (!(STATE.ctrl && STATE.ctrl[n]) && R.node !== n) continue; // only mark junctions you changed or selected
    disc(STATE.nodes[n], 1.7, 0x2b2420); disc(STATE.nodes[n], 1.2, CTRL_COL[t] || 0xaaaaaa);
  }
  for (const e of STATE.edges.values()) {
    if (!e.g || !e.oneway || e.ring) continue;
    const p = e.oneway === 1 ? e.p : e.p.slice().reverse(), q = nearestOnLine(p, p[0][0], p[0][1]); void q;
    let L = 0; const segs = []; for (let i = 1; i < p.length; i++) { const d = Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); segs.push(d); L += d; }
    for (let at = 12; at < L - 6; at += 30) {
      let acc2 = 0, i = 0; while (i < segs.length - 1 && acc2 + segs[i] < at) { acc2 += segs[i]; i++; }
      const t = (at - acc2) / (segs[i] || 1), a = p[i], b = p[i + 1], x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t, ux = (b[0] - a[0]) / (segs[i] || 1), uz = (b[1] - a[1]) / (segs[i] || 1);
      decal(acc, [[x + ux * 2.2, z + uz * 2.2], [x - ux * 1.2 - uz * 1.5, z - uz * 1.2 + ux * 1.5], [x - ux * 1.2 + uz * 1.5, z - uz * 1.2 - ux * 1.5]], 1.15, C(0xf5f2ea), 20);
    }
  }
  setOv('rmarks', overlay(acc, 0.9));
}

export { R as ROAD, bindRoadEdgeExtras, drawMarkers, modeActive, roadClick, roadEdgeExtras, roadHover, roadModeBar, roadPath, roadsCard, selectNode };
void offsetLine;
