import PC from 'polygon-clipping';
import { area, bbox, bufferLine, centroid, clamp, densify, fmt, fromPC, hash32, inPoly, nearestOnLine, obb, pcDiff, pcSafe, polyLen, ringDistToLine, rng, segX, toPC } from './core.js';
import { BLD, EL, PRESETS, buildBase, curbHalf, frameOf, inferProgram, lotMeta, rowWidth, zfam } from './model.js';
import { TPL, availability } from './templates.js';

// =====================================================================
// Edits are a log. The city = base pack + an ordered list of commands.
// =====================================================================
const BASE = buildBase();
const ZONE_FILL = {
  R1: ['sfr.refresh', 'sfr.adu', 'cottage.pair', 'garden.house', 'sb9.duplex'], RE11: ['sfr.refresh', 'garden.house', 'sfr.adu'],
  R2: ['mf.court4', 'mf.townrow', 'mf.stacked', 'sb9.duplex', 'cottage.pair'], R3: ['apt.court', 'mf.stacked', 'mf.townrow', 'apt.mid', 'mf.court4'],
  RAS4: ['apt.mid', 'ms.mixed', 'apt.court'], C2: ['ms.mixed', 'ms.shop', 'apt.mid', 'ms.market'], P: ['pk.solar', 'pk.plaza', 'pk.apts'],
  PF: ['cv.library', 'cv.play', 'cv.garden', 'cv.court'], OS: ['pk.park', 'cv.play', 'cv.garden', 'pk.plaza'],
};
const ZONE_LT = { R1: 'house', RE11: 'house', R2: 'multi', R3: 'apts', RAS4: 'apts', C2: 'main', P: 'parking', PF: 'civic', OS: 'civic' };
const uid = (p) => p + Date.now().toString(36).slice(-5) + Math.floor(Math.random() * 1296).toString(36);

function exec(S, cmd, info) {
  const L = (id) => S.lots.get(id);
  switch (cmd.op) {
    case 'apply': for (const id of cmd.lots) { const lot = L(id); if (!lot) continue; lot.prog = cmd.t === 'asb' ? inferProgram(lot) : { t: cmd.t, ...cmd.p, sd: cmd.vary ? hash32(cmd.sd + id) : hash32(cmd.sd), dr: cmd.dr ? 1 : 0 }; } break;
    case 'tweak': for (const id of cmd.lots) { const lot = L(id); if (!lot) continue; Object.assign(lot.prog, cmd.f); for (const k in cmd.f) if (cmd.f[k] === null) delete lot.prog[k]; } break;
    case 'rezone': for (const id of cmd.lots) { const lot = L(id); if (lot) { lot.z = cmd.z; lot.zr = null; } } break;
    case 'restore': for (const id of cmd.lots) { const lot = L(id); if (lot) lot.prog = inferProgram(lot); } break;
    case 'fill': for (const id of cmd.lots) { const lot = L(id); if (lot) lot.prog = zoneFill(lot, hash32(cmd.sd + id), cmd.dr); } break;
    case 'merge': mergeLots(S, cmd, info); break;
    case 'split': (cmd.lots || [cmd.lot]).forEach((id, k) => splitLot(S, { ...cmd, lot: id, id: cmd.lots ? `${cmd.id}_${k}` : cmd.id }, info)); break;
    case 'street.add': streetAdd(S, cmd, info); break;
    case 'street.move': break; // applied by rewriting the matching street.add during replay
    case 'street.del': streetDel(S, cmd, info); break;
    case 'street.prof': streetProf(S, cmd, info); break;
    case 'area.new': areaNew(S, cmd, info); break;
  }
}
function zoneFill(lot, seed, dream) {
  const list = ZONE_FILL[zfam(lot.z)] || ZONE_FILL.R1, r = rng(seed), off = Math.floor(r() * list.length);
  for (let k = 0; k < list.length; k++) { const t = TPL[list[(k + off) % list.length]]; if (availability(t, lot, dream).ok) return { t: t.id, sd: seed, dr: dream ? 1 : 0 }; }
  return { t: lot.m2 > 300 ? 'pk.park' : 'cv.garden', sd: seed, dr: dream ? 1 : 0 };
}
function replay(log) {
  const S = structuredClone(BASE), info = { skipped: [], notes: [] };
  const moves = {}; for (const c of log) if (c.op === 'street.move') moves[c.id] = c.pts;
  for (const c of log) {
    const cmd = c.op === 'street.add' && moves[c.id] ? { ...c, pts: moves[c.id] } : c;
    try { exec(S, cmd, info); } catch (e) { console.warn('command failed', cmd, e); info.notes.push(`A ${cmd.op} edit no longer fits the base data and was skipped`); }
  }
  return { S, info };
}

