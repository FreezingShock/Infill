import * as THREE from 'three';
import { C, UP, clamp, inPoly, obb, obox, oroof, rng, pick, segDist2 } from './core.js';

// =====================================================================
// Looks: what kind of building is this, and how should it be drawn?
// A look is decided from open data only (Overture class and floors, Overture Places, and when
// present the roof colour and pitched/flat read from public-domain NAIP imagery) plus the footprint
// itself. The result is the same toon vertex-colour geometry as the rest of the engine, so ink
// outlines and lighting stay consistent. Everything here is optional: a building with no sidecar
// data still gets a kind from its footprint, and a missing look falls back to the old box.
// =====================================================================

// ---------- sidecar data (public/areas/<id>.looks.json), set by src/assets/boot.js ----------
let SIDECAR = null;
function setLooksData(d, buildingCount, checksum) {
  SIDECAR = d && d.v === 1 && d.n === buildingCount && (checksum == null || d.chk === checksum) ? d : null;
  return !!SIDECAR;
}
const metaOf = (idx) => (SIDECAR && SIDECAR.b[idx]) || null;
const hasLooksData = () => !!SIDECAR;
function packChecksum(buildings) { let s = 0; for (const b of buildings) s += Math.round(b.r[0][0] * 10) + Math.round(b.r[0][1] * 10) * 3; return s; }

// ---------- classification ----------
const KINDS = ['house', 'apt', 'store', 'strip', 'bigbox', 'office', 'hotel', 'school', 'civic', 'shed', 'outbuilding', 'plain'];
// Overture Places category -> storefront colours: [wall, accent]
const SHOP = {
  restaurant: [0xefd9bd, 0xc4613b], casual_eatery: [0xf2e2c2, 0xd6ad57], food_and_beverage_store: [0xe6eadb, 0x4f8a4a], grocery_store: [0xe6eadb, 0x4f8a4a],
  fashion_and_apparel_store: [0xeadcdf, 0x8a5a9e], hardware_home_and_garden_store: [0xdfe4e8, 0x3e7fb5], automotive_service: [0xd9d6d0, 0x2b2420],
  health_care: [0xeef1f1, 0x3b8f8f], dental_clinic: [0xeef1f1, 0x3b8f8f], medical_service: [0xeef1f1, 0x3b8f8f], wellness_service: [0xeee6dc, 0x6f9a6f],
  personal_or_beauty_service: [0xf1dfe1, 0xc1627a], financial_service: [0xe3e6ec, 0x2f4f7a], real_estate_service: [0xeadfca, 0xb65d3a], gym: [0xdcdfe3, 0xd6573a],
};
const SHOP_DEFAULT = [[0xeadfca, 0xc4613b], [0xdcd2bf, 0x3e9fdc], [0xe8c9a0, 0x4f8a4a], [0xc9d3d6, 0xd6ad57], [0xe7d4d0, 0x8a5a9e], [0xd8dfc8, 0x2b2420]];

function geometry(b) {
  const R = obb(b.r); if (!R) return { R: null, w: 0, d: 0, rect: 0, aspect: 1 };
  const w = Math.max(R.hw, R.hd) * 2, d = Math.min(R.hw, R.hd) * 2;
  return { R, w, d, rect: b.a / Math.max(1, 4 * R.hw * R.hd), aspect: w / Math.max(d, 0.1) };
}

// kind: the archetype to draw. Pure: depends only on numbers, so tests can cover it.
function classify(b, meta, geo, floorsHint) {
  const c = meta && meta.c, a = b.a, t = b.t;
  if (c === 'garage' || c === 'garages' || c === 'carport' || c === 'shed' || c === 'roof' || c === 'greenhouse' || c === 'service' || t === 'outbuilding' || t === 'agricultural' || a < 40) return 'outbuilding';
  if (c === 'school' || c === 'college' || c === 'university' || c === 'kindergarten' || t === 'education') return 'school';
  if (c === 'hotel' || c === 'motel') return 'hotel';
  if (c === 'church' || c === 'chapel' || c === 'library' || c === 'civic' || c === 'government' || c === 'fire_station' || c === 'hospital' || t === 'civic') return 'civic';
  if (c === 'industrial' || c === 'warehouse' || c === 'factory' || t === 'industrial') return 'shed';
  if (c === 'retail' || c === 'supermarket' || c === 'commercial' || c === 'office' || t === 'commercial' || (meta && meta.p)) {
    if (c === 'office' || (floorsHint >= 3 && a < 2500)) return 'office';
    if (a > 2200) return 'bigbox';
    if (a > 650 && geo.aspect > 2.4) return 'strip';
    return 'store';
  }
  if (c === 'apartments' || c === 'residential' || c === 'dormitory' || c === 'terrace' || c === 'semidetached_house' || c === 'duplex') return a > 220 || floorsHint >= 3 ? 'apt' : 'house';
  if (c === 'house' || c === 'detached' || c === 'bungalow' || t === 'residential' || t === 'unknown' || !t) return a > 420 && floorsHint >= 2 ? 'apt' : 'house';
  return 'plain';
}

