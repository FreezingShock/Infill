import * as THREE from 'three';
import { Acc, C, FT, UP, area, clamp, decal, elev, fmt, inPoly, obb, obox, ofacade, oroof, pick, rcorners, ribbon, rng, segDist2, subR } from './core.js';
import { BLD, DREAM, PAL, fitRect, frameOf, liveBuildings, zfam, zrule } from './model.js';

// =====================================================================
// Programs -> geometry. A program is {t, st, rf, pl, sb, adu, trees, solar, fence, sd, dr}.
// =====================================================================
const COL = { pad: C(0xcfc7b8), asphalt: C(0x77716b), stripe: C(0xf5f2ea), dirt: C(0xc9b083), lawn: C(0x8fb26b), garden: C(0xb9a774), paving: C(0xd8c6a3),
  plaza: C(0xe2d3b2), sand: C(0xe8d5a0), soil: C(0x7a5b3e), wood: C(0xa8774d), court: C(0x5d8fb0), courtLine: C(0xf4f1ea), solar: C(0x2c3e66),
  hedge: C(0x5f8a4e), fence: C(0xf4f1ea), dark: C(0x3a3633), canopy: C(0x3b4f7a), post: C(0x8d8780), water: C(0x6fb3d6) };
const AWN = [0xc4613b, 0x3e9fdc, 0x4f8a4a, 0xd6ad57, 0x8a5a9e, 0x2b2420];

