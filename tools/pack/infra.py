#!/usr/bin/env python3
"""Real infrastructure layers for an area: public/areas/<id>.infra.json (a sidecar, like <id>.bg.json).

Only what public data actually has (nate: no modeled utilities):
  lights        City of LA Bureau of Street Lighting   [x, z, watts, led 0/1, as-built 0/1]
  hydrants      City of LA Fire Department layer       [x, z, size code, street]
  stops         LA Metro bus stops + ridership (2022)  [x, z, name, [lines], avg boardings per day]
  transmission  California Energy Commission           {kv, owner, p: [x, z, ...]}
  power         Overture base/infrastructure (OSM)     lines {k, kv, p} and points [class, x, z]
There are no public water mains, gas or LADWP distribution lines, so none are drawn.

    python tools/pack/infra.py --id canoga-park              # fetch live (needs maps.lacity.org and arcgis.com)
    python tools/pack/infra.py --all                         # every area in public/areas/index.json
    python tools/pack/infra.py --all --raw DIR               # read <layer>-<id>.geojson + transmission-sfv.geojson from DIR

build_area.py calls build() after the pack is written. Coordinates match the pack: x east, z south, metres
from pack['origin'], KY = 110540 like pack_v1.py.
"""
from concurrent.futures import ThreadPoolExecutor
import argparse, json, math, os, re, sys, time, urllib.parse, urllib.request
from collections import OrderedDict

HERE = os.path.dirname(os.path.abspath(__file__))
AREAS = os.path.abspath(os.path.join(HERE, '..', '..', 'public', 'areas'))
PAD = 0.003
LAYERS = {
    'lights': 'https://maps.lacity.org/lahub/rest/services/Bureau_of_Street_Lighting/MapServer/0',
    'hydrants': 'https://maps.lacity.org/lahub/rest/services/Fire_Department/MapServer/0',
    'busstops': 'https://services.arcgis.com/RmCCgQtiZLDCtblq/arcgis/rest/services/Metro_Bus_Stations/FeatureServer/2',
    'transmission': 'https://services1.arcgis.com/qDIoVrQGSaQYXp0A/arcgis/rest/services/Transmission_Line/FeatureServer/100',
}
SOURCES = [
    {'layer': 'lights', 'name': 'City of LA Bureau of Street Lighting', 'url': LAYERS['lights']},
    {'layer': 'hydrants', 'name': 'City of LA Fire Department (hydrants)', 'url': LAYERS['hydrants']},
    {'layer': 'stops', 'name': 'LA Metro bus stops and ridership', 'url': LAYERS['busstops']},
    {'layer': 'transmission', 'name': 'California Energy Commission transmission lines', 'url': LAYERS['transmission']},
    {'layer': 'power', 'name': 'Overture Maps base/infrastructure (OpenStreetMap)', 'license': 'ODbL'},
]
POWER_PTS = ('power_pole', 'power_tower', 'substation', 'transformer', 'generator', 'plant')
POWER_LINES = ('power_line', 'minor_line', 'cable')


def arcgis(url, bbox, get, page=1000):
    """All features of one ArcGIS layer touching bbox (W,S,E,N), as GeoJSON features."""
    feats, off = [], 0
    while True:
        q = {'where': '1=1', 'geometry': ','.join(map(str, bbox)), 'geometryType': 'esriGeometryEnvelope', 'inSR': 4326,
             'spatialRel': 'esriSpatialRelIntersects', 'outFields': '*', 'outSR': 4326, 'f': 'geojson',
             'resultOffset': off, 'resultRecordCount': page}
        d = get(url + '/query?' + urllib.parse.urlencode(q))
        got = d.get('features') or []
        feats += got
        if len(got) < page and not (d.get('properties') or {}).get('exceededTransferLimit') and not d.get('exceededTransferLimit'): break
        off += len(got)
        if not got: break
    return feats


def _get(url, tries=2):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'renovated-area-builder'}), timeout=120) as r:
                return json.loads(r.read())
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(1.5 * (k + 1))
    raise RuntimeError(f'{url[:90]}... failed: {last}')


def lines_of(g):
    if not g: return []
    if g['type'] == 'LineString': return [g['coordinates']]
    if g['type'] == 'MultiLineString': return g['coordinates']
    return []


