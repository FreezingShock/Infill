"""Pull one Overture layer for a box with every attribute kept (roof/facade fields, floors, places).
Usage: pull_overture.py <theme> <type> <out.json> W,S,E,N     e.g. buildings building work/bld_full.json -118.6115,34.1590,-118.5990,34.1700
Same anonymous-S3 row-group pruning as tools/pack/ov.py, which drops these columns."""
import sys, json, s3fs, pyarrow.parquet as pq, pyarrow.compute as pc
from concurrent.futures import ThreadPoolExecutor
from shapely import wkb
theme, typ, out = sys.argv[1:4]; W,S,E,N = map(float, sys.argv[4].split(','))
fs = s3fs.S3FileSystem(anon=True, client_kwargs={'region_name':'us-west-2'})
files = fs.ls(f'overturemaps-us-west-2/release/2026-10-21.0/theme={theme}/type={typ}/')
def ci(md,n):
    for i in range(md.schema.__len__()):
        if md.schema.column(i).path==n: return i
def scan(f):
    pf=pq.ParquetFile(f,filesystem=fs); md=pf.metadata; ix={k:ci(md,'bbox.'+k) for k in('xmin','xmax','ymin','ymax')}; rgs=[]
    for r in range(md.num_row_groups):
        rg=md.row_group(r); st={k:rg.column(i).statistics for k,i in ix.items()}
        if st['xmin'].min>E or st['xmax'].max<W or st['ymin'].min>N or st['ymax'].max<S: continue
        rgs.append(r)
    if not rgs: return None
    t=pf.read_row_groups(rgs); b=t.column('bbox').combine_chunks()
    m=pc.and_(pc.and_(pc.less_equal(b.field('xmin'),E),pc.greater_equal(b.field('xmax'),W)),pc.and_(pc.less_equal(b.field('ymin'),N),pc.greater_equal(b.field('ymax'),S)))
    return t.filter(m)
with ThreadPoolExecutor(32) as ex: res=[r for r in ex.map(scan,files) if r is not None and r.num_rows]
feats=[]
for t in res:
    for row in t.to_pylist():
        g=wkb.loads(row.pop('geometry')); row.pop('bbox',None); feats.append({'type':'Feature','geometry':g.__geo_interface__,'properties':row})
json.dump({'type':'FeatureCollection','features':feats},open(out,'w'),default=str); print(len(feats))
