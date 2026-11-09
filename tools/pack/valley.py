#!/usr/bin/env python3
"""Bake the area picker's map of the whole San Fernando Valley from open data.

    python tools/pack/valley.py            # writes public/areas/valley.webp, valley-sat.jpg, valley.map.json

valley.webp      Camino render: terrain hillshade, parks, water and every street (Overture transportation + base,
                 AWS terrain tiles). Dark, on theme, same lon/lat frame as the picker.
valley-sat.jpg   NAIP aerial imagery (USGS, public domain) of the same frame, for the satellite layer.
valley.map.json  Named arterials (motorway to tertiary) as polylines: the picker searches street names and
                 computes intersections from it, and draws them crisp at any zoom.
Everything is real data. Run it once; the files are committed. Needs the same Python packages as build_area.py.
"""
import io, json, math, os, sys, time, urllib.request
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'areas'))
RELEASE = '2026-10-21.0'
BBOX = (-118.68, 34.13, -118.33, 34.31)   # W,S,E,N: the Valley, same as index.json region
W_PX = 4200
KX = math.cos(math.radians((BBOX[1] + BBOX[3]) / 2)) * 111320
H_PX = round(W_PX * ((BBOX[3] - BBOX[1]) * 110540) / ((BBOX[2] - BBOX[0]) * KX))
sys.path.insert(0, HERE)


def px(lon, lat):
    return (lon - BBOX[0]) / (BBOX[2] - BBOX[0]) * W_PX, (BBOX[3] - lat) / (BBOX[3] - BBOX[1]) * H_PX


def read_theme(theme, typ, cols):
    import pyarrow.parquet as pq, pyarrow.compute as pc, s3fs
    from concurrent.futures import ThreadPoolExecutor
    W, S, E, N = BBOX
    fs = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name': 'us-west-2'})
    files = fs.ls(f'overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/')

    def scan(f):
        pf = pq.ParquetFile(f, filesystem=fs); md = pf.metadata
        idx = {}
        for i in range(len(md.schema)):
            idx[md.schema.column(i).path] = i
        rgs = []
        for r in range(md.num_row_groups):
            rg = md.row_group(r); st = {k: rg.column(idx['bbox.' + k]).statistics for k in ('xmin', 'xmax', 'ymin', 'ymax')}
            if st['xmin'].min > E or st['xmax'].max < W or st['ymin'].min > N or st['ymax'].max < S: continue
            rgs.append(r)
        if not rgs: return None
        t = pf.read_row_groups(rgs, columns=cols + ['bbox'])
        b = t.column('bbox').combine_chunks()
        m = pc.and_(pc.and_(pc.less_equal(b.field('xmin'), E), pc.greater_equal(b.field('xmax'), W)), pc.and_(pc.less_equal(b.field('ymin'), N), pc.greater_equal(b.field('ymax'), S)))
        return t.filter(m).drop(['bbox'])
    with ThreadPoolExecutor(32) as ex:
        return [t for t in ex.map(scan, files) if t is not None and t.num_rows]


