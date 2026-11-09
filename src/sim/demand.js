// Trip demand: where cars come from and go to, and how many are out at each hour.
// Zones are [x, z, homes, jobs] per lot (homes = dwelling units, jobs = commercial, civic and parking draw), snapped to the
// nearest intersection of the lane graph. Without zones the network itself implies some (local streets house, arterials work).
// Trips are home-to-work/shops in the morning, back in the evening, errands at lunch, plus through traffic between the
// area's edge portals (weighted towards arterials). Pure, no THREE.
const bump = (h, c, w) => { let d = Math.abs(h - c); d = Math.min(d, 24 - d); return Math.exp(-d * d / (2 * w * w)); };

// relative trip rates by hour: H home, J job/commercial, T through
function tripMix(h) {
  return {
    HJ: 0.12 + 1.0 * bump(h, 8, 1.5) + 0.35 * bump(h, 12.5, 2.5) + 0.3 * bump(h, 18.5, 1.5),
    JH: 0.12 + 1.0 * bump(h, 17.3, 1.8) + 0.3 * bump(h, 12.5, 1.5),
    JJ: 0.05 + 0.4 * bump(h, 12.3, 1.2) + 0.2 * bump(h, 15, 2),
    HH: 0.04 + 0.1 * bump(h, 19, 2),
    TT: 0.12 + 0.6 * bump(h, 8, 1.8) + 0.8 * bump(h, 17.3, 2),
  };
}
const PEAK = Object.values(tripMix(17.3)).reduce((a, b) => a + b, 0);
// how busy the roads are against the evening peak (1): about 0.15 at 3 am, a morning shoulder, a lunch bump
function activity(h) { return Math.min(1.1, Object.values(tripMix(h)).reduce((a, b) => a + b, 0) / PEAK); }

const PORTAL_W = [0.05, 0.25, 1.2, 3, 6, 6]; // through traffic uses arterial portals far more than residential ones
const HUB = 200; // destinations are grouped into 200 m cells so route tables are shared

class Pick { // weighted sampler over [item, weight] pairs
  constructor() { this.items = []; this.cum = []; this.total = 0; }
  add(item, w) { if (w > 0) { this.items.push(item); this.cum.push(this.total += w); } }
  sample(r) {
    if (!this.items.length) return null;
    const x = r() * this.total; let lo = 0, hi = this.cum.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (this.cum[m] >= x) hi = m; else lo = m + 1; }
    return this.items[lo];
  }
}

// The largest piece of the lane graph that is strongly connected through one of a few busy seed nodes.
function coreNodes(net, router) {
  const seeds = net.nodes.filter((n) => n.ins.length && n.outs.length).sort((a, b) => (b.rank * 10 + b.legs.length) - (a.rank * 10 + a.legs.length)).slice(0, 6);
  let best = null;
  for (const seed of seeds) {
    const back = router.table(seed), fwd = new Set(), q = [];
    for (const l of seed.outs) { fwd.add(l); q.push(l); }
    while (q.length) { const l = q.pop(); for (const c of l.conns) if (!fwd.has(c.to)) { fwd.add(c.to); q.push(c.to); } }
    const nodes = new Set();
    const leaves = (l) => (l.to === seed || back[l.ix] < Infinity), arrives = (l) => fwd.has(l) && leaves(l);
    for (const n of net.nodes) {
      // an edge portal has no connectors: cars enter on its out lane and leave on its in lane
      if (n.portal ? n.outs.some(leaves) && n.ins.some((l) => fwd.has(l)) : n.outs.some(arrives) && n.ins.some(arrives)) nodes.add(n);
    }
    if (!best || nodes.size > best.size) best = nodes;
  }
  return best && best.size > 2 ? best : null;
}