// ---------- small geometry helpers ----------
const mix = (hexA, hexB, k) => new THREE.Color(hexA).lerp(new THREE.Color(hexB), k);
const colOf = (v) => (v instanceof THREE.Color ? v : C(v));
function ringEdges(r) {
  let sa = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; sa += p[0] * q[1] - q[0] * p[1]; }
  const out = [];
  for (let i = 0; i < r.length; i++) {
    const a = r[i], c = r[(i + 1) % r.length], dx = c[0] - a[0], dz = c[1] - a[1], L = Math.hypot(dx, dz); if (L < 0.05) continue;
    const ux = dx / L, uz = dz / L, nx = sa > 0 ? uz : -uz, nz = sa > 0 ? -ux : ux;
    out.push({ a, c, L, ux, uz, nx, nz });
  }
  return out;
}
function wallQuad(acc, e, y0, y1, col, out = 0, inset = 0) { // a vertical strip along an edge, optionally pushed out along its normal
  const ax = e.a[0] + e.nx * out, az = e.a[1] + e.nz * out, cx = e.c[0] + e.nx * out, cz = e.c[1] + e.nz * out;
  void inset;
  acc.quad([ax, y0, az], [cx, y0, cz], [cx, y1, cz], [ax, y1, az], col, [e.nx, 0, e.nz]);
}
// a rectangle on a wall: u0..u1 metres along the edge from a, y0..y1 up, pushed `out` from the wall
function panel(acc, e, u0, u1, y0, y1, col, out = 0.06) {
  const P = (u, y) => [e.a[0] + e.ux * u + e.nx * out, y, e.a[1] + e.uz * u + e.nz * out];
  acc.quad(P(u0, y0), P(u1, y0), P(u1, y1), P(u0, y1), col, [e.nx, 0, e.nz]);
}
function cap(ctx, ring, y, col) { // flat triangulated lid on a footprint
  try { for (const t of THREE.ShapeUtils.triangulateShape(ring.map((p) => new THREE.Vector2(p[0], p[1])), [])) ctx.s.tri([ring[t[0]][0], y, ring[t[0]][1]], [ring[t[1]][0], y, ring[t[1]][1]], [ring[t[2]][0], y, ring[t[2]][1]], col, UP); } catch (e) { /* odd footprint: walls only */ }
}
function parapet(ctx, edges, y1, h, wall, top) {
  const t = 0.28;
  for (const e of edges) {
    wallQuad(ctx.s, e, y1, y1 + h, wall, 0.02);
    const ia = [e.a[0] - e.nx * t, e.a[1] - e.nz * t], ic = [e.c[0] - e.nx * t, e.c[1] - e.nz * t];
    ctx.s.quad([e.a[0], y1 + h, e.a[1]], [e.c[0], y1 + h, e.c[1]], [ic[0], y1 + h, ic[1]], [ia[0], y1 + h, ia[1]], top, UP);
    ctx.s.quad([ia[0], y1, ia[1]], [ic[0], y1, ic[1]], [ic[0], y1 + h, ic[1]], [ia[0], y1 + h, ia[1]], mix(0xb9b2a6, 0x000000, 0.08), [-e.nx, 0, -e.nz]);
    ctx.s.line([e.a[0], y1 + h, e.a[1]], [e.c[0], y1 + h, e.c[1]]);
  }
}
function unit(acc, x, z, y, w, d, h, col, ang = 0) { // small oriented box (rooftop units, chimneys, posts)
  const ux = Math.cos(ang), uz = Math.sin(ang);
  obox(acc, { x, z, ux, uz, vx: -uz, vz: ux, hw: w / 2, hd: d / 2 }, y, h, col, true);
}
function freeSpots(ring, r, n, margin, taken = []) { // n interior points that keep `margin` from the walls and each other
  const bb = ring.reduce((m, p) => [Math.min(m[0], p[0]), Math.min(m[1], p[1]), Math.max(m[2], p[0]), Math.max(m[3], p[1])], [1e9, 1e9, -1e9, -1e9]);
  const out = [];
  for (let k = 0; k < n * 24 && out.length < n; k++) {
    const x = bb[0] + r() * (bb[2] - bb[0]), z = bb[1] + r() * (bb[3] - bb[1]);
    if (!inPoly(x, z, ring)) continue;
    let ok = true;
    for (let i = 0; i < ring.length && ok; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; if (segDist2(x, z, a[0], a[1], c[0], c[1]) < margin * margin) ok = false; }
    for (const q of out.concat(taken)) if ((q[0] - x) ** 2 + (q[1] - z) ** 2 < 9) ok = false;
    if (ok) out.push([x, z]);
  }
  return out;
}