function makeCtx(lot, S, prog) {
  const rules = prog.dr ? DREAM : zrule(lot.z);
  const m = { std: 1, tight: 0.5, deep: 1.6 }[prog.sb || 'std'];
  const sb = { front: rules.front * m, side: Math.max(prog.dr ? 0.5 : 0.9, rules.side * (prog.sb === 'tight' ? 0.67 : 1)), rear: rules.rear * m };
  return { lot, S, prog, rules, sb, r: rng(prog.sd || 1), s: new Acc(), g: new Acc(), d: new Acc(), trees: [], cars: [], units: 0, floor: 0, cost: 0, park: 0, avoid: [], stalls: 0 };
}
function stories(ctx, tpl, def) {
  const want = ctx.prog.st ?? def ?? tpl.st[2];
  const max = ctx.prog.dr ? 8 : ctx.rules.st;
  return clamp(Math.round(want), tpl.st[0], Math.max(tpl.st[0], Math.min(tpl.st[1], max)));
}
function pad(ctx, R) {
  const cs = rcorners(R, 0.4), hs = cs.map(([x, z]) => elev(x, z)); hs.push(elev(R.x, R.z));
  const top = Math.max(...hs) + 0.15, low = Math.min(...hs) - 0.3;
  obox(ctx.s, { ...R, hw: R.hw + 0.4, hd: R.hd + 0.4 }, low, top - low, COL.pad, false);
  return top;
}
function solar(ctx, R, y, roof, pitch = 0.3) {
  if (roof === 'flat' || roof === 'garden') { obox(ctx.g, { ...R, hw: R.hw * 0.7, hd: R.hd * 0.55 }, y + 0.75, 0.12, COL.solar, false); return; }
  const along = R.hw >= R.hd, o = 0.45, hw = R.hw + o, hd = R.hd + o, short = along ? hd : hw, rise = short * pitch * 2;
  const P = (s, t) => { const yy = along ? y + rise * (1 - Math.abs(t) / hd) : y + rise * (1 - Math.abs(s) / hw); return [R.x + R.ux * s + R.vx * t, yy + 0.12, R.z + R.uz * s + R.vz * t]; };
  if (roof === 'shed') { ctx.g.quad(P(-hw * 0.7, -hd * 0.8), P(hw * 0.7, -hd * 0.8), P(hw * 0.7, -hd * 0.1), P(-hw * 0.7, -hd * 0.1), COL.solar, UP); return; }
  if (along) ctx.g.quad(P(-hw * 0.65, -hd * 0.85), P(hw * 0.65, -hd * 0.85), P(hw * 0.65, -hd * 0.2), P(-hw * 0.65, -hd * 0.2), COL.solar, UP);
  else ctx.g.quad(P(-hw * 0.85, -hd * 0.65), P(-hw * 0.2, -hd * 0.65), P(-hw * 0.2, hd * 0.65), P(-hw * 0.85, hd * 0.65), COL.solar, UP);
}
function mass(ctx, R, st, roof, pal, o = {}) {
  const top = o.y ?? pad(ctx, R), fh = o.fh || 3.1, P = PAL[pal] || PAL.sand;
  obox(ctx.s, R, top, st * fh, C(o.wall ?? P.w));
  ofacade(ctx.g, R, top, st, fh, o);
  oroof(ctx.s, R, top + st * fh, roof, C(o.roofCol ?? P.r), C(o.wall ?? P.w), o.pitch);
  if (ctx.prog.solar && !o.noSolar) solar(ctx, R, top + st * fh, roof, o.pitch);
  if (o.balc) balconies(ctx, R, top, st, fh, P);
  if (!o.noFloor) ctx.floor += R.hw * 2 * R.hd * 2 * st;
  ctx.avoid.push(rcorners(R));
  return top + st * fh;
}
function balconies(ctx, R, y0, st, fh, P) {
  const len = R.hw * 2, n = Math.max(1, Math.floor(len / 4.2));
  for (let f = 1; f < st; f++) for (let i = 0; i < n; i += 1) {
    if ((i + f) % 2) continue;
    const s = -R.hw + (i + 0.5) * len / n, cx = R.x + R.ux * s - R.vx * (R.hd + 0.6), cz = R.z + R.uz * s - R.vz * (R.hd + 0.6);
    const B = { x: cx, z: cz, ux: R.ux, uz: R.uz, vx: R.vx, vz: R.vz, hw: 1.2, hd: 0.6 };
    obox(ctx.s, B, y0 + f * fh - 0.1, 0.18, C(0xe9e3d6));
    obox(ctx.s, { ...B, x: cx - R.vx * 0.55, z: cz - R.vz * 0.55, hd: 0.05 }, y0 + f * fh + 0.08, 1, C(P.r), false);
  }
}
function tree(ctx, x, z, s = 1, kind = 0, y = null) { ctx.trees.push([x, y ?? elev(x, z), z, s, kind, Math.floor(ctx.r() * 5)]); }
function insideFree(ctx, x, z, margin) {
  if (!inPoly(x, z, ctx.lot.r)) return false;
  const r = ctx.lot.r; for (let i = 0; i < r.length; i++) { const a = r[i], b = r[(i + 1) % r.length]; if (segDist2(x, z, a[0], a[1], b[0], b[1]) < 1.2) return false; }
  for (const av of ctx.avoid) { if (inPoly(x, z, av)) return false; for (let i = 0; i < av.length; i++) { const a = av[i], b = av[(i + 1) % av.length]; if (segDist2(x, z, a[0], a[1], b[0], b[1]) < margin * margin) return false; } }
  return true;
}
function yardTrees(ctx, n, margin = 2.2, kinds = [0, 0, 1]) {
  const bb = ctx.lot.bb; let placed = 0;
  for (let k = 0; k < n * 14 && placed < n; k++) {
    const x = bb[0] + ctx.r() * (bb[2] - bb[0]), z = bb[1] + ctx.r() * (bb[3] - bb[1]);
    if (!insideFree(ctx, x, z, margin)) continue;
    if (ctx.trees.some((t) => (t[0] - x) ** 2 + (t[2] - z) ** 2 < 20)) continue;
    tree(ctx, x, z, 0.8 + ctx.r() * 0.6, pick(ctx.r, kinds)); placed++;
  }
  return placed;
}
function lotDecal(ctx, col, y = 0.32) { decal(ctx.d, ctx.lot.r, y, col); }
function driveway(ctx, fit, R) {
  if (!fit || fit.t0 < 2.5) return;
  const F = fit.F, s = fit.s0 + fit.w - 2;
  const ring = [F.P(s - 1.5, 0), F.P(s + 1.5, 0), F.P(s + 1.5, fit.t0), F.P(s - 1.5, fit.t0)];
  decal(ctx.d, ring, 0.36, COL.pad); void R;
}
function frontGarden(ctx, fit) {
  if (!fit || fit.t0 < 3) return;
  const F = fit.F, ring = [F.P(fit.s0, 0.6), F.P(fit.s0 + fit.w - 4, 0.6), F.P(fit.s0 + fit.w - 4, fit.t0 - 0.8), F.P(fit.s0, fit.t0 - 0.8)];
  const dry = ctx.r() < 0.45; decal(ctx.d, ring, 0.34, dry ? COL.garden : COL.lawn);
}
function fenceAround(ctx, kind) {
  const r = ctx.lot.r, fd = ctx.lot.fd;
  for (let i = 0; i < r.length; i++) {
    const a = r[i], b = r[(i + 1) % r.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 1.5) continue;
    let nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L; const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
    if (inPoly(mx + nx * 0.2, mz + nz * 0.2, r)) { nx = -nx; nz = -nz; }
    if (nx * fd[0] + nz * fd[1] > 0.55) continue; // street side stays open
    const ux = (b[0] - a[0]) / L, uz = (b[1] - a[1]) / L, w = kind === 'hedge' ? 0.45 : 0.05;
    const R = { x: mx - nx * (w + 0.1), z: mz - nz * (w + 0.1), ux, uz, vx: nx, vz: nz, hw: L / 2 - 0.3, hd: w };
    const y = Math.min(elev(a[0], a[1]), elev(b[0], b[1]));
    obox(ctx.s, R, y, (kind === 'hedge' ? 1.2 : 1.5) + Math.abs(elev(a[0], a[1]) - elev(b[0], b[1])) / 2, kind === 'hedge' ? COL.hedge : COL.fence, kind !== 'hedge');
  }
}
function stallsIn(ctx, ring, occ = 0.6, canopy = false) {
  const R = obb(ring); if (!R || R.hw < 3 || R.hd < 3) return 0;
  let n = 0;
  const P = (s, t) => [R.x + R.ux * s + R.vx * t, R.z + R.uz * s + R.vz * t];
  for (let t0 = -R.hd + 1; t0 + 5.5 <= R.hd; t0 += 17) {
    for (const [ta, dir] of [[t0, 1], [t0 + 11.5, -1]]) {
      if (ta + 5.5 > R.hd) continue;
      let rowN = 0;
      for (let s = -R.hw + 1.4; s + 1.35 <= R.hw; s += 2.7) {
        const c = P(s, ta + 2.75), c1 = P(s - 1.3, ta + 0.2), c2 = P(s + 1.3, ta + 5.3);
        if (!inPoly(c[0], c[1], ring) || !inPoly(c1[0], c1[1], ring) || !inPoly(c2[0], c2[1], ring)) continue;
        const a = P(s - 1.35, ta), b = P(s - 1.35, ta + 5.3);
        ribbon(ctx.d, [a, b], -0.06, 0.06, 0.46, COL.stripe, 6);
        if (ctx.r() < occ) ctx.cars.push([c[0], elev(c[0], c[1]) + 0.35, c[1], Math.atan2(R.vx * dir, R.vz * dir), Math.floor(ctx.r() * 6)]);
        n++; rowN++;
      }
      if (canopy && rowN > 2) {
        const C0 = { x: 0, z: 0, ux: R.ux, uz: R.uz, vx: R.vx, vz: R.vz, hw: R.hw - 2, hd: 2.6 }, cc = P(0, ta + 2.75);
        C0.x = cc[0]; C0.z = cc[1];
        const y = elev(cc[0], cc[1]);
        for (let s = -R.hw + 4; s < R.hw - 3; s += 9) { const pp = P(s, ta + 2.75); obox(ctx.s, { ...C0, x: pp[0], z: pp[1], hw: 0.15, hd: 0.15 }, y, 3.2, COL.post, false); }
        obox(ctx.g, C0, y + 3.2, 0.2, COL.canopy);
      }
    }
  }
  ctx.stalls += n; return n;
}
function benches(ctx, n) { const bb = ctx.lot.bb; for (let k = 0, m = 0; k < n * 10 && m < n; k++) { const x = bb[0] + ctx.r() * (bb[2] - bb[0]), z = bb[1] + ctx.r() * (bb[3] - bb[1]); if (!insideFree(ctx, x, z, 1)) continue; const a = ctx.r() * Math.PI; obox(ctx.s, { x, z, ux: Math.cos(a), uz: Math.sin(a), vx: -Math.sin(a), vz: Math.cos(a), hw: 0.9, hd: 0.3 }, elev(x, z), 0.5, COL.wood); m++; } }

