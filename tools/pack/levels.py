"""Road levels (bridges, tunnels, stacked roads) read from Overture transportation segments.

Overture marks grade separation two ways, both as fractions of the segment length (`between: [a, b]`, null = whole segment):
  road_flags   [{values: [is_bridge | is_tunnel | is_link | is_covered ...], between}]
  level_rules  [{value: int, between}]       1 = on a bridge or elevated, -1 = tunnel or underpass, 0 = ground
Segments are split at connectors, so a span that crosses over another road runs between two nodes of its own segment.

Each pack edge gets `lv = [[s0, s1, level], ...]` in metres along the edge (in its own direction p[0] -> p[-1]), with level >= 1 for
bridges and <= -1 for tunnels. Absent = at grade. The engine (src/engine/levels.js) turns that into decks, abutments, piers and
separate traffic levels; where a pack has no `lv`, the engine falls back to detecting crossings from the geometry alone.

  python tools/pack/levels.py public/areas/<id>.json [more packs]   # retrofit: re-reads the segments of each pack's box
"""
import json, math, os, sys, tempfile
import numpy as np
import shapely
from shapely.geometry import shape, box, LineString, Point

MIN_SPAN = 2.0  # metres: shorter bits are digitising noise


def _level_of(v):
    return max(-2, min(2, int(v)))


def raw_spans(props, cls, sub):
    """[(f0, f1, level)] as fractions of the segment, in its digitised direction."""
    out = []
    flagged = cls not in ('service', 'unknown')  # parking structures and driveways carry levels that are not roads over roads
    for rf in props.get('road_flags') or []:
        vals = set(rf.get('values') or [])
        b = rf.get('between') or [0.0, 1.0]
        if 'is_bridge' in vals: out.append((b[0], b[1], 1))
        elif 'is_tunnel' in vals and flagged: out.append((b[0], b[1], -1))
    if flagged:
        for lr in props.get('level_rules') or []:
            v = lr.get('value')
            if not v: continue
            b = lr.get('between') or [0.0, 1.0]
            out.append((b[0], b[1], _level_of(v)))
    return out


def merge(spans):
    """Overlapping spans of the same sign join; a higher level wins where they overlap."""
    spans = sorted(spans, key=lambda s: s[0])
    out = []
    for a, b, L in spans:
        if out and (out[-1][2] > 0) == (L > 0) and a <= out[-1][1] + 0.5:
            out[-1][1] = max(out[-1][1], b); out[-1][2] = L if abs(L) > abs(out[-1][2]) else out[-1][2]
        else:
            out.append([a, b, L])
    return out


def part_spans(props, cls, sub, full_len, p0, p1, flip):
    """Spans (metres) for the piece of the segment between station p0 and p1 (metres along the whole segment).
    flip = the pack stores this piece reversed (one-way against the digitised direction)."""
    if full_len <= 0: return []
    res = []
    for f0, f1, L in raw_spans(props, cls, sub):
        a, b = max(f0 * full_len, p0), min(f1 * full_len, p1)
        if b - a >= MIN_SPAN: res.append((a - p0, b - p0, L))
    res = merge(res)
    plen = p1 - p0
    # a span that nearly reaches an end of the piece reaches it: noise at the clip edge must not leave a 1 m gap
    out = []
    for a, b, L in res:
        if a < 1.5: a = 0.0
        if plen - b < 1.5: b = plen
        out.append([round(a, 1), round(b, 1), L])
    if flip: out = [[round(plen - b, 1), round(plen - a, 1), L] for a, b, L in reversed(out)]
    return out


def at_grade(line, lv):
    """The pieces of a line (LineString) that are not on a bridge or in a tunnel."""
    if not lv: return [line]
    from shapely.ops import substring
    out = []; cur = 0.0; L = line.length
    for a, b, _ in sorted(lv):
        if a - cur > 1: out.append(substring(line, cur, a))
        cur = max(cur, b)
    if L - cur > 1: out.append(substring(line, cur, L))
    return out


def local_frame(origin):
    lon0, lat0 = origin
    kx = math.cos(math.radians(lat0)) * 111320; ky = 110540
    def tr(g): return shapely.transform(g, lambda a: np.column_stack([(a[:, 0] - lon0) * kx, -(a[:, 1] - lat0) * ky]))
    return tr


def apply(pack, seg_path, log=print):
    """Write `lv` on the pack's edges from a segments geojson (a fetch of transportation/segment for the pack's box)."""
    W, S, E, N = pack['bbox']
    tr = local_frame(pack['origin'])
    clip = tr(box(W, S, E, N))
    seg = json.load(open(seg_path))
    byKey = {}
    for e in pack['edges']:
        e.pop('lv', None)
        k = tuple((round(p[0], 1), round(p[1], 1)) for p in e['p'])
        byKey[k] = e; byKey[k[::-1]] = e
    hit = 0; spans = 0
    for f in seg['features']:
        p = f['properties']; cls = p.get('class')
        if not (p.get('road_flags') or p.get('level_rules')): continue
        full = tr(shape(f['geometry']))
        if full.geom_type != 'LineString' or full.length < 1: continue
        g = full.intersection(clip)
        if g.is_empty: continue
        for part in (list(g.geoms) if hasattr(g, 'geoms') else [g]):
            if part.geom_type != 'LineString' or part.length < 1: continue
            pts = [(round(a, 1), round(b, 1)) for a, b in part.coords]
            e = byKey.get(tuple(pts))
            if not e: continue
            fwd = tuple(map(tuple, e['p'])) == tuple(pts)  # the edge runs the way this piece was cut
            s0 = full.project(Point(part.coords[0])); s1 = full.project(Point(part.coords[-1]))
            plen = part.length; lo = min(s0, s1)
            sp = part_spans(p, cls, p.get('subclass'), full.length, lo, lo + plen, flip=(s1 < s0) != (not fwd))  # spans are measured along the segment; the edge may run against it
            if sp:
                e['lv'] = sp; hit += 1; spans += len(sp)
    log(f'levels: {spans} bridge/tunnel spans on {hit} streets')
    return hit


def retrofit(path, log=print):
    here = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, here)
    import ov
    pack = json.load(open(path))
    W, S, E, N = pack['bbox']; pad = 0.0006
    with tempfile.TemporaryDirectory() as d:
        seg = os.path.join(d, 'seg.geojson')
        ov.fetch('transportation', 'segment', seg, (W - pad, S - pad, E + pad, N + pad))
        n = apply(pack, seg, log)
    json.dump(pack, open(path + '.tmp', 'w'), separators=(',', ':')); os.replace(path + '.tmp', path)
    return n


if __name__ == '__main__':
    for p in sys.argv[1:]:
        print(p); retrofit(p)
