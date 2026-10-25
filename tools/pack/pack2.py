# Area pack v2 for the Renovated builder preview.
# Input: v1 pack.json (terrain, roads, buildings, estimated lots) + Overture base layers
# (infrastructure: parking polygons and street props; land_use). Output adds a road graph,
# blocks, lot types, simplified zones, frontage and street-facing direction per lot.
# When county parcels become reachable, replace the `lots` step with Assessor parcels.
import json, math, sys, hashlib
import numpy as np, shapely
from shapely.geometry import shape, Polygon, LineString, Point, box
from shapely.ops import unary_union, polygonize, nearest_points
from shapely import STRtree

V1, INFRA, LU, OUT = sys.argv[1:5]
P = json.load(open(V1))
lon0, lat0 = P['origin']; W, S, E, N = P['bbox']
KX = math.cos(math.radians(lat0)) * 111320; KY = 110540
tr = lambda g: shapely.transform(g, lambda a: np.column_stack([(a[:, 0] - lon0) * KX, -(a[:, 1] - lat0) * KY]))
clip = tr(box(W, S, E, N))
T = P['terrain']; HG = np.array(T['h'], float).reshape(T['nz'], T['nx']) / 10
def elev(x, z):
    fx = (x - T['minx']) / T['cell']; fz = (z - T['minz']) / T['cell']
    i = min(max(int(fx), 0), T['nx'] - 2); j = min(max(int(fz), 0), T['nz'] - 2); dx = min(max(fx - i, 0), 1); dz = min(max(fz - j, 0), 1)
    return HG[j, i] * (1 - dx) * (1 - dz) + HG[j, i + 1] * dx * (1 - dz) + HG[j + 1, i] * (1 - dx) * dz + HG[j + 1, i + 1] * dx * dz
def h32(s): return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)
R = lambda v: round(float(v), 1)
ring = lambda g: [[R(a), R(b)] for a, b in list(g.exterior.coords)[:-1]]

# ---------- road graph ----------
nodes = {}; node_list = []
def node(pt):
    k = (round(pt[0] * 2) / 2, round(pt[1] * 2) / 2)
    if k not in nodes: nodes[k] = len(node_list); node_list.append([R(pt[0]), R(pt[1])])
    return nodes[k]
edges = []
for i, r in enumerate(P['roads']):
    a = node(r['p'][0]); b = node(r['p'][-1])
    g = r['c'] not in ('service', 'unknown') or r.get('s') == 'alley'
    edges.append({'id': f'E{i}', 'a': a, 'b': b, 'p': r['p'], 'c': r['c'], 's': r.get('s'), 'n': r.get('n'), 'w': r['w'], 'g': 1 if g else 0})
graph = [e for e in edges if e['g'] and e['c'] != 'motorway']
glines = [LineString(e['p']) for e in graph]
gtree = STRtree(glines)

# ---------- blocks (faces of the graph minus right-of-way) ----------
blines = [LineString(e['p']) for e in edges if e['g']]
polys = list(polygonize(unary_union(blines + [clip.exterior])))
roadbuf = unary_union([LineString(e['p']).buffer(e['w'] / 2 + 1.5, cap_style=2) for e in edges if e['g']])
blocks = []
for pg in polys:
    b = pg.difference(roadbuf)
    for q in (b.geoms if hasattr(b, 'geoms') else [b]):
        if q.geom_type == 'Polygon' and q.area > 150: blocks.append(q.simplify(0.4))
btree = STRtree(blocks)

# ---------- extra layers ----------
inf = json.load(open(INFRA))['features']
parking = [tr(shape(f['geometry'])).buffer(0) for f in inf if f['properties'].get('class') == 'parking' and f['geometry']['type'] == 'Polygon']
parking = [p.intersection(clip) for p in parking if p.area > 30]
PROPK = {'traffic_signals': 'signal', 'street_lamp': 'lamp', 'bus_stop': 'bus', 'bench': 'bench', 'power_pole': 'pole', 'waste_basket': 'bin', 'bicycle_parking': 'bike'}
props = []
for f in inf:
    k = PROPK.get(f['properties'].get('class'))
    if k and f['geometry']['type'] == 'Point':
        x, z = tr(shape(f['geometry'])).coords[0]
        if clip.contains(Point(x, z)): props.append([k, R(x), R(z)])
lu = []
for f in json.load(open(LU))['features']:
    g = tr(shape(f['geometry'])).buffer(0).intersection(clip)
    for q in (g.geoms if hasattr(g, 'geoms') else [g]):
        if q.geom_type == 'Polygon' and q.area > 200: lu.append({'k': f['properties'].get('class'), 'g': q})