// ---------- as-built ----------
function genAsBuilt(ctx) {
  const { lot, S, prog } = ctx, blds = liveBuildings(lot, S), P = PAL[prog.pl] || PAL.sand;
  const k = lot.st0 && prog.st && prog.st !== lot.st0 ? prog.st / lot.st0 : 1;
  for (const i of blds) {
    const b = BLD[i]; const h = b.h * k; let r = b.r; const n = r.length, y0 = b.b - 1, y1 = b.b + h;
    const res = b.t === 'residential' || b.t === 'unknown' || b.t === 'outbuilding';
    const wall = C(res ? P.w : ({ commercial: 0xe1e4e6, education: 0xdcd5e6, civic: 0xdcd5e6 }[b.t] || P.w));
    const cx = b.r.reduce((s, p) => s + p[0], 0) / n, cz = b.r.reduce((s, p) => s + p[1], 0) / n;
    const floors = Math.max(1, Math.round(h / 3.2)), fh = h / floors;
    for (let e = 0; e < n; e++) {
      const a = r[e], c = r[(e + 1) % n], L = Math.hypot(c[0] - a[0], c[1] - a[1]) || 1;
      let nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
      if (inPoly(mx + nx * 0.15, mz + nz * 0.15, r)) { nx = -nx; nz = -nz; }
      ctx.s.quad([a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], y1, c[1]], [a[0], y1, a[1]], wall, [nx, 0, nz]);
      ctx.s.line([a[0], y1, a[1]], [c[0], y1, c[1]]); ctx.s.line([a[0], b.b, a[1]], [a[0], y1, a[1]]);
      if (L > 3) { // windows
        const nw = Math.max(1, Math.floor(L / 3.6)), ux = (c[0] - a[0]) / L, uz = (c[1] - a[1]) / L, gcol = C(0x2f4753);
        for (let f = 0; f < floors && f < 12; f++) for (let w = 0; w < nw; w++) {
          const u = (w + 0.5) * L / nw, ww = Math.min(1.5, L / nw * 0.45), yy = b.b + f * fh + fh * 0.33, wh = Math.min(1.4, fh * 0.42);
          const px = a[0] + ux * u + nx * 0.07, pz = a[1] + uz * u + nz * 0.07;
          ctx.g.quad([px - ux * ww / 2, yy, pz - uz * ww / 2], [px + ux * ww / 2, yy, pz + uz * ww / 2], [px + ux * ww / 2, yy + wh, pz + uz * ww / 2], [px - ux * ww / 2, yy + wh, pz - uz * ww / 2], gcol, [nx, 0, nz]);
        }
      }
    }
    const R = obb(r), rect = R ? b.a / (4 * R.hw * R.hd) : 0;
    const roof = !res || b.a > 900 ? 'flat' : prog.rf;
    if (roof !== 'flat' && roof !== 'garden' && R && rect > 0.72) { oroof(ctx.s, R, y1, roof, C(P.r), wall); if (prog.solar) solar(ctx, R, y1, roof); }
    else {
      const top = roof === 'garden' ? C(0x8fae6c) : roof === 'flat' ? C(res ? P.r : 0xc9c3b8) : C(P.r);
      const lift = roof === 'flat' || roof === 'garden' ? 0 : 1.3, sh = lift ? 0.55 : 1;
      const rr = r.map((p) => [cx + (p[0] - cx) * sh, cz + (p[1] - cz) * sh]);
      if (lift) for (let e = 0; e < n; e++) { const a = r[e], c = r[(e + 1) % n], a2 = rr[e], c2 = rr[(e + 1) % n]; ctx.s.quad([a[0], y1, a[1]], [c[0], y1, c[1]], [c2[0], y1 + lift, c2[1]], [a2[0], y1 + lift, a2[1]], top, [(a[0] + c[0]) / 2 - cx, 1, (a[1] + c[1]) / 2 - cz]); ctx.s.line([a[0], y1, a[1]], [a2[0], y1 + lift, a2[1]]); }
      try { for (const t of THREE.ShapeUtils.triangulateShape(rr.map((p) => new THREE.Vector2(p[0], p[1])), [])) ctx.s.tri([rr[t[0]][0], y1 + lift, rr[t[0]][1]], [rr[t[1]][0], y1 + lift, rr[t[1]][1]], [rr[t[2]][0], y1 + lift, rr[t[2]][1]], top, UP); } catch (e) { /* odd footprint: walls only */ }
      if (prog.solar && R) solar(ctx, { ...R, x: cx, z: cz }, y1, 'flat');
    }
    ctx.avoid.push(r);
    ctx.floor += b.a * floors;
  }
  // paving from the data, striped where it is a real lot
  for (const ring of lot.pk) { decal(ctx.d, ring, 0.3, COL.asphalt); ctx.park += Math.abs(area(ring)); if (lot.lt === 'parking' || Math.abs(area(ring)) > 400) stallsIn(ctx, ring, 0.55); }
  if (lot.lt === 'parking' && !lot.pk.length) { decal(ctx.d, lot.r, 0.3, COL.asphalt); ctx.park += lot.m2; stallsIn(ctx, lot.r, 0.55); }
  if (!blds.length && !lot.sh.length && !lot.pk.length && lot.lt !== 'parking' && lot.lt !== 'civic') { decal(ctx.d, lot.r, 0.28, COL.dirt); yardTrees(ctx, Math.min(3, Math.round(lot.m2 / 300)), 1, [3]); }
  // yard trees by rule (no tree inventory in this pack yet)
  if (['house', 'multi', 'apts', 'civic'].includes(lot.lt)) yardTrees(ctx, clamp(Math.round(lot.m2 / (lot.lt === 'house' ? 300 : 420)), 0, 5));
  if (prog.trees) yardTrees(ctx, 4, 1.6);
  ctx.units = lot.lt === 'apts' || lot.lt === 'multi' ? Math.round(lot.u0 * k) : lot.u0;
  if (prog.adu) { const f = fitRect(lot, 7, 6, { front: ctx.sb.front + 6, side: 1.2, rear: 1.2 }, { pref: 'rear', avoid: ctx.avoid, minScale: 0.75, gap: 2.5 }); if (f) { mass(ctx, f.R, 1, 'shed', 'sage', { noFloor: true }); ctx.units += 1; ctx.cost += 260000; } else ctx.warn = 'No room for an ADU behind the existing house'; }
  if (prog.fence && prog.fence !== 'none') fenceAround(ctx, prog.fence);
  return true;
}