class Demand {
  constructor(net, zones, router) {
    const ok = router ? coreNodes(net, router) : null; // nodes a car can leave from and come back to (one-way stubs and cut-off pieces never host trips)
    const real = net.nodes.filter((n) => !n.portal && n.ins.length && n.outs.length && (!ok || ok.has(n)));
    const home = new Map(), job = new Map();
    let hz = 0, jz = 0;
    for (const z of zones || []) {
      let best = null, bd = 1e18;
      for (const n of real) { const d = (n.x - z[0]) ** 2 + (n.z - z[1]) ** 2; if (d < bd) { bd = d; best = n; } }
      if (!best || bd > 150 * 150) continue;
      if (z[2] > 0) { home.set(best, (home.get(best) || 0) + z[2]); hz += z[2]; }
      if (z[3] > 0) { job.set(best, (job.get(best) || 0) + z[3]); jz += z[3]; }
    }
    if (!hz && !jz) { // no lots known: local streets are where people live, busier roads where they go
      for (const n of real) {
        if (n.rank <= 1) { home.set(n, n.legs.length * 1.5); hz += n.legs.length * 1.5; }
        else if (n.legs.length >= 3) { job.set(n, 3); jz += 3; }
      }
    }
    this.homes = hz; this.jobs = jz;
    // destination hubs: the heaviest node in each cell stands for the cell
    const cell = new Map(), key = (n) => Math.floor(n.x / HUB) + ',' + Math.floor(n.z / HUB);
    for (const n of new Set([...home.keys(), ...job.keys()])) {
      const k = key(n), w = (home.get(n) || 0) + (job.get(n) || 0), c = cell.get(k);
      if (!c || w > c.w) cell.set(k, { n, w });
    }
    this.homeFrom = new Pick(); this.jobFrom = new Pick(); this.homeTo = new Pick(); this.jobTo = new Pick(); this.portals = new Pick();
    const hubH = new Map(), hubJ = new Map();
    for (const [n, w] of home) { this.homeFrom.add(n, w); const h = cell.get(key(n)).n; hubH.set(h, (hubH.get(h) || 0) + w); }
    for (const [n, w] of job) { this.jobFrom.add(n, w); const h = cell.get(key(n)).n; hubJ.set(h, (hubJ.get(h) || 0) + w); }
    for (const [n, w] of hubH) this.homeTo.add(n, w);
    for (const [n, w] of hubJ) this.jobTo.add(n, w);
    let pw = 0;
    for (const n of net.nodes) if (n.portal && n.ins.length && n.outs.length && (!ok || ok.has(n))) { const w = PORTAL_W[Math.min(5, n.rank)]; this.portals.add(n, w); pw += w; }
    this.portalW = pw;
    // arterial nodes buses run between
    this.stops = new Pick();
    for (const n of real) if (n.rank >= 3 && n.legs.length >= 2) this.stops.add(n, 1);
    // cars on the road at the evening peak: a share of the dwellings and workplaces, plus through traffic
    this.base = 0.035 * hz + 0.012 * jz + 1.0 * pw;
  }
  activity(h) { return activity(h); }
  // cars that should be out at hour h
  want(h) { return this.base * activity(h); }
  _types(h) {
    const m = tripMix(h), P = new Pick();
    if (this.homeFrom.items.length && this.jobTo.items.length) P.add('HJ', m.HJ);
    if (this.jobFrom.items.length && this.homeTo.items.length) P.add('JH', m.JH);
    if (this.jobFrom.items.length && this.jobTo.items.length) P.add('JJ', m.JJ);
    if (this.homeFrom.items.length && this.homeTo.items.length) P.add('HH', m.HH);
    if (this.portals.items.length > 1) P.add('TT', m.TT * Math.min(1.5, this.portalW / 20));
    return P;
  }
  // a whole trip: { origin, dest } as nodes, or null
  pickTrip(h, r) {
    const type = this._types(h).sample(r); if (!type) return null;
    const from = { H: this.homeFrom, J: this.jobFrom, T: this.portals }[type[0]], to = { H: this.homeTo, J: this.jobTo, T: this.portals }[type[1]];
    for (let i = 0; i < 8; i++) {
      const o = from.sample(r), d = to.sample(r);
      if (!o || !d || o === d) continue;
      if (type !== 'TT' && (o.x - d.x) ** 2 + (o.z - d.z) ** 2 < 120 * 120) continue;
      if (type === 'TT' && (o.x - d.x) ** 2 + (o.z - d.z) ** 2 < 300 * 300) continue;
      return { origin: o, dest: d, type };
    }
    return null;
  }
  // a destination for a car that starts at a curb: from home it goes to work, the shops, a neighbour or out of the area
  pickDest(kind, h, r, exclude) {
    const m = tripMix(h), P = new Pick(), out = this.portals.items.length > 1 ? m.TT * 0.6 : 0;
    if (kind === 'H') { P.add(this.jobTo, m.HJ); P.add(this.homeTo, m.HH); } else { P.add(this.homeTo, m.JH); P.add(this.jobTo, m.JJ); }
    P.add(this.portals, out);
    const src = P.sample(r); if (!src) return null;
    for (let i = 0; i < 6; i++) { const d = src.sample(r); if (d && d !== exclude && (!exclude || (d.x - exclude.x) ** 2 + (d.z - exclude.z) ** 2 > 100 * 100)) return d; }
    return null;
  }
  busDest(r, exclude) { for (let i = 0; i < 4; i++) { const d = this.stops.sample(r); if (d && d !== exclude) return d; } return this.stops.sample(r); }
}

export { Demand, activity, tripMix };
