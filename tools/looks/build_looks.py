"""Build the looks sidecar for an area pack: public/areas/<id>.looks.json

For every building in the pack it records what the open data says the building is, so the game can
draw it as that kind of building instead of one generic box:
  c  Overture class (house, retail, commercial, apartments, ...)       f  floors if mapped
  p  main Overture Places category inside it (restaurant, grocery, ...) n  number of places
  rc roof colour (hex)  rs 'p' pitched / 'f' flat  rx 1 = ridge across the long side
The last three come from overhead imagery and are optional (see --imagery below).

Licences: Overture buildings and places are ODbL / CDLA-style open data (attribution in docs). NAIP
aerial imagery is a USGS product in the public domain, so deriving colours and roof shape from it is fine.
Google, Apple and Bing imagery or 3D tiles are NOT used: their terms forbid extracting from them.

  pip install shapely numpy pillow
  python3 build_looks.py --pack ../../public/areas/wh-topanga.json --bld work/bld_full.json --places work/plc.json \\
      [--imagery file.png --imagery-bbox W,S,E,N | --fetch-naip]
"""
import argparse, json, math, sys, io, urllib.request
from collections import Counter
from shapely.geometry import shape, Polygon, Point
from shapely.strtree import STRtree
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--pack', required=True); ap.add_argument('--bld', required=True); ap.add_argument('--places', required=True)
ap.add_argument('--out'); ap.add_argument('--imagery', help='RGB image (png/jpg/tif) covering --imagery-bbox'); ap.add_argument('--imagery-bbox')
ap.add_argument('--fetch-naip', action='store_true', help='download NAIP for the pack box from the USGS National Map ImageServer (public domain)')
ap.add_argument('--naip-mpp', type=float, default=0.6, help='metres per pixel to request (NAIP is 0.6 m)')
a = ap.parse_args()

pack = json.load(open(a.pack)); lon0, lat0 = pack['origin']
KX = math.cos(math.radians(lat0)) * 111320; KY = 110540   # same projection as tools/pack/pack_v1.py
ll = lambda x, z: (x / KX + lon0, -z / KY + lat0)
PB = pack['buildings']

# --- Overture buildings and places
OB = [(shape(f['geometry']), f['properties']) for f in json.load(open(a.bld))['features']]
OB = [(g, p) for g, p in OB if g.is_valid and not g.is_empty]
tree = STRtree([g for g, _ in OB])
PL = [(shape(f['geometry']), f['properties']) for f in json.load(open(a.places))['features'] if (f['properties'].get('operating_status') or 'open') != 'closed']

def pack_poly(b): return Polygon([ll(x, z) for x, z in b['r']])

def tax(p):
    t = p.get('basic_category') or (p.get('taxonomy') or {}).get('primary') or (p.get('categories') or {}).get('primary')
    return t

looks, matched, withplace = [], 0, 0
polys = [pack_poly(b) for b in PB]
for b, pg in zip(PB, polys):
    rp = pg.representative_point(); L = {}
    best = None
    for i in tree.query(rp):
        g, p = OB[int(i)]
        if g.contains(rp): best = p; break
    if best:
        matched += 1
        if best.get('class'): L['c'] = best['class']
        if best.get('num_floors'): L['f'] = int(best['num_floors'])
        if best.get('roof_color'): L['rc'] = str(best['roof_color']).lstrip('#').lower()
        if best.get('roof_shape') in ('flat', 'gabled', 'hipped', 'skillion', 'pyramidal'): L['rs'] = 'f' if best['roof_shape'] == 'flat' else 'p'
        if best.get('facade_color'): L['wc'] = str(best['facade_color']).lstrip('#').lower()
    looks.append(L)
# places: each place goes to the building it sits in, else the nearest footprint within 12 m
pb_tree = STRtree(polys); per = {}
for pt, p in PL:
    cand = [int(i) for i in pb_tree.query(pt.buffer(12 / 100000))]
    inside = [i for i in cand if polys[i].contains(pt)]
    pick = inside[0] if inside else (min(cand, key=lambda i: polys[i].distance(pt)) if cand and min(polys[i].distance(pt) for i in cand) * 100000 < 12 else None)
    if pick is not None and tax(p): per.setdefault(pick, []).append((p.get('confidence') or 0, tax(p)))
for i, v in per.items():
    withplace += 1
    looks[i]['p'] = Counter(c for _, c in sorted(v, reverse=True)[:3]).most_common(1)[0][0]; looks[i]['n'] = len(v)

