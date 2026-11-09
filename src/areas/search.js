// "Load any spot" search: suggestions as you type. Pure (no DOM, no THREE) so node tests cover it.
// Instant and offline: built areas, named arterials from the Valley map (valley.map.json), intersections computed from
// those streets ("Reseda Blvd & Sherman Way"), and plain coordinates. Online, behind a short pause: house addresses and
// places from Photon (OpenStreetMap data, built for search-as-you-type). Local results always show, even offline.
const ABBR = { boulevard: 'blvd', street: 'st', avenue: 'ave', road: 'rd', drive: 'dr', lane: 'ln', place: 'pl', court: 'ct', highway: 'hwy', parkway: 'pkwy', freeway: 'fwy', terrace: 'ter', circle: 'cir', north: 'n', south: 's', east: 'e', west: 'w', saint: 'st', mount: 'mt' };
const CLASS_RANK = { m: 0, t: 1, p: 2, s: 3, r: 4 };

/** "Reseda Boulevard" and "reseda blvd." both become "reseda blvd". */
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[.,'`]/g, ' ').replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/).filter(Boolean).map((w) => ABBR[w] || w).join(' ');
}

/** Every query word must start some word of the name. Returns a rank (lower is better) or -1. */
function rank(key, q) {
  if (!q) return -1;
  if (key === q) return 0;
  if (key.startsWith(q)) return 1;
  const kt = key.split(' '), qt = q.split(' '), used = new Set();
  for (const t of qt) { const i = kt.findIndex((w, j) => !used.has(j) && w.startsWith(t)); if (i < 0) return -1; used.add(i); }
  return 2;
}

/** Groups the map's named pieces by street name. roads: [{ n, c, l: [flat lon/lat arrays] }]. */
export function streetIndex(roads) {
  const by = new Map();
  for (const r of roads || []) {
    const key = norm(r.n); if (!key) continue;
    let s = by.get(key); if (!s) by.set(key, (s = { name: r.n, key, c: r.c, lines: [], len: 0 }));
    if (CLASS_RANK[r.c] < CLASS_RANK[s.c]) s.c = r.c;
    for (const f of r.l) { const b = [Infinity, Infinity, -Infinity, -Infinity]; for (let i = 0; i < f.length; i += 2) { b[0] = Math.min(b[0], f[i]); b[1] = Math.min(b[1], f[i + 1]); b[2] = Math.max(b[2], f[i]); b[3] = Math.max(b[3], f[i + 1]); } s.lines.push({ f, b }); s.len += f.length; }
  }
  return [...by.values()];
}

const cross = (ax, ay, bx, by) => ax * by - ay * bx;
/** Where two segments meet, as a fraction along the first, or null. */
function segHit(p, p2, q, q2) {
  const rx = p2[0] - p[0], ry = p2[1] - p[1], sx = q2[0] - q[0], sy = q2[1] - q[1], d = cross(rx, ry, sx, sy);
  if (Math.abs(d) < 1e-14) return null;
  const t = cross(q[0] - p[0], q[1] - p[1], sx, sy) / d, u = cross(q[0] - p[0], q[1] - p[1], rx, ry) / d;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [p[0] + rx * t, p[1] + ry * t] : null;
}

/** Points where street A crosses street B (lon/lat), merged when within about 90 m. */
export function intersections(A, B, limit = 6) {
  const out = [];
  for (const la of A.lines) for (const lb of B.lines) {
    if (la.b[0] > lb.b[2] || lb.b[0] > la.b[2] || la.b[1] > lb.b[3] || lb.b[1] > la.b[3]) continue;
    for (let i = 0; i + 3 < la.f.length; i += 2) {
      const p = [la.f[i], la.f[i + 1]], p2 = [la.f[i + 2], la.f[i + 3]];
      for (let j = 0; j + 3 < lb.f.length; j += 2) {
        const h = segHit(p, p2, [lb.f[j], lb.f[j + 1]], [lb.f[j + 2], lb.f[j + 3]]);
        if (h && !out.some((o) => Math.abs(o[0] - h[0]) < 0.001 && Math.abs(o[1] - h[1]) < 0.0008)) out.push(h);
      }
    }
  }
  return out.slice(0, limit);
}

/** The point on a street nearest a reference spot (a vertex is close enough to centre a 1 km box). */
export function nearestPoint(s, ref) {
  let best = null, bd = Infinity;
  for (const { f } of s.lines) for (let i = 0; i < f.length; i += 2) { const d = (f[i] - ref[0]) ** 2 + ((f[i + 1] - ref[1]) * 1.2) ** 2; if (d < bd) { bd = d; best = [f[i], f[i + 1]]; } }
  return best;
}

const SPLIT = /\s*(?:&|@|\/|\band\b|\bat\b|\bcross\b|\bnear\b)\s*/i;
const COORD = /^\s*(-?\d{1,3}\.\d{2,})\s*[,;\s]\s*(-?\d{1,3}\.\d{2,})\s*$/;
const short = (n) => String(n).replace(/\b(Boulevard|Street|Avenue|Road|Drive|Lane|Place|Court)\b/g, (m) => ABBR[m.toLowerCase()].replace(/^./, (c) => c.toUpperCase()));

/**
 * Instant suggestions. ctx: { areas, streets (from streetIndex), region: {bbox}, center: [lon, lat] }.
 * Each: { kind: 'area'|'street'|'cross'|'coord', label, sub, lon, lat, areaId? }.
 */
