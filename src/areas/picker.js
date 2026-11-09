// The area picker: a real map of the Valley, the area list with details, "load any spot" with address suggestions,
// a staged build with a progress bar, and custom areas you can install, export and remove.
// Building runs on this computer through the dev server (tools/vite-areas.js -> tools/pack/build_area.py), so build,
// install, export and remove need `npm run dev`. Opening a ready area works anywhere.
import './picker.css';
import { bboxAround, bboxProblem, bboxSizeM, slugify } from './geo.js';
import { createMap } from './mapview.js';
import { mergeSuggestions, nameFor, photon, searchLocal, streetIndex } from './search.js';
import { stageView } from './stages.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SIZES = [['Block', 800], ['Neighborhood', 1200], ['Large', 1800], ['Wide', 2400]];
const G = { // small drawn glyphs for suggestion rows (no emoji)
  address: '<svg viewBox="0 0 14 14"><path d="M7 1.5a4 4 0 0 0-4 4c0 3 4 7 4 7s4-4 4-7a4 4 0 0 0-4-4z" fill="none" stroke="currentColor" stroke-width="1.3"/><circle cx="7" cy="5.5" r="1.4" fill="currentColor"/></svg>',
  street: '<svg viewBox="0 0 14 14"><path d="M2 12 12 2" stroke="currentColor" stroke-width="3" fill="none"/><path d="M2 12 12 2" stroke="#0b1013" stroke-width="1" stroke-dasharray="2 2" fill="none"/></svg>',
  cross: '<svg viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="2" fill="none"/></svg>',
  area: '<svg viewBox="0 0 14 14"><rect x="2" y="2" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2 5.5h10M5.5 2v10" stroke="currentColor" stroke-width="1" opacity=".5"/></svg>',
  place: '<svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="7" cy="7" r="1.5" fill="currentColor"/></svg>',
  coord: '<svg viewBox="0 0 14 14"><path d="M7 1v12M1 7h12" stroke="currentColor" stroke-width="1.2" fill="none"/><circle cx="7" cy="7" r="2.5" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
};
const KIND = { address: 'Address', street: 'Street', cross: 'Intersection', area: 'Area', place: 'Place', coord: 'Coordinates' };

let ctx, map = null, tab = 'areas', picked = null, draft = null, devServer = false, busy = null, nameAuto = true, streets = [], valley = null;
let sug = [], sugHi = -1, sugSeq = 0, sugTimer = 0, sugAbort = null, filterText = '';
const prefetched = new Set();

const region = () => ctx.AREAS.region || { name: 'San Fernando Valley', bbox: [-118.68, 34.13, -118.33, 34.31] };
const areas = () => ctx.AREAS.areas;
const byId = (id) => areas().find((a) => a.id === id);
const sizeM = () => +$('apSize').value || 1200;