// ---------- parcel surgery ----------
function relink(S, lot, src) { // buildings and paving follow the piece they sit in
  lot.b = src.b.filter((i) => { const b = BLD[i]; const c = centroid(b.r); return inPoly(c[0], c[1], lot.r); });
  lot.pk = src.pk.map((r) => pcSafe(PC.intersection, toPC(r), toPC(lot.r)) || []).flat().filter((r) => Math.abs(area(r)) > 25);
}
function cutLots(S, rowPC, newIdBase) {
  const rings = fromPC(rowPC); if (!rings.length) return [];
  const bb = rings.map(bbox).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const touched = [];
  for (const lot of [...S.lots.values()]) {
    const lb = lot.bb; if (lb[0] > bb[2] || lb[2] < bb[0] || lb[1] > bb[3] || lb[3] < bb[1]) continue;
    const inter = pcSafe(PC.intersection, toPC(lot.r), rowPC); if (!inter || !inter.length || inter.reduce((s, r) => s + Math.abs(area(r)), 0) < 1) continue;
    for (const i of lot.b) { const b = BLD[i]; const hit = pcSafe(PC.intersection, toPC(b.r), rowPC); if (hit && hit.reduce((s, r) => s + Math.abs(area(r)), 0) > 2) S.demo.add(i); }
    let pieces = (pcSafe(PC.difference, toPC(lot.r), rowPC) || []).filter((r) => Math.abs(area(r)) > 8).sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));
    // slivers under a minimum size join a neighbouring piece, or the right-of-way if none touches
    const keep = pieces.filter((r) => Math.abs(area(r)) >= 60);
    if (!keep.length) { S.lots.delete(lot.id); continue; }
    const src = { b: lot.b.slice(), pk: lot.pk.slice() };
    keep.forEach((r, k) => {
      const L = k === 0 ? lot : { ...structuredClone(lot), id: `${newIdBase}.${lot.id}.${k}`, a: null, flags: {}, prog: { t: 'asb', st: 0, rf: lot.prog.rf, pl: lot.prog.pl, sd: lot.sd + k } };
      L.r = r.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]);
      relink(S, L, src); if (k > 0 && !L.b.length) L.lt = L.lt === 'parking' ? 'parking' : 'vacant';
      S.lots.set(L.id, L); touched.push(L);
    });
  }
  S.blocks = S.blocks.flatMap((r) => { if (!r) return [r]; const d = pcSafe(PC.difference, toPC(r), rowPC); return d && d.length ? d : [r]; });
  return touched;
}
function refreshNear(S, bb, pad = 70) {
  for (const lot of S.lots.values()) { const lb = lot.bb; if (lb[0] > bb[2] + pad || lb[2] < bb[0] - pad || lb[1] > bb[3] + pad || lb[3] < bb[1] - pad) continue; lotMeta(lot, S); }
}
function mergeLots(S, cmd, info) {
  const lots = cmd.lots.map((id) => S.lots.get(id)).filter(Boolean); if (lots.length < 2) return;
  let u = pcSafe(PC.union, ...lots.map((l) => toPC(l.r)));
  if (!u || u.length !== 1) { // close hairline gaps between estimated lot lines
    const grow = (r) => { const c = centroid(r), A = Math.sqrt(Math.abs(area(r))) / 2, k = 1 + 0.6 / Math.max(A, 1); return r.map((p) => [c[0] + (p[0] - c[0]) * k, c[1] + (p[1] - c[1]) * k]); };
    u = pcSafe(PC.union, ...lots.map((l) => toPC(grow(l.r))));
  }
  if (!u || u.length !== 1) { info.skipped.push({ id: cmd.lots[0], why: 'Merge needs lots that touch each other' }); return; }
  const big = lots.reduce((a, b) => (b.m2 > a.m2 ? b : a));
  const M = { ...structuredClone(big), id: cmd.id, r: u[0].map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), flags: {}, a: lots.find((l) => l.a)?.a || null,
    b: lots.flatMap((l) => l.b), sh: lots.flatMap((l) => l.sh), pk: lots.flatMap((l) => l.pk), u0: lots.reduce((s, l) => s + l.u0, 0), st0: Math.max(...lots.map((l) => l.st0)), yr: Math.min(...lots.map((l) => l.yr)), merged: lots.map((l) => l.a || l.id) };
  M.sd = hash32(cmd.id); M.prog = big.prog.t === 'asb' ? inferProgram(M) : { ...big.prog };
  for (const l of lots) S.lots.delete(l.id);
  lotMeta(M, S); S.lots.set(M.id, M);
}
function halfPlaneCut(lot, F, s0, s1) {
  const box = [F.P(s0, -30), F.P(s1, -30), F.P(s1, F.tmax + 30), F.P(s0, F.tmax + 30)];
  return pcSafe(PC.intersection, toPC(lot.r), toPC(box)) || [];
}
function splitLot(S, cmd, info) {
  const lot = S.lots.get(cmd.lot); if (!lot) return;
  const F = frameOf(lot); let pieces = [];
  const n = cmd.mode === 'sb9' ? 2 : clamp(cmd.n | 0, 2, 12);
  const deep = cmd.mode === 'sb9' && lot.wd < 2 * 7.6 && lot.dp > 2 * 15;
  if (deep) { // flag-lot style split front/back when the lot is narrow and deep
    const tm = F.tmax / 2, front = [F.P(F.smin - 30, -30), F.P(F.smax + 30, -30), F.P(F.smax + 30, tm), F.P(F.smin - 30, tm)];
    pieces = [...(pcSafe(PC.intersection, toPC(lot.r), toPC(front)) || []), ...(pcSafe(PC.difference, toPC(lot.r), toPC(front)) || [])];
  } else {
    // equal-area cut lines, found by bisection along the street
    const leftArea = (s) => halfPlaneCut(lot, F, F.smin - 30, s).reduce((a, r) => a + Math.abs(area(r)), 0);
    const cutsAt = [];
    for (let k = 1; k < n; k++) { let lo = F.smin, hi = F.smax; for (let it = 0; it < 14; it++) { const m = (lo + hi) / 2; if (leftArea(m) < lot.m2 * k / n) lo = m; else hi = m; } cutsAt.push((lo + hi) / 2); }
    const xs = [F.smin - 30, ...cutsAt, F.smax + 30];
    for (let k = 0; k < n; k++) pieces.push(...halfPlaneCut(lot, F, xs[k], xs[k + 1]));
  }
  pieces = pieces.filter((r) => Math.abs(area(r)) > 5);
  const minA = cmd.mode === 'sb9' ? Math.max(111.5, lot.m2 * 0.4) : 60;
  if (pieces.length < 2 || pieces.some((r) => Math.abs(area(r)) < minA - 0.5)) {
    info.skipped.push({ id: lot.id, why: cmd.mode === 'sb9' ? `SB 9 needs two lots of at least 1,200 ft² and 40% each; this lot is ${fmt(lot.m2 * 10.764)} ft²` : 'Pieces would be too small (under 650 ft²)' });
    return;
  }
  const src = { b: lot.b.slice(), pk: lot.pk.slice() };
  S.lots.delete(lot.id);
  pieces.forEach((r, k) => {
    const L = { ...structuredClone(lot), id: `${cmd.id}.${k + 1}`, r: r.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), flags: {}, a: k === 0 ? lot.a : null, split: lot.a || lot.id };
    relink(S, L, src); L.sd = hash32(L.id); L.u0 = L.b.length ? lot.u0 : 0; L.st0 = L.b.length ? lot.st0 : 0;
    L.prog = lot.prog.t === 'asb' ? inferProgram(L) : { ...lot.prog, sd: L.sd };
    lotMeta(L, S); S.lots.set(L.id, L);
  });
}