# --- optional imagery: roof colour and pitched/flat from the overhead picture
def load_image():
    if a.imagery:
        from PIL import Image
        return Image.open(a.imagery).convert('RGB'), [float(v) for v in a.imagery_bbox.split(',')]
    if a.fetch_naip:
        from PIL import Image
        W, S, E, N = pack['bbox']; px = lambda d: int(round(d / (a.naip_mpp / 111320)))
        w, h = min(4000, int((E - W) * KX / a.naip_mpp)), min(4000, int((N - S) * KY / a.naip_mpp))
        url = ('https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage'
               f'?bbox={W},{S},{E},{N}&bboxSR=4326&imageSR=4326&size={w},{h}&format=png&f=image')
        print('fetching', url, file=sys.stderr)
        return Image.open(io.BytesIO(urllib.request.urlopen(url, timeout=120).read())).convert('RGB'), [W, S, E, N]
    return None, None

def roof_stats(im, bbox, pg, area_m2):
    from PIL import Image, ImageDraw
    W, S, E, N = bbox; iw, ih = im.size
    to_px = lambda lo, la: ((lo - W) / (E - W) * iw, (N - la) / (N - S) * ih)
    pts = [to_px(*c) for c in pg.exterior.coords]
    x0, y0, x1, y1 = [int(v) for v in (min(p[0] for p in pts) - 1, min(p[1] for p in pts) - 1, max(p[0] for p in pts) + 2, max(p[1] for p in pts) + 2)]
    x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, iw), min(y1, ih)
    if x1 - x0 < 4 or y1 - y0 < 4: return None
    m = Image.new('L', (x1 - x0, y1 - y0), 0); ImageDraw.Draw(m).polygon([(px - x0, py - y0) for px, py in pts], fill=1)
    mask = np.asarray(m, bool)
    er = mask.copy(); er[1:] &= mask[:-1]; er[:-1] &= mask[1:]; er[:, 1:] &= mask[:, :-1]; er[:, :-1] &= mask[:, 1:]   # 1 px erosion: skip edge mixing
    rgb = np.asarray(im.crop((x0, y0, x1, y1)), float)
    r_, g_, b_ = rgb[..., 0], rgb[..., 1], rgb[..., 2]; lum = 0.3 * r_ + 0.59 * g_ + 0.11 * b_
    ok = er & ~((g_ > r_ * 1.06) & (g_ > b_ * 1.04)) & (lum > 35)   # not tree/lawn, not deep shadow
    if ok.sum() < 12: return None
    col = np.median(rgb[ok], axis=0).astype(int); out = {'rc': '%02x%02x%02x' % tuple(col)}
    # pitched roofs: the two slopes catch different light. Split the footprint along each axis of its
    # minimum rotated rectangle and compare the halves; flat roofs come out even.
    rect = pg.minimum_rotated_rectangle; rc_ = list(rect.exterior.coords)[:4]
    e0 = (rc_[1][0] - rc_[0][0], rc_[1][1] - rc_[0][1]); e1 = (rc_[2][0] - rc_[1][0], rc_[2][1] - rc_[1][1])
    long_ax, short_ax = (e0, e1) if math.hypot(*e0) >= math.hypot(*e1) else (e1, e0)
    ys, xs = np.nonzero(ok); cx, cy = rect.centroid.x, rect.centroid.y
    P = np.array([to_px(lo, la) for lo, la in [(cx, cy)]])[0]
    def split_diff(ax):
        # pixel-space direction of ax (lon/lat deltas -> px deltas)
        d = np.array([ax[0] / (E - W) * iw, -ax[1] / (N - S) * ih]); d /= (np.linalg.norm(d) or 1)
        t = (xs + x0 - P[0]) * d[0] + (ys + y0 - P[1]) * d[1]; v = lum[ys, xs]
        lo, hi = v[t < 0], v[t >= 0]
        return abs(lo.mean() - hi.mean()) / (v.mean() or 1) if len(lo) > 4 and len(hi) > 4 else 0
    d_short, d_long = split_diff(short_ax), split_diff(long_ax)   # split across the short side = ridge along the long side
    if area_m2 < 600 and max(d_short, d_long) > 0.10:
        out['rs'] = 'p'
        if d_long > d_short * 1.3: out['rx'] = 1
    else: out['rs'] = 'f'
    return out

im, ibox = load_image(); shot = 0
if im is not None:
    for L, pg, b in zip(looks, polys, PB):
        s = roof_stats(im, ibox, pg, b.get('a', 0))
        if s:
            shot += 1
            L.update({k: v for k, v in s.items() if not (k == 'rs' and L.get('rs'))})   # an explicit mapped roof_shape wins
chk = sum(int(round(b['r'][0][0] * 10)) + int(round(b['r'][0][1] * 10)) * 3 for b in PB)  # same check as src/engine/looks.js packChecksum
out = a.out or a.pack.replace('.json', '.looks.json')
json.dump({'v': 1, 'n': len(PB), 'chk': chk, 'imagery': bool(im is not None), 'b': [L or 0 for L in looks]}, open(out, 'w'), separators=(',', ':'))
print(f'{len(PB)} buildings, {matched} matched Overture, {withplace} with a place, {shot} read from imagery; wrote {out}')
