// "Load any spot in the Valley": search or draw a box on the area map, then build its pack from open data
// (City of LA parcels, Overture roads and buildings, AWS terrain). The build runs on this machine through the
// dev server (tools/vite-areas.js -> tools/pack/build_area.py), so it needs `npm run dev`.
// The same panel refreshes the loaded area from the latest data; saved edits carry over (see rebase.js).
import './picker.css';
import { bboxAround, bboxFromCorners, bboxProblem, bboxSizeM, frameFrom, slugify } from './geo.js';

const $ = (id) => document.getElementById(id);
const SIZES = [['Block · 0.8 km', 800], ['Neighborhood · 1.2 km', 1200], ['Large · 1.8 km', 1800]];
let ctx, draft = null, frame = null, drag = null, devServer = false, busy = false;

/** Called once by the game with the area list and a way to redraw the map. */
export function initPicker({ AREA, AREAS, redraw }) {
  ctx = { AREA, AREAS, redraw };
  const host = $('areas').querySelector('.plaque'), footer = host.querySelector('.row:last-of-type');
  const box = document.createElement('section');
  box.className = 'loadarea';
  box.innerHTML = `<h3>Load any spot in the Valley</h3>
    <p>Search for an address or place, or click or drag a box on the map. The builder pulls real streets, lots, buildings, parking and terrain from open data; it takes about a minute.</p>
    <div class="row"><input class="inp" id="laSearch" placeholder="Address or place, e.g. Reseda Blvd and Sherman Way" autocomplete="off"><button class="btn ghost small" id="laFind">Find</button>
      <select id="laSize" aria-label="Area size">${SIZES.map(([t, m]) => `<option value="${m}"${m === 1200 ? ' selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="la-hits" id="laHits"></div>
    <div class="row" style="margin-top:8px"><input class="inp" id="laName" placeholder="Name this area" maxlength="40"><button class="btn" id="laBuild" disabled>Build this area</button></div>
    <div class="la-prog" id="laProg" hidden><div class="la-bar"><i id="laBar"></i></div><small id="laMsg" aria-live="polite"></small></div>
    <p class="la-off" id="laOff" hidden>Building areas needs the dev server: run <code>npm run dev</code> (and Python 3) on your computer, then reopen this screen.</p>`;
  host.insertBefore(box, footer);
  const refresh = document.createElement('button');
  refresh.className = 'btn ghost'; refresh.id = 'laRefresh'; refresh.textContent = 'Refresh this area’s data'; refresh.title = 'Re-pull the open data for the highlighted area. Your edits carry over.';
  footer.insertBefore(refresh, footer.firstChild); footer.style.gap = '8px';

  const cv = $('areaMap');
  cv.addEventListener('pointerdown', (e) => { if (busy) return; cv.setPointerCapture(e.pointerId); drag = { x: e.offsetX, y: e.offsetY, moved: false, e0: e }; });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !frame) return;
    const sx = cv.width / cv.clientWidth, a = [drag.x * sx, drag.y * sx], b = [e.offsetX * sx, e.offsetY * sx];
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 6 * sx) { drag.moved = true; setDraft(bboxFromCorners(frame.toLL(...a), frame.toLL(...b))); }
  });
  cv.addEventListener('pointerup', (e) => {
    if (!drag || !frame) return;
    if (!drag.moved) { const sx = cv.width / cv.clientWidth; setDraft(bboxAround(...frame.toLL(e.offsetX * sx, e.offsetY * sx), +$('laSize').value)); }
    drag = null;
  });
  $('laSize').onchange = () => { if (draft) { const c = [(draft[0] + draft[2]) / 2, (draft[1] + draft[3]) / 2]; setDraft(bboxAround(c[0], c[1], +$('laSize').value)); } };
  $('laFind').onclick = find; $('laSearch').onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); find(); } e.stopPropagation(); };
  $('laName').onkeydown = (e) => e.stopPropagation();
  $('laName').oninput = syncBuild;
  $('laBuild').onclick = () => build({ bbox: draft, name: $('laName').value.trim() });
  refresh.onclick = () => { const a = ctx.AREAS.areas.find((x) => x.id === ($('alist').querySelector('.aitem.on')?.dataset.area || ctx.AREA.id)); if (a?.bbox && a.status === 'ready') build({ id: a.id, refresh: true, name: a.name }); };
  $('areaBtn').addEventListener('click', ping);
  ping();
}

async function ping() {
  try { const r = await fetch('api/areas/ping'); devServer = r.ok && (await r.json()).ok; } catch { devServer = false; }
  $('laOff').hidden = devServer; syncBuild();
  $('laRefresh').disabled = !devServer;
}

function setDraft(b) { draft = b; syncBuild(); ctx.redraw(); }
function syncBuild() {
  const bad = draft ? bboxProblem(draft, ctx.AREAS.region) : 'Pick a spot on the map first.';
  const btn = $('laBuild'); btn.disabled = busy || !devServer || !!bad || !$('laName').value.trim();
  const [w, h] = draft ? bboxSizeM(draft) : [0, 0];
  btn.title = bad || (devServer ? `${Math.round(w)} × ${Math.round(h)} m` : 'Needs npm run dev');
}

/** Hook for the area map: draws the box being chosen. `LL` is the map's lon/lat -> pixel function. */
export function drawDraft(g, LL) {
  const rb = ctx?.AREAS.region?.bbox; if (!rb) return;
  frame = frameFrom(LL, rb);
  if (!draft) return;
  const p = LL(draft[0], draft[3]), q = LL(draft[2], draft[1]);
  g.save(); g.setLineDash([6, 4]); g.lineWidth = 2.5; g.strokeStyle = '#2f7fb8'; g.fillStyle = 'rgba(62,159,220,.25)';
  g.fillRect(p[0], p[1], q[0] - p[0], q[1] - p[1]); g.strokeRect(p[0], p[1], q[0] - p[0], q[1] - p[1]);
  g.setLineDash([]); g.fillStyle = '#1d5a85'; g.font = '700 12px Fraunces, Georgia, serif'; g.fillText($('laName')?.value.trim() || 'New area', p[0], p[1] - 4); g.restore();
}

async function find() {
  const q = $('laSearch').value.trim(), hits = $('laHits'); if (!q) return;
  hits.textContent = 'Searching…';
  const r = ctx.AREAS.region?.bbox;
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}${r ? `&viewbox=${r[0]},${r[3]},${r[2]},${r[1]}&bounded=1` : ''}`;
    const list = await (await fetch(url, { headers: { Accept: 'application/json' } })).json();
    hits.textContent = '';
    if (!list.length) { hits.textContent = 'Nothing found in the Valley for that. Try a cross street, or click the map.'; return; }
    for (const h of list) {
      const b = document.createElement('button'); b.className = 'btn ghost small'; b.textContent = h.display_name.split(',').slice(0, 3).join(',');
      b.onclick = () => { setDraft(bboxAround(+h.lon, +h.lat, +$('laSize').value)); if (!$('laName').value.trim()) { $('laName').value = h.display_name.split(',')[0].replace(/^\d+\s+/, ''); syncBuild(); } };
      hits.appendChild(b);
    }
    list[0] && hits.firstChild.click();
  } catch { hits.textContent = 'Search is unavailable right now. Click the map instead.'; }
}