// ---------- rectangles that tile an L- or T-shaped footprint, so each wing gets its own roof ----------
function maxRect(g, nu, nv) { // largest all-true rectangle in a boolean grid (histogram method)
  const h = new Array(nu).fill(0); let best = null;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) h[i] = g[j * nu + i] ? h[i] + 1 : 0;
    const st = [];
    for (let i = 0; i <= nu; i++) {
      const cur = i === nu ? 0 : h[i]; let start = i;
      while (st.length && st[st.length - 1][1] >= cur) {
        const [s, hh] = st.pop(); const area = (i - s) * hh;
        if (!best || area > best.area) best = { area, i0: s, i1: i, j0: j - hh + 1, j1: j + 1 };
        start = s;
      }
      st.push([start, cur]);
    }
  }
  return best;
}
// Roof pieces for a footprint: greedy rectangles (largest first) until the polygon is (almost) fully covered. A side that faces open air
// gets an eave grown to reach the real wall; a side that touches another piece gets none, so wings meet the main roof instead of stacking
// slabs over it. R.eave = [s-, s+, t-, t+] in the piece's own frame.
function wings(ring, R, maxN = 7) {
  const cell = clamp(Math.max(R.hw, R.hd) / 40, 0.35, 0.9), nu = Math.ceil(R.hw * 2 / cell), nv = Math.ceil(R.hd * 2 / cell);
  const g = new Array(nu * nv);
  let on = 0;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const s = -R.hw + (i + 0.5) * cell, t = -R.hd + (j + 0.5) * cell;
    const v = inPoly(R.x + R.ux * s + R.vx * t, R.z + R.uz * s + R.vz * t, ring); g[j * nu + i] = v; if (v) on++;
  }
  if (!on) return { rects: [], cover: 0 };
  const inside = g.slice(), at = (i, j) => i >= 0 && j >= 0 && i < nu && j < nv && inside[j * nu + i];
  const touches = (cells) => cells.filter(([i, j]) => at(i, j)).length > cells.length * 0.85; // another roof piece continues beyond this whole side
  const rects = []; let covered = 0;
  for (let n = 0; n < maxN; n++) {
    const m = maxRect(g, nu, nv); if (!m || m.area < Math.max(3, on * 0.012) || covered / on > 0.985) break;
    for (let j = m.j0; j < m.j1; j++) for (let i = m.i0; i < m.i1; i++) g[j * nu + i] = false;
    covered += m.area;
    const col = (i) => { const c = []; for (let j = m.j0; j < m.j1; j++) c.push([i, j]); return c; }, row = (j) => { const c = []; for (let i = m.i0; i < m.i1; i++) c.push([i, j]); return c; };
    const out = cell * 0.5 + 0.45, e = [touches(col(m.i0 - 1)) ? 0 : out, touches(col(m.i1)) ? 0 : out, touches(row(m.j0 - 1)) ? 0 : out, touches(row(m.j1)) ? 0 : out];
    const s0 = -R.hw + m.i0 * cell, s1 = -R.hw + m.i1 * cell, t0 = -R.hd + m.j0 * cell, t1 = -R.hd + m.j1 * cell, sm = (s0 + s1) / 2, tm = (t0 + t1) / 2;
    rects.push({ x: R.x + R.ux * sm + R.vx * tm, z: R.z + R.uz * sm + R.vz * tm, ux: R.ux, uz: R.uz, vx: R.vx, vz: R.vz, hw: (s1 - s0) / 2, hd: (t1 - t0) / 2, eave: e });
  }
  return { rects, cover: covered / on };
}