// ---------- template shelf ----------
const TPL = {};
const tpl = (id, o) => { TPL[id] = { id, st: [1, 2, 1], minFront: 0, minArea: 0, ...o }; };
const icon = (body) => `<svg viewBox="0 0 44 30" aria-hidden="true">${body}</svg>`;
const ICO = {
  house: (w, r) => icon(`<path d="M8 27V15h28v12z" fill="${w}" stroke="currentColor" stroke-width="2"/><path d="M5 15L22 6l17 9z" fill="${r}" stroke="currentColor" stroke-width="2"/>`),
  block: (w, h) => icon(`<path d="M8 27V${27 - h}h28v${h}z" fill="${w}" stroke="currentColor" stroke-width="2"/>${Array.from({ length: Math.floor(h / 6) }, (_, i) => `<path d="M12 ${23 - i * 6}h4M20 ${23 - i * 6}h4M28 ${23 - i * 6}h4" stroke="currentColor" stroke-width="2"/>`).join('')}`),
  park: (c) => icon(`<path d="M3 27h38" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="15" r="7" fill="${c}" stroke="currentColor" stroke-width="2"/><circle cx="30" cy="17" r="5" fill="${c}" stroke="currentColor" stroke-width="2"/><path d="M14 22v5M30 22v5" stroke="currentColor" stroke-width="2"/>`),
  flat: (c) => icon(`<path d="M4 25h36" stroke="currentColor" stroke-width="2"/><path d="M6 25l6-8h20l6 8z" fill="${c}" stroke="currentColor" stroke-width="2"/>`),
};
function mainFit(ctx, w, d, o = {}) { const lot = ctx.lot; return fitRect(lot, Math.min(w, lot.wd), Math.min(d, lot.dp), o.sb || ctx.sb, { minScale: o.min ?? 0.6, keepDepth: o.keepDepth, pref: o.pref }); }
const roofOf = (ctx, def) => ctx.prog.rf || def;
const palOf = (ctx, list) => ctx.prog.pl || pick(ctx.r, list);

tpl('sfr.refresh', { cat: 'house', name: 'Refreshed house', blurb: 'The same house, rebuilt: fresh walls, roof and garden', icon: ICO.house('#f1e2c4', '#bb5836'), st: [1, 2, 1], need: [11, 10, 0.5],
  build(ctx) {
    const f = mainFit(ctx, 15, 13, { min: 0.5 }); if (!f) return false;
    const st = stories(ctx, this, ctx.r() < 0.55 ? 1 : 2), roof = roofOf(ctx, pick(ctx.r, ['hip', 'gable'])), pal = palOf(ctx, ['terracotta', 'sand', 'white', 'sage', 'cream']);
    if (f.w > 11) { mass(ctx, subR(f.R, 0, 0, f.w - 5.5, f.d), st, roof, pal); mass(ctx, subR(f.R, f.w - 5.5, 0, 5.5, Math.min(6.5, f.d)), 1, roof === 'gable' ? 'gable' : 'hip', pal, { noDoor: true, noFloor: true }); }
    else mass(ctx, f.R, st, roof, pal);
    driveway(ctx, f); frontGarden(ctx, f); ctx.units = 1; return true;
  } });
tpl('sfr.adu', { cat: 'house', name: 'House + ADU', blurb: 'Main house plus a backyard unit (state ADU rules)', icon: icon('<path d="M4 27V15h22v12z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/><path d="M2 15L15 7l13 8z" fill="#8a6a52" stroke="currentColor" stroke-width="2"/><path d="M30 27v-9h11v9z" fill="#dfe3cf" stroke="currentColor" stroke-width="2"/><path d="M29 18l13-2" stroke="currentColor" stroke-width="2.5"/>'), st: [1, 2, 1], minArea: 380, need: [10, 10, 0.55],
  build(ctx) {
    const f = mainFit(ctx, 13, 11, { min: 0.55 }); if (!f) return false;
    const st = stories(ctx, this, 1), pal = palOf(ctx, ['cream', 'sand', 'white']);
    mass(ctx, f.R, st, roofOf(ctx, 'hip'), pal);
    const a = fitRect(ctx.lot, 7, 6, { front: ctx.sb.front + 4, side: 1.2, rear: 1.2 }, { pref: 'rear', avoid: ctx.avoid, minScale: 0.75, gap: 2.5 });
    if (!a) { ctx.reason = 'No room for a backyard ADU'; return false; }
    mass(ctx, a.R, 1, 'shed', 'sage'); driveway(ctx, f); yardTrees(ctx, 1); ctx.units = 2; return true;
  } });
tpl('sb9.duplex', { cat: 'house', name: 'SB 9 duplex', blurb: 'Two side-by-side homes on one lot', icon: icon('<path d="M4 27V14h36v13z" fill="#dce8ee" stroke="currentColor" stroke-width="2"/><path d="M2 14l10-7 10 7 10-7 10 7" fill="#4f6470" stroke="currentColor" stroke-width="2"/><path d="M22 14v13" stroke="currentColor" stroke-width="2"/>'), st: [1, 2, 2], minFront: 15, need: [14, 11, 0.7],
  build(ctx) {
    const f = mainFit(ctx, 16, 12, { min: 0.7 }); if (!f) return false;
    const st = stories(ctx, this, 2), pal = palOf(ctx, ['sky', 'white', 'butter', 'mint']), roof = roofOf(ctx, 'gable');
    mass(ctx, subR(f.R, 0, 0, f.w / 2 - 0.1, f.d), st, roof, pal); mass(ctx, subR(f.R, f.w / 2 + 0.1, 0, f.w / 2 - 0.1, f.d), st, roof, pal);
    driveway(ctx, f); ctx.units = 2; return true;
  } });
tpl('cottage.pair', { cat: 'house', name: 'Cottage pair', blurb: 'Two small cottages, front and back', icon: icon('<path d="M3 27V17h15v10z" fill="#f2dfa2" stroke="currentColor" stroke-width="2"/><path d="M1 17l9-7 9 7z" fill="#7a6a4a" stroke="currentColor" stroke-width="2"/><path d="M25 27V15h16v12z" fill="#d2e6d6" stroke="currentColor" stroke-width="2"/><path d="M23 15l10-7 10 7z" fill="#5b7f73" stroke="currentColor" stroke-width="2"/>'), st: [1, 2, 1], minArea: 420, need: [8, 8, 0.75],
  build(ctx) {
    const a = mainFit(ctx, 9, 8, { min: 0.75 }); if (!a) return false;
    const pal = palOf(ctx, ['butter', 'mint', 'cream']), st = stories(ctx, this, 1);
    mass(ctx, a.R, st, roofOf(ctx, 'gable'), pal);
    const b = fitRect(ctx.lot, 9, 8, ctx.sb, { pref: 'rear', avoid: ctx.avoid, minScale: 0.75, gap: 3 });
    if (!b) { ctx.reason = 'Not deep enough for a second cottage'; return false; }
    mass(ctx, b.R, st, roofOf(ctx, 'gable'), ctx.prog.pl || (pal === 'mint' ? 'butter' : 'mint'));
    frontGarden(ctx, a); yardTrees(ctx, 2); ctx.units = 2; return true;
  } });
