import * as THREE from 'three';
import { AREA } from '../engine/pack.js';
import { $, Acc, C, FT, area, clamp, esc, fmt, polyLen, reduceMotion, ribbon } from '../engine/core.js';
import { BLD, EL, ERA, ERA_NAME, LT, PAL, PRESETS, ZONES, ZONE_CODES, liveBuildings, rowWidth, zfam, zrule } from '../engine/model.js';
import { CATS, TPL, TPL_BY_CAT, availability } from '../engine/templates.js';
import { areaNew, uid } from '../engine/commands.js';
import { cam } from './render.js';
import { CUR, LOG, STATE, anyFilter, buildEdgeSel, buildSel, commit, ghost, ghostLots, lotStories, outlineMesh, save, scores, selIds, setOv, setSel, startRise, toast, ui, world } from './state.js';
import { drawPreview, finishDraw, placeHandles, renderHint, setTool } from './input.js';
import { addDesign, copyLook, designs, itemById, plan, preview, previewText, progAfter, removeDesign, shelves, suggestions } from './palette.js';

// =====================================================================
// Inspector
// =====================================================================
const card = $('card');
const ft2 = (m2) => fmt(m2 * 10.764) + ' ft²';
const lotName = (l) => l.a ? l.a.replace(/ Street$/, ' St').replace(/ Avenue$/, ' Ave').replace(/ Drive$/, ' Dr').replace(/ Boulevard$/, ' Blvd').replace(/ Road$/, ' Rd') : l.newArea ? `New lot ${l.id.split('.').pop()}` : l.freed ? `Freed land (former ${l.freed})` : l.split ? `Part of ${l.split}` : `Lot ${l.id}`;
const progName = (p) => p.t === 'asb' ? 'As-built' : TPL[p.t]?.name || p.t;
function breakdown(lots) { const m = {}; for (const l of lots) m[l.lt] = (m[l.lt] || 0) + 1; return Object.entries(m).sort((a, b) => b[1] - a[1]); }
function mixed(vals, fmtv = (v) => v) { const u = [...new Set(vals.map((v) => v ?? 'auto'))]; if (u.length === 1) return fmtv(u[0]); const nums = u.filter((v) => typeof v === 'number'); if (nums.length === u.length) return `${Math.min(...nums)}–${Math.max(...nums)}`; return 'mixed'; }

