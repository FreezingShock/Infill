#!/usr/bin/env python3
"""Low-detail surroundings for an area pack: the real map beyond the playable box, as a blur.

    python tools/pack/backdrop.py public/areas/wh-topanga.json    # writes wh-topanga.bg.json next to it

Ring = the pack's box padded by 3.2 km. It holds a 40 m terrain grid, simplified streets by class, and a
30 m raster of building coverage and height (Overture buildings). Same local metres and base height as the
pack, so the game places it with no conversion. The game fades it into the fog; it is never edited.
"""
import json, math, os, sys
import numpy as np
from PIL import Image
from shapely.geometry import shape, LineString, box
from shapely import transform

PAD_M = 3200
TCELL = 40.0
BCELL = 30.0
Z = 14
DRIVE = {'motorway': 'm', 'trunk': 'm', 'primary': 'p', 'secondary': 'p', 'tertiary': 's', 'residential': 'r', 'unclassified': 'r'}


def build(pack_path, out_path, work, get, ov, log=print):
    P = json.load(open(pack_path))
    lon0, lat0 = P['origin']; W, S, E, N = P['bbox']
    KX = math.cos(math.radians(lat0)) * 111320; KY = 110540
    X = lambda lon: (lon - lon0) * KX
    Zc = lambda lat: -(lat - lat0) * KY
    core = (X(W), Zc(N), X(E), Zc(S))
    dlon, dlat = PAD_M / KX, PAD_M / KY
    ring = (W - dlon, S - dlat, E + dlon, N + dlat)
    os.makedirs(work, exist_ok=True)
    log('Fetching surrounding streets and buildings')
    seg_p, bld_p = os.path.join(work, 'ring_seg.geojson'), os.path.join(work, 'ring_bld.geojson')
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(2) as ex:  # the two layers are independent downloads
        list(ex.map(lambda j: ov.fetch(*j), [('transportation', 'segment', seg_p, ring), ('buildings', 'building', bld_p, ring)]))
    # ---- terrain (AWS terrarium z14) sampled on a 40 m grid in local metres
    n = 2 ** Z
    tile = lambda lon, lat: (int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    tx0, ty0 = tile(ring[0], ring[3]); tx1, ty1 = tile(ring[2], ring[1]); tx1 += 1; ty1 += 1
    rows = []
    for y in range(ty0, ty1 + 1):
        row = []
        for x in range(tx0, tx1 + 1):
            p = os.path.join(work, f'r{Z}_{x}_{y}.png')
            if not os.path.exists(p): open(p, 'wb').write(get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', binary=True))
            im = np.asarray(Image.open(p).convert('RGB')).astype(float)
            row.append(im[:, :, 0] * 256 + im[:, :, 1] + im[:, :, 2] / 256 - 32768)
        rows.append(np.hstack(row))
    big = np.vstack(rows)
    def elev(lon, lat):
        fx = (lon + 180) / 360 * n * 256 - tx0 * 256; fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n * 256 - ty0 * 256
        x0, y0 = int(fx), int(fy); dx, dy = fx - x0, fy - y0
        x0 = min(max(x0, 0), big.shape[1] - 2); y0 = min(max(y0, 0), big.shape[0] - 2)
        a, b, c, d = big[y0, x0], big[y0, x0 + 1], big[y0 + 1, x0], big[y0 + 1, x0 + 1]
        return a * (1 - dx) * (1 - dy) + b * dx * (1 - dy) + c * (1 - dx) * dy + d * dx * dy
    rx0, rz0, rx1, rz1 = X(ring[0]), Zc(ring[3]), X(ring[2]), Zc(ring[1])
    nx, nz = int((rx1 - rx0) / TCELL) + 1, int((rz1 - rz0) / TCELL) + 1
    H = np.array([[elev(lon0 + (rx0 + i * TCELL) / KX, lat0 - (rz0 + j * TCELL) / KY) for i in range(nx)] for j in range(nz)])
    base = P['terrain']['base']  # same zero as the pack, so the ring meets the playable terrain
    terrain = {'minx': round(rx0, 1), 'minz': round(rz0, 1), 'cell': TCELL, 'nx': nx, 'nz': nz, 'h': [int(round((v - base) * 10)) for v in H.ravel()]}
    # ---- streets, simplified, outside the playable box
    to_local = lambda g: transform(g, lambda a: np.column_stack([(a[:, 0] - lon0) * KX, -(a[:, 1] - lat0) * KY]))
    cb = box(*core).buffer(-5)
    roads = {'m': [], 'p': [], 's': [], 'r': []}
    for f in json.load(open(seg_p))['features']:
        k = DRIVE.get(f['properties'].get('class'))
        if not k or f['properties'].get('subclass') in ('driveway', 'parking_aisle'): continue
        g = to_local(shape(f['geometry'])).difference(cb)
        for part in (g.geoms if hasattr(g, 'geoms') else [g]):
            if part.geom_type != 'LineString' or part.length < 8: continue
            q = part.simplify(5 if k in 'mp' else 8)
            roads[k].append([int(round(v)) for xy in q.coords for v in xy])
    # ---- buildings: coverage and height per 30 m cell (a blur of the real footprints)
    bx0, bz0 = rx0, rz0; bnx, bnz = int((rx1 - rx0) / BCELL) + 1, int((rz1 - rz0) / BCELL) + 1
    area = np.zeros((bnz, bnx)); hs = np.zeros((bnz, bnx))
    for f in json.load(open(bld_p))['features']:
        p = f['properties']; g = to_local(shape(f['geometry']))
        c = g.centroid
        if core[0] <= c.x <= core[2] and core[1] <= c.y <= core[3]: continue
        i, j = int((c.x - bx0) / BCELL), int((c.y - bz0) / BCELL)
        if not (0 <= i < bnx and 0 <= j < bnz): continue
        h = p.get('height') or (p.get('num_floors') or (1 if g.area < 300 else 2)) * 3.3
        area[j, i] += g.area; hs[j, i] += g.area * h
    cov = np.minimum(1, area / (BCELL * BCELL)); hm = np.where(area > 0, hs / np.maximum(area, 1), 0)
    cells = []
    for j, i in zip(*np.nonzero(cov >= 0.06)):
        cells += [int(i), int(j), int(round(hm[j, i] * 10)), int(round(cov[j, i] * 100))]
    out = {'v': 1, 'terrain': terrain, 'bcell': BCELL, 'bx0': round(bx0, 1), 'bz0': round(bz0, 1), 'core': [round(v, 1) for v in core], 'roads': roads, 'cells': cells}
    s = json.dumps(out, separators=(',', ':')); open(out_path, 'w').write(s)
    log(f'backdrop: {len(cells) // 4} building cells, {sum(len(v) for v in roads.values())} street pieces, {len(s) // 1024} KB')
    return out_path


if __name__ == '__main__':
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import ov, build_area as ba
    pk = sys.argv[1]
    build(pk, pk.replace('.json', '.bg.json'), os.path.join(os.path.dirname(os.path.abspath(__file__)), 'work', 'bg-' + os.path.basename(pk)[:-5]), ba.get, ov)
