import sys, json, s3fs, pyarrow.parquet as pq, pyarrow as pa
from concurrent.futures import ThreadPoolExecutor
from shapely import wkb
theme, typ, out = sys.argv[1], sys.argv[2], sys.argv[3]
W,S,E,N = map(float, sys.argv[4].split(','))
fs = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name':'us-west-2'})
files = fs.ls(f'overturemaps-us-west-2/release/2026-10-21.0/theme={theme}/type={typ}/')
def colidx(md, name):
    sch = md.schema
    for i in range(len(sch)):
        if sch.column(i).path == name: return i
def scan(f):
    try:
        pf = pq.ParquetFile(f, filesystem=fs)
        md = pf.metadata
        ix = {k: colidx(md, 'bbox.'+k) for k in ('xmin','xmax','ymin','ymax')}
        rgs=[]
        for r in range(md.num_row_groups):
            rg = md.row_group(r)
            st = {k: rg.column(i).statistics for k,i in ix.items()}
            if st['xmin'].min > E or st['xmax'].max < W or st['ymin'].min > N or st['ymax'].max < S: continue
            rgs.append(r)
        if not rgs: return None
        t = pf.read_row_groups(rgs)
        b = t.column('bbox').combine_chunks()
        import pyarrow.compute as pc
        xmin=b.field('xmin'); xmax=b.field('xmax'); ymin=b.field('ymin'); ymax=b.field('ymax')
        m = pc.and_(pc.and_(pc.less_equal(xmin,E), pc.greater_equal(xmax,W)), pc.and_(pc.less_equal(ymin,N), pc.greater_equal(ymax,S)))
        return t.filter(m)
    except Exception as e:
        print('ERR', f, e, file=sys.stderr); return None
with ThreadPoolExecutor(32) as ex:
    res = [r for r in ex.map(scan, files) if r is not None and r.num_rows]
feats=[]
for t in res:
    for row in t.to_pylist():
        g = wkb.loads(row.pop('geometry'))
        props = {}
        for k in ('number','street','postcode','unit','id','subtype','class','names','height','num_floors','road_surface','subclass','level'):
            if k in row and row[k] is not None: props[k]=row[k]
        feats.append({'type':'Feature','geometry':g.__geo_interface__,'properties':props})
json.dump({'type':'FeatureCollection','features':feats}, open(out,'w'), default=str)
print(len(files), 'files', len(feats), 'features')