def convert(pack, raw, power_feats):
    """raw: {'lights': feats, 'hydrants': feats, 'busstops': feats, 'transmission': feats}."""
    lon0, lat0 = pack['origin']; KX = math.cos(math.radians(lat0)) * 111320; KY = 110540
    P = lambda lon, lat: [round((lon - lon0) * KX, 1), round(-(lat - lat0) * KY, 1)]
    W, S, E, N = pack['bbox']; (X0, Z1), (X1, Z0) = P(W, S), P(E, N)
    X0, X1, Z0, Z1 = X0 - 60, X1 + 60, Z0 - 60, Z1 + 60
    inb = lambda q, m=0: X0 - m <= q[0] <= X1 + m and Z0 - m <= q[1] <= Z1 + m
    pt = lambda f: P(*f['geometry']['coordinates'][:2]) if f.get('geometry') and f['geometry'].get('type') == 'Point' else None
    o = {'v': 1, 'sources': SOURCES}
    L = []
    for f in raw.get('lights', []):
        q = pt(f)
        if not q or not inb(q): continue
        p = f['properties']; lamp = (p.get('LAMPA') or '').strip(); w = re.match(r'(\d+)', lamp)
        L.append([*q, int(w.group(1)) if w else 0, 1 if 'LED' in lamp.upper() else 0, 1 if p.get('STATUS') == 'AsBuilt' else 0])
    o['lights'] = L
    H = []
    for f in raw.get('hydrants', []):
        q = pt(f)
        if not q or not inb(q): continue
        p = f['properties']; m = re.search(r'Street: ([^\\\n]+)', p.get('TOOLTIP') or '')
        H.append([*q, (p.get('SIZE_CODE') or '').strip(), m.group(1).strip().title() if m else ''])
    o['hydrants'] = H
    st = OrderedDict()
    for f in raw.get('busstops', []):
        q = pt(f)
        if not q or not inb(q): continue
        p = f['properties']
        s = st.setdefault(p.get('STOP_ID'), {'q': q, 'n': (p.get('STOP_NAME') or '').title(), 'lines': set(), 'ons': 0})
        if p.get('LINE') is not None: s['lines'].add(p['LINE'])
        s['ons'] += p.get('Avg_Ons') or 0
    o['stops'] = [[*s['q'], s['n'], sorted(s['lines']), s['ons']] for s in st.values()]
    T = []
    for f in raw.get('transmission', []):
        pr = f.get('properties') or {}
        for ln in lines_of(f.get('geometry')):
            run = []
            for c in ln + [None]:
                q = P(*c[:2]) if c else None
                if q and inb(q, 900): run.append(q); continue
                if len(run) > 1: T.append({'kv': pr.get('kV'), 'owner': pr.get('Owner'), 'p': [v for r in run for v in r]})
                run = []
    o['transmission'] = T
    pl, pp = [], []
    for f in power_feats:
        pr = f.get('properties') or {}; c = pr.get('class'); g = f.get('geometry') or {}
        if pr.get('subtype') != 'power': continue
        tags = pr.get('source_tags') or {}
        kv = tags.get('voltage') if isinstance(tags, dict) else None
        if c in POWER_LINES:
            for ln in lines_of(g):
                p = [P(*q[:2]) for q in ln]
                if any(inb(q, 300) for q in p): pl.append({'k': c, 'kv': kv, 'p': [v for q in p for v in q]})
        elif c in POWER_PTS:
            if g.get('type') == 'Point': q = P(*g['coordinates'][:2])
            elif g.get('type') == 'Polygon': ring = g['coordinates'][0]; q = P(sum(a[0] for a in ring) / len(ring), sum(a[1] for a in ring) / len(ring))
            else: continue
            if inb(q, 300): pp.append([c, *q])
    o['power'] = {'lines': pl, 'pts': pp}
    return o


def build(pack_path, out_path, get=_get, power_geojson=None, raw_dir=None, area_id=None, log=print):
    pack = json.load(open(pack_path))
    W, S, E, N = pack['bbox']; box = (W - PAD, S - PAD, E + PAD, N + PAD)
    raw = {}

    def one(item):  # the four layers are independent servers: ask them all at once
        k, url = item
        try:
            if raw_dir:
                f = os.path.join(raw_dir, 'transmission-sfv.geojson' if k == 'transmission' else f'{k}-{area_id}.geojson')
                feats = json.load(open(f))['features'] if os.path.exists(f) else []
            else:
                feats = arcgis(url, (box if k != 'transmission' else (W - 0.02, S - 0.02, E + 0.02, N + 0.02)), get)
            log(f'{k}: {len(feats)} features'); return k, feats
        except Exception as e:  # noqa: BLE001
            log(f'{k} unavailable ({type(e).__name__}: {e})'); return k, []
    with ThreadPoolExecutor(len(LAYERS)) as ex:
        raw = dict(ex.map(one, LAYERS.items()))
    power = []
    if power_geojson and os.path.exists(power_geojson): power = json.load(open(power_geojson))['features']
    o = convert(pack, raw, power)
    json.dump(o, open(out_path, 'w'), separators=(',', ':'))
    return {k: len(o[k]) for k in ('lights', 'hydrants', 'stops', 'transmission')} | {'power': len(o['power']['lines']) + len(o['power']['pts'])}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id'); ap.add_argument('--all', action='store_true')
    ap.add_argument('--raw', help='folder of pre-fetched <layer>-<id>.geojson files')
    ap.add_argument('--power', help='folder of Overture infrastructure geojson as <id>.infra-ov.geojson (default: fetch with ov.py)')
    ap.add_argument('--no-power', action='store_true')
    a = ap.parse_args()
    mpath = os.path.join(AREAS, 'index.json'); manifest = json.load(open(mpath))
    ids = [x['id'] for x in manifest['areas'] if x.get('pack')] if a.all else [a.id]
    for aid in ids:
        entry = next(x for x in manifest['areas'] if x['id'] == aid)
        pp = None
        if not a.no_power:
            pp = os.path.join(a.power, f'{aid}.infra-ov.geojson') if a.power else None
            if not pp or not os.path.exists(pp):
                sys.path.insert(0, HERE); import ov
                W, S, E, N = entry['bbox']; pp = os.path.join(HERE, 'work', f'{aid}.infra-ov.geojson'); os.makedirs(os.path.dirname(pp), exist_ok=True)
                ov.fetch('base', 'infrastructure', pp, (W - 0.004, S - 0.004, E + 0.004, N + 0.004))
        n = build(os.path.join(AREAS, entry['pack']), os.path.join(AREAS, f'{aid}.infra.json'), power_geojson=pp, raw_dir=a.raw, area_id=aid, log=lambda m: print(f'  {aid}: {m}'))
        entry['infra'] = f'{aid}.infra.json'
        print(aid, n)
    json.dump(manifest, open(mpath + '.tmp', 'w'), indent=1); os.replace(mpath + '.tmp', mpath)


if __name__ == '__main__':
    main()