// ---------- road graph edits ----------
function addNode(S, x, z) { S.nodes.push([x, z]); return S.nodes.length - 1; }
function findNode(S, x, z, tol) { let b = -1, bd = tol; S.nodes.forEach((n, i) => { const d = Math.hypot(n[0] - x, n[1] - z); if (d < bd) { bd = d; b = i; } }); return b; }
function splitEdgeAt(S, e, x, z) {
  const q = nearestOnLine(e.p, x, z), pt = [q.x, q.z];
  const pA = e.p.slice(0, q.i + 1).concat([pt]), pB = [pt].concat(e.p.slice(q.i + 1));
  if (polyLen(pA) < 0.5 || polyLen(pB) < 0.5) return polyLen(pA) < 0.5 ? e.a : e.b;
  const nd = addNode(S, pt[0], pt[1]);
  const A = { ...e, id: e.id + 'a', p: pA, b: nd, bb: bbox(pA) }, B = { ...e, id: e.id + 'b', p: pB, a: nd, bb: bbox(pB) };
  S.edges.delete(e.id); S.edges.set(A.id, A); S.edges.set(B.id, B);
  for (const lot of S.lots.values()) if (lot.rd === e.id) lot.rd = nearestOnLine(pA, lot.c[0], lot.c[1]).d <= nearestOnLine(pB, lot.c[0], lot.c[1]).d ? A.id : B.id;
  return nd;
}
function roadClass(prof) { const w = prof.els.filter((e) => !EL[e[0]]?.curb).reduce((s, e) => s + e[1], 0); return { w: Math.max(3, w), c: w >= 16 ? 'secondary' : w >= 7 ? 'residential' : 'service', s: w < 7 ? 'alley' : null }; }
function streetAdd(S, cmd, info, opts = {}) {
  const pts = cmd.pts.map((p) => [p[0], p[1]]); if (pts.length < 2 || polyLen(pts) < 4) return [];
  const prof = structuredClone(cmd.prof), rc = roadClass(prof);
  // every crossing with an existing street splits both and adds a node
  const cuts = []; let along = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    for (const e of [...S.edges.values()]) {
      if (!e.g || e.grp === cmd.id) continue;
      for (let k = 1; k < e.p.length; k++) {
        const x = segX(a, b, e.p[k - 1], e.p[k]);
        if (x) { cuts.push({ d: along + x[0] * L, x: x[2], z: x[3], e: e.id }); }
      }
    }
    along += L;
  }
  cuts.sort((p, q) => p.d - q.d);
  const total = polyLen(pts), stops = [];
  for (const c of cuts) { const e = S.edges.get(c.e) || [...S.edges.values()].find((q) => q.id.startsWith(c.e) && nearestOnLine(q.p, c.x, c.z).d < 0.5); if (!e) continue; const nd = splitEdgeAt(S, e, c.x, c.z); stops.push({ d: c.d, nd }); }
  // endpoints snap to nodes or onto streets (T junctions)
  const endNode = (p) => { let n = findNode(S, p[0], p[1], 2); if (n >= 0) return n; for (const e of S.edges.values()) if (e.g && e.grp !== cmd.id && nearestOnLine(e.p, p[0], p[1]).d < 2) return splitEdgeAt(S, e, p[0], p[1]); return addNode(S, p[0], p[1]); };
  const n0 = endNode(pts[0]), n1 = endNode(pts[pts.length - 1]);
  const marks = [{ d: 0, nd: n0 }, ...stops.filter((s) => s.d > 1 && s.d < total - 1), { d: total, nd: n1 }];
  const sub = (d0, d1) => { const out = []; let acc = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]); const lo = Math.max(d0, acc), hi = Math.min(d1, acc + L); if (hi > lo || (L === 0 && lo === acc)) { const P = (d) => [a[0] + (b[0] - a[0]) * (d - acc) / (L || 1), a[1] + (b[1] - a[1]) * (d - acc) / (L || 1)]; if (!out.length) out.push(P(lo)); out.push(P(hi)); } acc += L; } return out; };
  const made = [];
  for (let k = 1; k < marks.length; k++) {
    const p = sub(marks[k - 1].d, marks[k].d); if (p.length < 2 || polyLen(p) < 0.5) continue;
    const E = { id: `${cmd.id}.${k}`, a: marks[k - 1].nd, b: marks[k].nd, p, c: rc.c, s: rc.s, n: cmd.name || null, w: rc.w, g: 1, grp: cmd.id, prof: structuredClone(prof), bb: bbox(p), drawn: 1 };
    S.edges.set(E.id, E); made.push(E);
  }
  if (!opts.noCut) {
    const row = bufferLine(pts, rowWidth(prof) / 2);
    const touched = cutLots(S, row, cmd.id);
    refreshNear(S, bbox(pts)); touched.forEach((l) => lotMeta(l, S));
  }
  return made;
}
function streetDel(S, cmd, info) {
  for (const id of cmd.ids) {
    const e = S.edges.get(id); if (!e) continue;
    S.edges.delete(id);
    if (!e.g) continue;
    // freed right-of-way becomes land
    let freed = bufferLine(e.p, curbHalf(e));
    const others = [...S.edges.values()].filter((q) => q.bb[0] < e.bb[2] + 30 && q.bb[2] > e.bb[0] - 30 && q.bb[1] < e.bb[3] + 30 && q.bb[3] > e.bb[1] - 30);
    for (const q of others) freed = pcDiff(freed, bufferLine(q.p, Math.max(curbHalf(q), q.w / 2 + 0.5)));
    for (const l of S.lots.values()) if (l.bb[0] < e.bb[2] + 30 && l.bb[2] > e.bb[0] - 30 && l.bb[1] < e.bb[3] + 30 && l.bb[3] > e.bb[1] - 30) freed = pcDiff(freed, toPC(l.r));
    const rings = fromPC(freed).filter((r) => Math.abs(area(r)) > 60);
    rings.forEach((r, k) => {
      const c = centroid(r); let near = null, nd = 1e9; for (const l of S.lots.values()) { const d = Math.hypot(l.c[0] - c[0], l.c[1] - c[1]); if (d < nd) { nd = d; near = l; } }
      const L = { id: `${cmd.id}.${k + 1}`, r: r.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), a: null, freed: e.n || 'street', lt: 'vacant', z: near ? near.z : 'R1-1', yr: 2030, st0: 0, u0: 0, b: [], sh: [], pk: [], sd: hash32(cmd.id + k), flags: {}, c, fd: [0, 1], fr: 0, dp: 0, wd: 0, rd: null, fp: c, e: 0, blk: -1 };
      L.prog = { t: 'asb', st: 0, rf: 'flat', pl: 'sand', sd: L.sd };
      lotMeta(L, S); S.lots.set(L.id, L);
      // blocks on both sides merge with the freed strip
      const touching = S.blocks.map((b, i) => [b, i]).filter(([b]) => b && pcSafe(PC.intersection, toPC(b), toPC(r))?.length);
      if (touching.length) { const u = pcSafe(PC.union, toPC(r), ...touching.map(([b]) => toPC(b))); if (u && u.length) { const keepI = touching[0][1]; S.blocks[keepI] = u.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0]; for (const [, i] of touching.slice(1)) S.blocks[i] = null; } }
    });
    for (const l of S.lots.values()) if (l.rd === id) lotMeta(l, S);
    refreshNear(S, e.bb, 30);
  }
}
function streetProf(S, cmd, info) {
  for (const id of cmd.ids) {
    const e = S.edges.get(id); if (!e) continue;
    const old = rowWidth(e.prof), prof = structuredClone(cmd.prof), nw = rowWidth(prof);
    if (nw < old - 0.2 && e.prof.k !== 'plain') { const pad = (old - nw) / 2; prof.els = [prof.els[0], ['trees', pad], ...prof.els.slice(1, -1), ['trees', pad], prof.els[prof.els.length - 1]]; }
    e.prof = prof; e.prof.k = cmd.prof.k || 'custom';
    if (nw > old + 0.3) { const touched = cutLots(S, bufferLine(e.p, nw / 2), cmd.id + id); touched.forEach((l) => lotMeta(l, S)); }
  }
}