# ---------- lots: City of LA parcels (with county AIN) when given, else v1 estimates ----------
REAL = len(sys.argv) > 5
if REAL:
    PARC, ZON, GPL, ADDR, PERMITS = sys.argv[5], sys.argv[6], sys.argv[7], sys.argv[8], sys.argv[9:]
    rb = roadbuf.buffer(0)
    groups = {}
    for k, f in enumerate(json.load(open(PARC))['features']):
        pr = f['properties']; key = pr.get('bpp') if (pr.get('bpp') or '').isdigit() else f'pin{pr.get("pind") or k}'
        groups.setdefault(key, {'g': [], 'pins': set()})
        groups[key]['g'].append(tr(shape(f['geometry'])).buffer(0)); groups[key]['pins'].add((pr.get('pin') or '').replace(' ', ''))
    adr = {}
    for x in json.load(open(ADDR)):
        if x.get('asgn_stts_ind', 'A') != 'A' or not x.get('hse_nbr'): continue
        st = ' '.join(w.capitalize() for w in [x.get('str_nm', ''), x.get('str_sfx_cd', '')] if w)
        adr.setdefault(x['pin'].replace(' ', ''), []).append(f"{x['hse_nbr']} {st}")
    ZP = [(tr(shape(f['geometry'])).buffer(0), f['properties']['zone_cmplt']) for f in json.load(open(ZON))['features']]
    GP = [(tr(shape(f['geometry'])).buffer(0), f['properties']['gplu_desc']) for f in json.load(open(GPL))['features']]
    zt = STRtree([z[0] for z in ZP]); gt = STRtree([z[0] for z in GP])
    newb = {}
    for fn in PERMITS:
        for x in json.load(open(fn)):
            if 'CofO Issued' not in (x.get('status_desc') or '') or not x.get('apn') or not x.get('issue_date'): continue
            if float(x.get('height') or 0) < 16 or float(x.get('adu_changed') or 0) > 0: continue
            y = int(x['issue_date'][:4]); newb[x['apn']] = max(newb.get(x['apn'], 0), y)
    def at(tree, items, pt):
        for k in tree.query(pt):
            if items[k][0].contains(pt): return items[k][1]
    lots = []
    for key, gr in groups.items():
        g = unary_union(gr['g']).buffer(0.05).buffer(-0.05).intersection(clip)
        g = g.difference(rb)
        parts = sorted([q for q in (g.geoms if hasattr(g, 'geoms') else [g]) if q.geom_type == 'Polygon' and q.area > 30], key=lambda q: -q.area)
        al = sorted({a for p in gr['pins'] for a in adr.get(p, [])})
        for n, q in enumerate(parts):
            if n and q.area < 120: continue
            q = shapely.Polygon(q.exterior).simplify(0.3)
            c = q.representative_point()
            ain = key if key.isdigit() else None
            lots.append({'g': q, 'a': al[0] if al else None, 'ain': ain, 'zr': at(zt, ZP, c), 'gp': at(gt, GP, c), 'yb': newb.get(ain)})
else:
    lots = [{'g': Polygon(l['r']).buffer(0), 'a': l['a'][0]} for l in P['lots']]
cover = unary_union([l['g'] for l in lots])
extra = [(p, 'parking') for p in parking] + [(x['g'], 'school') for x in lu if x['k'] == 'school']
for g, why in extra:
    rest = g.difference(cover).difference(roadbuf)
    for q in (rest.geoms if hasattr(rest, 'geoms') else [rest]):
        if q.geom_type == 'Polygon' and q.area > 350 and q.area / max(q.length, 1) > 4:
            lots.append({'g': q.simplify(0.4), 'a': None, 'why': why}); cover = cover.union(q)
B = P['buildings']
bpolys = [Polygon(b['r']) for b in B]
ltree = STRtree([l['g'] for l in lots])
for l in lots: l['bld'] = []
for bi, b in enumerate(B):
    c = bpolys[bi].centroid; hit = None
    for i in ltree.query(c):
        if lots[i]['g'].contains(c): hit = int(i); break
    if hit is None:
        cand = [(lots[i]['g'].intersection(bpolys[bi]).area, int(i)) for i in ltree.query(bpolys[bi])]
        cand = [c for c in cand if c[0] > 5]
        if cand: hit = max(cand)[1]
    b['l'] = hit
    if hit is not None: lots[hit]['bld'].append(bi)
