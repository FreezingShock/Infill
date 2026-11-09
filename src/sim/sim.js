// Traffic simulation on the lane network from net.js: car following (IDM), turns through
// intersections with signals, stop signs and priority roads, curb parking that fills and empties.
// Pure JS with no THREE and no DOM, so it runs in a Web Worker and in node tests.
import { rng, sampleAt } from './geom.js';

const CAR_LEN = 4.4, STRIDE = 7;
const IDM = { a: 2.6, b: 3.4, T: 1.1, s0: 2.0 };
const GREEN = 9, CYCLE = 12;
const PARK_TIME = 1.4;

class Sim {
  constructor(seed = 1) {
    this.r = rng(seed); this.t = 0; this.cars = []; this.nextId = 1; this.net = null;
    this.density = 1; this.maxCars = 900; this.parkedShare = 0.55; this.running = true; this.broken = 0;
    this.stats = { moving: 0, parked: 0, waiting: 0, avg: 0 };
    this._leave = 0;
  }

  // ---------- network swap (street edits keep every car that still has its lane) ----------
  setNet(net) {
    const old = this.net, oldSlots = new Map();
    if (old) for (const s of old.slots) oldSlots.set(s.id, s);
    this.net = net;
    this.segs = [...net.lanes, ...net.connectors];
    // cumulative weights for picking spawn lanes
    this.spawnLanes = net.lanes.filter((l) => l.len > 16); let w = 0; this.spawnW = this.spawnLanes.map((l) => (w += 1 + l.rank) );
    this.portals = this.spawnLanes.filter((l) => l.from.portal);
    // re-seat cars
    const keep = [];
    for (const c of this.cars) {
      const seg = c.isConn ? net.connById.get(c.seg.id) : net.laneById.get(c.seg.id);
      if (!seg || c.park || (c.s > seg.len + 1)) continue;
      c.seg = seg; seg.cars.push(c);
      if (c.isConn) { c.plan = seg; seg.reserved++; seg.to.reserved++; c.granted = seg; }
      else { c.plan = null; c.granted = null; c.stopped = false; c.arrive = undefined; c.plan = this.choose(seg); }
      keep.push(c);
    }
    this.cars = keep;
    // parking slots: carry over what still exists, seed the rest
    for (const s of net.slots) {
      const o = oldSlots.get(s.id);
      if (o && (o.state === 1)) { s.state = 1; s.leaveAt = o.leaveAt; s.color = o.color; }
      else if (!old && this.r() < this.parkedShare) { s.state = 1; s.leaveAt = this.t + 5 + this.r() * 200; s.color = Math.floor(this.r() * 6); }
      else if (old && !o && this.r() < this.parkedShare) { s.state = 1; s.leaveAt = this.t + 5 + this.r() * 200; s.color = Math.floor(this.r() * 6); }
    }
    this.fill(0.8);
  }

  target() { return Math.min(this.maxCars, Math.round(this.net.laneMeters / 34 * this.density)); }
  fill(share) {
    const want = Math.round(this.target() * share);
    for (let i = 0; i < want * 3 && this.cars.length < want; i++) this.spawn(false);
  }
  spawn(atPortal) {
    if (!this.spawnLanes.length) return false;
    let lane, s;
    if (atPortal && this.portals.length) { lane = this.portals[Math.floor(this.r() * this.portals.length)]; s = 1; }
    else { const x = this.r() * this.spawnW.at(-1); let i = this.spawnW.findIndex((w) => w >= x); if (i < 0) i = 0; lane = this.spawnLanes[i]; s = 6 + this.r() * (lane.len - 12); }
    if (!lane.conns.length && !atPortal) return false;
    for (const c of lane.cars) if (Math.abs(c.s - s) < CAR_LEN + 9) return false;
    this.add(lane, s, lane.speed * 0.5, Math.floor(this.r() * 6), 0, 150 + this.r() * 900);
    return true;
  }
  add(lane, s, v, color, lat, trip) {
    const c = { id: this.nextId++, seg: lane, isConn: false, s, v, len: CAR_LEN, fac: 0.85 + this.r() * 0.3, color, lat, plan: null, granted: null, stopped: false, arrive: undefined, trip, park: null, i: 0, acc: 0, wait: 0 };
    c.plan = this.choose(lane); lane.cars.push(c); this.cars.push(c); return c;
  }
  choose(lane) {
    const cs = lane.conns; if (!cs.length) return null;
    let tot = 0; const w = cs.map((c) => (tot += ({ S: 4, R: 1.6, L: 1.2, U: 1 }[c.type]) * (1 + c.to.rank * 0.5)));
    const x = this.r() * tot; return cs[w.findIndex((v) => v >= x)] || cs[0];
  }