// ---------- new areas: street pattern + oriented-bounding-box subdivision ----------
function clipLine(line, ring) {
  const P = densify(line, 1.5), runs = []; let cur = null;
  for (const p of P) { const ins = inPoly(p[0], p[1], ring); if (ins) { if (!cur) { cur = []; runs.push(cur); } cur.push(p); } else cur = null; }
  return runs.filter((r) => r.length > 3);
}
function extendToStreet(S, run, atStart, maxD = 18) {
  const p = atStart ? run[0] : run[run.length - 1], q = atStart ? run[1] : run[run.length - 2];
  const L = Math.hypot(p[0] - q[0], p[1] - q[1]) || 1, dx = (p[0] - q[0]) / L, dz = (p[1] - q[1]) / L, far = [p[0] + dx * maxD, p[1] + dz * maxD];
  let best = null;
  for (const e of S.edges.values()) { if (!e.g) continue; for (let k = 1; k < e.p.length; k++) { const x = segX(p, far, e.p[k - 1], e.p[k]); if (x && (!best || x[0] < best[0])) best = x; } }
  if (best) { if (atStart) run.unshift([best[2], best[3]]); else run.push([best[2], best[3]]); }
}
function patternLines(region, cmd) {
  const R = obb(region), bs = cmd.bs, out = [], P = (s, t) => [R.x + R.ux * s + R.vx * t, R.z + R.uz * s + R.vz * t];
  const r = rng(hash32(cmd.id)), ph = r() * 6.28, amp = cmd.pattern === 'curvy' ? bs * 0.22 : 0;
  const line = (fn, a0, a1) => { const p = []; for (let a = a0; a <= a1 + 1e-6; a += 3) p.push(fn(a)); return p; };
  if (cmd.pattern === 'grid' || cmd.pattern === 'curvy') {
    for (let t = -R.hd + bs; t < R.hd - bs * 0.35; t += bs) out.push({ p: line((s) => P(s, t + amp * Math.sin(s / bs * 2.2 + ph)), -R.hw - 5, R.hw + 5) });
    const bw = bs * 1.6; for (let s = -R.hw + bw; s < R.hw - bw * 0.35; s += bw) out.push({ p: line((t) => P(s + amp * 0.6 * Math.sin(t / bs * 2 + ph), t), -R.hd - 5, R.hd + 5) });
  } else if (cmd.pattern === 'super') {
    const i = Math.min(cmd.ld * 1.1, Math.min(R.hw, R.hd) * 0.45), hw = R.hw - i, hd = R.hd - i;
    out.push({ p: [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd), P(-hw, -hd)], loop: 1 });
    out.push({ p: line((s) => P(s, 0), -hw, hw), prof: 'ped' }); out.push({ p: line((t) => P(0, t), -hd, hd), prof: 'ped' });
    // short links from the ring out to the surrounding streets
    out.push({ p: line((t) => P(0, t), -R.hd - 5, -hd) }); out.push({ p: line((t) => P(0, t), hd, R.hd + 5) });
  }
  return out;
}
function subdivide(S, ring, lw, ld, roads, out, depth = 0) {
  const A = Math.abs(area(ring)); if (A < 40) return;
  const R = obb(ring); if (!R) return;
  const long = R.hw * 2, short = R.hd * 2;
  if (depth > 9 || (long <= lw * 1.5 && short <= ld * 1.5) || A < lw * ld * 1.3) { out.push(ring); return; }
  const access = (r) => roads.some((e) => ringDistToLine(r, e.p) - curbHalf(e) < 3.5);
  const cut = (axis, at) => { // axis 'u': cut across the long side; 'v': cut along it
    const big = 2000, P = (s, t) => [R.x + R.ux * s + R.vx * t, R.z + R.uz * s + R.vz * t];
    const half = axis === 'u' ? [P(-big, -big), P(at, -big), P(at, big), P(-big, big)] : [P(-big, -big), P(big, -big), P(big, at), P(-big, at)];
    const a = pcSafe(PC.intersection, toPC(ring), toPC(half)) || [], b = pcSafe(PC.difference, toPC(ring), toPC(half)) || [];
    return [...a, ...b].filter((r) => Math.abs(area(r)) > 10);
  };
  const jit = (Math.sin(A * 13.7) * 0.08);
  const tries = short > ld * 1.9 ? [['v', jit * R.hd], ['u', jit * R.hw]] : [['u', jit * R.hw], ['v', jit * R.hd]];
  for (const [ax, at] of tries) {
    const pcs = cut(ax, at);
    if (pcs.length >= 2 && pcs.every(access)) { for (const p of pcs) subdivide(S, p, lw, ld, roads, out, depth + 1); return; }
  }
  out.push(ring);
}
function areaNew(S, cmd, info) {
  // region: chosen lots, or a drawn boundary minus existing right-of-way
  let region = null;
  if (cmd.lots && cmd.lots.length) {
    const ls = cmd.lots.map((id) => S.lots.get(id)).filter(Boolean); if (!ls.length) return;
    const u = pcSafe(PC.union, ...ls.map((l) => toPC(l.r))); if (!u || !u.length) return;
    region = u.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
    for (const l of ls) { for (const i of l.b) S.demo.add(i); S.lots.delete(l.id); }
  } else if (cmd.region) {
    let reg = [toPC(cmd.region)];
    for (const e of S.edges.values()) if (e.g && e.bb[0] < 1e9) reg = [pcDiff(reg[0], bufferLine(e.p, curbHalf(e)))];
    const u = fromPC(reg[0]); if (!u.length) return;
    region = u.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)))[0];
    const touched = cutLots(S, toPC(region), cmd.id + 'c');
    for (const l of [...S.lots.values()]) { const c = l.c; if (inPoly(c[0], c[1], region) && pcSafe(PC.intersection, toPC(l.r), toPC(region))?.reduce((s, r) => s + Math.abs(area(r)), 0) > l.m2 * 0.5) { for (const i of l.b) S.demo.add(i); S.lots.delete(l.id); } }
    void touched;
  }
  if (!region) return;
  const prof = { k: cmd.prof, els: PRESETS[cmd.prof]?.els || PRESETS.slow.els };
  const lines = patternLines(region, cmd), made = [];
  let k = 0;
  for (const L of lines) {
    for (const run of clipLine(L.p, region)) {
      extendToStreet(S, run, true); extendToStreet(S, run, false);
      const pr = L.prof ? { k: L.prof, els: PRESETS[L.prof].els } : prof;
      made.push(...streetAdd(S, { id: `${cmd.id}.s${++k}`, pts: run, prof: pr, name: cmd.name ? `${cmd.name} ${k}` : null }, info, { noCut: true }));
    }
  }
  // blocks = region minus new right-of-way
  let blocks = [toPC(region)];
  for (const e of made) blocks = [pcDiff(blocks[0], bufferLine(e.p, curbHalf(e)))];
  const brings = fromPC(blocks[0]);
  const roads = [...S.edges.values()].filter((e) => e.g && e.c !== 'motorway' && e.bb[0] < bbox(region)[2] + 40 && e.bb[2] > bbox(region)[0] - 40 && e.bb[1] < bbox(region)[3] + 40 && e.bb[3] > bbox(region)[1] - 40);
  let n = 0;
  for (const b of brings) {
    S.blocks.push(b);
    const parts = []; subdivide(S, b, cmd.lw, cmd.ld, roads, parts);
    for (const r of parts) {
      if (Math.abs(area(r)) < 60) continue;
      const id = `${cmd.id}.${++n}`, c = centroid(r);
      const L = { id, r: r.map((p) => [Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10]), a: null, newArea: cmd.id, lt: 'vacant', z: 'R2-1', yr: 2030, st0: 0, u0: 0, b: [], sh: [], pk: [], sd: hash32(id), flags: {}, c, fd: [0, 1], fr: 0, dp: 0, wd: 0, rd: null, fp: c, e: 0, blk: S.blocks.length - 1 };
      lotMeta(L, S);
      const front = S.edges.get(L.rd);
      L.z = cmd.zone === 'mix' ? (front && (front.c === 'primary' || front.c === 'secondary') ? 'C2-1VL' : (n % 3 === 0 ? 'R3-1' : 'R2-1')) : cmd.zone;
      L.lt = ZONE_LT[zfam(L.z)] || 'vacant';
      L.prog = cmd.fill ? zoneFill(L, L.sd, cmd.dr) : { t: 'asb', st: 0, rf: 'flat', pl: 'sand', sd: L.sd };
      S.lots.set(id, L);
    }
  }
  refreshNear(S, bbox(region), 20);
  info.notes.push(`New area: ${made.length} street pieces, ${n} lots`);
}

export {
  BASE,
  areaNew,
  exec,
  replay,
  uid,
};
