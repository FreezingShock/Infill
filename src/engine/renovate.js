import { C, UP, inPoly } from './core.js';

// =====================================================================
// Renovate and repurpose: change what an existing building is used for while keeping its shell.
// A repurposed lot is the as-built program plus two optional fields: `use` and `add` (extra floors).
//   use: 'shops' | 'mixed' | 'homes' | 'office'      add: storeys built on top (mixed defaults to 2 over a 1-2 storey shell)
// Pure data and geometry helpers, no THREE. templates.js calls these from genAsBuilt.
// =====================================================================
const USES = {
  shops: { name: 'Shops', wall: 0xf2dfa2, jobs: 1, homes: 0, rate: 900 },
  mixed: { name: 'Shops and homes', wall: 0xeedcc0, jobs: 1, homes: 1, rate: 1700 },
  homes: { name: 'Homes', wall: 0xf1e2c4, jobs: 0, homes: 1, rate: 1500 },
  office: { name: 'Offices', wall: 0xdfe6ea, jobs: 1, homes: 0, rate: 1100 },
};
const FLOOR_H = 3.2, M2_PER_HOME = 85, AWNING = [0xc4613b, 0x3e9fdc, 0x4f8a4a, 0xd6ad57, 0x8a5a9e, 0x2b2420];

const useOf = (prog) => (prog && prog.t === 'asb' && USES[prog.use] ? USES[prog.use] : null);
// storeys added on top of the existing building
function addedFloors(prog, existingFloors) {
  if (!useOf(prog)) return 0;
  if (prog.add != null) return Math.max(0, Math.min(6, prog.add | 0));
  return prog.use === 'mixed' && existingFloors < 3 ? 2 : 0;
}
// Which edges face the street: outward normal points along lot.fd (towards the front line).
function frontEdges(lot, r) {
  const out = []; if (!lot.fd) return out;
  for (let e = 0; e < r.length; e++) {
    const a = r[e], c = r[(e + 1) % r.length], L = Math.hypot(c[0] - a[0], c[1] - a[1]); if (L < 3.5) continue;
    let nx = -(c[1] - a[1]) / L, nz = (c[0] - a[0]) / L; const mx = (a[0] + c[0]) / 2, mz = (a[1] + c[1]) / 2;
    if (inPoly(mx + nx * 0.15, mz + nz * 0.15, r)) { nx = -nx; nz = -nz; }
    if (nx * lot.fd[0] + nz * lot.fd[1] > 0.55) out.push({ a, c, L, nx, nz, ux: (c[0] - a[0]) / L, uz: (c[1] - a[1]) / L });
  }
  return out;
}
// Draw the new use on one building: shopfronts, awnings, doors, curtain glass, a new storey band.
// geometry accumulators: ctx.s (solid) and ctx.g (glass)
function dressUse(ctx, o) {
  const { lot, prog } = ctx, { r, y0, floors, fh, added, seed } = o, u = prog.use;
  const front = frontEdges(lot, r), glass = C(0x3b5866), door = C(0x6d4a33), white = C(0xf4f1ea);
  const P = (e, t, y, off = 0.09) => [e.a[0] + e.ux * t + e.nx * off, y, e.a[1] + e.uz * t + e.nz * off];
  front.forEach((e, k) => {
    const hint = [e.nx, 0, e.nz];
    if (u === 'shops' || u === 'mixed') {
      const t0 = 0.8, t1 = e.L - 0.8, yb = y0 + 0.25, yt = y0 + Math.min(3, fh - 0.5);
      ctx.g.quad(P(e, t0, yb), P(e, t1, yb), P(e, t1, yt), P(e, t0, yt), glass, hint);
      const col = C(AWNING[(seed + k) % AWNING.length]), ya = yt + 0.15;
      ctx.s.quad(P(e, t0 - 0.2, ya, 0.1), P(e, t1 + 0.2, ya, 0.1), P(e, t1 + 0.2, ya - 0.5, 1.1), P(e, t0 - 0.2, ya - 0.5, 1.1), col, [e.nx, 0.6, e.nz]);
      ctx.s.quad(P(e, t0 - 0.2, ya, 0.1), P(e, t1 + 0.2, ya, 0.1), P(e, t1 + 0.2, ya + 0.35, 0.1), P(e, t0 - 0.2, ya + 0.35, 0.1), white, hint);
    } else if (u === 'homes') {
      const tc = e.L / 2;
      ctx.g.quad(P(e, tc - 0.55, y0), P(e, tc + 0.55, y0), P(e, tc + 0.55, y0 + 2.2), P(e, tc - 0.55, y0 + 2.2), door, hint);
      ctx.s.quad(P(e, tc - 1.4, y0 + 2.5, 0.12), P(e, tc + 1.4, y0 + 2.5, 0.12), P(e, tc + 1.4, y0 + 2.5, 1.5), P(e, tc - 1.4, y0 + 2.5, 1.5), white, UP);
    }
  });
  if (u === 'office') { // a curtain-wall band on every floor of every street-facing wall
    for (const e of front) for (let f = 0; f < floors + added; f++) {
      const yb = y0 + 1 + f * fh + fh * 0.2, yt = yb + fh * 0.55;
      ctx.g.quad(P(e, 0.7, yb), P(e, e.L - 0.7, yb), P(e, e.L - 0.7, yt), P(e, 0.7, yt), glass, [e.nx, 0, e.nz]);
    }
  }
}
// What the lot holds after the change: homes (units) and a rough cost for the converted floor area.
function useTotals(prog, floorsByBuilding) {
  const U = useOf(prog); if (!U) return null;
  let homes = 0, floorM2 = 0;
  for (const { a, floors, added } of floorsByBuilding) {
    const total = floors + added;
    floorM2 += a * total;
    if (U.homes) homes += Math.max(0, Math.floor(a * (U.jobs ? total - 1 : total) / M2_PER_HOME));
  }
  const newM2 = floorsByBuilding.reduce((s, b) => s + b.a * b.added, 0);
  return { homes, cost: floorM2 * U.rate * 0.35 + newM2 * 3200 };
}

export { FLOOR_H, M2_PER_HOME, USES, addedFloors, dressUse, frontEdges, useOf, useTotals };