tpl('garden.house', { cat: 'house', name: 'Garden house', blurb: 'Single-storey L around a private garden', icon: icon('<path d="M4 27V12h14v8h22v7z" fill="#dfe3cf" stroke="currentColor" stroke-width="2"/><circle cx="31" cy="12" r="6" fill="#8ea67a" stroke="currentColor" stroke-width="2"/>'), st: [1, 1, 1], minArea: 400, need: [13, 12, 0.65],
  build(ctx) {
    const f = mainFit(ctx, 16, 15, { min: 0.65 }); if (!f) return false;
    const pal = palOf(ctx, ['sage', 'cream', 'white']), roof = roofOf(ctx, 'gable');
    mass(ctx, subR(f.R, 0, 0, f.w, f.d * 0.45), 1, roof, pal); mass(ctx, subR(f.R, 0, f.d * 0.45, f.w * 0.42, f.d * 0.55), 1, roof, pal, { noDoor: true });
    const F = f.F; decal(ctx.d, [F.P(f.s0 + f.w * 0.45, f.t0 + f.d * 0.5), F.P(f.s0 + f.w, f.t0 + f.d * 0.5), F.P(f.s0 + f.w, f.t0 + f.d), F.P(f.s0 + f.w * 0.45, f.t0 + f.d)], 0.34, COL.lawn);
    const g = F.P(f.s0 + f.w * 0.72, f.t0 + f.d * 0.75); tree(ctx, g[0], g[1], 1.2);
    driveway(ctx, f); ctx.units = 1; return true;
  } });
tpl('mf.court4', { cat: 'multi', name: 'Courtyard fourplex', blurb: 'Four homes in a U around a shared court', icon: icon('<path d="M4 27V9h10v12h16V9h10v18z" fill="#f1e2c4" stroke="currentColor" stroke-width="2"/><circle cx="22" cy="17" r="3.5" fill="#8ea67a" stroke="currentColor" stroke-width="1.5"/>'), st: [2, 2, 2], minFront: 15, minArea: 500, need: [15, 16, 0.7],
  build(ctx) {
    const f = mainFit(ctx, 19, 20, { min: 0.7 }); if (!f) return false;
    const pal = palOf(ctx, ['terracotta', 'sand', 'cream']), roof = roofOf(ctx, 'hip'), wg = Math.min(7, f.w * 0.36), st = stories(ctx, this, 2);
    mass(ctx, subR(f.R, 0, 0, wg, f.d), st, roof, pal); mass(ctx, subR(f.R, f.w - wg, 0, wg, f.d), st, roof, pal);
    mass(ctx, subR(f.R, wg, f.d - wg, f.w - 2 * wg, wg), st, roof, pal, { noDoor: true });
    const c = f.F.P(f.s0 + f.w / 2, f.t0 + (f.d - wg) / 2); tree(ctx, c[0], c[1], 1.1);
    decal(ctx.d, [f.F.P(f.s0 + wg, f.t0), f.F.P(f.s0 + f.w - wg, f.t0), f.F.P(f.s0 + f.w - wg, f.t0 + f.d - wg), f.F.P(f.s0 + wg, f.t0 + f.d - wg)], 0.34, COL.paving);
    ctx.units = 4; return true;
  } });
tpl('mf.stacked', { cat: 'multi', name: 'Stacked flats', blurb: 'One flat per floor per side, balconies to the street', icon: ICO.block('#dce8ee', 18), st: [2, 4, 3], minArea: 300, need: [11, 12, 0.6],
  build(ctx) {
    const f = mainFit(ctx, 14, 16, { min: 0.6 }); if (!f) return false;
    const st = stories(ctx, this, 3); mass(ctx, f.R, st, roofOf(ctx, 'flat'), palOf(ctx, ['sky', 'white', 'mint', 'butter']), { balc: true });
    yardTrees(ctx, 2); ctx.units = st * 2; return true;
  } });
tpl('mf.townrow', { cat: 'multi', name: 'Townhouse row', blurb: 'A row of narrow three-storey homes', icon: icon('<path d="M3 27V12h10v15zM13 27V12h10v15zM23 27V12h10v15zM33 27V12h8v15z" fill="#c98a6b" stroke="currentColor" stroke-width="2"/><path d="M3 12l5-5 5 5 5-5 5 5 5-5 5 5 4-4 4 4" fill="none" stroke="currentColor" stroke-width="2"/>'), st: [2, 3, 3], minFront: 17, need: [16, 10, 0.6],
  build(ctx) {
    const f = mainFit(ctx, 40, 11, { min: 0.45, keepDepth: true }); if (!f || f.w < 11) return false;
    const n = Math.max(2, Math.floor(f.w / 5.5)), uw = f.w / n, st = stories(ctx, this, 3), pals = ['brick', 'cream', 'sky', 'butter', 'white'];
    for (let i = 0; i < n; i++) mass(ctx, subR(f.R, i * uw + 0.05, 0, uw - 0.1, f.d), st, roofOf(ctx, 'gable'), ctx.prog.pl || pals[(i + ctx.lot.sd) % pals.length], { bay: 2.4 });
    ctx.units = n; return true;
  } });
tpl('apt.court', { cat: 'apts', name: 'Courtyard apartments', blurb: 'LA-style U of flats around a garden court', icon: icon('<path d="M3 27V6h12v12h14V6h12v21z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/><path d="M7 11h4M7 16h4M7 21h4M33 11h4M33 16h4M33 21h4" stroke="currentColor" stroke-width="2"/>'), st: [2, 4, 3], minArea: 850, need: [24, 22, 0.6],
  build(ctx) {
    const f = mainFit(ctx, 48, 40, { min: 0.55 }); if (!f || f.w < 22) return false;
    const st = stories(ctx, this, 4), pal = palOf(ctx, ['cream', 'white', 'terracotta']), wg = Math.min(12, f.w / 3);
    mass(ctx, subR(f.R, 0, 0, wg, f.d), st, 'flat', pal); mass(ctx, subR(f.R, f.w - wg, 0, wg, f.d), st, 'flat', pal);
    mass(ctx, subR(f.R, wg, f.d - wg, f.w - 2 * wg, wg), st, 'flat', pal, { noDoor: true });
    decal(ctx.d, [f.F.P(f.s0 + wg, f.t0), f.F.P(f.s0 + f.w - wg, f.t0), f.F.P(f.s0 + f.w - wg, f.t0 + f.d - wg), f.F.P(f.s0 + wg, f.t0 + f.d - wg)], 0.34, COL.lawn);
    for (let k = 0; k < 3; k++) { const c = f.F.P(f.s0 + wg + (f.w - 2 * wg) * (0.25 + 0.25 * k), f.t0 + (f.d - wg) * (0.35 + 0.2 * (k % 2))); tree(ctx, c[0], c[1], 1.1, k === 1 ? 2 : 0); }
    ctx.units = Math.round(ctx.floor / 85); return true;
  } });
