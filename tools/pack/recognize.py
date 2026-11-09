#!/usr/bin/env python3
"""Land-cover recognition on a built pack: find surface parking lots that no map layer drew.

The mapped parking polygons (Overture, from OpenStreetMap) miss many lots. Three signals say "this open
ground behind the buildings is paved":
  1. service roads / parking aisles that run through a lot (Overture transportation) -> strongest;
  2. a commercial lot (mapped use or C/M zoning) with a big open area left after its buildings;
  3. an apartment or civic lot with aisles through its open ground (never from area alone: yards exist).
The recognised polygons go to `pack['parkingInf']`; the game paves and stripes them exactly like mapped lots,
and metrics/traffic read their stalls from the same lot.pk rings. Idempotent: it rebuilds parkingInf each run.

    python tools/pack/recognize.py public/areas/wh-topanga.json [more packs...]     # retrofit existing packs
pack2.py calls infer() itself when it builds a pack.
"""
import json, sys
from shapely.geometry import LineString, Polygon
from shapely.ops import unary_union
from shapely import STRtree

MIN_OPEN = 140        # m2 of open ground worth looking at
MIN_COMMERCIAL = 220  # m2 for a lot with no aisle evidence
EDGE_MARGIN = 1.5     # green strip kept at the lot edge
AISLE_REACH = 9.0     # a parking bay is about 5.5 m deep beside an aisle: only ground this close to an aisle is paved
MAX_BLOCK = 2500      # m2: no single recognised lot is bigger than this (real lots with this much are mapped)
MAX_UNBACKED = 1400   # m2 for a lot recognised with no aisle at all
BUILD_BUFFER = 1.2    # walkway room around a building


def _polys(g):
    return [q for q in (g.geoms if hasattr(g, 'geoms') else [g]) if q.geom_type == 'Polygon']


def infer(pack):
    """Returns (rings, per-lot m2 dict). Does not modify the pack."""
    B = [Polygon(b['r']).buffer(0) for b in pack['buildings']]
    mapped = unary_union([Polygon(r).buffer(0) for r in pack['parking']]) if pack['parking'] else Polygon()
    aisle, other = [], []
    for e in pack['edges']:
        if e['c'] != 'service' or e.get('n'): continue
        (other if e.get('s') in ('driveway', 'alley') else aisle).append(LineString(e['p']))
    roads = [LineString(e['p']).buffer(e['w'] / 2, cap_style=2) for e in pack['edges'] if e['c'] == 'service' and e.get('n') is None]
    roads = unary_union(roads) if roads else Polygon()
    reach = unary_union([l.buffer(AISLE_REACH) for l in aisle]) if aisle else Polygon()
    atree = STRtree(aisle) if aisle else None
    out, per = [], {}
    lots = [(lot, Polygon(lot['r']).buffer(0)) for lot in pack['lots'] if lot['lt'] in ('main', 'apts', 'multi', 'civic')]
    # Back lots serve several frontages, so look at groups of touching lots of one family, not at single lots.
    fam = lambda lt: 'main' if lt == 'main' else 'res' if lt in ('apts', 'multi') else 'civic'
    tree = STRtree([g for _, g in lots]); parent = list(range(len(lots)))
    def find(i):
        while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
        return i
    for i, (lot, g) in enumerate(lots):
        for j in tree.query(g.buffer(1.0)):
            j = int(j)
            if j != i and fam(lots[j][0]['lt']) == fam(lot['lt']) and lots[j][1].distance(g) < 1.0: parent[find(i)] = find(j)
    groups = {}
    for i in range(len(lots)): groups.setdefault(find(i), []).append(i)
    for idx in groups.values():
        kind = fam(lots[idx[0]][0]['lt'])
        gu = unary_union([lots[i][1] for i in idx])
        keys = [k for i in idx for k in lots[i][0]['b'] + lots[i][0].get('sh', [])]
        blds = unary_union([B[k] for k in set(keys)]).buffer(BUILD_BUFFER) if keys else Polygon()
        free = gu.difference(blds).difference(mapped.buffer(0.5)).buffer(-2.0).buffer(2.0)  # drop thin strips; aisles stay inside, they are drawn as roads
        for q in _polys(free):
            if q.area < MIN_OPEN: continue
            ev = 0.0
            if atree is not None:
                zone = q.buffer(3)
                ev = sum(aisle[int(k)].intersection(zone).length for k in atree.query(zone))
            if ev >= 15:
                q = q.intersection(reach)  # only the bays beside real aisles, never the hillside or lawn around them
                q = q.buffer(-1.0).buffer(1.0)
            elif kind == 'main' and MIN_COMMERCIAL <= q.area <= MAX_UNBACKED and q.area / max(q.length, 1) ** 2 > 0.03 and q.area <= 0.65 * gu.area:
                pass  # compact open ground behind a commercial frontage, no aisle mapped
            else:
                continue
            for part in _polys(q):
                for r in _polys(part.buffer(-EDGE_MARGIN).difference(roads)):
                    if r.area < 40 or r.area > MAX_BLOCK: continue
                    r = r.simplify(0.3); out.append([[round(x, 1), round(z, 1)] for x, z in list(r.exterior.coords)[:-1]])
                    for i in idx:
                        ar = lots[i][1].intersection(r).area
                        if ar > 5: per[lots[i][0]['id']] = per.get(lots[i][0]['id'], 0) + round(ar)
    return out, per


def apply(pack):
    rings, per = infer(pack)
    pack['parkingInf'] = rings
    for lot in pack['lots']:
        lot.pop('pvi', None)
        if lot['id'] in per: lot['pvi'] = round(per[lot['id']] / max(lot['m2'], 1), 2)
    return len(rings), sum(per.values())


if __name__ == '__main__':
    for path in sys.argv[1:]:
        P = json.load(open(path))
        if 'buildings' not in P: continue  # not a pack (other tools keep side files here)
        n, m2 = apply(P)
        json.dump(P, open(path, 'w'), separators=(',', ':'))
        print(f'{path}: {n} recognised lots, {m2} m2 of paving added')