# lots that got no building centroid: take over a building they mostly hold from a lot that has several
for i, l in enumerate(lots):
    if l['bld']: continue
    for bi in ltree.query(l['g']):
        pass
    for bi in STRtree(bpolys).query(l['g']):
        bi = int(bi); own = B[bi]['l']
        if own is None or own == i or len(lots[own]['bld']) < 2: continue
        if l['g'].intersection(bpolys[bi]).area > 0.45 * bpolys[bi].area:
            lots[own]['bld'].remove(bi); l['bld'].append(bi); B[bi]['l'] = i; break
btr = STRtree(bpolys)
ptree = STRtree(parking)
lutree = STRtree([x['g'] for x in lu])

ARTERIAL = ('primary', 'secondary')
import re
def zplay(zr):
    # map a real LA zone string ("(T)(Q)C4-1LD") to the game's simplified zone families
    if not zr: return None
    base = re.sub(r'^([\[(][A-Z]+[\])])+', '', zr.upper()).split('-')[0]
    if 'PARK' in base or base.startswith('OS') or base == 'A1': return 'OS-1'
    if 'COMMERCE' in base or base.startswith(('C', 'M')): return 'C2-1VL'
    if base.startswith('PF'): return 'PF-1'
    if base.startswith(('PB', 'P')) and not base.startswith('PV'): return 'P-1'
    if base.startswith('RAS'): return 'RAS4-1'
    if base.startswith(('R3', 'R4', 'R5', 'RD')): return 'R3-1'
    if base.startswith(('R2', 'RW')): return 'R2-1'
    if base.startswith(('RE', 'RA', 'RS')) and base not in ('RE9',): return 'RE11-1'
    return 'R1-1'
ERA = [(1938, 'bungalow', 5), (1956, 'ranch', 60), (1974, 'split', 25), (1996, 'stucco', 10)]
out_lots = []
for i, l in enumerate(lots):
    g = l['g']
    if g.geom_type != 'Polygon' or g.area < 30: continue
    if REAL and g.area < 80 and not l['bld'] and not l.get('why'): continue  # slivers of real parcels after clipping
    c = g.representative_point(); cx, cz = c.x, c.y
    # nearest graph street = front
    best = None
    for j in gtree.query(g.buffer(40)):
        d = glines[j].distance(g)
        if best is None or d < best[0]: best = (d, int(j))
    if best is None:
        j = int(gtree.nearest(c)); best = (glines[j].distance(g), j)
    e = graph[best[1]]; line = glines[best[1]]
    fp = nearest_points(line, c)[0]
    dx, dz = fp.x - cx, fp.y - cz; L = math.hypot(dx, dz) or 1
    fd = [dx / L, dz / L]
    front = g.boundary.intersection(line.buffer(e['w'] / 2 + 5.5)).length
    # depth: extent of the lot along the street-facing direction
    pts = np.array(g.exterior.coords)
    proj = pts[:, 0] * fd[0] + pts[:, 1] * fd[1]; depth = proj.max() - proj.min()
    width = (pts[:, 0] * -fd[1] + pts[:, 1] * fd[0]); width = width.max() - width.min()
    blds = [B[k] for k in l['bld']]
    foot = sum(b['a'] for b in blds); floor = sum(b['a'] * max(1, round(b['h'] / 3.2)) for b in blds)
    tallest = max([b['h'] for b in blds], default=0)
    types = [b['t'] for b in blds]
    shared = [] if blds else [int(k) for k in btr.query(g) if g.intersection(bpolys[int(k)]).area > 25]
    if shared:
        types = [B[k]['t'] for k in shared]; floor = sum(B[k]['a'] * max(1, round(B[k]['h'] / 3.2)) for k in shared) / 2; tallest = max(B[k]['h'] for k in shared)
    pk = sum(g.intersection(parking[k]).area for k in ptree.query(g)) / g.area
    luk = [lu[k]['k'] for k in lutree.query(c) if lu[k]['g'].contains(c)]
    on_art = e['c'] in ARTERIAL and best[0] < 12
    commercial = any(t in ('commercial', 'industrial') for t in types) or (not blds and ('retail' in luk or 'commercial' in luk))
    zfam = (zplay(l.get('zr')) or '').split('-')[0]
    if any(t in ('education', 'civic') for t in types) or 'school' in luk or l.get('why') == 'school' or (zfam in ('PF', 'OS') and foot < 0.3 * g.area): lt = 'civic'
    elif (pk > 0.6 and foot < 0.08 * g.area) or (l.get('why') == 'parking') or (zfam == 'P' and foot < 0.08 * g.area): lt = 'parking'
    elif zfam == 'C2' and blds and not any(t == 'residential' for t in types): lt = 'main'
    elif commercial: lt = 'main'
    elif not blds and not shared: lt = 'vacant'
    elif floor > 1400 or tallest > 10.5: lt = 'apts'
    elif floor > 800: lt = 'multi'
    else: lt = 'house'
    # simplified zone (estimate until City of LA ZONING_PLY is fetched)
    zone = {'house': 'RE11-1' if g.area > 1100 else 'R1-1', 'multi': 'R2-1', 'apts': 'R3-1', 'main': 'C2-1VL', 'parking': 'C2-1VL' if on_art else 'P-1', 'civic': 'PF-1', 'vacant': 'R1-1'}[lt]
    if lt == 'vacant' and on_art: zone = 'C2-1VL'
    if zplay(l.get('zr')): zone = zplay(l['zr'])
    hsh = h32(l['a'] or f'lot{i}')
    w = hsh % 100; acc = 0; era = ERA[1]
    for e_ in ERA:
        acc += e_[2]
        if w < acc: era = e_; break
    yr = era[0] - 6 + (hsh >> 8) % 13
    if lt in ('main', 'parking'): yr = 1962 + (hsh >> 8) % 25
    if lt == 'apts': yr = 1964 + (hsh >> 8) % 20
    if lt == 'multi': yr = 1958 + (hsh >> 8) % 25
    if l.get('yb'): yr = l['yb']
    units = 0
    if lt == 'house': units = 1
    elif lt == 'multi': units = max(2, min(4, round(floor / 140)))
    elif lt == 'apts': units = max(5, round(floor / 85))
    bk = None
    for k in btree.query(c):
        if blocks[k].contains(c): bk = int(k); break
    if bk is None:
        bk = int(btree.nearest(c))
    o = {'id': f'L{len(out_lots)}', 'r': ring(g), 'a': l['a'], 'c': [R(cx), R(cz)], 'e': round(float(elev(cx, cz)), 2), 'm2': round(g.area),
                     'blk': bk, 'rd': e['id'], 'fp': [R(fp.x), R(fp.y)], 'fd': [round(fd[0], 3), round(fd[1], 3)], 'fr': R(front), 'dp': R(depth), 'wd': R(width),
                     'lt': lt, 'z': zone, 'yr': yr, 'st': max(1, round(tallest / 3.2)) if (blds or shared) else 0, 'sh': shared or None, 'u': units, 'pv': round(pk, 2), 'b': l['bld'],
                     'sd': hsh % 100000, 'ain': l.get('ain'), 'zr': l.get('zr'), 'gp': l.get('gp'), 'ys': 'permit' if l.get('yb') else None}
    out_lots.append({k: v for k, v in o.items() if v is not None})
    for k in l['bld']: B[k]['l'] = len(out_lots) - 1