/** Called once by the game. `save` stores the loaded area's edits before the page moves to another area. */
export function initPicker({ AREA, AREAS, save }) {
  ctx = { AREA, AREAS, save: save || (() => {}) };
  picked = AREA.id;
  $('apSize').innerHTML = SIZES.map(([t, m]) => `<option value="${m}"${m === 1200 ? ' selected' : ''}>${t} · ${(m / 1000).toFixed(1)} km</option>`).join('');
  $('areaClose').onclick = closePicker;
  $('areas').addEventListener('pointerdown', (e) => { if (e.target.id === 'areas') closePicker(); });
  $('areas').addEventListener('keydown', (e) => { if (e.key === 'Escape' && !document.querySelector('.cs-pop') && sug.length === 0) { e.stopPropagation(); closePicker(); } });
  $('apTabAreas').onclick = () => setTab('areas'); $('apTabAdd').onclick = () => setTab('add');
  $('apFilter').oninput = (e) => { filterText = e.target.value.trim().toLowerCase(); renderList(); };
  $('apFilter').onkeydown = (e) => e.stopPropagation();
  $('apName').oninput = () => { nameAuto = !$('apName').value.trim(); syncBuild(); };
  $('apName').onkeydown = (e) => e.stopPropagation();
  $('apSize').onchange = () => { if (draft) { const c = center(draft); setDraft(bboxAround(c[0], c[1], sizeM())); } };
  $('apBuild').onclick = () => build({ bbox: draft, name: $('apName').value.trim(), custom: true });
  $('apInstall').onclick = () => $('apFile').click();
  $('apFile').onchange = installFile;
  $('areaGo').onclick = openPicked;
  initSearch();
  document.querySelectorAll('.ap-layers button').forEach((b) => (b.onclick = () => {
    ensureMap(); map.setLayer(b.dataset.layer);
    document.querySelectorAll('.ap-layers button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  }));
  document.querySelectorAll('.ap-zoom button').forEach((b) => (b.onclick = () => { ensureMap(); b.dataset.zoom === 'reset' ? map.reset() : map.zoomBy(b.dataset.zoom === 'in' ? 1.6 : 1 / 1.6); }));
  ping(); loadValley();
}

const center = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];

export function openPicker() {
  picked = ctx.AREA.id; filterText = ''; $('apFilter').value = '';
  $('areas').hidden = false; ensureMap(); map.resize();
  setTab(busy ? 'add' : 'areas'); renderList(); selectArea(picked, { fly: true, keepTab: true }); ping();
  setTimeout(() => $('areaMap').focus({ preventScroll: true }), 50);
}
export function closePicker() { if (!$('areas')) return; $('areas').hidden = true; clearSug(); $('areaBtn')?.focus(); }

function ensureMap() {
  if (map) return map;
  map = createMap($('areaMap'), {
    region: region(), streetsUrl: 'areas/valley.webp', satUrl: 'areas/valley-sat.jpg',
    onPick: (lon, lat) => { setTab('add'); placeAt(lon, lat); },
    onAreaClick: (a) => { setTab('areas'); selectArea(a.id); },
    onDraft: (b, phase) => { draft = b; if (phase !== 'move' && phase !== 'draw') return; if (tab !== 'add') setTab('add'); syncBuild(); if (phase === 'end') suggestName(center(draft)); },
    onHover: (a, e) => { const t = $('apTip'); if (!a) { t.hidden = true; return; } t.hidden = false; t.textContent = `${a.name}${a.status === 'ready' ? '' : ' (planned)'}`; const r = $('areaMap').getBoundingClientRect(); t.style.left = `${Math.min(r.width - 160, e.clientX - r.left + 14)}px`; t.style.top = `${e.clientY - r.top + 14}px`; },
    onCursor: (lon, lat) => { $('apRead').innerHTML = `${lat.toFixed(4)} N &nbsp; ${Math.abs(lon).toFixed(4)} W`; },
  });
  map.setAreas(areas()); map.setLoaded(ctx.AREA.id); if (valley) map.setRoads(valley.roads);
  return map;
}

async function loadValley() {
  try {
    const r = await fetch('areas/valley.map.json'); if (!r.ok) return; valley = await r.json();
    streets = streetIndex(valley.roads); if (map) map.setRoads(valley.roads);
  } catch { /* the map and the search work without the street names */ }
}

async function ping() {
  try { const r = await fetch('api/areas/ping'); devServer = r.ok && (await r.json()).ok; } catch { devServer = false; }
  const chip = $('apDev'); chip.textContent = devServer ? 'Builder online' : 'Builder offline'; chip.classList.toggle('on', devServer);
  $('apOff').hidden = devServer; $('apInstall').disabled = !devServer; syncBuild(); renderDetail();
}

function setTab(t) {
  tab = t;
  for (const [id, k] of [['apTabAreas', 'areas'], ['apTabAdd', 'add']]) { $(id).setAttribute('aria-selected', String(t === k)); }
  $('apPaneAreas').hidden = t !== 'areas'; $('apPaneAdd').hidden = t !== 'add';
  if (!map) return;
  map.setDraft(t === 'add' ? draft : null);
  $('apHint').hidden = t !== 'add' && !!picked;
  syncFoot();
}

// ---------- the area list ----------
function badge(a) {
  if (a.id === ctx.AREA.id) return ['loaded', 'Loaded'];
  if (a.status !== 'ready') return ['planned', 'Planned'];
  return a.custom ? ['custom', 'Yours'] : ['ready', 'Ready'];
}
function renderList() {
  const rows = areas().filter((a) => !filterText || `${a.name} ${a.sub || ''}`.toLowerCase().includes(filterText));
  const order = (a) => (a.id === ctx.AREA.id ? 0 : a.custom ? 1 : a.status === 'ready' ? 2 : 3);
  rows.sort((a, b) => order(a) - order(b));
  $('alist').innerHTML = rows.map((a) => { const [k, t] = badge(a); return `<button type="button" class="aitem${a.id === picked ? ' on' : ''}${a.status === 'ready' ? '' : ' planned'}" data-area="${esc(a.id)}" aria-pressed="${a.id === picked}"><b>${esc(a.name)}</b><small>${esc(a.sub || '')}</small><em class="bdg ${k}">${t}</em></button>`; }).join('') || '<p class="ap-note">No areas match.</p>';
  $('alist').querySelectorAll('[data-area]').forEach((b) => (b.onclick = () => selectArea(b.dataset.area, { fly: true })));
  syncFoot();
}
function selectArea(id, o = {}) {
  const a = byId(id); if (!a) return;
  picked = id; renderList(); renderDetail();
  if (map) { map.setSelected(id); if (a.bbox && o.fly !== false) map.flyToBox(a.bbox, a.id === ctx.AREA.id && o.keepTab ? 0.3 : 0.4); }
  if (a.status === 'ready' && a.pack && !prefetched.has(a.pack)) { prefetched.add(a.pack); fetch(`areas/${a.pack}`, { priority: 'low' }).catch(() => {}); } // warm the cache so Open is quick
  $('apHint').hidden = true;
}
function renderDetail() {
  const a = byId(picked), el = $('apDetail'); if (!a) { el.innerHTML = ''; return; }
  const [k, t] = badge(a), [w, h] = a.bbox ? bboxSizeM(a.bbox) : [0, 0], ready = a.status === 'ready';
  const rows = [['Lots', ready ? Number(a.lots || 0).toLocaleString() : 'Not built'], ['Size', a.bbox ? `${Math.round(w)} × ${Math.round(h)} m` : ''], ['Parcels', a.parcels === 'city' ? 'City of LA' : a.parcels ? 'Estimated' : ''], ['Built', a.built || '']].filter((r) => r[1]);
  el.innerHTML = `<div class="ap-dh"><b>${esc(a.name)}</b><em class="bdg ${k}">${t}</em></div><p class="ap-sub">${esc(a.sub || '')}</p>
    <dl>${rows.map(([x, y]) => `<dt>${x}</dt><dd>${esc(y)}</dd>`).join('')}</dl>
    <div class="ap-acts">${ready ? `<button class="btn ghost small" data-act="refresh" ${devServer && !busy ? '' : 'disabled'} title="Re-pull the open data. Your edits carry over.">Refresh data</button><a class="btn ghost small${devServer ? '' : ' off'}" data-act="export" href="api/areas/export?id=${encodeURIComponent(a.id)}" download="${esc(a.id)}.sfvos-area.json" ${devServer ? '' : 'aria-disabled="true" tabindex="-1"'} title="Save this area as a file you can install elsewhere">Export</a>` : `<button class="btn ghost small" data-act="plan" ${devServer ? '' : 'disabled'}>Build this area</button>`}
      ${a.custom && a.id !== ctx.AREA.id ? `<button class="btn ghost small danger" data-act="remove" ${devServer && !busy ? '' : 'disabled'}>Remove</button>` : ''}</div>`;
  el.querySelectorAll('[data-act]').forEach((b) => (b.onclick = (e) => act(b, a, e)));
}
function act(btn, a, e) {
  const what = btn.dataset.act;
  if (what === 'export' && !devServer) e.preventDefault();
  if (what === 'refresh') build({ id: a.id, refresh: true, name: a.name });
  if (what === 'plan') { setTab('add'); setDraft(a.bbox); $('apName').value = a.name; nameAuto = false; syncBuild(); map?.flyToBox(a.bbox); }
  if (what === 'remove') {
    if (!btn.classList.contains('arm')) { btn.classList.add('arm'); btn.textContent = 'Confirm remove'; setTimeout(() => { if (btn.isConnected) { btn.classList.remove('arm'); btn.textContent = 'Remove'; } }, 3500); return; }
    removeArea(a);
  }
}
async function removeArea(a) {
  try {
    const r = await fetch('api/areas/remove', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id }) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Server said ${r.status}`);
    ctx.AREAS.areas = areas().filter((x) => x.id !== a.id); picked = ctx.AREA.id; map?.setAreas(areas()); renderList(); selectArea(picked); say(`${a.name} was removed.`);
  } catch (e) { say(e.message, true); }
}
function say(msg, err) { const f = $('apFootMsg'); f.textContent = msg; f.classList.toggle('err', !!err); clearTimeout(say.t); say.t = setTimeout(() => (f.textContent = ''), 6000); }

// ---------- opening ----------
function syncFoot() {
  const a = byId(picked), go = $('areaGo');
  go.hidden = tab === 'add'; go.disabled = !a || a.status !== 'ready';
  go.textContent = !a ? 'Open' : a.id === ctx.AREA.id ? `Back to ${a.name}` : a.status === 'ready' ? `Open ${a.name}` : `${a.name} needs a pack`;
}
function openPicked() {
  const a = byId(picked); if (!a || a.status !== 'ready') return;
  if (a.id === ctx.AREA.id) { closePicker(); ctx.save(); return; }
  ctx.save(); location.search = `?area=${encodeURIComponent(a.id)}`;
}

// ---------- choosing a spot ----------
function setDraft(b) { draft = b; ensureMap(); map.setDraft(tab === 'add' ? b : null); syncBuild(); }
function placeAt(lon, lat, name) {
  setDraft(bboxAround(lon, lat, sizeM())); map.setPin([lon, lat]);
  if (name && nameAuto) $('apName').value = name; else if (nameAuto) suggestName([lon, lat]);
  syncBuild();
}
async function suggestName([lon, lat]) { // a name from the neighbourhood under the box, when the player has not typed one
  if (!nameAuto) return;
  const near = areas().find((a) => a.bbox && lon >= a.bbox[0] && lon <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3]);
  try {
    const r = await (await fetch(`https://photon.komoot.io/reverse?lon=${lon}&lat=${lat}&lang=en&limit=1`)).json(), p = r.features?.[0]?.properties || {};
    const nm = p.district || p.locality || p.suburb || p.city || near?.name || '';
    if (nm && nameAuto && !busy) { $('apName').value = nm; syncBuild(); }
  } catch { /* offline: the player names it */ }
}
function syncBuild() {
  if (!ctx) return;
  const reg = region(), bad = draft ? bboxProblem(draft, reg) : 'Pick a spot on the map first.', st = $('apStatus'), btn = $('apBuild');
  const name = $('apName').value.trim(), over = draft && areas().find((a) => a.status === 'ready' && a.bbox && center(draft)[0] >= a.bbox[0] && center(draft)[0] <= a.bbox[2] && center(draft)[1] >= a.bbox[1] && center(draft)[1] <= a.bbox[3]);
  btn.disabled = !!busy || !devServer || !!bad || !name;
  if (bad) { st.className = 'ap-status'; st.textContent = bad; return; }
  const [w, h] = bboxSizeM(draft);
  if (over) { st.className = 'ap-status warn'; st.innerHTML = `${Math.round(w)} × ${Math.round(h)} m. <b>${esc(over.name)}</b> is already built here. <button type="button" class="lnk" id="apUse">Open it instead</button>`; $('apUse').onclick = () => { setTab('areas'); selectArea(over.id); }; return; }
  st.className = 'ap-status ok'; st.textContent = `${Math.round(w)} × ${Math.round(h)} m selected.${name ? '' : ' Give it a name to build.'}${devServer ? '' : ' Needs npm run dev to build.'}`;
}

// ---------- search with suggestions ----------
function initSearch() {
  const inp = $('apSearch');
  inp.addEventListener('input', () => { clearTimeout(sugTimer); const q = inp.value.trim(); if (q.length < 2) return clearSug(); show(searchLocal(q, searchCtx()), true); sugTimer = setTimeout(() => remote(q), 260); });
  inp.addEventListener('focus', () => { if (inp.value.trim().length >= 2 && !sug.length) inp.dispatchEvent(new Event('input')); });
  inp.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { if (!sug.length) return; e.preventDefault(); sugHi = (sugHi + (e.key === 'ArrowDown' ? 1 : -1) + sug.length) % sug.length; paintSug(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (sug[Math.max(0, sugHi)]) choose(sug[Math.max(0, sugHi)]); else if (inp.value.trim().length > 1) remote(inp.value.trim(), true); }
    else if (e.key === 'Escape' && sug.length) { e.preventDefault(); clearSug(); }
  });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.ap-combo')) clearSug(); });
}
function searchCtx() { return { areas: areas(), streets, region: region(), center: map ? map.fromScreen(map ? $('areaMap').clientWidth / 2 : 0, $('areaMap').clientHeight / 2) : null }; }
async function remote(q, enter) {
  const seq = ++sugSeq; sugAbort?.abort(); sugAbort = new AbortController();
  const note = $('apSearchNote'), local = searchLocal(q, searchCtx());
  try {
    const near = searchCtx().center, got = await photon(q, { bbox: region().bbox, near, signal: sugAbort.signal });
    if (seq !== sugSeq) return;
    note.textContent = 'Streets and areas search offline. Addresses and places come from OpenStreetMap.';
    const list = mergeSuggestions(local, got); show(list, true);
    if (enter && list[0]) choose(list[0]);
    else if (enter) note.textContent = 'Nothing found in the Valley for that. Try a cross street, or click the map.';
  } catch (e) {
    if (e.name === 'AbortError' || seq !== sugSeq) return;
    note.textContent = 'Address lookup is offline right now. Streets, intersections and areas still work, or click the map.';
    if (enter && local[0]) choose(local[0]);
  }
}
function show(list, keep) { sug = list; sugHi = list.length && keep ? 0 : -1; paintSug(); }
function paintSug() {
  const ul = $('apSug'), inp = $('apSearch');
  ul.hidden = !sug.length; inp.setAttribute('aria-expanded', String(!!sug.length));
  ul.innerHTML = sug.map((s, i) => `<li role="option" id="apSug${i}" aria-selected="${i === sugHi}" class="${i === sugHi ? 'hi' : ''}" data-i="${i}"><i class="sg">${G[s.kind] || G.place}</i><span><b>${esc(s.label)}</b><small>${esc(s.sub || '')}</small></span><em>${KIND[s.kind] || ''}</em></li>`).join('');
  inp.setAttribute('aria-activedescendant', sugHi >= 0 ? `apSug${sugHi}` : '');
  ul.querySelectorAll('li').forEach((li) => { li.onpointerdown = (e) => { e.preventDefault(); choose(sug[+li.dataset.i]); }; li.onmousemove = () => { if (sugHi !== +li.dataset.i) { sugHi = +li.dataset.i; ul.querySelectorAll('li').forEach((x, j) => { x.classList.toggle('hi', j === sugHi); x.setAttribute('aria-selected', String(j === sugHi)); }); } }; });
}
function clearSug() { sug = []; sugHi = -1; sugAbort?.abort(); clearTimeout(sugTimer); if ($('apSug')) paintSug(); }
function choose(s) {
  $('apSearch').value = s.kind === 'address' || s.kind === 'place' ? s.label : s.label; clearSug();
  ensureMap(); setTab('add');
  if (s.kind === 'area' && s.areaId && byId(s.areaId)?.status === 'ready') { setTab('areas'); selectArea(s.areaId); return; }
  nameAuto = true; $('apName').value = '';
  const nm = nameFor(s); placeAt(s.lon, s.lat, nm); map.flyToLL(s.lon, s.lat, 1.1);
}

/** The backdrop in the 3D view was clicked at a lon/lat: open the area built there, or start a new box on the map. */
export function proposeAt({ lon, lat }) {
  if (!ctx) return;
  openPicker();
  const hit = areas().find((a) => a.status === 'ready' && a.bbox && lon >= a.bbox[0] && lon <= a.bbox[2] && lat >= a.bbox[1] && lat <= a.bbox[3]);
  if (hit) { selectArea(hit.id); return; }
  setTab('add'); nameAuto = true; $('apName').value = ''; placeAt(lon, lat); map.flyToLL(lon, lat, 1.1);
}

// ---------- building, with a staged progress view ----------
let view = null, abort = null;
function showProgress(on) { $('apForm').hidden = on; $('apProg').hidden = !on; }
async function build({ bbox, name, id, refresh, custom }) {
  if (busy) return;
  id = id || slugify(name, [...areas().map((a) => a.id)]);
  busy = { id, name }; setTab('add'); showProgress(true); renderDetail();
  $('apProgHead').textContent = refresh ? 'Refreshing' : 'Building'; $('apProgName').textContent = name;
  view = stageView({ fill: $('apFill'), pct: $('apPct'), time: $('apTime'), msg: $('apMsg'), list: $('apStages') }); view.start();
  $('apAct').innerHTML = '<button class="btn ghost small" id="apCancel" type="button">Cancel</button>'; $('apCancel').onclick = () => abort?.abort();
  abort = new AbortController(); let done = null;
  try {
    const res = await fetch('api/areas/build', { method: 'POST', signal: abort.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, bbox, refresh: !!refresh, custom: !!custom }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Server said ${res.status}`);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done: end } = await rd.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.step === 'error') throw new Error(ev.msg);
        view.event(ev); if (ev.step === 'done') done = ev.area;
      }
    }
    if (!done) throw new Error('The builder stopped before finishing.');
    view.finish(`${done.name} is ready: ${Number(done.lots).toLocaleString()} lots.`);
    ctx.AREAS.areas = refresh ? areas().map((a) => (a.id === done.id ? { ...a, ...done } : a)) : [...areas().filter((a) => a.id !== done.id), done];
    map?.setAreas(areas()); busy = null; picked = done.id; map?.setSelected(done.id);
    if (refresh && done.id === ctx.AREA.id) { $('apAct').innerHTML = '<span class="ap-note">Reloading the city with fresh data</span>'; setTimeout(() => location.reload(), 900); return; }
    $('apAct').innerHTML = `<button class="btn" id="apOpenNew" type="button">Open ${esc(done.name)}</button><button class="btn ghost small" id="apMore" type="button">${refresh ? 'Done' : 'Build another'}</button>`;
    $('apOpenNew').onclick = openPicked;
    $('apMore').onclick = () => { showProgress(false); view.stop(); setTab(refresh ? 'areas' : 'add'); renderList(); renderDetail(); if (!refresh) { draft = null; map?.setDraft(null); $('apName').value = ''; nameAuto = true; } syncBuild(); };
  } catch (e) {
    busy = null; view?.fail(e.name === 'AbortError' ? 'Cancelled.' : e.message);
    $('apAct').innerHTML = '<button class="btn ghost small" id="apBack" type="button">Back</button>';
    $('apBack').onclick = () => { showProgress(false); view.stop(); syncBuild(); renderDetail(); };
  } finally { renderList(); renderDetail(); }
}

async function installFile(e) {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const st = $('apStatus'); st.className = 'ap-status'; st.textContent = `Installing ${f.name}…`;
  try {
    const r = await fetch('api/areas/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: await f.text() });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Server said ${r.status}`);
    ctx.AREAS.areas = [...areas().filter((a) => a.id !== j.area.id), j.area]; map?.setAreas(areas());
    st.className = 'ap-status ok'; st.textContent = `${j.area.name} installed.`; setTab('areas'); selectArea(j.area.id); say(`${j.area.name} installed. It is listed as yours.`);
  } catch (err) { st.className = 'ap-status warn'; st.textContent = err.message; }
}