tpl('apt.mid', { cat: 'apts', name: 'Mid-rise + roof garden', blurb: 'Five to six storeys with a planted roof', icon: icon('<path d="M8 27V7h28v20z" fill="#dce8ee" stroke="currentColor" stroke-width="2"/><path d="M6 7h32" stroke="#4f8a4a" stroke-width="3"/><path d="M12 12h4M20 12h4M28 12h4M12 18h4M20 18h4M28 18h4" stroke="currentColor" stroke-width="2"/>'), st: [4, 6, 5], minArea: 900, need: [24, 18, 0.55],
  build(ctx) {
    const f = mainFit(ctx, 44, 28, { min: 0.55 }); if (!f) return false;
    const st = stories(ctx, this, 6), top = mass(ctx, f.R, st, 'garden', palOf(ctx, ['sky', 'white', 'sand']), { balc: true });
    for (let k = 0; k < 3; k++) { const c = f.F.P(f.s0 + f.w * (0.25 + 0.25 * k), f.t0 + f.d * 0.5); tree(ctx, c[0], c[1], 0.7, 0, top + 0.7); }
    yardTrees(ctx, 2); ctx.units = Math.round(ctx.floor / 85); return true;
  } });
tpl('ms.shop', { cat: 'main', name: 'Shopfronts', blurb: 'Shops built up to the sidewalk, awnings over the walk', icon: icon('<path d="M3 27V11h38v16z" fill="#f2dfa2" stroke="currentColor" stroke-width="2"/><path d="M3 15h38" stroke="#c4613b" stroke-width="4"/><path d="M7 19h8v8M19 19h8v8M31 19h7v8" fill="#3b5866" stroke="currentColor" stroke-width="1.5"/>'), st: [1, 2, 2], minFront: 8, need: [8, 10, 0.4],
  build(ctx) {
    const f = mainFit(ctx, 64, 16, { min: 0.3, keepDepth: true, sb: { front: 0, side: 0, rear: 2 } }); if (!f || f.w < 6) return false;
    const n = Math.max(1, Math.round(f.w / 8)), bw = f.w / n, st = stories(ctx, this, 2), pals = ['butter', 'white', 'brick', 'mint', 'cream', 'sky'];
    for (let i = 0; i < n; i++) {
      const R = subR(f.R, i * bw, 0, bw, f.d), y = mass(ctx, R, st, 'flat', ctx.prog.pl || pals[(i + ctx.lot.sd) % pals.length], { shop: true, wide: true });
      const A = { ...R, x: R.x - R.vx * (R.hd + 0.8), z: R.z - R.vz * (R.hd + 0.8), hw: R.hw * 0.85, hd: 0.8 }; obox(ctx.s, A, y - st * 3.1 + 2.9, 0.25, C(AWN[(i + ctx.lot.sd) % AWN.length]));
    }
    if (st > 1) ctx.units = n;
    alongStreet(ctx, f, 2); return true;
  } });
tpl('ms.mixed', { cat: 'main', name: 'Mixed-use 3–5', blurb: 'Shops below, three to five floors of homes above', icon: ICO.block('#f1e2c4', 20), st: [3, 5, 4], minFront: 12, minArea: 450, need: [12, 14, 0.4],
  build(ctx) {
    const f = mainFit(ctx, 54, 20, { min: 0.35, sb: { front: 0, side: 0, rear: 3 } }); if (!f || f.w < 10) return false;
    const st = stories(ctx, this, 4), pal = palOf(ctx, ['cream', 'sand', 'white', 'brick']);
    const base = pad(ctx, f.R);
    mass(ctx, f.R, st - 1, 'flat', pal, { y: base, shop: true, wide: true, balc: true });
    const top = subR(f.R, 0, 2, f.w, f.d - 2); mass(ctx, top, 1, 'flat', pal, { y: base + (st - 1) * 3.1, noDoor: true });
    ctx.units = Math.round((ctx.floor - f.w * f.d) / 85); alongStreet(ctx, f, 2); return true;
  } });
tpl('ms.market', { cat: 'main', name: 'Market hall', blurb: 'A tall gabled hall with stalls and a plaza', icon: icon('<path d="M4 27V15h36v12z" fill="#ead7b5" stroke="currentColor" stroke-width="2"/><path d="M2 15L22 3l20 12z" fill="#9a5a3c" stroke="currentColor" stroke-width="2"/><path d="M10 27v-7h24v7" fill="#3b5866" stroke="currentColor" stroke-width="1.5"/>'), st: [1, 1, 1], minArea: 700, need: [22, 16, 0.6],
  build(ctx) {
    lotDecal(ctx, COL.plaza);
    const f = mainFit(ctx, 34, 20, { min: 0.6, sb: { front: 4, side: 2, rear: 2 } }); if (!f) return false;
    mass(ctx, f.R, 1, 'gable', 'sand', { fh: 7.5, shop: true, wide: true, pitch: 0.42 });
    yardTrees(ctx, 4, 2); benches(ctx, 4); ctx.units = 0; return true;
  } });
tpl('pk.solar', { cat: 'parking', name: 'Shaded parking + solar', blurb: 'Keep the stalls, add trees and a solar canopy', icon: icon('<path d="M4 25h36" stroke="currentColor" stroke-width="2"/><path d="M6 12h32l-3 4H9z" fill="#3b4f7a" stroke="currentColor" stroke-width="2"/><path d="M12 16v9M32 16v9" stroke="currentColor" stroke-width="2"/>'), st: [1, 1, 1], anyType: ['parking', 'main', 'civic'],
  build(ctx) {
    lotDecal(ctx, COL.asphalt, 0.3); const n = stallsIn(ctx, ctx.lot.r, 0.6, true); if (n < 4) { ctx.reason = 'Too small or odd-shaped for stall rows'; return false; }
    ctx.park += ctx.lot.m2; yardTrees(ctx, Math.max(2, Math.round(ctx.lot.m2 / 400)), 1.5); return true;
  } });
