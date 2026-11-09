import json, math, sys
from shapely.geometry import shape, box, Point, LineString, Polygon, MultiPolygon, MultiPoint
from shapely.ops import polygonize, unary_union
import shapely
import levels
from PIL import Image
D = sys.argv[1]
W,S,E,N = map(float, (sys.argv[3] if len(sys.argv) > 3 else '-118.6115,34.1590,-118.5990,34.1700').split(','))  # lon/lat box; default is the Woodland Hills pack
lat0=(S+N)/2; lon0=(W+E)/2
KX = math.cos(math.radians(lat0))*111320; KY = 110540
def P(lon,lat): return ((lon-lon0)*KX, -(lat-lat0)*KY)   # x east, z south
def tr(g): return shapely.transform(g, lambda a: __import__('numpy').column_stack([(a[:,0]-lon0)*KX, -(a[:,1]-lat0)*KY]))
clip = tr(box(W,S,E,N))
# ---- terrain
import numpy as np
z=15; n=2**z; tiles={}
def tile_of(lon,lat): return int((lon+180)/360*n), int((1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n)
TX0,TY0=tile_of(W,N); TX1,TY1=tile_of(E,S)   # tiles covering the box, padded by one tile east/south for bilinear lookups
TX1+=1; TY1+=1
for x in range(TX0,TX1+1):
  for y in range(TY0,TY1+1):
    im=np.asarray(Image.open(f'{D}/t_{x}_{y}.png').convert('RGB')).astype(float)
    tiles[(x,y)] = im[:,:,0]*256+im[:,:,1]+im[:,:,2]/256-32768
big = np.vstack([np.hstack([tiles[(x,y)] for x in range(TX0,TX1+1)]) for y in range(TY0,TY1+1)])
def elev_ll(lon,lat):
  fx=(lon+180)/360*n*256 - TX0*256
  fy=(1-math.asinh(math.tan(math.radians(lat)))/math.pi)/2*n*256 - TY0*256
  x0=int(fx); y0=int(fy); dx=fx-x0; dy=fy-y0
  a=big[y0,x0]; b=big[y0,x0+1]; c=big[y0+1,x0]; d=big[y0+1,x0+1]
  return a*(1-dx)*(1-dy)+b*dx*(1-dy)+c*(1-dx)*dy+d*dx*dy
minx,minz,maxx,maxz = clip.bounds
CELL=6.0
nx=int((maxx-minx)/CELL)+1; nz=int((maxz-minz)/CELL)+1
H=[]
for j in range(nz):
  for i in range(nx):
    x=minx+i*CELL; zz=minz+j*CELL
    lon=x/KX+lon0; lat=-zz/KY+lat0
    H.append(elev_ll(lon,lat))
H=np.array(H); base=float(H.min())
terrain={'minx':round(minx,1),'minz':round(minz,1),'cell':CELL,'nx':nx,'nz':nz,'base':round(base,1),'h':[int(round((h-base)*10)) for h in H]}
Hg=H.reshape(nz,nx)-base
def elev(x,zz):
  fx=(x-minx)/CELL; fz=(zz-minz)/CELL
  i=min(max(int(fx),0),nx-2); j=min(max(int(fz),0),nz-2); dx=fx-i; dz=fz-j
  return Hg[j,i]*(1-dx)*(1-dz)+Hg[j,i+1]*dx*(1-dz)+Hg[j+1,i]*(1-dx)*dz+Hg[j+1,i+1]*dx*dz
# ---- roads
seg=json.load(open(f'{D}/seg.geojson'))
def oneway_of(p):
  # Overture marks a one-way road by denying travel against its digitised direction: heading=backward -> forward only
  d = set()
  for a in p.get('access_restrictions') or []:
    w = a.get('when') or {}
    if a.get('access_type') != 'denied' or w.get('heading') not in ('forward', 'backward') or a.get('between'): continue
    if w.get('during') or w.get('using') or w.get('vehicle'): continue
    if w.get('mode') and not set(w['mode']) & {'vehicle', 'motor_vehicle', 'car'}: continue
    d.add(w['heading'])
  return 1 if d == {'backward'} else -1 if d == {'forward'} else 0
def speed_of(p):
  best = None
  for s in p.get('speed_limits') or []:
    m = s.get('max_speed')
    if m and not s.get('when') and not s.get('between'):
      v = m['value'] * (0.621371 if m.get('unit') == 'km/h' else 1); best = round(v) if best is None else min(best, round(v))
  return best
# carriageway width when the road is one-way (a divided road is drawn as two of these)
OWW={'motorway':14,'primary':16,'secondary':12,'tertiary':9,'residential':7.5,'unclassified':7.5,'service':4.5,'unknown':5}
WID={'motorway':22,'primary':20,'secondary':14,'tertiary':11,'residential':9,'unclassified':8,'service':4.5,'unknown':5}
roads=[]; walks=[]; blocklines=[]
for f in seg['features']:
  p=f['properties']; cls=p.get('class'); sub=p.get('subclass')
  full=tr(shape(f['geometry'])); g=full.intersection(clip)
  if g.is_empty: continue
  parts = list(g.geoms) if hasattr(g,'geoms') else [g]
  name=(p.get('names') or {}).get('primary')
  for part in parts:
    if part.geom_type!='LineString' or part.length<1: continue
    pts=[[round(a,1),round(b,1)] for a,b in part.coords]
    if cls in ('footway','path','steps','pedestrian','cycleway'):
      walks.append({'k':sub or cls,'p':pts})
    elif cls in WID:
      w=WID[cls]
      if sub=='driveway': w=3.2
      if sub=='parking_aisle': w=5
      if sub=='link': w=7
      ow=oneway_of(p) if cls not in ('service','unknown') or sub=='alley' else 0
      if ow==-1: pts=pts[::-1]
      if ow and sub!='link' and sub!='driveway': w=OWW[cls]
      r={'c':cls,'s':sub,'n':name,'w':w,'p':pts}
      if ow: r['ow']=1
      if full.geom_type=='LineString' and (p.get('road_flags') or p.get('level_rules')):  # bridges and tunnels: spans in metres along the edge (tools/pack/levels.py)
        s0=full.project(Point(part.coords[0])); s1=full.project(Point(part.coords[-1])); lo=min(s0,s1)
        sp=levels.part_spans(p,cls,sub,full.length,lo,lo+part.length,flip=(s1<s0)!=(ow==-1))
        if sp: r['lv']=sp
      sp=speed_of(p)
      if sp: r['sp']=sp
      roads.append(r)
      if cls not in ('service','unknown') or sub=='alley':
        blocklines.extend((q,w) for q in levels.at_grade(LineString(pts),r.get('lv')))
# ---- blocks
lines=unary_union([l for l,_ in blocklines]+[clip.exterior])
polys=list(polygonize(lines))
roadbuf=unary_union([l.buffer(w/2+1.5, cap_style=2) for l,w in blocklines])
blocks=[]
for pg in polys:
  b=pg.difference(roadbuf)
  for q in (b.geoms if hasattr(b,'geoms') else [b]):
    if q.geom_type=='Polygon' and q.area>150: blocks.append(q)
# ---- buildings
bld=json.load(open(f'{D}/bld.geojson'))
buildings=[]
for f in bld['features']:
  p=f['properties']; g=tr(shape(f['geometry']))
  if not g.centroid.within(clip): continue
  if g.geom_type=='MultiPolygon': g=max(g.geoms,key=lambda q:q.area)
  g=g.simplify(0.4)
  h=p.get('height'); fl=p.get('num_floors')
  if h is None: h=(fl or (1 if g.area<300 else 2))*3.3
  ring=[[round(a,1),round(b,1)] for a,b in list(g.exterior.coords)[:-1]]
  if len(ring)<3: continue
  ys=[elev(a,b) for a,b in ring]
  buildings.append({'r':ring,'h':round(float(h),1),'b':round(float(min(ys)),2),'t':p.get('subtype') or 'unknown','a':round(g.area)})
# ---- addresses -> lots
ad=json.load(open(f'{D}/addr.geojson'))
seen={}; 
for f in ad['features']:
  p=f['properties']; x,zz=P(*f['geometry']['coordinates'][:2])
  if not clip.contains(Point(x,zz)): continue
  st=(p.get('street') or '').title().replace(' De La ',' de la ')
  num=p.get('number'); 
  if not num or not st: continue
  key=(round(x),round(zz))
  seen.setdefault(key,[]).append(f'{num} {st}')
apts=[(Point(k),sorted(set(v))) for k,v in seen.items()]
lots=[]
from shapely import STRtree
tree=STRtree([b for b in blocks])
bpts={}
for pt,labels in apts:
  idx=tree.query(pt.buffer(25))
  best=None;bd=1e9
  for i in idx:
    d=blocks[i].distance(pt)
    if d<bd: bd=d;best=i
  if best is not None and bd<25: bpts.setdefault(best,[]).append((pt,labels))
for bi,items in bpts.items():
  blk=blocks[bi]
  if len(items)==1: cells=[blk]
  else:
    vor=shapely.voronoi_polygons(MultiPoint([p for p,_ in items]), extend_to=blk.buffer(50))
    cells=[]
    for p,_ in items:
      c=[v for v in vor.geoms if v.contains(p) or v.distance(p)<0.01]
      cells.append(c[0].intersection(blk) if c else p.buffer(5))
  for (p,labels),c in zip(items,cells):
    if c.is_empty: continue
    if c.geom_type!='Polygon': c=max([q for q in getattr(c,'geoms',[c]) if q.geom_type=='Polygon'],key=lambda q:q.area,default=None)
    if c is None or c.area<40: continue
    c=c.simplify(0.3)
    ring=[[round(a,1),round(b,1)] for a,b in list(c.exterior.coords)[:-1]]
    cx,cz=c.representative_point().coords[0]
    lots.append({'r':ring,'a':labels,'c':[round(cx,1),round(cz,1)],'e':round(float(elev(cx,cz)),2),'m2':round(c.area)})
# link buildings to lots
ltree=STRtree([Polygon(l['r']) for l in lots])
lpolys=[Polygon(l['r']) for l in lots]
for bi,b in enumerate(buildings):
  c=Polygon(b['r']).centroid
  for i in ltree.query(c):
    if lpolys[i].contains(c): b['l']=int(i); break
pack={'v':1,'origin':[lon0,lat0],'bbox':[W,S,E,N],'terrain':terrain,'roads':roads,'walks':walks,'buildings':buildings,'lots':lots,
 'sources':{'roads':'Overture Maps transportation 2026-10-21.0 (from OpenStreetMap, ODbL)','buildings':'Overture Maps buildings 2026-10-21.0 (OSM, Microsoft, Google Open Buildings)','addresses':'Overture Maps addresses 2026-10-21.0','terrain':'AWS Terrain Tiles z15 (USGS 3DEP in the US)'}}
s=json.dumps(pack,separators=(',',':'))
open(sys.argv[2],'w').write(s)
print(len(roads),'roads',len(walks),'walks',len(buildings),'buildings',len(blocks),'blocks',len(lots),'lots',len(s)//1024,'KB', 'relief',round(float(H.max()-base),1),'m', 'size',round(maxx-minx),round(maxz-minz))
print(sum(1 for b in buildings if 'l' in b),'buildings on lots')
