"""Measured right-of-way width per street: edge['rw'] = metres between the parcels on either side (median along the street).

The parcels stop where the public right of way begins, so the gap between them is the real kerb-to-property-line width: road plus
parkway plus sidewalk. The game fills the gap with a sidewalk and a planted parkway instead of leaving bare ground beside a
fixed-width street. Only streets with parcels on both sides get a value (12 to 20 m kept); others keep the standard section.

  python tools/pack/rowwidth.py public/areas/<id>.json [more packs]   # retrofit
"""
import json, math, statistics, sys
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

LOCAL = ('residential', 'unclassified', 'tertiary')


def _hit(p, nx, nz, boundary, reach=20.0):
    seg = LineString([(p.x, p.y), (p.x + nx * reach, p.y + nz * reach)])
    x = seg.intersection(boundary)
    return None if x.is_empty else x.distance(p)


def infer(pack):
    lots = [Polygon(l['r']).buffer(0) for l in pack['lots'] if len(l['r']) > 2]
    boundary = unary_union(lots).boundary
    out = {}
    for e in pack['edges']:
        if e['c'] not in LOCAL or e.get('s') in ('driveway', 'parking_aisle', 'link') or e.get('ow'): continue
        ln = LineString(e['p'])
        if ln.length < 30: continue
        gaps = []
        for t in range(6, int(ln.length) - 5, 8):
            p, q = ln.interpolate(t), ln.interpolate(t + 1); dx, dz = q.x - p.x, q.y - p.y; L = math.hypot(dx, dz) or 1
            l, r = _hit(p, -dz / L, dx / L, boundary), _hit(p, dz / L, -dx / L, boundary)
            if l is not None and r is not None: gaps.append(l + r)   # both sides must have a parcel, or it is a field or a gap
        if len(gaps) >= 3:
            rw = statistics.median(gaps)
            if 12 <= rw <= 20: out[e['id']] = round(rw, 1)
    return out


def apply(pack):
    per = infer(pack)
    for e in pack['edges']:
        e.pop('rw', None)
        if e['id'] in per: e['rw'] = per[e['id']]
    return len(per)


if __name__ == '__main__':
    for path in sys.argv[1:]:
        P = json.load(open(path))
        if 'buildings' not in P: continue
        n = apply(P)
        json.dump(P, open(path, 'w'), separators=(',', ':'))
        print(f'{path}: right-of-way width on {n} streets')
