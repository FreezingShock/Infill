// Route choice on the lane graph: a cost-to-go table per destination (reverse Dijkstra), then each car picks the
// connector with the cheapest remainder at every intersection. Costs are travel time with a road-class preference
// (people like fast arterials and stroads), turn and signal delay, and a penalty for leaving an arterial onto a
// residential street, so cut-throughs only win when the destination really is down that street. Pure, no THREE.
const PREF = [0.35, 0.55, 0.85, 1, 1.1, 1.15]; // how much drivers like a class, by RANK (service .. motorway)
const TURN = { S: 0, R: 2.5, L: 5, U: 30 };
const SIGNAL = { S: 7, R: 3, L: 9, U: 9 }, YIELD = { S: 6, R: 4, L: 10, U: 10 }, STOP = 4;
const LEAVE_ARTERIAL = 18; // seconds of detour a driver will accept to avoid turning onto a residential street

const laneCost = (l) => l.len / (Math.max(l.speed, 3) * PREF[Math.min(5, Math.max(0, l.rank))]);
function connCost(c) {
  const n = c.node; let t = TURN[c.type] ?? 0;
  if (n.control === 'signal') t += SIGNAL[c.type] ?? 0;
  else if (n.control === 'allway') t += STOP;
  else if (n.control === 'priority' && c.rank < n.rank && !n.noStop) t += YIELD[c.type] ?? 0;
  if (c.to.rank <= 1 && c.from.rank >= 2) t += LEAVE_ARTERIAL;
  if (c.to.rank === 0 && c.from.rank > 0) t += 40; // alleys and service drives only for the last stretch
  return t;
}

class Heap { // min-heap of (key, value) pairs
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(k, v) {
    const K = this.k, V = this.v; let i = K.length; K.push(k); V.push(v);
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; K[i] = K[p]; V[i] = V[p]; i = p; }
    K[i] = k; V[i] = v;
  }
  pop() {
    const K = this.k, V = this.v, k0 = K[0], v0 = V[0], k = K.pop(), v = V.pop(), n = K.length;
    if (n) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= k) break; K[i] = K[c]; V[i] = V[c]; i = c; }
      K[i] = k; V[i] = v;
    }
    this.out = k0; return v0;
  }
}

class Router {
  constructor(net) {
    this.net = net; this.tabs = new Map();
    net.lanes.forEach((l, i) => { l.ix = i; l.rc = laneCost(l); });
    this.preds = net.lanes.map(() => []);
    for (const c of net.connectors) { c.rc = connCost(c); this.preds[c.to.ix].push(c); }
  }
  // seconds to reach `dest` from the END of each lane (Infinity where it cannot)
  table(dest) {
    let t = this.tabs.get(dest.id); if (t) return t;
    const lanes = this.net.lanes, tab = new Float64Array(lanes.length).fill(Infinity), h = new Heap();
    for (const l of dest.ins) { tab[l.ix] = 0; h.push(0, l.ix); }
    while (h.size) {
      const ix = h.pop(), d = h.out; if (d > tab[ix]) continue;
      const lane = lanes[ix];
      for (const c of this.preds[ix]) {
        const nd = d + lane.rc + c.rc, f = c.from.ix;
        if (nd < tab[f]) { tab[f] = nd; h.push(nd, f); }
      }
    }
    this.tabs.set(dest.id, t = tab); return t;
  }
  // the connector with the cheapest remainder; `r` adds a little driver taste so routes spread across near-equal options
  next(lane, tab, r) {
    let best = null, bs = Infinity;
    for (const c of lane.conns) {
      const v = tab[c.to.ix]; if (v === Infinity) continue;
      const s = (c.rc + c.to.rc + v) * (1 + 0.1 * r());
      if (s < bs) { bs = s; best = c; }
    }
    return best;
  }
  // best lane leaving a node towards the destination
  bestOut(node, tab) {
    let best = null, bs = Infinity;
    for (const l of node.outs) { const v = tab[l.ix]; if (v === Infinity) continue; const s = l.rc + v; if (s < bs) { bs = s; best = l; } }
    return best;
  }
}

export { Router, connCost, laneCost };