// ---------- the look of one building ----------
// o: { h, P: {w, r} palette, solar(R, y, roof), overridden: user picked a palette/roof in the game }
function lookFor(ctx, b, idx, o) {
  const meta = metaOf(idx), geo = geometry(b);
  if (!geo.R) return null;
  const floorsHint = meta && meta.f ? meta.f : Math.max(1, Math.round(o.h / 3.2));
  const kind = classify(b, meta, geo, floorsHint);
  const r = rng((ctx.lot.sd || 1) * 31 + idx + 11);
  return { kind, meta, geo, r, floorsHint };
}

function drawBuilding(ctx, b, idx, o) {
  let L; try { L = lookFor(ctx, b, idx, o); } catch (e) { return false; }
  if (!L || L.kind === 'plain') return false;
  try { DRAW[L.kind](ctx, b, idx, L, o); } catch (e) { console.warn('look failed, using the plain box', e); return false; }
  return true;
}

function shell(ctx, b, L, o, opt) {
  // walls from the footprint with a plinth and ink lines; returns the edge list and key heights
  const { P } = o, y0 = b.b - 1, edges = ringEdges(b.r);
  const wall = colOf(opt.wall ?? P.w), plinth = mix(wall.getHex(), 0x6f655a, 0.35);
  for (const e of edges) {
    wallQuad(ctx.s, e, y0, opt.y1, wall);
    if (opt.plinth !== false) wallQuad(ctx.s, e, y0, b.b + 0.55, plinth, 0.04);
    ctx.s.line([e.a[0], opt.y1, e.a[1]], [e.c[0], opt.y1, e.c[1]]); ctx.s.line([e.a[0], b.b, e.a[1]], [e.a[0], opt.y1, e.a[1]]);
  }
  return { edges, wall, y0 };
}
const frontEdges = (ctx, edges, min = 3) => edges.filter((e) => e.L >= min && e.nx * ctx.lot.fd[0] + e.nz * ctx.lot.fd[1] > 0.55);

function windowsOn(ctx, edges, y, floors, fh, opt = {}) {
  const gcol = C(opt.glass || 0x2f4753), trim = C(opt.trim || 0xf4f1ea);
  for (const e of edges) {
    if (e.L < 2.2) continue;
    const bay = opt.bay || 3.5, n = Math.max(1, Math.floor(e.L / bay)), step = e.L / n;
    for (let f = opt.from || 0; f < floors && f < 14; f++) for (let w = 0; w < n; w++) {
      if (opt.skip && opt.skip(e, f, w, n)) continue;
      const u = (w + 0.5) * step, ww = Math.min(opt.ww || 1.4, step * 0.5), wh = Math.min(opt.wh || 1.4, fh * 0.46), yy = y + f * fh + fh * 0.3;
      if (opt.trim !== false) panel(ctx.g, e, u - ww / 2 - 0.12, u + ww / 2 + 0.12, yy - 0.12, yy + wh + 0.12, trim, 0.05);
      panel(ctx.g, e, u - ww / 2, u + ww / 2, yy, yy + wh, gcol, 0.075);
    }
  }
}
function door(ctx, e, u, y, col = 0x6d4a33, w = 1.0, h = 2.2) { panel(ctx.g, e, u - w / 2, u + w / 2, y, y + h, C(col), 0.08); }
function canopy(ctx, e, u, w, y, depth, col) { // flat slab that sticks out of the wall
  const A = (uu, dd) => [e.a[0] + e.ux * uu + e.nx * dd, y, e.a[1] + e.uz * uu + e.nz * dd];
  ctx.g.quad(A(u - w / 2, 0), A(u + w / 2, 0), A(u + w / 2, depth), A(u - w / 2, depth), col, UP);
  ctx.g.quad(A(u - w / 2, depth), A(u + w / 2, depth), [e.a[0] + e.ux * (u + w / 2) + e.nx * depth, y - 0.2, e.a[1] + e.uz * (u + w / 2) + e.nz * depth], [e.a[0] + e.ux * (u - w / 2) + e.nx * depth, y - 0.2, e.a[1] + e.uz * (u - w / 2) + e.nz * depth], mix(col.getHex(), 0x000000, 0.2), [e.nx, 0, e.nz]);
}
function awning(ctx, e, u0, u1, y, drop, depth, c1, c2) {
  const stripe = 0.8, n = Math.max(1, Math.round((u1 - u0) / stripe)), step = (u1 - u0) / n;
  const A = (u, d, yy) => [e.a[0] + e.ux * u + e.nx * d, yy, e.a[1] + e.uz * u + e.nz * d];
  for (let i = 0; i < n; i++) {
    const col = i % 2 ? c2 : c1, ua = u0 + i * step, ub = ua + step;
    ctx.g.quad(A(ua, 0.02, y), A(ub, 0.02, y), A(ub, depth, y - drop), A(ua, depth, y - drop), col, [e.nx, 0.7, e.nz]);
    ctx.g.quad(A(ua, depth, y - drop), A(ub, depth, y - drop), A(ub, depth, y - drop - 0.28), A(ua, depth, y - drop - 0.28), col, [e.nx, 0, e.nz]);
  }
  ctx.g.line(A(u0, depth, y - drop), A(u1, depth, y - drop));
}
function storefront(ctx, e, y, fh, col, accent, opt = {}) { // shop glass, mullions, sign band, entrance
  const g1 = Math.min(3.1, fh - 0.5), ins = 0.6;
  if (e.L < ins * 2 + 2) return;
  panel(ctx.g, e, ins, e.L - ins, y + 0.45, y + g1, C(0x3b5866), 0.07);
  const bays = Math.max(1, Math.round((e.L - ins * 2) / 3.6)), step = (e.L - ins * 2) / bays;
  for (let i = 1; i < bays; i++) panel(ctx.g, e, ins + i * step - 0.07, ins + i * step + 0.07, y + 0.45, y + g1, C(0xf4f1ea), 0.09);
  const dU = ins + step * (bays > 1 ? Math.floor(bays / 2) : 0.5) - (bays > 1 ? 0 : 0);
  door(ctx, e, bays > 1 ? ins + step * Math.floor(bays / 2) : e.L / 2, y, 0x2b2420, 1.3, 2.4);
  void dU;
  if (!opt.noSign) panel(ctx.g, e, ins - 0.2, e.L - ins + 0.2, y + g1 + 0.12, y + Math.min(fh - 0.1, g1 + 0.85), colOf(accent), 0.09);
  void col;
}

