// Info-view numbers. Pure (no THREE, no DOM) so node tests can run them.
// Live sim data wins when a provider is registered (see providers.js); otherwise these are
// honest estimates from road class, lanes, lot uses and the clock, and the legend says so.
import { EL, zfam } from '../engine/model.js';
import { minuteOfDay } from '../game/clock.js';
import { provided } from './providers.js';

const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const polyLen = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return s; };

// how busy the whole city is at a given minute of the day: two rush hours, a quiet night
export function tripsAt(min = minuteOfDay()) {
  const h = min / 60, g = (c, w) => Math.exp(-((h - c) ** 2) / (2 * w * w));
  return clamp(0.07 + 0.95 * g(8, 1.1) + 0.9 * g(17.5, 1.5) + 0.42 * g(12.5, 1.6));
}
// parked-car demand: homes fill at night, shops and offices fill by day
export const homeStay = (min = minuteOfDay()) => 0.35 + 0.65 * clamp(0.5 + Math.cos((min / 60 - 3) / 24 * Math.PI * 2) * 0.7);
export const workStay = (min = minuteOfDay()) => 0.1 + 0.9 * clamp(1 - Math.abs(min / 60 - 13) / 7);

const CLASS_LOAD = { motorway: 1.1, primary: 0.9, secondary: 0.68, tertiary: 0.46, residential: 0.2, unclassified: 0.2, service: 0.06, unknown: 0.06 };
const CLASS_LANES = { motorway: 4, primary: 4, secondary: 2, tertiary: 2, residential: 2, unclassified: 2, service: 1, unknown: 1 };
export const lanesOf = (e) => e.prof.els.reduce((n, [k]) => n + (EL[k]?.car ? 1 : 0), 0) || (e.prof.k === 'plain' ? 1 : 0);

// per-lot facts the views share. `info(lot)` gives the generated lot ({units, stalls, park}) when known.
export function lotFacts(S, info = () => null) {
  const out = new Map();
  for (const lot of S.lots.values()) {
    const g = info(lot) || {}, units = g.units ?? lot.u0 ?? 0;
    const shop = lot.lt === 'main' || ['ms.shop', 'ms.mixed', 'ms.market'].includes(lot.prog?.t);
    const stalls = g.stalls ?? Math.round(lot.pk.reduce((s, r) => s + Math.abs(ringArea(r)), 0) / 27);
    out.set(lot.id, { lot, units, shop, stalls, park: ['civic'].includes(lot.lt) || ['pk.park', 'pk.plaza', 'cv.play', 'cv.garden', 'cv.court'].includes(lot.prog?.t) });
  }
  return out;
}
function ringArea(r) { let a = 0; for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a += p[0] * q[1] - q[0] * p[1]; } return a / 2; }

// ---------- traffic ----------
// returns Map edgeId -> congestion 0..1.4 (0 empty, 1 at capacity)
export function traffic(S, facts, min = minuteOfDay()) {
  const live = provided('edgeFlow'); if (live) { const m = live(min); if (m) return { v: m, live: true }; }
  const homes = new Map(); for (const f of facts.values()) if (f.lot.rd) homes.set(f.lot.rd, (homes.get(f.lot.rd) || 0) + f.units + (f.shop ? 6 : 0));
  const rush = tripsAt(min), v = new Map();
  for (const e of S.edges.values()) {
    if (!e.g) continue;
    const len = Math.max(20, polyLen(e.p)), base = CLASS_LOAD[e.c] ?? 0.1, local = clamp((homes.get(e.id) || 0) / (len / 12), 0, 1.5);
    const cap = lanesOf(e) / (CLASS_LANES[e.c] ?? 2); // a road diet or a closed lane squeezes the same demand
    v.set(e.id, clamp(rush * (base * (0.8 + 0.3 * local) + 0.1 * local) / Math.max(0.25, cap), 0, 1.4));
  }
  return { v, live: false };
}