def terrain():
    z = 12; n = 2 ** z
    def tx(lon): return (lon + 180) / 360 * n
    def ty(lat): return (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    x0, x1 = int(tx(BBOX[0])), int(tx(BBOX[2])); y0, y1 = int(ty(BBOX[3])), int(ty(BBOX[1]))
    mos = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256), dtype=np.float32)
    def get(xy):
        x, y = xy
        d = urllib.request.urlopen(urllib.request.Request(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', headers={'User-Agent': 'sfvos-valley-map'}), timeout=60).read()
        a = np.asarray(Image.open(io.BytesIO(d)).convert('RGB'), dtype=np.float32)
        return x, y, a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
    with ThreadPoolExecutor(8) as ex:
        for x, y, h in ex.map(get, [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]):
            mos[(y - y0) * 256:(y - y0 + 1) * 256, (x - x0) * 256:(x - x0 + 1) * 256] = h
    # resample into the picker's frame (rows are equal lat steps)
    lons = np.linspace(BBOX[0], BBOX[2], W_PX); lats = np.linspace(BBOX[3], BBOX[1], H_PX)
    fx = (np.array([tx(v) for v in lons]) - x0) * 256; fy = (np.array([ty(v) for v in lats]) - y0) * 256
    xi = np.clip(fx.astype(int), 0, mos.shape[1] - 2); yi = np.clip(fy.astype(int), 0, mos.shape[0] - 2)
    return mos[np.ix_(yi, xi)]


def hillshade(h):
    cell = (BBOX[2] - BBOX[0]) * KX / W_PX
    gy, gx = np.gradient(h, cell)
    slope = np.arctan(np.hypot(gx, gy) * 2.2); aspect = np.arctan2(-gx, gy)
    az, alt = math.radians(315), math.radians(42)
    s = np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)
    return np.clip(s, 0, 1)


def main():
    t0 = time.time()
    def log(m): print(f'[{time.time() - t0:5.1f}s] {m}', flush=True)
    import shapely
    log(f'frame {W_PX} x {H_PX}')
    log('terrain'); h = terrain(); hs = hillshade(h)
    hs = np.asarray(Image.fromarray((hs * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), dtype=np.float32) / 255
    base = np.zeros((H_PX, W_PX, 3), dtype=np.float32); base[:] = (7, 11, 13)
    shade = (hs - 0.55) * 46  # +/- brightness
    elev = np.clip((h - 150) / 900, 0, 1)[:, :, None] * np.array([6, 10, 10])
    img = Image.fromarray(np.clip(base + shade[:, :, None] * np.array([0.8, 1.0, 1.05]) + elev, 0, 255).astype(np.uint8))
    d = ImageDraw.Draw(img, 'RGBA')

    def polys(tables, fill):
        for t in tables:
            for g in shapely.from_wkb(t.column('geometry').to_pylist()):
                for p in (g.geoms if hasattr(g, 'geoms') else [g]):
                    if p.geom_type != 'Polygon': continue
                    d.polygon([px(x, y) for x, y in p.exterior.coords], fill=fill)
    log('parks and water')
    try:
        lu = read_theme('base', 'land_use', ['geometry', 'subtype', 'class'])
        for t in lu:  # recreation and protected land, schools stay unpainted
            cls = t.column('class').to_pylist(); sub = t.column('subtype').to_pylist(); geo = shapely.from_wkb(t.column('geometry').to_pylist())
            for g, c, s in zip(geo, cls, sub):
                if c in ('park', 'golf_course', 'nature_reserve', 'recreation_ground', 'pitch', 'playground') or s in ('park', 'protected'):
                    for p in (g.geoms if hasattr(g, 'geoms') else [g]):
                        if p.geom_type == 'Polygon': d.polygon([px(x, y) for x, y in p.exterior.coords], fill=(30, 92, 66, 70))
        wt = read_theme('base', 'water', ['geometry'])
        polys(wt, (14, 52, 82, 235))
    except Exception as e:  # noqa: BLE001
        log(f'parks/water skipped: {e}')

    log('streets')
    tabs = read_theme('transportation', 'segment', ['geometry', 'class', 'subtype', 'names'])
    STY = {  # class -> (rgba, width)
        'motorway': ((47, 216, 232, 255), 3.6), 'trunk': ((47, 216, 232, 230), 3.0), 'primary': ((214, 226, 230, 235), 2.6),
        'secondary': ((150, 166, 174, 225), 2.0), 'tertiary': ((112, 128, 136, 215), 1.5), 'residential': ((62, 78, 86, 200), 1.0),
        'living_street': ((54, 68, 76, 180), 0.9), 'unclassified': ((54, 68, 76, 180), 0.9),
    }
    ORDER = ['living_street', 'unclassified', 'residential', 'tertiary', 'secondary', 'primary', 'trunk', 'motorway']
    lines = {k: [] for k in ORDER}; named = {}
    for t in tabs:
        cls = t.column('class').to_pylist(); sub = t.column('subtype').to_pylist(); names = t.column('names').to_pylist()
        geo = shapely.from_wkb(t.column('geometry').to_pylist())
        for g, c, s, nm in zip(geo, cls, sub, names):
            if s != 'road' or c not in lines: continue
            for ln in (g.geoms if hasattr(g, 'geoms') else [g]):
                if ln.geom_type != 'LineString': continue
                co = list(ln.coords); lines[c].append([px(x, y) for x, y in co])
                if c in ('motorway', 'trunk', 'primary', 'secondary', 'tertiary') and nm and nm.get('primary'):
                    named.setdefault((nm['primary'], c), []).append(co)
    n = 0
    for c in ORDER:
        col, w = STY[c]
        for ln in lines[c]:
            if len(ln) > 1: d.line(ln, fill=col, width=max(1, round(w)), joint='curve'); n += 1
    log(f'{n} street pieces drawn')
    img = img.filter(ImageFilter.UnsharpMask(radius=1.0, percent=40, threshold=2))
    os.makedirs(OUT, exist_ok=True)
    img.save(os.path.join(OUT, 'valley.webp'), 'WEBP', quality=82, method=6)
    log('valley.webp saved')

    # named arterials for search and crisp overlay
    roads = []
    CODE = {'motorway': 'm', 'trunk': 't', 'primary': 'p', 'secondary': 's', 'tertiary': 'r'}
    for (nm, c), parts in sorted(named.items()):
        if len(parts) > 400: parts = parts[:400]
        flat = []
        for co in parts:
            q = [[round(x, 5), round(y, 5)] for x, y in co]
            if len(q) > 2:  # thin out dense vertices
                keep = [q[0]] + [p for i, p in enumerate(q[1:-1], 1) if math.hypot((p[0] - q[i - 1][0]) * KX, (p[1] - q[i - 1][1]) * 110540) > 18] + [q[-1]]
                q = keep
            flat.append([v for p in q for v in p])
        roads.append({'n': nm, 'c': CODE[c], 'l': flat})
    json.dump({'bbox': list(BBOX), 'w': W_PX, 'h': H_PX, 'roads': roads}, open(os.path.join(OUT, 'valley.map.json'), 'w'), separators=(',', ':'))
    log(f'{len(roads)} named arterials saved')

    log('satellite (NAIP)')
    try:
        sw, sh = 3200, round(3200 * H_PX / W_PX)
        url = f'https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage?bbox={BBOX[0]},{BBOX[1]},{BBOX[2]},{BBOX[3]}&bboxSR=4326&imageSR=4326&size={sw},{sh}&format=jpg&f=image'
        data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'sfvos-valley-map'}), timeout=240).read()
        Image.open(io.BytesIO(data)).convert('RGB').save(os.path.join(OUT, 'valley-sat.jpg'), 'JPEG', quality=72, optimize=True, progressive=True)
        log('valley-sat.jpg saved')
    except Exception as e:  # noqa: BLE001
        log(f'satellite skipped: {e}')


if __name__ == '__main__':
    main()