export function searchLocal(query, ctx, limit = 8) {
  const q = norm(query), out = [], raw = String(query || '');
  if (q.length < 2) return out;
  const m = COORD.exec(raw);
  if (m) {
    let a = +m[1], b = +m[2]; if (Math.abs(a) > 90 || (a < 0 && b > 0)) [a, b] = [b, a]; // accept "lon, lat" too
    const r = ctx.region?.bbox;
    if (!r || (b >= r[0] && b <= r[2] && a >= r[1] && a <= r[3])) out.push({ kind: 'coord', label: `${a.toFixed(5)}, ${b.toFixed(5)}`, sub: 'Coordinates', lon: b, lat: a });
    return out;
  }
  const parts = raw.split(SPLIT).map(norm).filter(Boolean);
  if (parts.length === 2) {
    const pick = (p) => ctx.streets.map((s) => [rank(s.key, p), s]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || CLASS_RANK[a[1].c] - CLASS_RANK[b[1].c]).slice(0, 4).map((x) => x[1]);
    const As = pick(parts[0]), Bs = pick(parts[1]);
    for (const A of As) for (const B of Bs) {
      if (A === B) continue;
      for (const [lon, lat] of intersections(A, B, 3)) out.push({ kind: 'cross', label: `${short(A.name)} & ${short(B.name)}`, sub: 'Intersection', lon, lat });
      if (out.length >= limit) return out.slice(0, limit);
    }
  }
  const areas = (ctx.areas || []).map((a) => [rank(norm(a.name), q), a]).filter(([r, a]) => r >= 0 && a.bbox).sort((a, b) => a[0] - b[0]);
  for (const [, a] of areas.slice(0, 3)) out.push({ kind: 'area', label: a.name, sub: a.status === 'ready' ? (a.custom ? 'Your area' : 'Built area') : 'Planned area', lon: (a.bbox[0] + a.bbox[2]) / 2, lat: (a.bbox[1] + a.bbox[3]) / 2, areaId: a.id });
  const ref = ctx.center || [(ctx.region.bbox[0] + ctx.region.bbox[2]) / 2, (ctx.region.bbox[1] + ctx.region.bbox[3]) / 2];
  const sts = ctx.streets.map((s) => [rank(s.key, q), s]).filter(([r]) => r >= 0).sort((a, b) => a[0] - b[0] || CLASS_RANK[a[1].c] - CLASS_RANK[b[1].c] || b[1].len - a[1].len);
  for (const [, s] of sts.slice(0, limit)) { const p = nearestPoint(s, ref); if (p) out.push({ kind: 'street', label: s.name, sub: { m: 'Freeway', t: 'Highway', p: 'Major street', s: 'Street', r: 'Street' }[s.c], lon: p[0], lat: p[1] }); }
  return out.slice(0, limit);
}

/** Turns a Photon (komoot) GeoJSON feature into a suggestion. */
export function fromPhoton(f) {
  const p = f.properties || {}, [lon, lat] = f.geometry?.coordinates || [];
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const street = p.street || (p.osm_key === 'highway' ? p.name : ''), num = p.housenumber;
  const head = num && street ? `${num} ${street}` : p.name || street; if (!head) return null;
  const where = [p.district || p.locality, p.city || p.county, p.postcode].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
  return { kind: num ? 'address' : p.osm_key === 'highway' ? 'street' : 'place', label: head, sub: where || 'Place', lon, lat };
}

/** Online lookup. bbox is the Valley; near biases results toward the map's centre. Rejects on network errors. */
export async function photon(query, { bbox, near, signal, fetchImpl = globalThis.fetch, limit = 6 } = {}) {
  const u = new URL('https://photon.komoot.io/api/'); u.searchParams.set('q', `${query}`); u.searchParams.set('limit', String(limit)); u.searchParams.set('lang', 'en');
  if (bbox) u.searchParams.set('bbox', bbox.join(','));
  if (near) { u.searchParams.set('lon', String(near[0])); u.searchParams.set('lat', String(near[1])); }
  const r = await fetchImpl(u, { signal, headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`Search service said ${r.status}`);
  return ((await r.json()).features || []).map(fromPhoton).filter(Boolean);
}

/** Local first, then online ones that are not the same place (within ~120 m, or the same label). */
export function mergeSuggestions(local, remote, limit = 9) {
  const out = [...local];
  for (const r of remote) if (!out.some((o) => o.label.toLowerCase() === r.label.toLowerCase() || (Math.abs(o.lon - r.lon) < 0.0013 && Math.abs(o.lat - r.lat) < 0.0011 && o.kind !== 'street'))) out.push(r);
  return out.slice(0, limit);
}

/** A tidy default name for a new area from a suggestion. */
export function nameFor(s) {
  if (s.kind === 'area') return s.label;
  if (s.kind === 'cross') return s.label.split(' & ')[0].replace(/\s+(Blvd|St|Ave|Rd|Dr|Way|Ln|Pl)$/i, '');
  if (s.kind === 'address') return String(s.label).replace(/^\d+\s+/, '').replace(/\s+(Boulevard|Blvd|Street|St|Avenue|Ave|Road|Rd|Drive|Dr)$/i, '');
  if (s.kind === 'coord') return 'New area';
  return String(s.label).replace(/\s+(Boulevard|Blvd|Street|St|Avenue|Ave|Road|Rd|Drive|Dr)$/i, '');
}