// ---------- parking ----------
// edgeOcc: Map edgeId -> curb occupancy 0..1.5 (over 1 = spill, drivers circle); lotOcc: Map lotId -> off-street 0..1.5
export function parking(S, facts, min = minuteOfDay()) {
  const live = provided('parking'); if (live) { const r = live(min); if (r) return { ...r, live: true }; }
  const curb = new Map(); for (const e of S.edges.values()) if (e.g) { let n = 0; for (const [k, w] of e.prof.els) if (k === 'park') n += w > 1.2 ? polyLen(e.p) / 6 : 0; curb.set(e.id, Math.floor(n)); }
  const lotOcc = new Map(), spill = new Map(), home = homeStay(min), work = workStay(min);
  let want = 0, have = 0, curbHave = 0;
  for (const f of facts.values()) {
    const need = f.units * 1.5 * home + (f.shop ? (f.lot.m2 / 55) * work : 0);
    if (f.stalls) lotOcc.set(f.lot.id, clamp(need / f.stalls, 0, 1.5));
    const over = Math.max(0, need - f.stalls); want += need; have += f.stalls;
    if (over > 0 && f.lot.rd) spill.set(f.lot.rd, (spill.get(f.lot.rd) || 0) + over);
  }
  const edgeOcc = new Map();
  for (const [id, n] of curb) { curbHave += n; if (n) edgeOcc.set(id, clamp(0.15 + (spill.get(id) || 0) / n, 0, 1.5)); }
  return { edgeOcc, lotOcc, live: false, want, have, curbHave, short: Math.max(0, want - have - curbHave * 0.85) };
}

// ---------- comfort (the happiness view) ----------
// per lot 0..1 from: a shop and a park close by, trees on the street, and calm streets out front
export function comfort(S, facts, min = minuteOfDay(), roadCong = new Map()) {
  const shops = [], parks = [];
  for (const f of facts.values()) { if (f.shop) shops.push(f.lot.c); if (f.park) parks.push(f.lot.c); }
  const near = (list, x, z, r) => { let best = 1e9; for (const c of list) { const d = Math.hypot(c[0] - x, c[1] - z); if (d < best) best = d; } return clamp(1 - best / r); };
  const out = new Map();
  for (const f of facts.values()) {
    const [x, z] = f.lot.c, e = S.edges.get(f.lot.rd), cong = e ? roadCong.get(e.id) || 0 : 0;
    const treeRow = e ? e.prof.els.some(([k]) => k === 'trees' || k === 'median') : false;
    const noise = e ? clamp((CLASS_LOAD[e.c] ?? 0.1) * (0.5 + cong * 0.5)) : 0;
    out.set(f.lot.id, clamp(0.25 + 0.3 * near(shops, x, z, 400) + 0.28 * near(parks, x, z, 450) + (treeRow ? 0.12 : 0) + 0.1 * (f.lot.flags.noaccess ? 0 : 1) - 0.3 * noise));
  }
  return out;
}

// ---------- zones ----------
export const zoneOf = (lot) => zfam(lot.z);

// ---------- summary for the advisor and the legend ----------
export function summarize(S, facts, min = minuteOfDay()) {
  const t = traffic(S, facts, min), p = parking(S, facts, min), c = comfort(S, facts, min, t.v);
  let jam = 0, worst = null, sum = 0, n = 0;
  for (const e of S.edges.values()) { const v = t.v.get(e.id); if (v == null || !['primary', 'secondary', 'tertiary'].includes(e.c)) continue; sum += v; n++; if (v > 0.85) jam++; if (!worst || v > worst.v) worst = { v, e }; }
  let lonely = 0, happy = 0, homes = 0; for (const f of facts.values()) { if (!f.units) continue; homes += f.units; const h = c.get(f.lot.id) ?? 0; if (h < 0.4) lonely += f.units; happy += h * f.units; }
  return { traffic: n ? sum / n : 0, jam, worstStreet: worst && worst.v > 0.7 ? worst.e.n || `a ${worst.e.c} street` : null, parkShort: Math.round(p.short), parkWant: Math.round(p.want), parkHave: Math.round(p.have + p.curbHave),
    lonelyHomes: lonely, comfort: homes ? happy / homes : 0, live: t.live, tripsNow: tripsAt(min) };
}