function progress(pct, msg, err) {
  $('laProg').hidden = false; if (pct != null) $('laBar').style.width = `${pct}%`;
  const m = $('laMsg'); m.textContent = msg; m.className = err ? 'la-err' : '';
}

async function build({ bbox, name, id, refresh }) {
  if (busy) return;
  id = id || slugify(name, ctx.AREAS.areas.map((a) => a.id));
  busy = true; syncBuild(); $('laRefresh').disabled = true; progress(1, refresh ? `Refreshing ${name}…` : `Building ${name}…`);
  let done = null;
  try {
    const res = await fetch('api/areas/build', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name, bbox, refresh: !!refresh }) });
    if (!res.ok || !res.body) throw new Error((await res.json().catch(() => ({}))).error || `Server said ${res.status}`);
    const rd = res.body.getReader(), dec = new TextDecoder(); let buf = '';
    for (;;) {
      const { value, done: end } = await rd.read(); if (end) break;
      buf += dec.decode(value, { stream: true });
      for (let i; (i = buf.indexOf('\n')) >= 0;) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.step === 'error') throw new Error(ev.msg);
        progress(ev.pct, ev.msg); if (ev.step === 'done') done = ev.area;
      }
    }
    if (!done) throw new Error('The builder stopped before finishing.');
    progress(100, `${done.name} is ready (${done.lots} lots). Opening…`);
    setTimeout(() => { if (refresh) location.reload(); else location.search = `?area=${encodeURIComponent(done.id)}`; }, 600);
  } catch (e) {
    busy = false; progress(null, e.message, true); syncBuild(); $('laRefresh').disabled = !devServer;
  }
}