// ---------- archetypes ----------
function drawHouse(ctx, b, idx, L, o) {
  const { geo, meta, r } = L, { P } = o, prog = ctx.prog;
  const floors = clamp(meta && meta.f ? meta.f : Math.round(o.h / 3.1), 1, 3), fh = o.h / floors, y1 = b.b + o.h;
  const roofKind = !o.overridden && meta && meta.rs ? (meta.rs === 'f' ? 'flat' : prog.rf !== 'flat' && prog.rf !== 'garden' ? prog.rf : 'gable') : prog.rf;
  const rcol = !o.overridden && meta && meta.rc ? roofColour(meta.rc) : C(P.r);
  const { edges } = shell(ctx, b, L, o, { y1 });
  const fe = frontEdges(ctx, edges, 3);
  const pitched = roofKind !== 'flat' && roofKind !== 'garden' && b.a < 900;
  const W = pitched ? wings(b.r, geo.R) : { rects: [], cover: 0 };
  if (pitched && W.rects.length && W.cover > 0.9) {
    W.rects.forEach((R, i) => {
      let G = R; if (meta && meta.rx && i === 0) G = { ...R, hw: R.hd, hd: R.hw, ux: R.vx, uz: R.vz, vx: -R.ux, vz: -R.uz, eave: [R.eave[2], R.eave[3], R.eave[1], R.eave[0]] }; // ridge across the long side when the picture says so
      // one roof family, one pitch: a lone piece keeps the chosen form, several pieces are gables so wings meet the main roof cleanly
      oroof(ctx.s, G, y1, roofKind === 'shed' ? 'shed' : W.rects.length > 1 && roofKind === 'hip' ? 'gable' : roofKind, rcol, C(P.w), 0.3);
    });
  } else flatTop(ctx, b, edges, y1, o, rcol, false);
  windowsOn(ctx, edges, b.b, floors, fh, { ww: 1.2, wh: 1.35, bay: 3.4, skip: (e, f, w, n) => fe.includes(e) && f === 0 && w === Math.floor(n / 2) });
  if (fe.length) { // door with a small stoop, a garage door on long fronts
    const e = fe.sort((p, q) => q.L - p.L)[0], du = e.L * (0.3 + 0.2 * r());
    door(ctx, e, du, b.b, pick(r, [0x6d4a33, 0x3e5f7a, 0xa8433a, 0x2f5f4a]));
    canopy(ctx, e, du, 2.0, b.b + 2.5, 1.0, C(P.r));
    if (e.L > 9.5 && b.a > 90) panel(ctx.g, e, e.L - 4.2, e.L - 1.2, b.b, b.b + 2.3, mix(P.w, 0x000000, 0.14), 0.07);
  }
  if (pitched && r() < 0.35 && W.rects[0]) { const R = W.rects[0]; unit(ctx.s, R.x + R.ux * R.hw * 0.4, R.z + R.uz * R.hw * 0.4, y1 + R.hd * 0.3, 0.8, 0.8, 1.7, mix(P.w, 0x8a5a3c, 0.5)); }
  o.solar(geo.R, y1, 'flat');
}
function flatTop(ctx, b, edges, y1, o, col, withUnits = true, ph = 0.55) {
  const wall = colOf(o.P.w);
  cap(ctx, b.r, y1, mix(0xb9b2a6, col.getHex(), 0.12));
  parapet(ctx, edges, y1, ph, wall, mix(wall.getHex(), 0xffffff, 0.25));
  if (withUnits && b.a > 70) {
    const r = rng(Math.round(b.r[0][0] * 7 + b.r[0][1] * 13) >>> 0), n = clamp(Math.round(b.a / 260), b.a > 140 ? 1 : 0, 4);
    for (const [x, z] of freeSpots(b.r, r, n, 1.6)) unit(ctx.s, x, z, y1, 1.6 + r() * 0.8, 1.1 + r() * 0.6, 0.9 + r() * 0.5, C(0xa7adb0), r() * 3);
  }
}
function roofColour(hex) { // overhead colours are washed out and shadowed; lift saturation a touch so it reads like the toon palette
  const c = new THREE.Color('#' + hex), hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, clamp(hsl.s * 1.25, 0, 0.7), clamp(hsl.l, 0.22, 0.62)); return c;
}