  // ---------- control ----------
  green(node, group) {
    const ph = Math.max(1, node.phases), t = (this.t + node.cycleOff) % (ph * CYCLE);
    return Math.floor(t / CYCLE) === group % ph && (t % CYCLE) < GREEN;
  }
  yields(f, fd, car, d, k, conn) {
    if (k.pv !== conn.pv) return k.pv > conn.pv;
    const fa = f.arrive ?? Infinity, ca = car.arrive ?? Infinity;
    if (fa !== ca) return fa < ca;
    return fd < d || (fd === d && f.id < car.id);
  }
  roomFor(conn, car) {
    const tl = conn.to, rear = tl.cars[tl.cars.length - 1];
    const free = rear ? rear.s - rear.len : tl.len;
    const unit = Math.min(CAR_LEN + 1.5, tl.len);
    return free - tl.reserved * unit >= Math.min(unit + car.v * 0.4, tl.len);
  }
  canGo(conn, car) {
    if (!this.roomFor(conn, car)) return false;
    for (const k of conn.conflicts) if (k.reserved > 0) return false;
    const n = conn.node;
    if (n.control === 'signal') { if (!this.green(n, conn.group)) return false; }
    else if (n.control !== 'none') {
      for (const k of conn.conflicts) {
        const f = k.from.cars[0]; if (!f || f === car || f.granted || f.plan !== k || !this.roomFor(k, f)) continue;
        const fd = k.from.len - f.s;
        if (fd < 28 && this.yields(f, fd, car, car.seg.len - car.s, k, conn)) return false;
      }
    }
    return true;
  }
  mayEnter(conn, car, d) {
    const n = conn.node, stop = n.control === 'allway' || (n.control === 'priority' && conn.rank < n.rank && !n.noStop);
    if (stop) {
      if (!car.stopped) { if (d < 3.6 && car.v < 0.35) { car.stopped = true; car.arrive = this.t; } else return false; }
    } else if (d > Math.max(10, car.v * car.v / 6 + 5)) return false;
    if (!this.canGo(conn, car)) return false;
    conn.reserved++; conn.to.reserved++; car.granted = conn;
    return true;
  }

  // ---------- one tick ----------
  step(dt) {
    if (!this.net) return;
    this.t += dt;
    for (const seg of this.segs) if (seg.cars.length) { if (seg.cars.length > 1) seg.cars.sort((a, b) => b.s - a.s); for (let i = 0; i < seg.cars.length; i++) seg.cars[i].i = i; }
    // accelerations from the state at the start of the tick
    for (const c of this.cars) c.acc = this.accel(c);
    const dead = [];
    for (const c of this.cars) {
      if (c.park && c.park.phase === 1) { c.v = 0; c.park.timer += dt; c.lat = c.park.slot.lat * Math.min(1, c.park.timer / PARK_TIME); if (c.park.timer >= PARK_TIME) dead.push(c); continue; }
      c.v = Math.max(0, c.v + c.acc * dt);
      // gridlock breaker: a car stuck for a minute leaves the map instead of freezing the city
      if (c.v < 0.2 && !c.park) { c.wait += dt; if (c.wait > 60) { dead.push(c); this.broken++; continue; } } else c.wait = 0;
      const ds = c.v * dt; c.s += ds; c.trip -= ds;
      if (c.lat) { const m = 1.7 * dt; c.lat = Math.abs(c.lat) <= m ? 0 : c.lat - Math.sign(c.lat) * m; }
      this.advance(c, dead);
    }
    if (dead.length) this.remove(dead);
    // parking: arrivals and departures
    for (const c of this.cars) if (c.park && c.park.phase === 0 && Math.abs(c.park.ft - c.s) < 1.2 && c.v < 0.5) c.park.phase = 1, c.park.timer = 0;
    this._leave -= dt;
    if (this._leave <= 0) { this._leave = 0.5; this.departures(); }
    // keep traffic topped up; a few cars enter from the edges of the area
    const want = this.target();
    for (let k = 0; k < 2 && this.cars.length < want; k++) this.spawn(this.r() < 0.3);
  }