for b in B:
    if b.get('l') is None: b.pop('l', None)

pack = {'v': 2, 'origin': P['origin'], 'bbox': P['bbox'], 'terrain': T, 'nodes': node_list,
        'edges': [{k: v for k, v in e.items() if v is not None} for e in edges], 'walks': P['walks'], 'buildings': B, 'lots': out_lots,
        'blocks': [ring(b) for b in blocks], 'parking': [ring(p) for p in parking if p.geom_type == 'Polygon'],
        'props': props, 'landuse': [{'k': x['k'], 'r': ring(x['g'].simplify(1))} for x in lu],
        'sources': P['sources'] | {'parking': 'Overture Maps base/infrastructure 2026-10-21.0 (from OSM)', 'props': 'Overture Maps base/infrastructure 2026-10-21.0', 'landuse': 'Overture Maps base/land_use 2026-10-21.0'}
        | ({'lots': 'City of LA BOE parcels (data.lacity.org qyra-qm2s, with LA County AIN), pulled 2026-10-25', 'zoning': 'City of LA ZONING_PLY (data.lacity.org jjxn-vhan) and GENPLAN_PLY (c3g2-yzgc)',
            'addresses': 'City of LA addresses (data.lacity.org 4ca8-mxuh)', 'years': 'LADBS new-building permits with CofO (data.lacity.org), else estimated'} if REAL else {})}
s = json.dumps(pack, separators=(',', ':'))
open(OUT, 'w').write(s)
from collections import Counter
print(len(out_lots), 'lots', Counter(l['lt'] for l in out_lots), len(blocks), 'blocks', len(edges), 'edges', len(node_list), 'nodes', len(props), 'props', len(pack['parking']), 'parking', len(s) // 1024, 'KB')
print(Counter(l['z'] for l in out_lots)); print(Counter(l.get('zr') for l in out_lots).most_common(12)); print(sum(1 for l in out_lots if l.get('ys')), 'permit years', sum(1 for l in out_lots if l.get('a')), 'with address')