function drawStore(ctx, b, idx, L, o) { // single shop or small row: tall ground floor, glazing, sign band, awning, parapet
  const { geo, meta, r } = L, fh0 = o.h < 7 ? o.h : Math.min(4.4, o.h * 0.6), floors = o.h < 7 ? 1 : 1 + Math.max(1, Math.round((o.h - fh0) / 3.1)), y1 = b.b + o.h;
  const [sw, acc] = SHOP[meta && meta.p] || SHOP_DEFAULT[Math.floor(r() * SHOP_DEFAULT.length)];
  const wall = !o.overridden ? sw : o.P.w, { edges } = shell(ctx, b, L, o, { y1, wall });
  const fe = frontEdges(ctx, edges, 3.5);
  flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: wall } }, C(0xc9c3b8));
  for (const e of fe) {
    storefront(ctx, e, b.b, fh0, wall, acc);
    if (e.L > 5 && r() < 0.8) awning(ctx, e, 0.8, e.L - 0.8, b.b + 3.0, 0.5, 1.3, C(acc), C(0xf4f1ea));
  }
  const fhU = (o.h - fh0) / Math.max(1, floors - 1);
  if (floors > 1) windowsOn(ctx, edges, b.b + fh0, floors - 1, fhU, { ww: 1.3, wh: 1.4, bay: 3.4 });
  else windowsOn(ctx, edges.filter((e) => !fe.includes(e)), b.b, 1, o.h, { ww: 1.0, wh: 1.0, bay: 5, from: 0 });
  o.solar(geo.R, y1, 'flat');
}
function drawStrip(ctx, b, idx, L, o) { // long low retail: shopfront bays in different colours under one canopy
  const { geo, meta, r } = L, y1 = b.b + o.h, fh = Math.min(o.h, 4.6);
  const { edges } = shell(ctx, b, L, o, { y1, wall: o.P.w });
  const fe = frontEdges(ctx, edges, 6);
  flatTop(ctx, b, edges, y1, o, C(0xc9c3b8), true, 0.9);
  for (const e of fe) {
    const bays = Math.max(2, Math.round(e.L / 7)), step = e.L / bays;
    for (let i = 0; i < bays; i++) {
      const [sw, acc] = SHOP_DEFAULT[(i + Math.floor(r() * 3)) % SHOP_DEFAULT.length];
      const sub = { ...e, a: [e.a[0] + e.ux * step * i, e.a[1] + e.uz * step * i], c: [e.a[0] + e.ux * step * (i + 1), e.a[1] + e.uz * step * (i + 1)], L: step };
      panel(ctx.s, sub, 0.1, step - 0.1, b.b + 0.55, y1, C(sw), 0.03);
      storefront(ctx, sub, b.b, fh, sw, acc);
    }
    canopy(ctx, e, e.L / 2, e.L, b.b + 3.5, 2.2, C(0xd8d2c4));
    for (let u = 3; u < e.L - 1; u += 6) unit(ctx.s, e.a[0] + e.ux * u + e.nx * 2.0, e.a[1] + e.uz * u + e.nz * 2.0, b.b, 0.22, 0.22, 3.5, C(0x8d8780));
  }
  void meta;
  o.solar(geo.R, y1, 'flat');
}
function drawBigBox(ctx, b, idx, L, o) { // blank tall walls, a bold sign band, an entrance bump, rooftop plant
  const { geo, r } = L, y1 = b.b + Math.max(o.h, 7.5), [sw, acc] = SHOP_DEFAULT[Math.floor(r() * SHOP_DEFAULT.length)];
  const { edges } = shell(ctx, b, L, o, { y1, wall: sw });
  const fe = frontEdges(ctx, edges, 12);
  flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: sw } }, C(0xc9c3b8), true, 1.1);
  for (const e of edges) if (e.L > 8) panel(ctx.s, e, 0, e.L, y1 - 2.0, y1 - 0.4, mix(sw, acc, 0.18), 0.03); // painted band all round
  for (const e of fe) {
    const w = Math.min(e.L * 0.4, 16), u = e.L * (0.3 + 0.4 * r());
    panel(ctx.g, e, u - w / 2, u + w / 2, b.b + 0.2, b.b + 4.4, C(0x3b5866), 0.08);
    panel(ctx.g, e, u - w / 2 - 1, u + w / 2 + 1, b.b + 4.6, b.b + 6.8, C(acc), 0.1);
    canopy(ctx, e, u, w + 2, b.b + 4.5, 1.6, C(0xd8d2c4));
  }
  void geo;
  o.solar(geo.R, y1, 'flat');
}
function drawApt(ctx, b, idx, L, o) { // mid-rise: window grid, balcony slabs on the street side, stair tower
  const { geo, meta, r } = L, floors = clamp(meta && meta.f ? meta.f : Math.round(o.h / 3.1), 2, 12), fh = o.h / floors, y1 = b.b + o.h;
  const { edges } = shell(ctx, b, L, o, { y1 });
  const fe = frontEdges(ctx, edges, 5);
  flatTop(ctx, b, edges, y1, o, C(0xb9b2a6), true, 0.8);
  windowsOn(ctx, edges, b.b, floors, fh, { ww: 1.6, wh: 1.4, bay: 3.2, skip: (e, f, w, n) => fe.includes(e) && f === 0 && w === Math.floor(n / 2) });
  for (const e of fe) {
    const n = Math.max(1, Math.floor(e.L / 6));
    for (let f = 1; f < floors; f++) for (let i = 0; i < n; i++) {
      if ((i + f) % 2) continue;
      const u = (i + 0.5) * e.L / n; canopy(ctx, e, u, 2.6, b.b + f * fh, 1.1, C(0xe9e3d6));
      panel(ctx.g, e, u - 1.3, u + 1.3, b.b + f * fh + 0.05, b.b + f * fh + 1.0, mix(o.P.r, 0xffffff, 0.2), 0.06);
    }
    door(ctx, e, e.L / 2, b.b, 0x2b2420, 1.6, 2.4); canopy(ctx, e, e.L / 2, 3, b.b + 2.7, 1.4, C(o.P.r));
  }
  if (b.a > 160) { const [s] = freeSpots(b.r, r, 1, 2.5); if (s) unit(ctx.s, s[0], s[1], y1, 2.8, 2.8, 2.6, mix(o.P.w, 0x000000, 0.12), 0); }
  void meta;
  o.solar(geo.R, y1, 'flat');
}
function drawOffice(ctx, b, idx, L, o) { // banded glass, flat roof with plant, a canopy entrance
  const { geo, meta, r } = L, floors = clamp(meta && meta.f ? meta.f : Math.round(o.h / 3.6), 2, 14), fh = o.h / floors, y1 = b.b + o.h;
  const wall = pick(r, [0xdfe3e6, 0xd8d4cc, 0xcfd6dc]), { edges } = shell(ctx, b, L, o, { y1, wall });
  flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: wall } }, C(0xb9b2a6), true, 0.9);
  for (const e of edges) if (e.L > 3) for (let f = 0; f < floors; f++) panel(ctx.g, e, 0.6, e.L - 0.6, b.b + f * fh + fh * 0.28, b.b + f * fh + fh * 0.78, C(f === 0 ? 0x34586b : 0x3a5f72), 0.06);
  for (const e of frontEdges(ctx, edges, 5)) { door(ctx, e, e.L / 2, b.b, 0x2b2420, 2, 2.6); canopy(ctx, e, e.L / 2, 4, b.b + 2.9, 1.8, C(0x4f6470)); }
  o.solar(geo.R, y1, 'flat');
}
function drawSchool(ctx, b, idx, L, o) { // long low blocks with a repeating window rhythm and a covered entry
  const { geo, r } = L, floors = clamp(Math.round(o.h / 3.6), 1, 3), fh = o.h / floors, y1 = b.b + o.h, wall = pick(r, [0xe6dcc6, 0xdfd3cf, 0xe3e0d0]);
  const { edges } = shell(ctx, b, L, o, { y1, wall });
  flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: wall } }, C(0xb9b2a6), true, 0.6);
  windowsOn(ctx, edges, b.b, floors, fh, { ww: 1.8, wh: 1.5, bay: 3.0 });
  for (const e of frontEdges(ctx, edges, 8)) { door(ctx, e, e.L / 2, b.b, 0x3e5f7a, 2.2, 2.4); canopy(ctx, e, e.L / 2, 5, b.b + 3.2, 2.2, C(0xc4613b)); }
  o.solar(geo.R, y1, 'flat');
}
function drawCivic(ctx, b, idx, L, o) {
  const { geo, r } = L, y1 = b.b + o.h, wall = pick(r, [0xe9dfc9, 0xdcd5e6, 0xe0d8c4]);
  const { edges } = shell(ctx, b, L, o, { y1, wall });
  const pitched = b.a < 500 && L.meta && (L.meta.c === 'church' || L.meta.c === 'chapel');
  if (pitched) { const W = wings(b.r, geo.R, 1); if (W.rects[0]) oroof(ctx.s, W.rects[0], y1, 'gable', C(0x7a6a5e), C(wall)); } else flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: wall } }, C(0xb9b2a6), true, 0.7);
  windowsOn(ctx, edges, b.b, Math.max(1, Math.round(o.h / 4)), Math.min(4, o.h), { ww: 1.1, wh: 2.0, bay: 4 });
  for (const e of frontEdges(ctx, edges, 6)) { door(ctx, e, e.L / 2, b.b, 0x6d4a33, 1.8, 2.8); canopy(ctx, e, e.L / 2, 4, b.b + 3.2, 1.8, C(0xd8d2c4)); }
  o.solar(geo.R, y1, 'flat');
}
function drawShed(ctx, b, idx, L, o) { // warehouse or workshop: tall plain walls, roll-up doors, low roof
  const { geo, r } = L, y1 = b.b + Math.max(o.h, 5.5), wall = pick(r, [0xcfd3d4, 0xd9d2c3, 0xc7cfd6]);
  const { edges } = shell(ctx, b, L, o, { y1, wall });
  flatTop(ctx, b, edges, y1, { ...o, P: { ...o.P, w: wall } }, C(0xb0b4b6), true, 0.5);
  for (const e of frontEdges(ctx, edges, 8)) for (let u = 3; u < e.L - 2; u += 7) panel(ctx.g, e, u - 1.6, u + 1.6, b.b, b.b + 3.6, C(0x8d8f90), 0.08);
  o.solar(geo.R, y1, 'flat');
}
function drawOut(ctx, b, idx, L, o) { // garage, shed, carport: simple box with a lean-to roof and one door
  const { geo, r } = L, y1 = b.b + Math.min(o.h, 3.4), wall = pick(r, [0xe4dccb, 0xd8d2c4, 0xe0d4c0]);
  shell(ctx, b, L, o, { y1, wall, plinth: false });
  if (geo.R && b.a >= 12) oroof(ctx.s, geo.R, y1, 'shed', C(o.P.r), C(wall)); else cap(ctx, b.r, y1, C(o.P.r));
  const e = frontEdges(ctx, ringEdges(b.r), 2.2)[0]; if (e) panel(ctx.g, e, Math.max(0.3, e.L / 2 - 1.2), Math.min(e.L - 0.3, e.L / 2 + 1.2), b.b, b.b + 2.1, mix(wall, 0x000000, 0.22), 0.07);
}
const DRAW = { house: drawHouse, store: drawStore, strip: drawStrip, bigbox: drawBigBox, apt: drawApt, hotel: drawApt, office: drawOffice, school: drawSchool, civic: drawCivic, shed: drawShed, outbuilding: drawOut };

export { KINDS, SHOP, DRAW, classify, wings, drawBuilding, lookFor, metaOf, hasLooksData, setLooksData, packChecksum };