  accel(c) {
    const seg = c.seg;
    let gap = 1e9, vl = 0;
    const prev = c.i > 0 ? seg.cars[c.i - 1] : null;
    if (prev) { gap = prev.s - prev.len - c.s; vl = prev.v; }
    else {
      const d = seg.len - c.s;
      if (!c.isConn) {
        const plan = c.plan;
        if (plan) {
          if (!c.granted && !c.park) this.mayEnter(plan, c, d);
          if (c.granted) {
            const rear = plan.cars[plan.cars.length - 1];
            if (rear) { gap = d + rear.s - rear.len; vl = rear.v; }
            else { const rr = plan.to.cars[plan.to.cars.length - 1]; if (rr) { gap = d + plan.len + rr.s - rr.len; vl = rr.v; } }
          } else { gap = d - 0.6; vl = 0; }
        }
      } else {
        const rr = seg.to.cars[seg.to.cars.length - 1]; if (rr) { gap = d + rr.s - rr.len; vl = rr.v; }
      }
    }
    let v0 = c.fac * seg.speed;
    if (c.isConn) v0 = Math.min(v0, seg.speed);
    else if (c.plan) { const d = seg.len - c.s; v0 = Math.min(v0, Math.sqrt(c.plan.speed * c.plan.speed + 5 * Math.max(0, d - 1))); }
    if (c.park) {
      if (c.park.phase === 0) { const g2 = c.park.ft - c.s + IDM.s0; if (g2 < gap) { gap = g2; vl = 0; } if (c.s > c.park.ft + 4) { c.park.slot.state = 0; c.park = null; } }
    }
    if (gap < 1e8 || c.v > v0) {
      const v = c.v, sStar = IDM.s0 + Math.max(0, v * IDM.T + v * (v - vl) / (2 * Math.sqrt(IDM.a * IDM.b)));
      const a = IDM.a * (1 - Math.pow(v / Math.max(v0, 0.5), 4) - (sStar / Math.max(gap, 0.1)) ** 2);
      return Math.max(-9, Math.min(IDM.a, a));
    }
    return IDM.a * (1 - Math.pow(c.v / Math.max(v0, 0.5), 4));
  }