tpl('pk.plaza', { cat: 'parking', name: 'Plaza', blurb: 'Paved square with a grid of shade trees', icon: ICO.flat('#e2d3b2'), st: [1, 1, 1], anyZone: true,
  build(ctx) {
    lotDecal(ctx, COL.plaza); const F = frameOf(ctx.lot);
    for (let s = F.smin + 4; s < F.smax - 3; s += 9) for (let t = 4; t < F.tmax - 3; t += 9) { const p = F.P(s, t); if (insideFree(ctx, p[0], p[1], 1)) tree(ctx, p[0], p[1], 1, 0); }
    const c = ctx.lot.c; obox(ctx.s, { x: c[0], z: c[1], ux: 1, uz: 0, vx: 0, vz: 1, hw: 2.2, hd: 2.2 }, elev(c[0], c[1]), 0.6, COL.pad); obox(ctx.s, { x: c[0], z: c[1], ux: 1, uz: 0, vx: 0, vz: 1, hw: 1.8, hd: 1.8 }, elev(c[0], c[1]) + 0.1, 0.55, COL.water, false);
    benches(ctx, Math.max(3, Math.round(ctx.lot.m2 / 250))); return true;
  } });
tpl('pk.park', { cat: 'parking', name: 'Pocket park', blurb: 'Lawn, a path and lots of trees', icon: ICO.park('#8ea67a'), st: [1, 1, 1], anyZone: true,
  build(ctx) {
    lotDecal(ctx, COL.lawn); const F = frameOf(ctx.lot);
    ribbon(ctx.d, [F.P(F.smin + 1, 0.5), F.P((F.smin + F.smax) / 2, F.tmax / 2), F.P(F.smax - 1, F.tmax - 0.5)], -1, 1, 0.4, COL.paving, 2);
    yardTrees(ctx, Math.max(2, Math.round(ctx.lot.m2 / 90)), 1.3, [0, 0, 1, 2]); benches(ctx, 3); return true;
  } });
tpl('pk.apts', { cat: 'parking', name: 'Apartments, tuck-under parking', blurb: 'Homes over a ground floor of parking', icon: icon('<path d="M6 27V7h32v20z" fill="#f4eadb" stroke="currentColor" stroke-width="2"/><path d="M6 21h32" stroke="currentColor" stroke-width="2"/><path d="M10 27v-4h8v4M24 27v-4h8v4" fill="#2b2420"/>'), st: [3, 5, 4], minArea: 650, need: [20, 16, 0.5],
  build(ctx) {
    const f = mainFit(ctx, 42, 26, { min: 0.5 }); if (!f) return false;
    const st = stories(ctx, this, 4); mass(ctx, f.R, st, 'flat', palOf(ctx, ['cream', 'white', 'sky']), { podium: true, balc: true });
    ctx.units = Math.round(ctx.floor * (st - 1) / st / 85); ctx.stalls += Math.round(f.w * f.d / 28); yardTrees(ctx, 2); return true;
  } });
tpl('cv.play', { cat: 'civic', name: 'Playground', blurb: 'Play structures, sand and shade', icon: icon('<path d="M3 27h38" stroke="currentColor" stroke-width="2"/><path d="M8 27V12h10v15" fill="#d6ad57" stroke="currentColor" stroke-width="2"/><path d="M18 14l14 13" stroke="#c4613b" stroke-width="3"/><circle cx="35" cy="13" r="5" fill="#8ea67a" stroke="currentColor" stroke-width="2"/>'), st: [1, 1, 1], anyZone: true,
  build(ctx) {
    lotDecal(ctx, COL.lawn); const f = fitRect(ctx.lot, 14, 10, { front: 2, side: 2, rear: 2 }, { minScale: 0.5 });
    if (f) { decal(ctx.d, rcorners(f.R), 0.36, COL.sand); const cols = [0xd6ad57, 0xc4613b, 0x3e9fdc, 0x4f8a4a]; for (let k = 0; k < 3; k++) { const R = subR(f.R, f.w * (0.1 + 0.3 * k), f.d * 0.3, f.w * 0.2, f.d * 0.35); obox(ctx.s, R, elev(R.x, R.z), 1.6 + k * 0.8, C(cols[(k + ctx.lot.sd) % 4])); } }
    yardTrees(ctx, Math.max(2, Math.round(ctx.lot.m2 / 160)), 1.6); benches(ctx, 2); return true;
  } });
tpl('cv.garden', { cat: 'civic', name: 'Community garden', blurb: 'Raised beds, a tool shed and fruit trees', icon: icon('<path d="M3 27h38" stroke="currentColor" stroke-width="2"/><path d="M5 22h9v4H5zM17 22h9v4h-9zM29 22h9v4h-9z" fill="#a8774d" stroke="currentColor" stroke-width="1.5"/><path d="M6 21c2-4 5-4 7 0M18 21c2-4 5-4 7 0M30 21c2-4 5-4 7 0" fill="#4f8a4a"/>'), st: [1, 1, 1], anyZone: true,
  build(ctx) {
    lotDecal(ctx, COL.soil, 0.3); const F = frameOf(ctx.lot);
    for (let t = 2.5; t < F.tmax - 2; t += 3) for (let s = F.smin + 2; s < F.smax - 4; s += 5.5) { const p = F.P(s + 2, t + 0.6); if (!insideFree(ctx, p[0], p[1], 2)) continue; const R = F.R(s, t, 4, 1.2); obox(ctx.s, R, elev(R.x, R.z), 0.5, COL.wood, true, C(0x6d9a4f)); }
    const sh = fitRect(ctx.lot, 3, 3, { front: 1, side: 1, rear: 1 }, { pref: 'rear', minScale: 1 }); if (sh) mass(ctx, sh.R, 1, 'shed', 'sage', { noFloor: true, noDoor: false });
    yardTrees(ctx, 3, 1.2); return true;
  } });
tpl('cv.library', { cat: 'civic', name: 'Library', blurb: 'Two storeys of glass facing a small plaza', icon: icon('<path d="M5 27V10h34v17z" fill="#f4f1ea" stroke="currentColor" stroke-width="2"/><path d="M9 14h26v9H9z" fill="#3b5866" stroke="currentColor" stroke-width="1.5"/><path d="M3 10h38" stroke="currentColor" stroke-width="3"/>'), st: [1, 3, 2], minArea: 600, need: [18, 14, 0.5],
  build(ctx) {
    lotDecal(ctx, COL.plaza); const f = mainFit(ctx, 32, 20, { min: 0.5, sb: { front: 6, side: 2, rear: 2 } }); if (!f) return false;
    mass(ctx, f.R, stories(ctx, this, 2), 'flat', 'white', { wide: true, fh: 4 }); yardTrees(ctx, 4, 2); benches(ctx, 3); return true;
  } });
