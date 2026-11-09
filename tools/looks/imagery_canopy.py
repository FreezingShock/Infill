"""Tree canopy from overhead imagery: public/areas/<id>.canopy.json  ([x, z, radius] in pack metres)

Reads the same NAIP picture build_looks.py saves (--save-imagery). Trees are dark, textured green; lawn is paler and flat,
so both brightness and local texture are used. Each canopy blob is split into crowns at the peaks of its distance map.
  pip install shapely numpy pillow scipy
  python3 imagery_canopy.py --pack ../../public/areas/wh-topanga.json --imagery work/naip.png
"""
import argparse, json, math
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
ap = argparse.ArgumentParser(); ap.add_argument('--pack', required=True); ap.add_argument('--imagery', required=True); ap.add_argument('--out'); ap.add_argument('--preview')
a = ap.parse_args()
pack = json.load(open(a.pack)); lon0, lat0 = pack['origin']; W, S, E, N = pack['bbox']
KX = math.cos(math.radians(lat0)) * 111320; KY = 110540
im = Image.open(a.imagery).convert('RGB'); iw, ih = im.size; rgb = np.asarray(im, float)
mx, my = (E - W) * KX / iw, (N - S) * KY / ih   # metres per pixel
r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]; lum = 0.3 * r_ + 0.59 * g_ + 0.11 * b_
exg = 2 * g_ - r_ - b_
m1 = ndi.uniform_filter(lum, 5); tex = np.sqrt(np.maximum(ndi.uniform_filter(lum * lum, 5) - m1 * m1, 0))   # local texture
veg = (exg > 10) & (lum < 150) & ((tex > 6) | (lum < 95)) & ~((b_ > g_ * 0.95) & (g_ > 120))
veg = ndi.binary_opening(veg, iterations=1)
veg = ndi.binary_closing(veg, iterations=2)
dt = ndi.distance_transform_edt(veg) * (mx + my) / 2
pk = (dt == ndi.maximum_filter(dt, size=int(4.0 / ((mx + my) / 2)) | 1)) & (dt > 1.8)
ys, xs = np.nonzero(pk); order = np.argsort(-dt[ys, xs]); keep = []; grid = {}; cs = 12   # 12 px cells for the neighbour test
for i in order:   # crowns closer than their radii overlap too much: keep the larger
    x, y, rad = int(xs[i]), int(ys[i]), float(dt[ys[i], xs[i]]); gx, gy = x // cs, y // cs; ok = True
    for u in range(gx - 2, gx + 3):
        for v in range(gy - 2, gy + 3):
            for kx, ky, kr in grid.get((u, v), ()):
                if math.hypot((x - kx) * mx, (y - ky) * my) <= 0.6 * (rad + kr): ok = False
    if ok: keep.append((x, y, rad)); grid.setdefault((gx, gy), []).append((x, y, rad))
# drop crowns standing on a roof (dark roofs and shadows read as green)
from shapely.geometry import Polygon, Point
from shapely.strtree import STRtree
bpolys = [Polygon([(lon0 + x / KX, lat0 - z / KY) for x, z in b['r']]).buffer(-0.00001) for b in pack['buildings']]
bt = STRtree(bpolys)
trees = []
for x, y, rad in keep:
    lon = W + x / iw * (E - W); lat = N - y / ih * (N - S)
    if any(bpolys[int(j)].contains(Point(lon, lat)) for j in bt.query(Point(lon, lat))): continue
    trees.append([round((lon - lon0) * KX, 1), round(-(lat - lat0) * KY, 1), round(float(min(rad * 1.15, 7.0)), 1)])
o = a.out or a.pack.replace('.json', '.canopy.json')
json.dump({'v': 1, 'src': 'USGS NAIP (public domain)', 't': trees}, open(o, 'w'), separators=(',', ':'))
print(len(trees), 'crowns; veg cover %.1f%%; wrote %s' % (100 * veg.mean(), o))
if a.preview:
    from PIL import ImageDraw
    p = im.copy(); d = ImageDraw.Draw(p)
    for x, z, rad in trees:
        lon = lon0 + x / KX; lat = lat0 - z / KY; px = (lon - W) / (E - W) * iw; py = (N - lat) / (N - S) * ih
        d.ellipse([px - rad / mx, py - rad / my, px + rad / mx, py + rad / my], outline=(255, 255, 0))
    p.save(a.preview)
