"""Overture Maps reader: features of one theme/type inside a lon/lat box, as a GeoJSON file.

Overture is hundreds of parquet files on S3 (buildings alone is 512). Reading every file's footer to find the
few row groups that touch a small area was most of the download time, and it was repeated for every layer and for
the backdrop ring. The footers do not change within a release, so the row-group boxes for the Valley are kept in
tools/pack/ov-index/<release>-<theme>-<type>.json (committed; rebuilt automatically if missing). A fetch inside
the Valley then opens only the files that matter and reads only their matching row groups. A box outside the
indexed region falls back to scanning footers, so any place on Earth still works, just slower.
"""
import sys, json, os, s3fs, pyarrow.parquet as pq, pyarrow as pa
import pyarrow.compute as pc
from concurrent.futures import ThreadPoolExecutor
from shapely import wkb
RELEASE = '2026-10-21.0'
HERE = os.path.dirname(os.path.abspath(__file__))
INDEX_DIR = os.path.join(HERE, 'ov-index')
COVER = (-118.76, 34.07, -118.27, 34.37)   # the Valley with a margin: row groups touching this are indexed
PROPS = ('number', 'street', 'postcode', 'unit', 'id', 'subtype', 'class', 'names', 'height', 'num_floors', 'road_surface', 'subclass', 'level', 'road_flags', 'access_restrictions', 'speed_limits', 'width_rules', 'prohibited_transitions', 'connectors', 'level_rules', 'routes', 'destinations', 'subclass_rules', 'source_tags')


def _fs():
    return s3fs.S3FileSystem(anon=True, client_kwargs={'region_name': 'us-west-2'})


def _colidx(md, name):
    sch = md.schema
    for i in range(len(sch)):
        if sch.column(i).path == name: return i


def _row_groups(pf, box):
    """Row groups of an open ParquetFile whose bbox statistics touch box (W,S,E,N)."""
    W, S, E, N = box; md = pf.metadata
    ix = {k: _colidx(md, 'bbox.' + k) for k in ('xmin', 'xmax', 'ymin', 'ymax')}
    out = []
    for r in range(md.num_row_groups):
        rg = md.row_group(r); st = {k: rg.column(i).statistics for k, i in ix.items()}
        if st['xmin'].min > E or st['xmax'].max < W or st['ymin'].min > N or st['ymax'].max < S: continue
        out.append((r, st['xmin'].min, st['xmax'].max, st['ymin'].min, st['ymax'].max))
    return out


def _index(theme, typ, fs):
    """{file: [[rg, xmin, xmax, ymin, ymax], ...]} for the Valley; read from disk, or built once and saved."""
    path = os.path.join(INDEX_DIR, f'{RELEASE}-{theme}-{typ}.json')
    if os.path.exists(path): return json.load(open(path))
    files = fs.ls(f'overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/')
    def one(f):
        try:
            rgs = _row_groups(pq.ParquetFile(f, filesystem=fs), COVER)
        except Exception as e:  # noqa: BLE001
            print('ERR', f, e, file=sys.stderr); return f, []
        r = lambda v, up: round(v + (1e-4 if up else -1e-4), 4)  # outward, so a rounded box never drops a feature
        return f, [[g[0], r(g[1], 0), r(g[2], 1), r(g[3], 0), r(g[4], 1)] for g in rgs]
    with ThreadPoolExecutor(32) as ex:
        idx = {f: rgs for f, rgs in ex.map(one, files) if rgs}
    os.makedirs(INDEX_DIR, exist_ok=True)
    json.dump(idx, open(path + '.tmp', 'w'), separators=(',', ':')); os.replace(path + '.tmp', path)
    return idx


def _filter(t, box):
    W, S, E, N = box
    b = t.column('bbox').combine_chunks()
    m = pc.and_(pc.and_(pc.less_equal(b.field('xmin'), E), pc.greater_equal(b.field('xmax'), W)), pc.and_(pc.less_equal(b.field('ymin'), N), pc.greater_equal(b.field('ymax'), S)))
    return t.filter(m)


def fetch(theme, typ, out, bbox):
    W, S, E, N = bbox
    fs = _fs()
    inside = W >= COVER[0] and S >= COVER[1] and E <= COVER[2] and N <= COVER[3]
    if inside:
        idx = _index(theme, typ, fs)
        jobs = [(f, [g[0] for g in rgs if not (g[1] > E or g[2] < W or g[3] > N or g[4] < S)]) for f, rgs in idx.items()]
        jobs = [(f, r) for f, r in jobs if r]
        nfiles = len(idx)
    else:
        files = fs.ls(f'overturemaps-us-west-2/release/{RELEASE}/theme={theme}/type={typ}/'); nfiles = len(files)
        jobs = [(f, None) for f in files]

    def scan(job):
        f, rgs = job
        try:
            pf = pq.ParquetFile(f, filesystem=fs)
            if rgs is None:
                rgs = [g[0] for g in _row_groups(pf, bbox)]
                if not rgs: return None
            return _filter(pf.read_row_groups(rgs), bbox)
        except Exception as e:  # noqa: BLE001
            print('ERR', f, e, file=sys.stderr); return None
    with ThreadPoolExecutor(min(32, max(1, len(jobs)))) as ex:
        res = [r for r in ex.map(scan, jobs) if r is not None and r.num_rows]
    feats = []
    for t in res:
        for row in t.to_pylist():
            g = wkb.loads(row.pop('geometry'))
            props = {k: row[k] for k in PROPS if k in row and row[k] is not None}
            feats.append({'type': 'Feature', 'geometry': g.__geo_interface__, 'properties': props})
    json.dump({'type': 'FeatureCollection', 'features': feats}, open(out, 'w'), default=str)
    print(nfiles, 'files', len(feats), 'features')
    return len(feats)


def warm():
    """Build every index the area builder uses (run once after a new release)."""
    fs = _fs()
    for theme, typ in [('transportation', 'segment'), ('buildings', 'building'), ('addresses', 'address'), ('base', 'infrastructure'), ('base', 'land_use'), ('base', 'water')]:
        idx = _index(theme, typ, fs); print(theme, typ, len(idx), 'files indexed')


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'warm': warm()
    else: fetch(sys.argv[1], sys.argv[2], sys.argv[3], tuple(map(float, sys.argv[4].split(','))))