function renderCard() {
  if (ui.tool === 'build') return renderPalette();
  if (ui.tool === 'doze') return renderDoze();
  if (ui.tool === 'roads') return ui.edgeSel.size && !(ui.draw && ui.draw.pts.length) ? renderEdge() : renderDraw();
  if (ui.tool === 'draw') return renderDraw();
  if (ui.tool === 'area' && ui.area) return renderArea();
  if (ui.edgeSel.size) return renderEdge();
  const ids = selIds();
  if (!ids.length) return renderEmpty();
  const lots = ids.map((id) => STATE.lots.get(id)), one = lots.length === 1 ? lots[0] : null, bd = breakdown(lots);
  const head = one
    ? `<div><div class="eyebrow">${LT[one.lt].name} · ${progName(one.prog)}</div><h2>${esc(lotName(one))}</h2>${one.merged ? `<div class="alt">Merged from ${one.merged.slice(0, 3).map(esc).join(', ')}${one.merged.length > 3 ? '…' : ''}</div>` : ''}</div>`
    : `<div><div class="eyebrow">Selection</div><h2>${fmt(lots.length)} lots</h2></div>
       <div class="bd">${bd.map(([k, n]) => `<i style="width:${n / lots.length * 100}%;background:#${LT[k].col.toString(16).padStart(6, '0')}" title="${LT[k].name}: ${n}"></i>`).join('')}</div>
       <div class="chips">${bd.map(([k, n]) => `<span class="chip" style="color:var(--ink)"><i style="width:9px;height:9px;border-radius:3px;background:#${LT[k].col.toString(16).padStart(6, '0')};display:inline-block;border:1px solid var(--ink)"></i>${LT[k].name} ${n}</span>`).join('')}</div>`;
  const filt = anyFilter() ? `<div class="note">${fmt(lots.length)} of ${fmt(ui.sel.size)} picked lots match the filters. <a href="#" id="clrF">Clear filters</a></div>` : '';
  let body = '';
  if (ui.tab === 'build') body = tabBuild(lots);
  else if (ui.tab === 'tweak') body = tabTweak(lots);
  else if (ui.tab === 'lot') body = tabLot(lots, one);
  else body = tabSelect(lots, one);
  const skips = ui.skipped && ui.skipped.length ? `<div class="skips"><b>${ui.skipped.length} lot${ui.skipped.length === 1 ? '' : 's'} skipped</b><ul>${groupWhy(ui.skipped).map(([w, n]) => `<li>${esc(w)}${n > 1 ? ` <small>(${n})</small>` : ''}</li>`).join('')}</ul></div>` : '';
  const full = ui.custom || ui.adv;
  card.innerHTML = `${head}${filt}${quickBlock(lots, one)}${skips}
  <div class="row" style="justify-content:space-between"><button class="btn ghost small" id="cust" aria-expanded="${full}">${full ? 'Hide the details' : 'Customize every detail'}</button><button class="btn ghost small" id="clrSel" title="Esc">Clear</button></div>
  ${full ? `<div class="tabs" role="tablist">${['build', 'tweak', 'lot', 'select'].map((t) => `<button class="tab ${ui.tab === t ? 'on' : ''}" data-tab="${t}" role="tab" aria-selected="${ui.tab === t}">${{ build: 'Templates', tweak: 'Tweak', lot: 'Lot', select: 'Select' }[t]}</button>`).join('')}</div>${body}` : ''}
  <div class="src">Lot lines and zones are real (City of LA); years and units are mostly estimates. ${ui.dream ? '<b>Dream mode:</b> no setbacks, up to 8 storeys.' : '<b>Real rules:</b> simplified setbacks, height caps and uses per zone.'}</div>`;
  bindCard(lots, one); bindQuick(lots, one);
  fillQuick(lots);
  if (full && ui.tab === 'build') fillCounts(lots);
}
const groupWhy = (sk) => { const m = new Map(); for (const s of sk) m.set(s.why, (m.get(s.why) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6); };
function tabBuild(lots) {
  const cats = new Set(lots.map((l) => l.lt === 'vacant' ? null : l.lt).filter(Boolean)); if (lots.some((l) => l.lt === 'vacant') || !cats.size) CATS.forEach((c) => cats.add(c));
  const kit = (t) => `<button class="kit" data-t="${t.id}" title="${esc(t.blurb)}">${t.icon}${t.name}<span class="fit" data-fit="${t.id}">…</span></button>`;
  const sec = (c) => `<div class="catlabel"><i style="background:#${LT[c].col.toString(16).padStart(6, '0')}"></i>${LT[c].name}</div><div class="kits">${TPL_BY_CAT[c].map(kit).join('')}</div>`;
  const others = CATS.filter((c) => !cats.has(c));
  return `<h3>Apply a template <small>hover to preview</small></h3>
  <label class="check"><input type="checkbox" id="vary" ${ui.vary ? 'checked' : ''}> Vary per lot (new seed and style for each lot)</label>
  ${[...cats].filter((c) => CATS.includes(c)).map(sec).join('')}
  ${others.length ? `<button class="btn ghost small" id="others">${ui.showOther ? 'Hide' : 'Show'} templates for other lot types</button>${ui.showOther ? others.map(sec).join('') : ''}` : ''}
  <div class="row"><button class="btn ghost small" id="restore">Restore as-built</button><button class="btn ghost small" id="fillZone" title="Each lot gets a template that suits its zone">Fill by zone</button></div>`;
}
function fillCounts(lots) {
  const kits = [...card.querySelectorAll('[data-fit]')]; let i = 0;
  const step = () => {
    if (!card.contains(kits[0])) return;
    const t0 = performance.now();
    while (i < kits.length && performance.now() - t0 < 30) {
      const el = kits[i++], t = TPL[el.dataset.fit]; let ok = 0, why = null;
      for (const l of lots) { const a = availability(t, l, ui.dream); if (a.ok) ok++; else why = why || a.why; }
      el.textContent = lots.length === 1 ? (ok ? 'fits' : 'unavailable') : `fits ${fmt(ok)}/${fmt(lots.length)}`;
      const btn = el.parentElement; btn.classList.toggle('off', !ok); if (!ok && why) btn.title = why; else if (why) btn.title = `${t.blurb}. Some lots skip: ${why}`;
    }
    if (i < kits.length) setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function tabTweak(lots) {
  const P = lots.map((l) => l.prog), st = mixed(P.map((p) => p.st || null)), rf = mixed(P.map((p) => p.rf || null)), pl = mixed(P.map((p) => p.pl || null)), sb = mixed(P.map((p) => p.sb || 'std'));
  const chk = (k) => { const v = P.map((p) => !!p[k]); return v.every(Boolean) ? 'checked' : ''; }, ind = (k) => { const v = P.map((p) => !!p[k]); return v.some(Boolean) && !v.every(Boolean); };
  const fence = mixed(P.map((p) => p.fence || 'none'));
  return `<h3>Tweak fields <small>applies to all ${fmt(lots.length)}</small></h3>
  <div class="ctrl"><span>Storeys</span><span class="stepper"><button data-st="-1" aria-label="Fewer storeys">−</button><b>${st === 'auto' ? 'auto' : st}</b><button data-st="1" aria-label="More storeys">+</button></span><span></span></div>
  <div class="ctrl"><label for="rf">Roof</label><select id="rf">${[['', rf === 'mixed' ? 'mixed' : 'auto'], ['hip', 'Hip'], ['gable', 'Gable'], ['flat', 'Flat'], ['shed', 'Shed'], ['garden', 'Green roof']].map(([v, n]) => `<option value="${v}" ${rf === v ? 'selected' : ''}>${n}</option>`).join('')}</select><span></span></div>
  <div class="ctrl"><span>Palette</span><div class="swatches">${Object.entries(PAL).map(([k, v]) => `<button class="sw ${pl === k ? 'on' : ''}" data-pl="${k}" title="${k}" aria-label="${k} palette" style="background:#${v.w.toString(16).padStart(6, '0')};--r:#${v.r.toString(16).padStart(6, '0')}"></button>`).join('')}</div><span></span></div>
  <div class="note">Palette now: ${pl}. Roof now: ${rf}.</div>
  <div class="ctrl"><label for="sb">Setback</label><select id="sb">${[['std', 'Zone standard'], ['tight', 'Tight'], ['deep', 'Deep front yard']].map(([v, n]) => `<option value="${v}" ${sb === v ? 'selected' : ''}>${n}</option>`).join('')}${sb === 'mixed' ? '<option selected disabled>mixed</option>' : ''}</select><span></span></div>
  ${[['adu', 'Add a backyard ADU'], ['trees', 'Add trees'], ['solar', 'Solar on roofs']].map(([k, n]) => `<label class="check"><input type="checkbox" data-flag="${k}" ${chk(k)} ${ind(k) ? 'data-ind="1"' : ''}> ${n}${ind(k) ? ' <small class="note">(some)</small>' : ''}</label>`).join('')}
  <div class="ctrl"><label for="fence">Edges</label><select id="fence">${[['none', 'Open'], ['fence', 'Fence'], ['hedge', 'Hedge']].map(([v, n]) => `<option value="${v}" ${fence === v ? 'selected' : ''}>${n}</option>`).join('')}${fence === 'mixed' ? '<option selected disabled>mixed</option>' : ''}</select><span></span></div>
  <div class="note">Storeys follow each template's range${ui.dream ? '' : ' and the zone height cap (Real rules)'}.</div>`;
}
function tabLot(lots, one) {
  let h = '';
  if (one) {
    const blds = liveBuildings(one, STATE).map((i) => BLD[i]), tall = blds.reduce((m, b) => Math.max(m, b.h), 0), g = world.gens.get(one.id), e = STATE.edges.get(one.rd);
    h += `<dl class="facts">
      <div><dt>Lot${one.ain ? '' : ' (est.)'}</dt><dd>${ft2(one.m2)} <small>${fmt(one.m2)} m²</small></dd></div>
      <div><dt>Frontage</dt><dd>${fmt(one.fr * FT)} ft <small>on ${esc(e?.n || 'a street')}</small></dd></div>
      <div><dt>Zone${one.zr ? '' : ' (est.)'}</dt><dd>${esc(one.zr || one.z)}${one.zr && zfam(one.zr.replace(/^([\[(][A-Z]+[\])])+/, '')) !== zfam(one.z) ? ` <small>plays as ${esc(one.z)}</small>` : ''}</dd></div>
      <div><dt>Built${one.ys ? ' (permit)' : ' (est.)'}</dt><dd>${one.st0 ? one.yr : '–'} <small>${one.st0 ? ERA_NAME[ERA(one.yr)] : ''}</small></dd></div>
      <div><dt>Buildings now</dt><dd>${blds.length ? `${blds.length} · ${tall.toFixed(1)} m` : 'None'}</dd></div>
      <div><dt>Homes</dt><dd>${g ? fmt(g.units) : '–'}</dd></div>
      ${one.ain ? `<div><dt>Parcel (AIN)</dt><dd>${esc(one.ain.slice(0, 4) + '-' + one.ain.slice(4, 7) + '-' + one.ain.slice(7))}</dd></div>` : ''}
      ${one.gp ? `<div><dt>General plan</dt><dd>${esc(one.gp)}</dd></div>` : ''}
    </dl>
    <div><div class="eyebrow" style="margin-bottom:4px">Program</div><div class="prog">${esc(JSON.stringify(Object.fromEntries(Object.entries(one.prog).filter(([, v]) => v != null))))}</div></div>
    ${g && g.warn ? `<div class="skips">${esc(g.warn)}</div>` : ''}`;
  }
  h += `<h3>Rezone <small>${ui.dream ? 'Dream ignores zoning' : 'opens templates for that zone'}</small></h3>
  <div class="row"><select id="zsel" aria-label="Zone">${ZONE_CODES.map((z) => `<option value="${z}" ${one && one.z === z ? 'selected' : ''}>${z} · ${ZONES[zfam(z)].name.split(' ').slice(1).join(' ')}</option>`).join('')}</select><button class="btn small" id="rezone">Rezone ${lots.length > 1 ? fmt(lots.length) + ' lots' : ''}</button></div>
  <h3>Reshape lots</h3>
  <div class="row"><button class="btn ghost small" id="merge" ${lots.length < 2 || lots.length > 40 ? 'disabled' : ''} title="Union of the selected lots, for a courtyard building or park">Merge ${lots.length > 1 ? fmt(lots.length) : ''}</button>
  <button class="btn ghost small" id="sb9" title="Two lots, each at least 1,200 ft² and 40% of the original">SB 9 split</button>
  <span class="stepper"><button data-n="-1" aria-label="Fewer pieces">−</button><b>${ui.nStep} lots</b><button data-n="1" aria-label="More pieces">+</button></span><button class="btn ghost small" id="splitN">Subdivide</button></div>
  <div class="row"><button class="btn ghost small" id="clearArea" title="Clear these lots and lay out new streets and lots">Clear for new area</button><button class="btn ghost small" id="restore2">Restore as-built</button></div>`;
  return h;
}
function tabSelect(lots, one) {
  const f = ui.filters, ltOn = (k) => f.lt && f.lt.has(k);
  const gnames = Object.keys(ui.groups);
  return `<h3>Select similar <small>from ${one ? 'this lot' : 'the first lot'}</small></h3>
  <div class="row"><button class="chipb" data-sim="lt">Same lot type</button><button class="chipb" data-sim="t">Same template</button><button class="chipb" data-sim="era">Same era</button><button class="chipb" data-sim="z">Same zone</button></div>
  <div class="row" role="radiogroup" aria-label="Scope"><span class="note">Within</span><button class="chipb ${ui.scope === 'view' ? 'on' : ''}" data-scope="view">this view</button><button class="chipb ${ui.scope === 'area' ? 'on' : ''}" data-scope="area">whole area</button></div>
  <h3>Filters <small>narrow the selection</small></h3>
  <div class="chips">${Object.entries(LT).map(([k, v]) => `<button class="chipb ${ltOn(k) ? 'on' : ''}" data-flt="${k}"><i style="background:#${v.col.toString(16).padStart(6, '0')}"></i>${v.name}</button>`).join('')}</div>
  <div class="ctrl"><span>Lot size ft²</span><span class="row" style="flex-wrap:nowrap"><input class="inp" style="width:80px" type="number" id="fMinA" placeholder="min" value="${f.minA ?? ''}"><input class="inp" style="width:80px" type="number" id="fMaxA" placeholder="max" value="${f.maxA ?? ''}"></span><span></span></div>
  <div class="ctrl"><span>Year built</span><span class="row" style="flex-wrap:nowrap"><input class="inp" style="width:80px" type="number" id="fMinY" placeholder="from" value="${f.minY ?? ''}"><input class="inp" style="width:80px" type="number" id="fMaxY" placeholder="to" value="${f.maxY ?? ''}"></span><span></span></div>
  <div class="ctrl"><span>Storeys</span><span class="row" style="flex-wrap:nowrap"><input class="inp" style="width:80px" type="number" id="fMinSt" placeholder="min" value="${f.minSt ?? ''}"><input class="inp" style="width:80px" type="number" id="fMaxSt" placeholder="max" value="${f.maxSt ?? ''}"></span><span></span></div>
  <div class="ctrl"><label for="fZone">Zone</label><select id="fZone"><option value="">any</option>${Object.keys(ZONES).map((z) => `<option ${f.zone === z ? 'selected' : ''}>${z}</option>`).join('')}</select><span></span></div>
  <div class="ctrl"><label for="fD">Street ≤ ft</label><input class="inp" type="number" id="fD" placeholder="distance to street" value="${f.maxD ?? ''}"><span></span></div>
  <h3>Saved groups</h3>
  <div class="row"><input class="inp" id="gName" placeholder="e.g. ${esc(AREA.main || 'Main street')} frontage" style="flex:1"><button class="btn small" id="gSave">Save</button></div>
  ${gnames.length ? `<div class="chips">${gnames.map((g) => `<button class="chipb" data-group="${esc(g)}">${esc(g)} · ${ui.groups[g].length}</button>`).join('')}</div>` : '<div class="note">Name this selection to recall it later.</div>'}`;
}
// ---------- quick changes on the Look card ----------
function quickBlock(lots, one) {
  const sug = suggestions(lots);
  return `<h3>Quick changes <small>${lots.length > 1 ? `for all ${fmt(lots.length)}` : 'for this lot'}</small></h3>
  <div class="kits">${sug.map((it) => `<button class="kit" data-q="${esc(it.id)}" title="${esc(it.blurb)}">${it.icon}${esc(it.name)}<span class="fit" data-qfit="${esc(it.id)}">…</span></button>`).join('')}</div>
  <div class="row">${one ? '<button class="btn ghost small" id="qCopy" title="Pick up this lot\'s look, then click or drag it onto other lots">Copy look</button><button class="btn ghost small" id="qSave" title="Keep this look as your own one-click design">Save as my design</button>' : ''}<button class="btn ghost small" id="qBlock" title="Double-click a lot does the same">Whole block</button><button class="btn ghost small" id="qSim" title="Every lot of this type in view">Similar nearby</button><button class="btn ghost small" id="qBuild" title="All upgrades, roofs, colours and templates">More in Build</button></div>
  ${ui.naming ? `<div class="row"><input class="inp" id="dsName" style="flex:1" placeholder="Name, e.g. Celes St ranch refresh" value="${esc(one ? (one.a || '') : '')}" aria-label="Design name"><button class="btn small" id="dsSave">Save</button></div>` : ''}`;
}
function fillQuick(lots) {
  const els = [...card.querySelectorAll('[data-qfit]')]; let i = 0;
  const step = () => {
    if (!els.length || !card.contains(els[0]) || i >= els.length) return;
    const el = els[i++], it = itemById(el.dataset.qfit), pv = preview(it, lots);
    el.textContent = pv.fits ? previewText(pv) : 'doesn\'t fit';
    el.parentElement.classList.toggle('off', !pv.fits);
    setTimeout(step, 0);
  };
  setTimeout(step, 0);
}
function bindQuick(lots, one) {
  const q = (s) => card.querySelector(s);
  card.querySelectorAll('[data-q]').forEach((b) => {
    const it = itemById(b.dataset.q);
    b.onmouseenter = () => ghostLots(lots.slice(0, 120).filter((l) => !it.fits(l)).map((l) => [l, progAfter(it, l)]).filter((x) => x[1]));
    b.onmouseleave = () => ghostLots(null);
    b.onclick = () => { ghostLots(null); applyItem(it, lots); };
  });
  q('#cust').onclick = () => { ui.custom = !(ui.custom || ui.adv); if (!ui.custom && ui.adv) toast('The Advanced drawer keeps every detail open. Close it to hide them.'); renderCard(); };
  const cp = q('#qCopy'); if (cp) cp.onclick = () => { copyLook(one); setTool('build'); toast(`Copied. Click or drag across lots to paint this look onto them.`); };
  const sv = q('#qSave'); if (sv) sv.onclick = () => { ui.naming = !ui.naming; renderCard(); const n = q('#dsName'); if (n) n.focus(); };
  const ds = q('#dsSave'); if (ds) ds.onclick = () => { const name = q('#dsName').value.trim() || `My design ${designs.length + 1}`; ui.item = addDesign(one, name); ui.naming = false; renderCard(); toast(`Saved "${name}". It is on the Build palette under My designs.`); };
  q('#qBlock').onclick = () => { const blks = new Set(lots.map((l) => l.blk).filter((b) => b >= 0)); setSel([...STATE.lots.values()].filter((l) => blks.has(l.blk)).map((l) => l.id)); };
  q('#qSim').onclick = () => { ui.scope = 'view'; selectSimilar('lt', lots[0]); };
  q('#qBuild').onclick = () => setTool('build');
}
// Apply one palette item to lots: the fitting ones change, the rest are listed with the reason.
function applyItem(it, lots, how) {
  if (!it) return toast('Pick something on the Build palette first.');
  const { ok, skipped, cmd } = plan(it, lots);
  if (!cmd) { ui.skipped = skipped; renderCard(); toast(`${it.name} doesn't fit ${lots.length === 1 ? 'this lot' : 'any of these lots'}${skipped[0] ? ': ' + skipped[0].why : ''}.`); return; }
  commit(cmd, { anim: ok, skipped, label: `${it.name} on ${fmt(ok.length)} lot${ok.length === 1 ? '' : 's'}${how ? ' · ' + how : ''}` });
  if (skipped.length && ui.tool !== 'select') toast(`${fmt(skipped.length)} lot${skipped.length === 1 ? '' : 's'} skipped: ${skipped[0].why}.`);
}

// ---------- Build palette and Bulldoze card ----------
function renderPalette() {
  const cur = itemById(ui.item);
  card.innerHTML = `<div><div class="eyebrow">Build</div><h2>${esc(cur ? cur.name : 'Pick something to build')}</h2>${cur ? `<div class="alt">${esc(cur.blurb)}</div>` : ''}</div>
  <p>Pick an item, then click a lot or drag across lots, like painting tiles. Hover a lot to preview it.</p>
  ${shelves().map((sh) => `<div class="catlabel">${sh.col != null ? `<i style="background:#${sh.col.toString(16).padStart(6, '0')}"></i>` : ''}${esc(sh.name)}</div>
  <div class="kits ${sh.k === 'pal' || sh.k === 'roof' ? 'small' : ''}">${sh.items.map((it) => `<button class="kit ${ui.item === it.id ? 'on' : ''}" data-item="${esc(it.id)}" title="${esc(it.blurb)}" aria-pressed="${ui.item === it.id}">${it.icon}${esc(it.name)}</button>`).join('')}</div>`).join('')}
  <div class="row"><label class="check"><input type="checkbox" id="vary" ${ui.vary ? 'checked' : ''}> Vary each lot a little</label>${ui.item && ui.item.startsWith('my:') ? '<button class="btn ghost small" id="dsDel">Delete this design</button>' : ''}</div>
  <div class="src">Tip: with Look (V), click any lot and press <b>Copy look</b> to paint its style onto others, or <b>Save as my design</b> to keep it here.</div>`;
  card.querySelectorAll('[data-item]').forEach((b) => (b.onclick = () => { ui.item = b.dataset.item; renderPalette(); renderHint(); }));
  card.querySelector('#vary').onchange = (e) => { ui.vary = e.target.checked; };
  const dd = card.querySelector('#dsDel'); if (dd) dd.onclick = () => { removeDesign(+ui.item.slice(3)); ui.item = 'up.floor'; renderPalette(); renderHint(); };
}
function renderDoze() {
  card.innerHTML = `<div><div class="eyebrow">Bulldoze</div><h2>Clear lots and streets</h2></div>
  <p>Click a lot or drag across lots to clear them to grass, ready for something new. Click a street piece to remove it. Undo (Ctrl+Z) brings anything back.</p>
  <div class="src">Removing a street flags the lots that lose access and turns its land into new ground.</div>`;
}

function renderEmpty() {
  const s = scores();
  card.innerHTML = `<div><div class="eyebrow">Look</div><h2>Click a lot or a street</h2></div>
  <p>Click a lot to see quick changes for it, double-click for its whole block. Or press <b>Build</b> and click or drag across lots to change them directly.</p>
  <div class="row"><button class="btn small" id="qPark">Every parking lot</button><button class="btn ghost small" id="qTop">${esc(AREA.main || 'Main street')} frontage</button><button class="btn ghost small" id="qRanch">All 1945–65 ranch houses</button></div>
  <dl class="facts">
    <div><dt>Lots</dt><dd>${fmt(STATE.lots.size)}</dd></div><div><dt>Streets</dt><dd>${fmt([...STATE.edges.values()].filter((e) => e.g).length)} pieces</dd></div>
    <div><dt>Homes now</dt><dd>${fmt(s.homes)}</dd></div><div><dt>Edits</dt><dd>${CUR}${LOG.length > CUR ? ` <small>(${LOG.length - CUR} to redo)</small>` : ''}</dd></div>
  </dl>
  <div class="src">Lot lines are City of LA parcels and zones come from City zoning. Lot types are inferred from buildings and zone; most build years and unit counts are estimates. Press <b>B</b> any time for the as-built view, <b>?</b> for keys.</div>`;
  $('qPark').onclick = () => { setTool('select'); setSel([...STATE.lots.values()].filter((l) => l.lt === 'parking' || (l.pk.length && l.pk.reduce((a, r) => a + Math.abs(area(r)), 0) > l.m2 * 0.5 && !liveBuildings(l, STATE).length)).map((l) => l.id)); toast('Selected every parking lot. Try Plaza or Apartments with tuck-under parking.'); };
  $('qTop').onclick = () => { setSel([...STATE.lots.values()].filter((l) => (STATE.edges.get(l.rd)?.n || '').includes(AREA.main || '\u0000')).map((l) => l.id)); };
  $('qRanch').onclick = () => { setSel([...STATE.lots.values()].filter((l) => l.lt === 'house' && ERA(l.yr) === 'ranch').map((l) => l.id)); };
}
function bindCard(lots, one) {
  const ids = lots.map((l) => l.id), q = (s) => card.querySelector(s), qa = (s) => card.querySelectorAll(s);
  qa('[data-tab]').forEach((b) => (b.onclick = () => { ui.tab = b.dataset.tab; renderCard(); }));
  q('#clrSel').onclick = () => setSel([]);
  const cf = q('#clrF'); if (cf) cf.onclick = (e) => { e.preventDefault(); ui.filters = {}; buildSel(); renderCard(); };
  // build tab
  qa('.kit').forEach((b) => {
    b.onmouseenter = () => ghost(b.dataset.t); b.onmouseleave = () => ghost(null); b.onfocus = () => ghost(b.dataset.t); b.onblur = () => ghost(null);
    b.onclick = () => { ghost(null); applyTemplate(b.dataset.t, lots); };
  });
  const v = q('#vary'); if (v) v.onchange = () => { ui.vary = v.checked; };
  const o = q('#others'); if (o) o.onclick = () => { ui.showOther = !ui.showOther; renderCard(); };
  for (const id of ['#restore', '#restore2']) { const r = q(id); if (r) r.onclick = () => commit({ op: 'restore', lots: ids }, { anim: ids, label: `Restored ${fmt(ids.length)} lots as-built` }); }
  const fz = q('#fillZone'); if (fz) fz.onclick = () => commit({ op: 'fill', lots: ids, sd: uid('f'), dr: ui.dream ? 1 : 0 }, { anim: ids, label: `Filled ${fmt(ids.length)} lots by zone` });
  // tweak tab
  qa('[data-st]').forEach((b) => (b.onclick = () => {
    const d = +b.dataset.st, f = {}; const cur = lots.map((l) => l.prog.st || lotStories(l) || 1); const nv = clamp(Math.round(cur.reduce((a, c) => a + c, 0) / cur.length) + d, 1, ui.dream ? 8 : 6);
    f.st = nv; const capped = ui.dream ? 0 : lots.filter((l) => zrule(l.z).st < nv).length;
    commit({ op: 'tweak', lots: ids, f }, { anim: ids, label: `${nv} storeys on ${fmt(ids.length)} lots` });
    if (capped) toast(`${fmt(capped)} lot${capped === 1 ? '' : 's'} stay lower: the zone caps height under Real rules.`);
  }));
  const rf = q('#rf'); if (rf) rf.onchange = () => commit({ op: 'tweak', lots: ids, f: { rf: rf.value || null } }, { label: 'Roofs changed' });
  qa('[data-pl]').forEach((b) => (b.onclick = () => commit({ op: 'tweak', lots: ids, f: { pl: b.dataset.pl } }, { label: `${b.dataset.pl} palette` })));
  const sb = q('#sb'); if (sb) sb.onchange = () => commit({ op: 'tweak', lots: ids, f: { sb: sb.value === 'std' ? null : sb.value } }, { anim: ids, label: 'Setbacks changed' });
  qa('[data-flag]').forEach((c) => { if (c.dataset.ind) c.indeterminate = true; c.onchange = () => commit({ op: 'tweak', lots: ids, f: { [c.dataset.flag]: c.checked ? 1 : null } }, { anim: c.dataset.flag === 'adu' ? ids : null, label: { adu: 'ADUs', trees: 'Trees', solar: 'Solar' }[c.dataset.flag] + (c.checked ? ' added' : ' removed') }); });
  const fe = q('#fence'); if (fe) fe.onchange = () => commit({ op: 'tweak', lots: ids, f: { fence: fe.value === 'none' ? null : fe.value } }, { label: fe.value === 'none' ? 'Open edges' : fe.value === 'fence' ? 'Fences' : 'Hedges' });
  // lot tab
  const rz = q('#rezone'); if (rz) rz.onclick = () => commit({ op: 'rezone', lots: ids, z: q('#zsel').value }, { label: `Rezoned ${fmt(ids.length)} to ${q('#zsel').value}` });
  const mg = q('#merge'); if (mg) mg.onclick = () => { const id = uid('M'); commit({ op: 'merge', lots: ids, id }, { label: `Merged ${ids.length} lots` }); if (STATE.lots.has(id)) setSel([id]); };
  const s9 = q('#sb9'); if (s9) s9.onclick = () => { const id = uid('P'); commit({ op: 'split', lots: ids, mode: 'sb9', id }, { label: 'SB 9 split' }); setSel([...STATE.lots.keys()].filter((k) => k.startsWith(id))); };
  qa('[data-n]').forEach((b) => (b.onclick = () => { ui.nStep = clamp(ui.nStep + +b.dataset.n, 2, 12); renderCard(); }));
  const sn = q('#splitN'); if (sn) sn.onclick = () => { const id = uid('P'); commit({ op: 'split', lots: ids, mode: 'n', n: ui.nStep, id }, { label: `Split into ${ui.nStep}` }); setSel([...STATE.lots.keys()].filter((k) => k.startsWith(id))); };
  const ca = q('#clearArea'); if (ca) ca.onclick = () => { ui.area = { lots: ids, pattern: 'grid', bs: 80, lw: 14, ld: 30, prof: 'slow', zone: 'mix', fill: true }; setTool('area', true); };
  // select tab
  qa('[data-sim]').forEach((b) => (b.onclick = () => selectSimilar(b.dataset.sim, lots[0])));
  qa('[data-scope]').forEach((b) => (b.onclick = () => { ui.scope = b.dataset.scope; renderCard(); }));
  qa('[data-flt]').forEach((b) => (b.onclick = () => { const f = ui.filters; f.lt = f.lt || new Set(); if (f.lt.has(b.dataset.flt)) f.lt.delete(b.dataset.flt); else f.lt.add(b.dataset.flt); buildSel(); renderCard(); }));
  for (const [id, k] of [['#fMinA', 'minA'], ['#fMaxA', 'maxA'], ['#fMinY', 'minY'], ['#fMaxY', 'maxY'], ['#fMinSt', 'minSt'], ['#fMaxSt', 'maxSt'], ['#fD', 'maxD']]) { const el = q(id); if (el) el.onchange = () => { ui.filters[k] = el.value === '' ? null : +el.value; buildSel(); renderCard(); }; }
  const fzz = q('#fZone'); if (fzz) fzz.onchange = () => { ui.filters.zone = fzz.value || null; buildSel(); renderCard(); };
  const gs = q('#gSave'); if (gs) gs.onclick = () => { const n = q('#gName').value.trim(); if (!n) return toast('Give the group a name first.'); ui.groups[n] = ids; save(); renderCard(); toast(`Saved "${n}" (${ids.length} lots).`); };
  qa('[data-group]').forEach((b) => (b.onclick = () => { setSel(ui.groups[b.dataset.group].filter((id) => STATE.lots.has(id))); }));
}
function applyTemplate(tid, lots) {
  const t = TPL[tid], ok = [], skipped = [];
  for (const l of lots) { const a = availability(t, l, ui.dream); if (a.ok) ok.push(l.id); else skipped.push({ id: l.id, why: a.why }); }
  if (!ok.length) { ui.skipped = skipped; renderCard(); toast(`${t.name} doesn't fit any of these lots.`); return; }
  commit({ op: 'apply', lots: ok, t: tid, p: {}, vary: ui.vary ? 1 : 0, sd: uid('s'), dr: ui.dream ? 1 : 0 }, { anim: ok, skipped, label: `${t.name} on ${fmt(ok.length)} lot${ok.length === 1 ? '' : 's'}` });
}
function inView(l) { const v = new THREE.Vector3(l.c[0], l.e, l.c[1]).project(cam); return Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1; }
function selectSimilar(kind, ref) {
  const key = { lt: (l) => l.lt, t: (l) => l.prog.t, era: (l) => l.st0 ? ERA(l.yr) : 'none', z: (l) => zfam(l.z) }[kind], want = key(ref);
  const ids = [...STATE.lots.values()].filter((l) => key(l) === want && (ui.scope === 'area' || inView(l))).map((l) => l.id);
  setSel(ids); toast(`Selected ${fmt(ids.length)} lots with the same ${({ lt: 'lot type', t: 'template', era: 'era', z: 'zone' })[kind]}${ui.scope === 'view' ? ' in view' : ''}.`);
}

// ---------- street inspector ----------
let profDraft = null, profPick = -1;
function clearProfDraft() { profDraft = null; }
function renderEdge() {
  const es = [...ui.edgeSel].map((id) => STATE.edges.get(id)).filter(Boolean); if (!es.length) { ui.edgeSel.clear(); return renderCard(); }
  const e = es[0], names = [...new Set(es.map((x) => x.n || 'Unnamed street'))], len = es.reduce((s, x) => s + polyLen(x.p), 0);
  if (!profDraft || profDraft.of !== e.id) { profDraft = { of: e.id, k: e.prof.k, els: structuredClone(e.prof.els) }; profPick = -1; }
  const row = rowWidth(profDraft), cur = rowWidth(e.prof), fronting = [...STATE.lots.values()].filter((l) => ui.edgeSel.has(l.rd)).length;
  const strip = profDraft.els.map(([k, w], i) => `<button class="${i === profPick ? 'on' : ''}" data-el="${i}" style="flex:${w};background:#${(EL[k]?.c ?? 0x8a837c).toString(16).padStart(6, '0')}" title="${EL[k]?.name || k} ${w.toFixed(1)} m">${w >= 2.4 ? (EL[k]?.name || k).split(' ')[0] : ''}</button>`).join('');
  card.innerHTML = `<div><div class="eyebrow">Street · ${es.length} piece${es.length === 1 ? '' : 's'}</div><h2>${esc(names.slice(0, 2).join(', '))}${names.length > 2 ? '…' : ''}</h2><div class="alt">${fmt(len * FT)} ft long · ${fmt(fronting)} lots front it · right-of-way ${cur.toFixed(1)} m (${fmt(cur * FT)} ft)</div></div>
  <h3>Quick changes <small>one click, whole selection</small></h3>
  <div class="row">${Object.entries(PRESETS).map(([k, p]) => `<button class="chipb ${e.prof.k === k ? 'on' : ''}" data-quick="${k}" title="${rowWidth(p).toFixed(0)} m wide">${p.name}</button>`).join('')}</div>
  <div class="row" style="justify-content:space-between"><button class="btn ghost small" id="corr" ${e.n ? '' : 'disabled'}>Select all of ${esc(e.n || 'this street')}</button><button class="btn ghost small" id="eDel">Delete street</button></div>
  <button class="btn ghost small" id="cust" aria-expanded="${!!(ui.custom || ui.adv)}">${ui.custom || ui.adv ? 'Hide the cross-section' : 'Customize the cross-section'}</button>
  ${ui.custom || ui.adv ? `  <h3>Cross-section <small>left to right</small></h3>
  <div class="strip" role="group" aria-label="Street elements">${strip}</div>
  <div class="row" style="justify-content:space-between"><span class="note">New width ${row.toFixed(1)} m${row > cur + 0.3 ? ` · widens by ${(row - cur).toFixed(1)} m and clips the lots beside it` : row < cur - 0.3 ? ' · the spare width becomes planting' : ''}</span></div>
  ${profPick >= 0 ? `<div class="row"><b style="font:700 13px var(--display)">${EL[profDraft.els[profPick][0]]?.name || profDraft.els[profPick][0]}</b><span class="stepper"><button data-w="-0.2" aria-label="Narrower">−</button><b>${profDraft.els[profPick][1].toFixed(1)} m</b><button data-w="0.2" aria-label="Wider">+</button></span><button class="btn ghost small" id="elDel">Remove</button></div>` : '<div class="note">Click an element to resize or remove it.</div>'}
  <div class="row"><select id="elAdd" aria-label="Add an element"><option value="">+ Add element…</option>${Object.entries(EL).map(([k, v]) => `<option value="${k}">${v.name}</option>`).join('')}</select></div>
  <h3>Presets</h3>
  <div class="row">${Object.entries(PRESETS).map(([k, p]) => `<button class="chipb ${profDraft.k === k ? 'on' : ''}" data-pre="${k}">${p.name}</button>`).join('')}</div>
  <div class="row"><button class="btn small" id="profApply">Apply to ${es.length} piece${es.length === 1 ? '' : 's'}</button><button class="btn ghost small" id="profReset">Reset</button></div>
` : ''}
  ${e.grp ? '<div class="note">Drag the round handles to reshape this drawn street.</div>' : ''}
  <div class="src">Delete flags lots that lose street access and turns the freed right-of-way into land. Widening clips lots; buildings inside the new right-of-way come down.</div>`;
  const q = (s) => card.querySelector(s), qa = (s) => card.querySelectorAll(s), ids = es.map((x) => x.id);
  qa('[data-el]').forEach((b) => (b.onclick = () => { profPick = +b.dataset.el; renderEdge(); }));
  qa('[data-w]').forEach((b) => (b.onclick = () => { const el = profDraft.els[profPick]; el[1] = clamp(Math.round((el[1] + +b.dataset.w) * 10) / 10, 0.6, 12); profDraft.k = 'custom'; renderEdge(); }));
  const ed = q('#elDel'); if (ed) ed.onclick = () => { profDraft.els.splice(profPick, 1); profPick = -1; profDraft.k = 'custom'; renderEdge(); };
  qa('[data-quick]').forEach((b) => (b.onclick = () => { const k = b.dataset.quick; commit({ op: 'street.prof', ids, prof: { k, els: structuredClone(PRESETS[k].els) } }, { label: `${PRESETS[k].name} on ${ids.length} piece${ids.length === 1 ? '' : 's'}` }); profDraft = null; }));
  q('#cust').onclick = () => { ui.custom = !(ui.custom || ui.adv); renderEdge(); };
  q('#corr').onclick = () => { ui.edgeSel = new Set([...STATE.edges.values()].filter((x) => x.n === e.n && x.g).map((x) => x.id)); profDraft = null; buildEdgeSel(); renderEdge(); };
  q('#eDel').onclick = () => deleteEdges();
  if (!q('#elAdd')) { placeHandles(); return; }
  q('#elAdd').onchange = (ev) => { const k = ev.target.value; if (!k) return; const mid = Math.floor(profDraft.els.length / 2); profDraft.els.splice(mid, 0, [k, { walk: 2.2, trees: 1.5, median: 2.5, park: 2.4, lane: 3.3, turn: 3.2, bike: 1.8, bus: 3.4, shared: 3, plaza: 4 }[k]]); profDraft.k = 'custom'; profPick = mid; renderEdge(); };
  qa('[data-pre]').forEach((b) => (b.onclick = () => { profDraft.k = b.dataset.pre; profDraft.els = structuredClone(PRESETS[b.dataset.pre].els); profPick = -1; renderEdge(); }));
  q('#profApply').onclick = () => { if (!profDraft.els.length) return toast('A street needs at least one element.'); commit({ op: 'street.prof', ids, prof: { k: profDraft.k, els: structuredClone(profDraft.els) } }, { label: `${PRESETS[profDraft.k]?.name || 'Custom street'} on ${ids.length} piece${ids.length === 1 ? '' : 's'}` }); profDraft = null; };
  q('#profReset').onclick = () => { profDraft = null; renderEdge(); };
  placeHandles();
}
function deleteEdges() {
  const ids = [...ui.edgeSel]; if (!ids.length) return;
  const before = [...STATE.lots.values()].filter((l) => l.flags.noaccess).length;
  commit({ op: 'street.del', ids, id: uid('D') }, { label: `Removed ${ids.length} street piece${ids.length === 1 ? '' : 's'}` });
  ui.edgeSel.clear(); buildEdgeSel(); renderCard();
  const after = [...STATE.lots.values()].filter((l) => l.flags.noaccess).length;
  if (after > before) toast(`${after - before} lots lost street access and are outlined in red.`);
}

// ---------- draw street and new area panels ----------
function renderDraw() {
  const d = ui.draw, n = d ? d.pts.length : 0, L = d && n > 1 ? polyLen(d.pts) : 0;
  card.innerHTML = `<div><div class="eyebrow">Draw street</div><h2>${n ? `${n} point${n === 1 ? '' : 's'} · ${fmt(L * FT)} ft` : 'Click to start a street'}</h2></div>
  <p>${ui.tool === 'roads' ? 'Click an existing street to change it, or click open ground to start a new one. ' : ''}Click points on the ground. It snaps to intersections, onto existing streets, to right angles and to parallel streets (hold Shift for 15° steps). Double-click or Enter to finish, Backspace removes a point, Esc cancels.</p>
  <div class="ctrl"><label for="dProf">Profile</label><select id="dProf">${Object.entries(PRESETS).map(([k, p]) => `<option value="${k}" ${ui.drawProf === k ? 'selected' : ''}>${p.name} · ${rowWidth(p).toFixed(0)} m</option>`).join('')}</select><span></span></div>
  <div class="ctrl"><label for="dName">Name</label><input class="inp" id="dName" placeholder="New street" value="${esc(ui.drawName)}"><span></span></div>
  <label class="check"><input type="checkbox" id="dSmooth" ${ui.smooth ? 'checked' : ''}> Smooth curve through the points</label>
  <div class="row"><button class="btn small" id="dDone" ${n < 2 ? 'disabled' : ''}>Build street</button><button class="btn ghost small" id="dBack" ${n ? '' : 'disabled'}>Remove last point</button><button class="btn ghost small" id="dCancel">Cancel</button></div>
  ${d && d.snap ? `<div class="note">Snap: ${esc(d.snap)}</div>` : ''}
  <div class="src">Crossings split both streets and add an intersection. The new right-of-way cuts through lots; slivers under 650 ft² fold into the street.</div>`;
  const q = (s) => card.querySelector(s);
  q('#dProf').onchange = (e) => { ui.drawProf = e.target.value; drawPreview(); };
  q('#dName').oninput = (e) => { ui.drawName = e.target.value; };
  q('#dSmooth').onchange = (e) => { ui.smooth = e.target.checked; drawPreview(); };
  q('#dDone').onclick = finishDraw; q('#dBack').onclick = () => { if (ui.draw) { ui.draw.pts.pop(); drawPreview(); renderDraw(); } };
  q('#dCancel').onclick = () => { ui.draw = null; drawPreview(); renderDraw(); };
}
function renderArea() {
  const a = ui.area;
  card.innerHTML = `<div><div class="eyebrow">New area</div><h2>${a.lots ? `${fmt(a.lots.length)} lots cleared` : 'Drawn boundary'}</h2></div>
  <p>Pick a street pattern. Streets join the ones around the area, then each block is cut along its longest side until lots reach your size, and every lot keeps a street.</p>
  <div class="row" role="radiogroup" aria-label="Street pattern">${[['grid', 'Grid'], ['curvy', 'Curvilinear'], ['super', 'Superblock'], ['own', 'Draw your own']].map(([k, n]) => `<button class="chipb ${a.pattern === k ? 'on' : ''}" data-pat="${k}">${n}</button>`).join('')}</div>
  ${a.pattern !== 'own' ? `<div class="ctrl"><label for="aBs">Block size</label><input type="range" id="aBs" min="50" max="160" step="5" value="${a.bs}"><output>${fmt(a.bs * FT)} ft</output></div>` : '<div class="note">No new streets: lots are cut from the existing frontage. Add streets later with Draw street; they cut the lots.</div>'}
  <div class="ctrl"><label for="aLw">Lot width</label><input type="range" id="aLw" min="7" max="40" step="1" value="${a.lw}"><output>${fmt(a.lw * FT)} ft</output></div>
  <div class="ctrl"><label for="aLd">Lot depth</label><input type="range" id="aLd" min="15" max="60" step="1" value="${a.ld}"><output>${fmt(a.ld * FT)} ft</output></div>
  <div class="ctrl"><label for="aProf">Streets</label><select id="aProf">${['slow', 'local', 'woonerf', 'complete', 'ped'].map((k) => `<option value="${k}" ${a.prof === k ? 'selected' : ''}>${PRESETS[k].name}</option>`).join('')}</select><span></span></div>
  <div class="ctrl"><label for="aZone">Zone</label><select id="aZone"><option value="mix" ${a.zone === 'mix' ? 'selected' : ''}>Mixed (shops on arterials)</option>${ZONE_CODES.map((z) => `<option ${a.zone === z ? 'selected' : ''}>${z}</option>`).join('')}</select><span></span></div>
  <label class="check"><input type="checkbox" id="aFill" ${a.fill ? 'checked' : ''}> Fill every new lot with a template for its zone</label>
  <div class="note" id="aStat">${a.stat || 'Previewing…'}</div>
  <div class="row"><button class="btn small" id="aGo">Build this area</button><button class="btn ghost small" id="aCancel">Cancel</button></div>
  <div class="src">Afterwards it is all ordinary lots and streets: paint zones with Z, then use Fill by zone, or apply any template.</div>`;
  const q = (s) => card.querySelector(s), up = () => { renderArea(); areaPreview(); };
  card.querySelectorAll('[data-pat]').forEach((b) => (b.onclick = () => { a.pattern = b.dataset.pat; up(); }));
  for (const [id, k] of [['#aBs', 'bs'], ['#aLw', 'lw'], ['#aLd', 'ld']]) { const el = q(id); if (!el) continue; el.oninput = () => { a[k] = +el.value; el.nextElementSibling.textContent = fmt(a[k] * FT) + ' ft'; }; el.onchange = () => areaPreview(); }
  q('#aProf').onchange = (e) => { a.prof = e.target.value; areaPreview(); };
  q('#aZone').onchange = (e) => { a.zone = e.target.value; };
  q('#aFill').onchange = (e) => { a.fill = e.target.checked; };
  q('#aGo').onclick = () => {
    const id = uid('N'); const cmd = { op: 'area.new', id, lots: a.lots || null, region: a.region || null, pattern: a.pattern, bs: a.bs, lw: a.lw, ld: a.ld, prof: a.prof, zone: a.zone, fill: a.fill ? 1 : 0, dr: ui.dream ? 1 : 0, name: 'New St' };
    setOv('area', null); ui.area = null;
    commit(cmd, { label: 'New area built' });
    const fresh = [...STATE.lots.keys()].filter((k) => k.startsWith(id + '.')); world.sync(STATE); if (fresh.length) startRiseFor(fresh);
    setTool('select'); setSel(fresh);
  };
  q('#aCancel').onclick = () => { ui.area = null; setOv('area', null); setTool('select'); };
}
function startRiseFor(ids) { world.sync(STATE, new Set(ids)); if (!reduceMotion) startRise(ids); else world.sync(STATE); }
let areaT;
function areaPreview() {
  clearTimeout(areaT);
  areaT = setTimeout(() => {
    const a = ui.area; if (!a) return;
    const S = structuredClone(STATE), info = { skipped: [], notes: [] }, id = 'preview';
    try { areaNew(S, { op: 'area.new', id, lots: a.lots || null, region: a.region || null, pattern: a.pattern, bs: a.bs, lw: a.lw, ld: a.ld, prof: a.prof, zone: 'R2-1', fill: 0 }, info); } catch (e) { console.warn(e); }
    const acc = new Acc(), lots = [...S.lots.values()].filter((l) => l.newArea === id), edges = [...S.edges.values()].filter((e) => e.grp && e.grp.startsWith(id));
    for (const e of edges) { const h = rowWidth(e.prof) / 2; ribbon(acc, e.p, -h, h, 1.0, C(0xc4613b), 3); }
    const grp = new THREE.Group(); grp.add(new THREE.Mesh(acc.geo(), new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide })));
    grp.add(outlineMesh(lots.map((l) => l.r), C(0x2b2420), 0.22, 1.1));
    setOv('area', grp);
    a.stat = `${edges.length} street pieces · ${lots.length} lots, about ${fmt(lots.length ? lots.reduce((s, l) => s + l.m2, 0) / lots.length * 10.764 : 0)} ft² each`;
    const el = $('aStat'); if (el) el.textContent = a.stat;
  }, 180);
}

export {
  applyItem,
  areaPreview,
  clearProfDraft,
  deleteEdges,
  renderCard,
  renderDraw,
};
