// The area picker's map: the real San Fernando Valley as a pannable, zoomable canvas.
// Layers: STREETS (a Camino render of real streets, terrain and parks baked by tools/pack/valley.py), SAT (USGS NAIP aerial
// imagery: a bundled overview, plus sharper tiles fetched from imagery.nationalmap.gov as you zoom in) and, over both,
// the named arterials as crisp vectors with street names. Area boxes, the box being chosen and a pin sit on top.
// No THREE and no game state: the picker owns what the map shows and listens to its callbacks.
import { bboxFromCorners } from './geo.js';

const KY = 110540;
const COL = { bg: '#070b0d', ready: '60,224,122', custom: '242,201,76', idle: '233,239,241', sel: '242,243,241', cyan: '47,216,232', ink: '#e9eff1', mono: '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace' };
const ROAD = { m: ['rgba(47,216,232,.95)', 3.6], t: ['rgba(47,216,232,.9)', 3], p: ['rgba(214,226,230,.92)', 2.6], s: ['rgba(150,166,174,.9)', 2], r: ['rgba(112,128,136,.85)', 1.5] };
const NAIP = 'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage';
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createMap(canvas, opts) {
  const { region, streetsUrl, satUrl, onPick, onAreaClick, onDraft, onHover, onCursor } = opts;
  const [W, S, E, N] = region.bbox, midLat = (S + N) / 2, KX = Math.cos((midLat * Math.PI) / 180) * 111320;
  const IW = 4200, IH = Math.round((IW * (N - S) * KY) / ((E - W) * KX)), MPP = ((E - W) * KX) / IW; // world units are streets-image pixels
  const toW = (lon, lat) => [((lon - W) / (E - W)) * IW, ((N - lat) / (N - S)) * IH];
  const toLL = (x, y) => [W + (x / IW) * (E - W), N - (y / IH) * (N - S)];
  const g = canvas.getContext('2d');
  const st = { cx: IW / 2, cy: IH / 2, z: 0.2, w: 1, h: 1, dpr: 1, layer: 'streets', areas: [], sel: null, loaded: null, draft: null, pin: null, hover: null, roads: [], imgs: {}, detail: null, anim: 0, raf: 0, gen: 0, dt: 0 };
  const zmin = () => Math.min(st.w / IW, st.h / IH), zmax = () => 3.2;
  const clampView = () => {
    st.z = Math.min(zmax(), Math.max(zmin(), st.z));
    const hw = st.w / 2 / st.z, hh = st.h / 2 / st.z;
    st.cx = hw * 2 >= IW ? IW / 2 : Math.min(IW - hw, Math.max(hw, st.cx));
    st.cy = hh * 2 >= IH ? IH / 2 : Math.min(IH - hh, Math.max(hh, st.cy));
  };
  const sx = (x) => (x - st.cx) * st.z + st.w / 2, sy = (y) => (y - st.cy) * st.z + st.h / 2;
  const toScreen = (lon, lat) => { const [x, y] = toW(lon, lat); return [sx(x), sy(y)]; };
  const fromScreen = (px, py) => toLL((px - st.w / 2) / st.z + st.cx, (py - st.h / 2) / st.z + st.cy);

  function size() {
    const r = canvas.getBoundingClientRect(); st.dpr = Math.min(2, devicePixelRatio || 1);
    st.w = Math.max(50, r.width); st.h = Math.max(50, r.height);
    canvas.width = Math.round(st.w * st.dpr); canvas.height = Math.round(st.h * st.dpr);
    const first = !st.sized; st.sized = true; if (first) st.z = zmin();
    clampView(); draw();
  }
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (canvas.offsetParent) size(); }) : null; ro?.observe(canvas);

  function load(key, url) {
    if (!url || st.imgs[key]) return;
    const im = new Image(); im.decoding = 'async'; im.onload = () => { st.imgs[key] = im; invalidate(); }; im.onerror = () => { st.imgs[key + 'Err'] = true; invalidate(); }; im.src = url;
  }
  load('streets', streetsUrl);

  function invalidate() { if (!st.raf) st.raf = requestAnimationFrame(() => { st.raf = 0; draw(); }); }

  // ---------- drawing ----------
  function drawImg(im, bb) { // an image covering lon/lat box bb
    const [x0, y0] = toW(bb[0], bb[3]), [x1, y1] = toW(bb[2], bb[1]);
    g.drawImage(im, sx(x0), sy(y0), (x1 - x0) * st.z, (y1 - y0) * st.z);
  }
  function label(text, x, y, o = {}) {
    g.save(); g.font = `${o.w || 600} ${o.size || 10}px ${COL.mono}`; if ('letterSpacing' in g) g.letterSpacing = o.ls || '1.4px';
    g.textAlign = o.align || 'left'; g.textBaseline = 'alphabetic'; g.lineJoin = 'round'; g.lineWidth = 3.5; g.strokeStyle = 'rgba(5,8,10,.9)'; g.strokeText(text, x, y);
    g.fillStyle = o.color || COL.ink; g.fillText(text, x, y); g.restore();
  }
  function boxPx(b) { const p = toScreen(b[0], b[3]), q = toScreen(b[2], b[1]); return [p[0], p[1], q[0] - p[0], q[1] - p[1]]; }
  function areaRect(a) { // on-screen rect, never smaller than a 12 px tick so every area can be seen and hit when zoomed out
    let [x, y, w, h] = boxPx(a.bbox); const m = 12;
    if (w < m) { x -= (m - w) / 2; w = m; } if (h < m) { y -= (m - h) / 2; h = m; }
    return [x, y, w, h];
  }

  function draw() {
    if (!st.sized) return;
    g.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); g.fillStyle = COL.bg; g.fillRect(0, 0, st.w, st.h);
    g.imageSmoothingQuality = 'high';
    const full = [W, S, E, N], sat = st.layer === 'sat';
    if (sat && st.imgs.sat) {
      g.save(); if ('filter' in g) g.filter = 'grayscale(.55) contrast(1.06) brightness(.8)'; drawImg(st.imgs.sat, full); g.restore();
      const d = st.detail; if (d && d.im && d.gen === st.gen) { g.save(); if ('filter' in g) g.filter = 'grayscale(.55) contrast(1.06) brightness(.8)'; drawImg(d.im, d.bbox); g.restore(); }
      const [x0, y0] = toW(W, N), [x1, y1] = toW(E, S); g.fillStyle = 'rgba(4,12,16,.34)'; g.fillRect(sx(x0), sy(y0), (x1 - x0) * st.z, (y1 - y0) * st.z);
    } else if (st.imgs.streets) drawImg(st.imgs.streets, full);
    if (st.z > (sat ? 0.15 : 0.85)) drawRoads(sat);
    drawAreas(); drawDraft(); drawPin(); drawScale();
    if (!st.imgs.streets && !st.imgs.streetsErr) label('LOADING MAP', st.w / 2, st.h / 2, { align: 'center', color: '#8a99a3' });
    if (st.imgs.streetsErr) label('MAP IMAGE MISSING: RUN tools/pack/valley.py', st.w / 2, st.h / 2, { align: 'center', color: '#ff4436' });
    if (sat && st.imgs.satErr) label('SATELLITE IMAGE UNAVAILABLE', st.w / 2, 24, { align: 'center', color: '#f2c94c' });
  }

  function drawRoads(sat) {
    const labels = [], grid = new Set(), z = st.z, pad = 80;
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    for (const cls of ['r', 's', 'p', 't', 'm']) {
      if (cls === 'r' && z < 0.7) continue;
      const [col, w0] = ROAD[cls]; g.strokeStyle = sat ? col.replace(/[\d.]+\)$/, '.7)') : col; g.lineWidth = Math.max(1, w0 * z * 0.85);
      for (const r of st.roads) {
        if (r.c !== cls || !r.vis()) continue;
        let best = null;
        for (const L of r.lines) {
          let on = false; g.beginPath();
          for (let i = 0; i < L.p.length; i += 2) { const x = sx(L.p[i]), y = sy(L.p[i + 1]); i ? g.lineTo(x, y) : g.moveTo(x, y); if (x > -pad && y > -pad && x < st.w + pad && y < st.h + pad) on = true; }
          if (!on) continue; g.stroke();
          if (L.len > 0 && (!best || L.len > best.len)) best = L;
        }
        if (best && z > (cls === 'r' ? 1.5 : 0.9)) labels.push([r.name, best]);
      }
    }
    g.restore();
    for (const [name, L] of labels) { // street names along the longest piece, one per 110 px cell
      const m = L.p.length / 2 >> 1, a = [sx(L.p[m * 2]), sy(L.p[m * 2 + 1])], b = [sx(L.p[Math.min(L.p.length - 2, m * 2 + 2)]), sy(L.p[Math.min(L.p.length - 1, m * 2 + 3)])];
      if (a[0] < 20 || a[1] < 20 || a[0] > st.w - 20 || a[1] > st.h - 20) continue;
      const key = `${Math.floor(a[0] / 110)},${Math.floor(a[1] / 40)}`; if (grid.has(key)) continue; grid.add(key);
      let ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      g.save(); g.translate(a[0], a[1]); g.rotate(ang); label(name.toUpperCase(), 0, -4, { size: 9, align: 'center', w: 500, ls: '1.2px', color: '#cfd8dc' }); g.restore();
    }
  }

  function drawAreas() {
    for (const a of st.areas) {
      if (!a.bbox) continue;
      const [x, y, w, h] = areaRect(a); if (x > st.w || y > st.h || x + w < 0 || y + h < 0) continue;
      const ready = a.status === 'ready', on = a.id === st.sel, hov = a.id === st.hover, c = a.custom ? COL.custom : ready ? COL.ready : COL.idle;
      g.save(); g.fillStyle = `rgba(${on ? COL.cyan : c},${on ? 0.2 : hov ? 0.2 : ready ? 0.1 : 0.04})`; g.fillRect(x, y, w, h);
      g.strokeStyle = on ? `rgb(${COL.cyan})` : `rgba(${c},${ready ? 0.95 : 0.55})`; g.lineWidth = on ? 2.4 : hov ? 2 : 1.3; if (!ready) g.setLineDash([4, 3]); g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      if (on) { g.setLineDash([]); g.strokeStyle = `rgb(${COL.sel})`; g.lineWidth = 2; for (const [cx, cy, dx, dy] of [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]]) { g.beginPath(); g.moveTo(cx + dx * 9, cy); g.lineTo(cx, cy); g.lineTo(cx, cy + dy * 9); g.stroke(); } }
      g.restore();
      if (st.z > 0.17 || on || hov) label(`${a.name}${a.id === st.loaded ? '  ●' : ''}`.toUpperCase(), x + w / 2, y - 6, { align: 'center', size: on ? 11 : 9.5, color: on ? `rgb(${COL.cyan})` : COL.ink });
    }
  }

  function drawDraft() {
    const d = st.draft; if (!d) return;
    const [x, y, w, h] = boxPx(d);
    g.save(); g.fillStyle = 'rgba(47,216,232,.14)'; g.fillRect(x, y, w, h); g.setLineDash([7, 4]); g.lineWidth = 2; g.strokeStyle = `rgb(${COL.cyan})`; g.strokeRect(x, y, w, h);
    g.setLineDash([]); g.beginPath(); g.moveTo(x + w / 2 - 9, y + h / 2); g.lineTo(x + w / 2 + 9, y + h / 2); g.moveTo(x + w / 2, y + h / 2 - 9); g.lineTo(x + w / 2, y + h / 2 + 9); g.lineWidth = 1.2; g.stroke(); g.restore();
    const wm = (d[2] - d[0]) * KX, hm = (d[3] - d[1]) * KY;
    label(`${Math.round(wm)} × ${Math.round(hm)} M`, x + w / 2, y + h + 14, { align: 'center', color: `rgb(${COL.cyan})` });
  }
  function drawPin() {
    if (!st.pin) return; const [x, y] = toScreen(st.pin[0], st.pin[1]), t = (performance.now() % 1800) / 1800;
    g.save(); g.strokeStyle = `rgb(${COL.cyan})`; g.lineWidth = 1.5; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke();
    g.globalAlpha = 1 - t; g.beginPath(); g.arc(x, y, 5 + t * 16, 0, 7); g.stroke(); g.restore();
    if (!reduce) invalidate();
  }
  function drawScale() {
    const mpp = MPP / st.z; let m = 200; for (const c of [100, 200, 500, 1000, 2000, 5000, 10000]) if (c / mpp < 150) m = c;
    const len = m / mpp, x = 14, y = st.h - 16;
    g.save(); g.strokeStyle = COL.ink; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x, y); g.lineTo(x + len, y); g.lineTo(x + len, y - 5); g.stroke(); g.restore();
    label(m >= 1000 ? `${m / 1000} KM` : `${m} M`, x + len + 8, y + 1, { size: 9.5 });
  }

  // ---------- NAIP detail tiles for the satellite layer ----------
  function wantDetail() {
    clearTimeout(st.dt); if (st.layer !== 'sat' || st.z < 0.55 || st.imgs.satErr) return;
    const gen = ++st.gen; st.dt = setTimeout(() => {
      const a = fromScreen(0, 0), b = fromScreen(st.w, st.h), bb = [Math.max(W, a[0]), Math.max(S, b[1]), Math.min(E, b[0]), Math.min(N, a[1])];
      if (bb[0] >= bb[2] || bb[1] >= bb[3]) return;
      const pw = Math.min(1800, Math.round(st.w * st.dpr)), ph = Math.round(pw * (st.h / st.w));
      const im = new Image(); im.decoding = 'async'; im.onload = () => { if (gen === st.gen) { st.detail = { im, bbox: bb, gen }; invalidate(); } }; im.onerror = () => {};
      im.src = `${NAIP}?bbox=${bb.map((v) => v.toFixed(6)).join(',')}&bboxSR=4326&imageSR=4326&size=${pw},${ph}&format=jpg&f=image`;
    }, 380);
  }

  // ---------- view changes ----------
  function setView(cx, cy, z) { st.cx = cx; st.cy = cy; st.z = z; clampView(); st.gen++; invalidate(); wantDetail(); }
  function flyTo(cx, cy, z) {
    cancelAnimationFrame(st.anim); const f = { cx: st.cx, cy: st.cy, z: st.z }; z = Math.min(zmax(), Math.max(zmin(), z));
    if (reduce) return setView(cx, cy, z);
    const t0 = performance.now(), dur = 520, ease = (t) => 1 - (1 - t) ** 3;
    const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = ease(k); setView(f.cx + (cx - f.cx) * e, f.cy + (cy - f.cy) * e, f.z * (z / f.z) ** e); if (k < 1) st.anim = requestAnimationFrame(step); };
    st.anim = requestAnimationFrame(step);
  }
  function zoomAt(px, py, k) { const [lon, lat] = fromScreen(px, py), nz = Math.min(zmax(), Math.max(zmin(), st.z * k)); const [x, y] = toW(lon, lat); setView(x - (px - st.w / 2) / nz, y - (py - st.h / 2) / nz, nz); }

  // ---------- pointer ----------
  const hitArea = (px, py) => { for (let i = st.areas.length - 1; i >= 0; i--) { const a = st.areas[i]; if (!a.bbox) continue; const [x, y, w, h] = areaRect(a); if (px >= x && px <= x + w && py >= y && py <= y + h) return a; } return null; };
  const inDraft = (px, py) => { if (!st.draft) return false; const [x, y, w, h] = boxPx(st.draft); return px >= x && px <= x + w && py >= y && py <= y + h; };
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; canvas.setPointerCapture(e.pointerId); canvas.focus({ preventScroll: true }); cancelAnimationFrame(st.anim);
    const px = e.offsetX, py = e.offsetY;
    drag = { px, py, x: px, y: py, moved: false, mode: e.shiftKey ? 'draw' : inDraft(px, py) && !hitArea(px, py) ? 'move' : 'pan', c0: { cx: st.cx, cy: st.cy }, d0: st.draft && [...st.draft], ll0: fromScreen(px, py) };
  });
  canvas.addEventListener('pointermove', (e) => {
    const px = e.offsetX, py = e.offsetY, [lon, lat] = fromScreen(px, py); onCursor?.(lon, lat);
    if (!drag) { const h = hitArea(px, py); if ((h?.id || null) !== st.hover) { st.hover = h?.id || null; onHover?.(h, e); invalidate(); } else if (h) onHover?.(h, e); canvas.style.cursor = h ? 'pointer' : inDraft(px, py) ? 'move' : 'crosshair'; return; }
    if (!drag.moved && Math.hypot(px - drag.px, py - drag.py) < 5) return; drag.moved = true; canvas.style.cursor = drag.mode === 'pan' ? 'grabbing' : 'move';
    if (drag.mode === 'pan') { st.cx = drag.c0.cx - (px - drag.px) / st.z; st.cy = drag.c0.cy - (py - drag.py) / st.z; clampView(); invalidate(); }
    else if (drag.mode === 'move') { const dl = [lon - drag.ll0[0], lat - drag.ll0[1]], d = drag.d0; st.draft = [d[0] + dl[0], d[1] + dl[1], d[2] + dl[0], d[3] + dl[1]]; onDraft?.(st.draft, 'move'); invalidate(); }
    else { st.draft = bboxFromCorners(drag.ll0, [lon, lat]); onDraft?.(st.draft, 'draw'); invalidate(); }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return; const d = drag; drag = null; canvas.style.cursor = 'crosshair';
    if (d.moved) { if (d.mode === 'pan') wantDetail(); else onDraft?.(st.draft, 'end'); return; }
    const a = hitArea(d.px, d.py); if (a) onAreaClick?.(a); else onPick?.(...fromScreen(d.px, d.py));
  });
  canvas.addEventListener('pointerleave', () => { if (st.hover) { st.hover = null; onHover?.(null); invalidate(); } });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); cancelAnimationFrame(st.anim); zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016))); }, { passive: false });
  canvas.addEventListener('dblclick', (e) => zoomAt(e.offsetX, e.offsetY, 2));
  canvas.addEventListener('keydown', (e) => {
    const k = e.key, s = 80 / st.z;
    if (k === '+' || k === '=') zoomAt(st.w / 2, st.h / 2, 1.5); else if (k === '-' || k === '_') zoomAt(st.w / 2, st.h / 2, 1 / 1.5);
    else if (k.startsWith('Arrow')) setView(st.cx + (k === 'ArrowRight' ? s : k === 'ArrowLeft' ? -s : 0), st.cy + (k === 'ArrowDown' ? s : k === 'ArrowUp' ? -s : 0), st.z); else return;
    e.preventDefault(); e.stopPropagation();
  });

  const api = {
    resize: size, redraw: invalidate,
    setAreas(a) { st.areas = a; invalidate(); }, setSelected(id) { st.sel = id; invalidate(); }, setLoaded(id) { st.loaded = id; invalidate(); },
    setDraft(b) { st.draft = b; invalidate(); }, setPin(p) { st.pin = p; invalidate(); },
    setLayer(l) { st.layer = l; if (l === 'sat') { load('sat', satUrl); wantDetail(); } invalidate(); }, get layer() { return st.layer; },
    setRoads(list) { // [{n, c, l:[flat lon/lat arrays]}] -> world-space pieces with a cheap visibility test
      st.roads = list.map((r) => {
        const lines = r.l.map((f) => { const p = new Float64Array(f.length); let len = 0; for (let i = 0; i < f.length; i += 2) { const [x, y] = toW(f[i], f[i + 1]); p[i] = x; p[i + 1] = y; if (i) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); } return { p, len }; });
        return { name: r.n, c: r.c, lines, vis: () => true };
      });
      invalidate();
    },
    flyToLL(lon, lat, z) { const [x, y] = toW(lon, lat); flyTo(x, y, z ?? Math.max(st.z, 0.9)); },
    flyToBox(b, fill = 0.42) { const [x0, y0] = toW(b[0], b[3]), [x1, y1] = toW(b[2], b[1]); flyTo((x0 + x1) / 2, (y0 + y1) / 2, Math.min(st.w * fill / Math.max(1, x1 - x0), st.h * fill / Math.max(1, y1 - y0))); },
    zoomBy(k) { zoomAt(st.w / 2, st.h / 2, k); }, reset() { flyTo(IW / 2, IH / 2, zmin()); },
    toScreen, fromScreen, get zoom() { return st.z; },
    destroy() { ro?.disconnect(); cancelAnimationFrame(st.raf); cancelAnimationFrame(st.anim); clearTimeout(st.dt); },
  };
  return api;
}