tpl('cv.court', { cat: 'civic', name: 'Sports court', blurb: 'A fenced court ringed by trees', icon: icon('<rect x="5" y="9" width="34" height="16" fill="#5d8fb0" stroke="currentColor" stroke-width="2"/><path d="M22 9v16M5 17h34" stroke="#fff" stroke-width="1.5"/>'), st: [1, 1, 1], anyZone: true, minArea: 420,
  build(ctx) {
    lotDecal(ctx, COL.lawn); const f = fitRect(ctx.lot, 30, 16, { front: 1.5, side: 1.5, rear: 1.5 }, { minScale: 0.55 }); if (!f) return false;
    decal(ctx.d, rcorners(f.R), 0.38, COL.court);
    const R = f.R, L = (a, b) => ribbon(ctx.d, [a, b], -0.08, 0.08, 0.44, COL.courtLine, 4), c = rcorners({ ...R, hw: R.hw - 1, hd: R.hd - 1 });
    L(c[0], c[1]); L(c[1], c[2]); L(c[2], c[3]); L(c[3], c[0]); L([R.x - R.vx * (R.hd - 1), R.z - R.vz * (R.hd - 1)], [R.x + R.vx * (R.hd - 1), R.z + R.vz * (R.hd - 1)]);
    ctx.avoid.push(rcorners(R)); yardTrees(ctx, 5, 1.5); return true;
  } });
function alongStreet(ctx, f, n) { // street trees in front of shopfronts
  const F = f.F; for (let k = 0; k < n; k++) { const p = F.P(f.s0 + f.w * (k + 0.5) / n, -1.4); tree(ctx, p[0], p[1], 0.9, 0); }
}
// Bulldozed ground: grass and a couple of trees. Not on any shelf; the Bulldoze tool applies it.
tpl('lot.clear', { cat: 'none', name: 'Cleared lot', blurb: 'Grass, ready for something new', icon: ICO.park('#cdb98f'), st: [1, 1, 1], anyZone: true,
  build(ctx) { lotDecal(ctx, COL.lawn); yardTrees(ctx, Math.min(3, Math.round(ctx.lot.m2 / 400)), 1.5, [3]); return true; } });
const CATS = ['house', 'multi', 'apts', 'main', 'parking', 'civic'];
const TPL_BY_CAT = Object.fromEntries(CATS.map((c) => [c, Object.values(TPL).filter((t) => t.cat === c)]));

// Template availability: { ok, why } in plain words
function availability(t, lot, dream) {
  if (!dream) {
    const zr = zrule(lot.z);
    const allowed = t.anyZone || zr.allow.includes(t.cat) || (t.anyType && t.anyType.includes(lot.lt) && zr.allow.includes(lot.lt));
    if (!allowed) return { ok: false, why: `Not allowed in ${zfam(lot.z)} under Real rules` };
    if (t.st[0] > zr.st) return { ok: false, why: `${zfam(lot.z)} caps height at ${zr.st} storey${zr.st > 1 ? 's' : ''}; this needs ${t.st[0]}` };
  }
  if (t.minFront && lot.fr < t.minFront) return { ok: false, why: `Needs ${Math.round(t.minFront * FT)} ft frontage, lot has ${Math.round(lot.fr * FT)} ft` };
  if (t.minArea && lot.m2 < t.minArea) return { ok: false, why: `Needs ${fmt(t.minArea * 10.764)} ft² of lot, lot has ${fmt(lot.m2 * 10.764)} ft²` };
  if (lot.flags.noaccess) return { ok: false, why: 'Lot has no street access' };
  return trialBuild(t, lot, dream);
}

const TRIAL = new Map();
function trialBuild(t, lot, dream) { // the real generator decides; results are cached per lot shape and zone
  const key = t.id + '|' + lot.id + '|' + lot.r.length + '|' + lot.r[0] + '|' + lot.z + '|' + (dream ? 1 : 0);
  let v = TRIAL.get(key); if (v) return v;
  if (TRIAL.size > 20000) TRIAL.clear();
  const ctx = makeCtx(lot, null, { t: t.id, sd: lot.sd, dr: dream ? 1 : 0 });
  let ok = false; try { ok = t.build(ctx); } catch (e) { console.warn(e); }
  v = ok ? { ok: true } : { ok: false, why: ctx.reason || `Doesn't fit inside the ${dream ? 'lot' : 'setbacks'} (lot is ${Math.round(lot.wd * FT)} × ${Math.round(lot.dp * FT)} ft)` };
  TRIAL.set(key, v); return v;
}

// ---------- generate one lot ----------
function genLot(lot, S) {
  const prog = lot.prog, ctx = makeCtx(lot, S, prog);
  let ok = true;
  if (prog.t === 'asb') genAsBuilt(ctx);
  else {
    const t = TPL[prog.t];
    ok = t ? t.build(ctx) : false;
    if (!ok) { ctx.s = new Acc(); ctx.g = new Acc(); ctx.d = new Acc(); ctx.trees = []; ctx.cars = []; ctx.units = 0; ctx.floor = 0; ctx.avoid = []; decal(ctx.d, lot.r, 0.28, COL.dirt); ctx.warn = ctx.reason || `${t ? t.name : 'Template'} doesn't fit this lot`; }
    else {
      if (prog.trees) yardTrees(ctx, 4, 1.6);
      if (prog.fence && prog.fence !== 'none') fenceAround(ctx, prog.fence);
      if (prog.adu && prog.t !== 'sfr.adu' && t.cat === 'house') { const f = fitRect(lot, 7, 6, { front: ctx.sb.front + 4, side: 1.2, rear: 1.2 }, { pref: 'rear', avoid: ctx.avoid, minScale: 0.75, gap: 2.5 }); if (f) { mass(ctx, f.R, 1, 'shed', 'sage', { noFloor: true }); ctx.units += 1; } }
      const kind = t.cat === 'main' || t.id === 'cv.library' ? 3200 : t.cat === 'parking' || t.cat === 'civic' ? 0 : 2800;
      ctx.cost = ctx.floor * kind + (t.cat === 'parking' || t.cat === 'civic' ? lot.m2 * 260 : 0) + (prog.solar ? 40000 : 0);
    }
  }
  if (lot.flags.noaccess) ctx.warn = 'No street access since the street was removed';
  return { s: ctx.s, g: ctx.g, d: ctx.d, trees: ctx.trees, cars: ctx.cars, units: ctx.units, floor: ctx.floor, cost: ctx.cost, park: ctx.park, stalls: ctx.stalls, warn: ctx.warn, ok };
}

export {
  CATS,
  TPL,
  TPL_BY_CAT,
  availability,
  genLot,
};