  advance(c, dead) {
    for (let guard = 0; guard < 3 && c.s >= c.seg.len; guard++) {
      const seg = c.seg;
      if (!c.isConn) {
        if (!c.plan) { dead.push(c); return; }
        if (!c.granted) { c.s = seg.len - 0.05; c.v = 0; return; }
        const conn = c.plan; c.s -= seg.len; seg.cars.splice(seg.cars.indexOf(c), 1);
        c.seg = conn; c.isConn = true; conn.cars.push(c); c.i = conn.cars.length - 1;
      } else {
        const tl = seg.to; seg.reserved--; tl.reserved--; c.s -= seg.len; seg.cars.splice(seg.cars.indexOf(c), 1);
        if (c.trip < -200) { dead.push(c); return; }
        c.seg = tl; c.isConn = false; tl.cars.push(c); c.i = tl.cars.length - 1;
        c.granted = null; c.stopped = false; c.arrive = undefined; c.plan = this.choose(tl);
        if (c.trip <= 0 && !c.park && tl.idx === 0 && tl.slots.length) this.seekSlot(c, 6);
      }
    }
    if (!c.isConn && c.trip <= 0 && !c.park && c.seg.idx === 0 && c.seg.slots.length && this.r() < 0.02) this.seekSlot(c, c.s + 14);
  }
  seekSlot(c, from) {
    const lane = c.seg;
    for (const s of lane.slots) {
      const ft = s.s + CAR_LEN / 2;
      if (s.state === 0 && ft >= Math.max(from, c.s + 14) && ft < lane.len - 4) { s.state = 2; c.park = { slot: s, ft, phase: 0, timer: 0 }; return; }
    }
  }
  departures() {
    for (const s of this.net.slots) {
      if (s.state !== 1 || s.leaveAt > this.t) continue;
      const lane = s.lane; let clear = true;
      for (const c of lane.cars) if (c.s > s.s - 18 && c.s - c.len < s.s + 6) { clear = false; break; }
      if (!clear || !lane.conns.length || this.cars.length >= this.target() * 1.1) { s.leaveAt = this.t + 3; continue; }
      s.state = 0;
      this.add(lane, s.s + CAR_LEN / 2, 0, s.color ?? 0, s.lat, 150 + this.r() * 700);
    }
  }
  remove(dead) {
    const gone = new Set(dead);
    for (const c of dead) {
      const arr = c.seg.cars, i = arr.indexOf(c); if (i >= 0) arr.splice(i, 1);
      if (c.isConn) { c.seg.reserved--; c.seg.to.reserved--; }
      else if (c.granted) { c.granted.reserved--; c.granted.to.reserved--; }
      if (c.park) { const sl = c.park.slot; if (c.park.phase === 1 && c.park.timer >= PARK_TIME) { sl.state = 1; sl.color = c.color; sl.leaveAt = this.t + 25 + this.r() * 170; } else sl.state = 0; }
    }
    this.cars = this.cars.filter((c) => !gone.has(c));
  }

  // ---------- per-street numbers for the info views ----------
  // flow: edgeId -> congestion 0..1.4 (queue length and slowness); curb: edgeId -> share of curb slots taken 0..1
  edgeStats() {
    const flow = {}, curb = {}, slots = {};
    for (const l of this.net.lanes) {
      let used = 0, v = 0; for (const c of l.cars) { used += c.len; v += c.v; }
      const occ = Math.min(1, used / Math.max(l.len, 1)), slow = l.cars.length ? 1 - Math.min(1, v / l.cars.length / Math.max(l.speed * 0.7, 1)) : 0;
      const cong = Math.min(1.4, occ * 2.4 + slow * 0.7 * Math.min(1, occ * 5));
      if (flow[l.eid] === undefined || cong > flow[l.eid]) flow[l.eid] = cong;
      if (l.slots.length) { const e = slots[l.eid] || (slots[l.eid] = [0, 0]); for (const sl of l.slots) { e[1]++; if (sl.state) e[0]++; } }
    }
    for (const id in slots) curb[id] = slots[id][0] / slots[id][1];
    return { flow, curb };
  }

  // ---------- output: [id, x, z, heading, vx, vz, colour] per vehicle ----------
  snapshot() {
    const net = this.net; if (!net) return new Float32Array(0);
    const parked = net.slots.filter((s) => s.state === 1);
    const out = new Float32Array((this.cars.length + parked.length) * STRIDE);
    let o = 0, wait = 0, sum = 0;
    const put = (id, seg, s, lat, v, color) => {
      const p = sampleAt(seg.pts, seg.cum, Math.max(0, s - CAR_LEN / 2));
      out[o++] = id; out[o++] = p[0] - p[3] * lat; out[o++] = p[1] + p[2] * lat; out[o++] = Math.atan2(p[2], p[3]); out[o++] = p[2] * v; out[o++] = p[3] * v; out[o++] = color;
    };
    for (const c of this.cars) { put(c.id, c.seg, c.s, c.lat, c.v, c.color); sum += c.v; if (c.v < 0.3) wait++; }
    for (const s of parked) put(1e6 + net.slots.indexOf(s), s.lane, s.s + CAR_LEN / 2, s.lat, 0, s.color ?? 0);
    this.stats = { moving: this.cars.length, parked: parked.length, waiting: wait, avg: this.cars.length ? sum / this.cars.length : 0, broken: this.broken };
    return out;
  }
}

export { CAR_LEN, STRIDE, Sim };
