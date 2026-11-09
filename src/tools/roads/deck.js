// Road levels, the small pure part: reading a planned deck. No THREE, no DOM, no engine imports, so the traffic
// worker can use it too. Planning (what is a bridge, how high, what is cut out of the ground) is src/engine/levels.js.
//
// An edge that bridges or tunnels carries `dk`: a list of spans { a, b, L, h, d } with a..b the stations in metres along
// the edge's own path, L the level (1 = bridge, -1 = tunnel) and h the surface height at n evenly spaced stations a..b
// (spacing d). Everywhere else the road follows the ground. `dkp` is the path length the plan was made for, so an edge
// that a later edit reshaped stops claiming a deck it no longer has.

const polyLen = (p) => { let L = 0; for (let i = 1; i < p.length; i++) L += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); return L; };

// the spans of an edge that are still valid for its current path
function spansOf(e) {
  if (!e || !e.dk || !e.dk.length || !e.p) return null;
  return Math.abs(polyLen(e.p) - e.dkp) < 0.6 ? e.dk : null;
}
const spanAt = (spans, s) => { for (const sp of spans) if (s >= sp.a - 1e-6 && s <= sp.b + 1e-6) return sp; return null; };
const levelAt = (spans, s) => spanAt(spans, s)?.L || 0;
function heightIn(sp, s) {
  const f = Math.min(Math.max((s - sp.a) / (sp.d || 1), 0), sp.h.length - 1), i = Math.min(Math.floor(f), sp.h.length - 2);
  return sp.h.length < 2 ? sp.h[0] : sp.h[i] + (sp.h[i + 1] - sp.h[i]) * (f - i);
}
const deckY = (spans, s) => { const sp = spanAt(spans, s); return sp ? heightIn(sp, s) : NaN; };

// nearest point of a path to (x, z): station s along it, distance d, segment index i
function project(p, x, z) {
  let best = { s: 0, d: Infinity, i: 0 }, acc = 0;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0], az = p[i - 1][1], dx = p[i][0] - ax, dz = p[i][1] - az, L2 = dx * dx + dz * dz, L = Math.sqrt(L2);
    const t = L2 ? Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / L2)) : 0, d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best.d) best = { s: acc + t * L, d, i: i - 1 };
    acc += L;
  }
  return best;
}
// surface height of the edge's deck under (x, z), or NaN where the edge runs on the ground
function deckYAt(e, x, z) {
  const spans = spansOf(e); if (!spans) return NaN;
  return deckY(spans, project(e.p, x, z).s);
}
// level of the edge at its start (0) or end (1), as planned for traffic: 0 unless the deck really continues past the node
const endLevel = (e, end) => (end ? e.l1 : e.l0) || 0;

export { deckY, deckYAt, endLevel, heightIn, levelAt, polyLen, project, spanAt, spansOf };
