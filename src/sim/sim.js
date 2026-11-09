// Traffic simulation on the lane network from net.js: car following (IDM), turns through
// intersections with signals, stop signs and priority roads, curb parking that fills and empties.
// Pure JS with no THREE and no DOM, so it runs in a Web Worker and in node tests.
import { rng, sampleAt } from './geom.js';
import { stateAt } from './signals.js';
import { deckHeight } from './net.js';

const NO_DECK = -999, CAR_LEN = 4.4, STRIDE = 8; // snapshot per vehicle: id, x, z, heading, vx, vz, look, height of the deck it drives on (NO_DECK = on the ground)
// vehicle kinds: 0 sedan, 1 SUV, 2 pickup, 3 van, 4 bus. A look is colour (0..5) + 8 * kind.
const LENS = [4.4, 4.7, 5.2, 5.0, 10.5];
const kindOf = (look) => Math.floor(look / 8);
const IDM = { a: 2.6, b: 3.4, T: 1.1, s0: 2.0 };
const PARK_TIME = 1.4;
// Junction behaviour (general rules, same at every junction in every area):
const COMFORT = 2.2;      // m/s^2 used to plan slowing for a stop line or a turn
const STOP_OFF = 1.2;     // cars stop about 0.8 m short of the stop line (the virtual wall sits this far past it)
const JERK = 7;           // m/s^3 limit on accel changes, so stop-and-go and braking onsets are smooth
// seconds a conflicting higher-priority car must still be away from the junction before we pull out
const GAP = { S: 3.4, L: 4.2, R: 2.8, U: 4.8 };

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
      c.prev = null; c.hold = false;
      if (c.isConn) { c.plan = seg; seg.reserved++; seg.to.reserved++; c.granted = seg; }
      else { c.plan = null; c.granted = null; c.stopped = false; c.arrive = undefined; c.plan = this.choose(seg); }
      keep.push(c);
    }
    this.cars = keep;
    // parking slots: carry over what still exists, seed the rest
    net.slots.forEach((s, ix) => { s.ix = ix; });
    for (const s of net.slots) {
      const o = oldSlots.get(s.id);
      if (o && (o.state === 1)) { s.state = 1; s.leaveAt = o.leaveAt; s.color = o.color; }
      else if (!old && this.r() < this.parkedShare) { s.state = 1; s.leaveAt = this.t + 5 + this.r() * 200; s.color = this.look(false); }
      else if (old && !o && this.r() < this.parkedShare) { s.state = 1; s.leaveAt = this.t + 5 + this.r() * 200; s.color = this.look(false); }
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
    if (lane.leftOnly && this.r() < 0.75) return false; // a left-turn pocket is short and quiet
    for (const c of lane.cars) if (Math.abs(c.s - s) < 16) return false;
    const look = this.look(lane.rank >= 2), len = LENS[kindOf(look)];
    for (const c of lane.cars) if (Math.abs(c.s - s) < len + 9) return false;
    this.add(lane, s, lane.speed * 0.5, look, 0, 150 + this.r() * 900);
    return true;
  }
  look(bus) { const r = this.r(), k = r < 0.46 ? 0 : r < 0.7 ? 1 : r < 0.82 ? 2 : r < 0.94 ? 3 : bus ? 4 : 0; return Math.floor(this.r() * 6) + 8 * k; }
  add(lane, s, v, color, lat, trip) {
    if (kindOf(color) === 4) trip = 1e9;
    const c = { id: this.nextId++, seg: lane, isConn: false, s, v, len: LENS[kindOf(color)], fac: 0.85 + this.r() * 0.3, color, lat, plan: null, granted: null, stopped: false, arrive: undefined, trip, park: null, i: 0, acc: 0, wait: 0, prev: null, hold: false };
    c.plan = this.choose(lane); lane.cars.push(c); this.cars.push(c); return c;
  }
  choose(lane) {
    const cs = lane.conns; if (!cs.length) return null;
    let tot = 0; const w = cs.map((c) => (tot += ({ S: 4, R: 1.6, L: 1.2, U: 1 }[c.type]) * (1 + c.to.rank * 0.5)));
    const x = this.r() * tot; return cs[w.findIndex((v) => v >= x)] || cs[0];
  }

  // ---------- control ----------
  // signal state of a movement: 0 red, 1 permissive green (yield), 2 protected green, 3 yellow (phasing lives in signals.js)
  sig(conn) { const n = conn.node; return n.sig ? stateAt(n.sig, this.t + n.cycleOff, conn.leg, conn.mv) : 2; }
  yields(f, fd, car, d, k, conn) {
    if (k.pv !== conn.pv) return k.pv > conn.pv;
    const fa = f.arrive ?? Infinity, ca = car.arrive ?? Infinity;
    if (fa !== ca) return fa < ca;
    return fd < d || (fd === d && f.id < car.id);
  }
  // Rearmost point (metres from the lane start) of any car on `tl`, counting a long car that has already moved on into a
  // connector but still overlaps the end of the lane. Short lanes between close junctions need this: without it a follower
  // sees an empty lane and drives into the back of the vehicle ahead.
  tail(tl) {
    let pos = tl.len, v = 0, found = false;
    const r = tl.cars[tl.cars.length - 1]; if (r) { pos = r.s - r.len; v = r.v; found = true; }
    for (const k of tl.conns) { const q = k.cars[k.cars.length - 1]; if (!q) continue; const p = tl.len + q.s - q.len; if (p < pos) { pos = p; v = q.v; found = true; } }
    return found ? { pos, v } : null;
  }
  // The box stays clear: a car only enters when the exit lane has room for its whole length (plus the cars
  // already committed to that lane), so nobody ends up parked inside the junction.
  roomFor(conn, car) {
    const tl = conn.to, t = this.tail(tl);
    const free = t ? t.pos : tl.len;
    const unit = Math.min(car.len + 1.5, tl.len);
    return free - tl.reserved * unit >= Math.min(unit + car.v * 0.4, tl.len);
  }
  // true when no car on `k`'s approach reaches the junction within `need` seconds (a stopped car at the line counts as leaving now; a head car with nowhere to go does not count, so two blocked cars cannot wait on each other)
  gapClear(k, need) {
    const L = k.from.len;
    for (const c of k.from.cars) { if (c.v < 0.5 && (c.i > 0 || c.wait > 4)) continue; if (c.i === 0 && !c.granted && !this.roomFor(k, c)) continue; const d = L - c.s; if (d < 120 && d / Math.max(c.v, 2.5) < need) return false; } // a queue that has stood still is not about to arrive
    return true;
  }
  // a stop sign or an all-way stop: the car must come to rest at the line first
  stopSign(conn) { const n = conn.node; return n.control === 'allway' || (n.control === 'priority' && conn.rank < n.rank && !n.noStop); }
  canGo(conn, car) {
    if (!this.roomFor(conn, car)) return false;
    for (const k of conn.conflicts) if (k.reserved > 0) return false;
    const n = conn.node, need = GAP[conn.type] || GAP.S;
    if (n.control === 'signal') {
      const g = this.sig(conn); if (g !== 1 && g !== 2) return false;
      // a permissive turn gives way to oncoming flow that is also green
      if (g === 1) for (const k of conn.conflicts) if (k.from !== conn.from && (this.sig(k) === 1 || this.sig(k) === 2) && !this.gapClear(k, need)) return false;
    } else if (n.control !== 'none') {
      for (const k of conn.conflicts) if (k.pv > conn.pv && k.from !== conn.from && !this.gapClear(k, need)) return false;
      for (const k of conn.conflicts) {
        const f = k.from.cars[0]; if (!f || f === car || f.granted || f.plan !== k || !this.roomFor(k, f)) continue;
        const fd = k.from.len - f.s;
        if (fd < 28 && this.yields(f, fd, car, car.seg.len - car.s, k, conn)) return false;
      }
    }
    return true;
  }
  mayEnter(conn, car, d) {
    if (this.stopSign(conn)) {
      if (!car.stopped) { if (d < 2.4 && car.v < 0.5) { car.stopped = true; car.arrive = this.t; } else return false; }
    } else if (!car.hold && d > Math.max(10, car.v * car.v / (2 * COMFORT) + 8)) return false; // too early to decide: keep rolling
    if (!this.canGo(conn, car)) { if (!this.stopSign(conn)) car.hold = true; return false; } // once we must brake we keep braking (no flicker)
    conn.reserved++; conn.to.reserved++; car.granted = conn; car.hold = false;
    return true;
  }

  // ---------- one tick ----------
  step(dt) {
    if (!this.net) return;
    this.t += dt;
    for (const seg of this.segs) if (seg.cars.length) { if (seg.cars.length > 1) seg.cars.sort((a, b) => b.s - a.s); for (let i = 0; i < seg.cars.length; i++) seg.cars[i].i = i; }
    // accelerations from the state at the start of the tick
    for (const c of this.cars) {
      const a = this.accel(c);
      // jerk limit smooths stop-and-go; real emergencies (below -6) pass straight through
      c.acc = a < -6 ? a : c.acc + Math.max(-JERK * dt, Math.min(JERK * dt, a - c.acc));
    }
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
            else { const t = this.tail(plan.to); if (t) { gap = d + plan.len + t.pos; vl = t.v; } }
          } else if (c.hold || this.stopSign(plan)) { gap = d + STOP_OFF; vl = 0; } // wall at the stop line
        }
      } else {
        const t = this.tail(seg.to); if (t) { gap = d + t.pos; vl = t.v; }
      }
    }
    let v0 = c.fac * seg.speed;
    if (c.isConn) v0 = Math.min(v0, seg.speed);
    else if (c.plan) { const d = seg.len - c.s; v0 = Math.min(v0, Math.sqrt(c.plan.speed * c.plan.speed + 2 * COMFORT * Math.max(0, d - 1))); } // slow down early to the turn's speed
    if (c.park) {
      if (c.park.phase === 0) { const g2 = c.park.ft - c.s + IDM.s0; if (g2 < gap) { gap = g2; vl = 0; } if (c.s > c.park.ft + 4) { c.park.slot.state = 0; c.park = null; } }
    }
    // speed-target braking is capped at a comfortable rate; only a car ahead can ask for hard braking
    const free = Math.max(-3.2, IDM.a * (1 - Math.pow(c.v / Math.max(v0, 0.5), 4)));
    if (gap < 1e8) {
      const v = c.v, sStar = IDM.s0 + Math.max(0, v * IDM.T + v * (v - vl) / (2 * Math.sqrt(IDM.a * IDM.b)));
      return Math.max(-9, Math.min(IDM.a, free - IDM.a * (sStar / Math.max(gap, 0.1)) ** 2));
    }
    return free;
  }

  advance(c, dead) {
    for (let guard = 0; guard < 3 && c.s >= c.seg.len; guard++) {
      const seg = c.seg;
      if (!c.isConn) {
        if (!c.plan) { dead.push(c); return; }
        if (!c.granted) { c.s = seg.len - 0.05; c.v = 0; return; }
        const conn = c.plan; c.s -= seg.len; seg.cars.splice(seg.cars.indexOf(c), 1);
        c.seg = conn; c.isConn = true; c.prev = seg; c.hold = false; conn.cars.push(c); c.i = conn.cars.length - 1;
      } else {
        const tl = seg.to; seg.reserved--; tl.reserved--; c.s -= seg.len; seg.cars.splice(seg.cars.indexOf(c), 1);
        c.seg = tl; c.isConn = false; c.prev = seg; c.hold = false; tl.cars.push(c); c.i = tl.cars.length - 1;
        c.granted = null; c.stopped = false; c.arrive = undefined; c.plan = this.choose(tl);
        if (c.trip < -200) { dead.push(c); return; }
        if (c.trip <= 0 && !c.park && tl.idx === 0 && tl.slots.length) this.seekSlot(c, 6);
      }
    }
    if (!c.isConn && c.trip <= 0 && !c.park && c.seg.idx === 0 && c.seg.slots.length && this.r() < 0.02) this.seekSlot(c, c.s + 14);
  }
  seekSlot(c, from) {
    const lane = c.seg;
    for (const s of lane.slots) {
      const ft = s.s + c.len / 2;
      if (s.state === 0 && ft >= Math.max(from, c.s + 14) && ft < lane.len - 4) { s.state = 2; c.park = { slot: s, ft, phase: 0, timer: 0 }; return; }
    }
  }
  departures() {
    for (const s of this.net.slots) {
      if (s.state !== 1 || s.leaveAt > this.t) continue;
      const lane = s.lane; let clear = true;
      for (const c of lane.cars) if (c.s > s.s - 18 && c.s - c.len < s.s + 6) { clear = false; break; }
      if (clear && s.s < 40) for (const cn of lane.from.conns) if (cn.to === lane && cn.cars.length) { clear = false; break; } // a car about to enter from the junction
      if (!clear || !lane.conns.length || this.cars.length >= this.target() * 1.1) { s.leaveAt = this.t + 3; continue; }
      s.state = 0;
      this.add(lane, s.s + LENS[kindOf(s.color ?? 0)] / 2, 0, s.color ?? 0, s.lat, 150 + this.r() * 700);
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

  // ---------- output: [id, x, z, heading, vx, vz, colour, deck height] per vehicle ----------
  snapshot() {
    const net = this.net; if (!net) return new Float32Array(0);
    const parked = net.slots.filter((s) => s.state === 1);
    const out = new Float32Array((this.cars.length + parked.length) * STRIDE);
    let o = 0, wait = 0, sum = 0;
    const put = (id, seg, s, lat, v, color) => {
      const p = sampleAt(seg.pts, seg.cum, Math.max(0, s - LENS[kindOf(color)] / 2));
      out[o++] = id; out[o++] = p[0] - p[3] * lat; out[o++] = p[1] + p[2] * lat; out[o++] = Math.atan2(p[2], p[3]); out[o++] = p[2] * v; out[o++] = p[3] * v; out[o++] = color; out[o++] = NO_DECK;
    };
    // A moving car is posed by its two axles, which can lie on different segments (the lane it just left and the
    // connector it is on). That keeps the car continuous across handovers and turns its heading smoothly through a corner.
    const pose = (c) => {
      const len = LENS[kindOf(c.color)], at = (d) => (d >= 0 || !c.prev ? sampleAt(c.seg.pts, c.seg.cum, Math.max(0, d)) : sampleAt(c.prev.pts, c.prev.cum, c.prev.len + d));
      const f = at(c.s - 0.8), r = at(c.s - len + 0.8);
      let dx = f[0] - r[0], dz = f[1] - r[1]; const L = Math.hypot(dx, dz);
      if (L < 0.3) { dx = f[2]; dz = f[3]; } else { dx /= L; dz /= L; }
      const x = (f[0] + r[0]) / 2 - dz * c.lat, z = (f[1] + r[1]) / 2 + dx * c.lat;
      out[o++] = c.id; out[o++] = x; out[o++] = z; out[o++] = Math.atan2(dx, dz); out[o++] = dx * c.v; out[o++] = dz * c.v; out[o++] = c.color; const dy = net.decks?.size ? deckHeight(net, c.seg.eid ?? c.seg.from?.eid, x, z) : NaN; out[o++] = Number.isFinite(dy) ? dy : NO_DECK;
    };
    for (const c of this.cars) { pose(c); sum += c.v; if (c.v < 0.3) wait++; }
    for (const s of parked) put(1e6 + s.ix, s.lane, s.s + LENS[kindOf(s.color ?? 0)] / 2, s.lat, 0, s.color ?? 0);
    this.stats = { moving: this.cars.length, parked: parked.length, waiting: wait, avg: this.cars.length ? sum / this.cars.length : 0, broken: this.broken };
    return out;
  }
}

export { CAR_LEN, LENS, NO_DECK, STRIDE, Sim };
