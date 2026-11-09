"""Cul-de-sac turnaround bulbs, read from the pack's own streets and parcels. Writes pack['bulbs'] = [[x, z, r, node], ...].

A dead-end residential street is a cul-de-sac when the lot-free ground at its end opens into a round bulb that the parcels wrap
around. For each such street end, find the biggest circle (r 8 to 14 m) near the end that overlaps no parcel and has parcels around
most of its rim. Ends that run into one lot, a field or a trail find no such circle and get none, so nothing is invented there.
The game draws each bulb as road with a kerb-side sidewalk ring (src/engine/bulbs.js) while its street still ends at that node.

  python tools/pack/bulbs.py public/areas/<id>.json [more packs]   # retrofit
"""
import json, math, sys
from shapely.geometry import Polygon, Point, LineString
from shapely.ops import unary_union
from shapely.strtree import STRtree

STREET = ('residential', 'unclassified', 'tertiary')
R_MIN, R_MAX = 8.0, 14.0


def infer(pack):
    nodes = pack['nodes']; edges = [e for e in pack['edges'] if e.get('s') not in ('driveway', 'parking_aisle', 'link') and e['c'] != 'motorway']
    deg = {}
    for e in edges:
        for n in (e['a'], e['b']): deg[n] = deg.get(n, 0) + 1
    T = pack['terrain']; x0, z0, x1, z1 = T['minx'] + 25, T['minz'] + 25, T['minx'] + (T['nx'] - 1) * T['cell'] - 25, T['minz'] + (T['nz'] - 1) * T['cell'] - 25
    lots = [Polygon(l['r']).buffer(0) for l in pack['lots'] if len(l['r']) > 2]
    tree = STRtree(lots)
    lines = [(e, LineString(e['p'])) for e in pack['edges'] if e.get('s') != 'parking_aisle' and len(e['p']) > 1]
    out = []
    for e in edges:
        if e['c'] not in STREET: continue
        line = LineString(e['p'])
        if line.length < 35: continue
        for n in (e['a'], e['b']):
            if deg.get(n) != 1: continue
            nx, nz = nodes[n]
            if not (x0 < nx < x1 and z0 < nz < z1): continue
            # direction of travel into the dead end: from 10 m back along the street to the end node
            back = line.interpolate(max(0, (line.project(Point(nx, nz)) - 10) if line.project(Point(nx, nz)) > 5 else 10))
            dx, dz = nx - back.x, nz - back.y; L = math.hypot(dx, dz)
            if L < 3: continue
            dx, dz = dx / L, dz / L; best = None
            for t in [i * 1.0 for i in range(-3, 13)]:
                cx, cz = nx + dx * t, nz + dz * t
                for r in [R_MAX - i * 0.5 for i in range(int((R_MAX - R_MIN) / 0.5) + 1)]:
                    disc = Point(cx, cz).buffer(r, 24)
                    near = [lots[int(i)] for i in tree.query(disc)]
                    if any(p.intersection(disc).area > 0.02 * disc.area for p in near): continue
                    if any(o is not e and o.get('c') != 'motorway' and o.get('s') != 'driveway' and ln.distance(Point(cx, cz)) < r - 0.5 for o, ln in lines if o['id'] != e['id'] and (o['a'] != n and o['b'] != n)): break
                    ring = Point(cx, cz).buffer(r + 8, 24).difference(disc)
                    cover = unary_union([p.intersection(ring) for p in [lots[int(i)] for i in tree.query(ring)]]).area / ring.area
                    if cover >= 0.4 and (best is None or r > best[2] + 0.01): best = (cx, cz, r, cover)
                    break  # the largest r that fits at this centre is enough
            if best: out.append([round(best[0], 1), round(best[1], 1), round(best[2], 1), n])
    return out


def apply(pack):
    pack['bulbs'] = infer(pack)
    return len(pack['bulbs'])


if __name__ == '__main__':
    for path in sys.argv[1:]:
        P = json.load(open(path))
        if 'buildings' not in P: continue
        n = apply(P)
        json.dump(P, open(path, 'w'), separators=(',', ':'))
        print(f'{path}: {n} cul-de-sac bulbs')
