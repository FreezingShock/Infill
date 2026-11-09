#!/usr/bin/env python3
"""Build (or refresh) one area pack from open data, start to finish.

    python tools/pack/build_area.py --id canoga-park --name "Canoga Park" --bbox -118.6082,34.1955,-118.5958,34.2065
    python tools/pack/build_area.py --id wh-topanga --refresh        # re-pull the data, keep ids stable

What it does: Overture roads/buildings/addresses/parking/land use, AWS terrain tiles, then (inside the
City of LA) BOE parcels with county AIN, zoning, general plan, addresses and permits from data.lacity.org.
Outside the city it falls back to estimated lots. It writes public/areas/<id>.json and the area's entry in
public/areas/index.json. With --refresh the previous pack is read so lots and streets keep their ids
(saved edits point at them).

Progress goes to stdout as lines starting with "@@" followed by JSON, which the dev server relays to the
game's "Load an area" screen. Every line carries the stage it belongs to (STAGES below) so the screen can show a
staged progress bar. First run creates tools/pack/.venv and installs the Python packages.

Speed: the downloads (five Overture layers, terrain tiles, seven City of LA datasets) run at the same time, Overture
reads use the committed row-group index (ov.py) instead of scanning hundreds of files, and the surroundings and the
real-infrastructure sidecars are built side by side at the end.

--custom puts the area under public/areas/custom/ (listed in custom/index.json, git-ignored) so areas the player
builds stay out of the repo; the picker lists, exports and removes those.
"""
import argparse, datetime, json, math, os, subprocess, sys, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
AREAS = os.path.join(ROOT, 'public', 'areas')
DEPS = ['s3fs', 'pyarrow', 'shapely', 'pillow', 'numpy']
MAX_SIDE_M = 3400  # the game draws far lots as cheap massing and builds detail near the camera (src/app/lod.js)


# The stages the picker shows, in order. Each say() names one of them.
STAGES = [('data', 'Open data'), ('streets', 'Streets and blocks'), ('lots', 'Lots and buildings'), ('imagery', 'Aerial check'), ('extras', 'Surroundings and street furniture'), ('save', 'Saving')]
STAGE_OF = {'setup': 'data', 'overture': 'data', 'terrain': 'data', 'city': 'data', 'streets': 'streets', 'lots': 'lots', 'imagery': 'imagery', 'bulbs': 'imagery',
            'backdrop': 'extras', 'infra': 'extras', 'save': 'save', 'done': 'save'}
T0 = time.time()


def say(step, msg, pct=None, **kw):
    print('@@' + json.dumps({'step': step, 'stage': STAGE_OF.get(step), 'msg': msg, 'pct': pct, 't': round(time.time() - T0, 1), **kw}), flush=True)


def ensure_deps():
    try:
        import s3fs, pyarrow, shapely, PIL, numpy  # noqa: F401
        return
    except ImportError:
        pass
    if os.environ.get('RENOVATED_PACK_VENV'):
        raise SystemExit('Python packages are still missing after installing into the venv: ' + ' '.join(DEPS))
    say('setup', 'First run: installing the map-data Python packages (one time, a minute or two)', 2)
    venv = os.path.join(HERE, '.venv')
    py = os.path.join(venv, 'Scripts' if os.name == 'nt' else 'bin', 'python')
    if not os.path.exists(py):
        subprocess.check_call([sys.executable, '-m', 'venv', venv])
    subprocess.check_call([py, '-m', 'pip', 'install', '-q', *DEPS])
    os.environ['RENOVATED_PACK_VENV'] = '1'
    raise SystemExit(subprocess.call([py, os.path.abspath(__file__), *sys.argv[1:]]))


def get(url, tries=4, binary=False):
    last = None
    for k in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'renovated-area-builder'}), timeout=120) as r:
                d = r.read()
                return d if binary else json.loads(d)
        except Exception as e:  # noqa: BLE001
            last = e; time.sleep(1.5 * (k + 1))
    raise RuntimeError(f'{url[:90]}... failed: {last}')


def socrata(dataset, bbox, kind, extra=''):
    W, S, E, N = bbox
    if kind == 'geojson':
        poly = f"POLYGON(({W} {S},{E} {S},{E} {N},{W} {N},{W} {S}))"
        where = f"intersects(the_geom,'{poly}')"
        ext = 'geojson'
    else:
        where = f"within_box({kind},{S},{W},{N},{E})"
        ext = 'json'
    q = urllib.parse.urlencode({'$where': where, '$limit': 50000}) + extra
    return get(f'https://data.lacity.org/resource/{dataset}.{ext}?{q}')


def tile_of(lon, lat, z=15):
    n = 2 ** z
    return int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n)


def custom_paths(custom):
    """(output folder, manifest path, file-name prefix used inside manifest entries)."""
    if custom:
        d = os.path.join(AREAS, 'custom'); os.makedirs(d, exist_ok=True)
        m = os.path.join(d, 'index.json')
        if not os.path.exists(m): json.dump({'areas': []}, open(m, 'w'), indent=1)
        return d, m, 'custom/'
    return AREAS, os.path.join(AREAS, 'index.json'), ''


def download_city(work, bbox):
    """City of LA datasets for the box, all asked at once. Returns (file list, parcel piece count) or ([], 0)."""
    W, S, E, N = bbox
    def permit(ds):
        try:
            return get(f'https://data.lacity.org/resource/{ds}.json?' + urllib.parse.urlencode({
                '$where': f"within_box(geolocation,{S},{W},{N},{E}) and status_desc like 'CofO%'", '$limit': 50000,
                '$select': 'apn,pin_nbr,issue_date,permit_sub_type,du_changed,adu_changed,height,primary_address,status_desc'}))
        except Exception:  # noqa: BLE001
            return []
    adr_q = 'https://data.lacity.org/resource/4ca8-mxuh.json?' + urllib.parse.urlencode({'$where': f'lat between {S} and {N} and lon between {W} and {E}', '$limit': 50000})
    with ThreadPoolExecutor(7) as ex:
        f_parc = ex.submit(socrata, 'qyra-qm2s', bbox, 'geojson')
        f_zon = ex.submit(socrata, 'jjxn-vhan', bbox, 'geojson'); f_gpl = ex.submit(socrata, 'c3g2-yzgc', bbox, 'geojson')
        f_adr = ex.submit(get, adr_q); f_perm = [ex.submit(permit, ds) for ds in ['e67z-kt2n', 'dyxf-7hc4', 'pi9x-tg5x']]
        parc = f_parc.result()
        if len(parc.get('features', [])) <= 20:
            return [], len(parc.get('features', []))
        data = [('parc.geojson', parc), ('zon.geojson', f_zon.result()), ('gpl.geojson', f_gpl.result()), ('addr_city.json', f_adr.result())] + [(f'new_{k}.json', f.result()) for k, f in enumerate(f_perm)]
    files = []
    for nm, d in data:
        p = os.path.join(work, nm); json.dump(d, open(p, 'w')); files.append(p)
    return files, len(parc['features'])


def download_terrain(work, bbox):
    W, S, E, N = bbox
    (x0, y0), (x1, y1) = tile_of(W, N), tile_of(E, S)
    todo = [(x, y) for x in range(x0, x1 + 2) for y in range(y0, y1 + 2) if not os.path.exists(os.path.join(work, f't_{x}_{y}.png'))]
    def one(xy):
        x, y = xy
        open(os.path.join(work, f't_{x}_{y}.png'), 'wb').write(get(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/{x}/{y}.png', binary=True))
    with ThreadPoolExecutor(6) as ex:
        list(ex.map(one, todo))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--id', required=True)
    ap.add_argument('--name'); ap.add_argument('--sub')
    ap.add_argument('--bbox', help='W,S,E,N in lon/lat')
    ap.add_argument('--refresh', action='store_true', help='rebuild an existing area, keeping lot and street ids')
    ap.add_argument('--no-city', action='store_true', help='skip City of LA data (estimated lots)')
    ap.add_argument('--custom', action='store_true', help='keep the area under public/areas/custom/ (git-ignored) instead of the shared list')
    a = ap.parse_args()
    os.makedirs(AREAS, exist_ok=True)
    custom = a.custom
    if not custom and os.path.exists(os.path.join(AREAS, 'custom', 'index.json')):  # refreshing an area that was built as custom
        custom = any(x['id'] == a.id for x in json.load(open(os.path.join(AREAS, 'custom', 'index.json')))['areas'])
    OUT, mpath, pre = custom_paths(custom)
    manifest = json.load(open(mpath))
    entry = next((x for x in manifest['areas'] if x['id'] == a.id), None)
    if a.refresh and not entry: raise SystemExit(f'No area "{a.id}" to refresh')
    if not a.refresh and not entry and any(x['id'] == a.id for x in json.load(open(os.path.join(AREAS, 'index.json')))['areas']):
        raise SystemExit(f'"{a.id}" is already an area. Pick another name.')
    bbox = tuple(map(float, a.bbox.split(','))) if a.bbox else (tuple(entry['bbox']) if entry else None)
    if not bbox: raise SystemExit('--bbox W,S,E,N is required for a new area')
    W, S, E, N = bbox
    ky, kx = 110540, math.cos(math.radians((S + N) / 2)) * 111320
    if not (W < E and S < N): raise SystemExit('bbox must be W,S,E,N with W<E and S<N')
    if (E - W) * kx > MAX_SIDE_M or (N - S) * ky > MAX_SIDE_M:
        raise SystemExit(f'Area is {round((E - W) * kx)} x {round((N - S) * ky)} m; keep each side under {MAX_SIDE_M} m')
    say('plan', 'Starting', 0, stages=[{'id': i, 'label': l} for i, l in STAGES])
    ensure_deps()
    sys.path.insert(0, HERE)
    import ov
    work = os.path.join(HERE, 'work', a.id); os.makedirs(work, exist_ok=True)
    out = os.path.join(OUT, f'{a.id}.json')
    prev = out if a.refresh and os.path.exists(out) else None
    pad = 0.0006
    wide = (W - pad, S - pad, E + pad, N + pad)

    # ---- stage 1: everything that is downloaded, at the same time
    say('overture', 'Downloading roads, buildings, addresses, parking and land use, terrain and City of LA records', 4)
    jobs = [('transportation', 'segment', 'seg'), ('buildings', 'building', 'bld'), ('addresses', 'address', 'addr'), ('base', 'infrastructure', 'infra'), ('base', 'land_use', 'lu')]
    city, parcels, left = [], 0, {'n': len(jobs) + 2}
    def tick(msg):
        left['n'] -= 1; say('overture', msg, 4 + round(26 * (len(jobs) + 2 - left['n']) / (len(jobs) + 2)))
    with ThreadPoolExecutor(8) as ex:
        fs = [ex.submit(ov.fetch, j[0], j[1], os.path.join(work, j[2] + '.geojson'), wide) for j in jobs]
        f_ter = ex.submit(download_terrain, work, bbox)
        f_city = None if a.no_city else ex.submit(download_city, work, bbox)
        for f, j in zip(fs, jobs): f.result(); tick(f'{j[1].replace("_", " ").title()} data ready')
        f_ter.result(); tick('Terrain tiles ready')
        if f_city:
            try: city, parcels = f_city.result()
            except Exception as e:  # noqa: BLE001
                say('city', f'City of LA data unavailable ({e}); using estimated lots', 34)
            else: say('city', f'{parcels} City of LA parcel pieces found' if city else 'No City of LA parcels here (outside the city): using estimated lots', 36)
            tick('City of LA records checked')
        else: tick('City records skipped')

    bb = ','.join(map(str, bbox))
    say('streets', 'Building streets, blocks and terrain', 40)
    v1 = os.path.join(work, 'pack_v1.json')
    v1env = dict(os.environ)
    if prev:  # same origin as the pack being refreshed: growing or moving the box must not shift existing coordinates
        o = json.load(open(prev))['origin']; v1env['PACK_ORIGIN'] = f'{o[0]},{o[1]}'
    subprocess.check_call([sys.executable, os.path.join(HERE, 'pack_v1.py'), work, v1, bb], stdout=subprocess.DEVNULL, env=v1env)
    say('lots', 'Cutting lots, placing buildings, parking and props', 58)
    tmp = out + '.tmp'
    env = dict(os.environ, PREV_PACK=prev or '')
    args = [sys.executable, os.path.join(HERE, 'pack2.py'), v1, os.path.join(work, 'infra.geojson'), os.path.join(work, 'lu.geojson'), tmp]
    if city: args += city
    log = subprocess.run(args, env=env, capture_output=True, text=True)
    if log.returncode: raise SystemExit('pack2 failed:\n' + log.stderr[-1500:])
    pack = json.load(open(tmp))
    pack['built'] = datetime.date.today().isoformat()
    try:  # aerial imagery (NAIP) checks and trims recognised paving; without it the map-data rules stand
        import naip, recognize
        say('imagery', 'Checking paved areas against aerial imagery (NAIP)', 72)
        mask = naip.fetch_mask(pack, os.path.join(work, 'naip'), log=lambda m: say('imagery', m, 76))
        if mask is not None: recognize.apply(pack, mask)
    except Exception as e:  # noqa: BLE001
        say('imagery', f'Imagery check skipped ({type(e).__name__}: {e})', 78)
    try:  # cul-de-sac bulbs from the parcels around dead-end streets (no network needed)
        import bulbs, rowwidth
        say('bulbs', f'Right-of-way width on {rowwidth.apply(pack)} streets, {bulbs.apply(pack)} cul-de-sac turnarounds', 80)
    except Exception as e:  # noqa: BLE001
        say('bulbs', f'Cul-de-sac check skipped ({type(e).__name__}: {e})', 80)
    json.dump(pack, open(tmp, 'w'), separators=(',', ':'))
    os.replace(tmp, out)

    # ---- the surroundings and the street-furniture sidecar do not depend on each other: build them side by side
    say('backdrop', 'Drawing the surrounding map and linking street lights, hydrants, stops and power lines', 82)
    def make_bg():
        try:  # the blurred surroundings are a nice-to-have: never fail the build over them
            import backdrop
            bgp = os.path.join(OUT, f'{a.id}.bg.json')
            backdrop.build(out, bgp + '.tmp', os.path.join(work, 'ring'), get, ov, log=lambda m: say('backdrop', m, 88))
            os.replace(bgp + '.tmp', bgp); return f'{pre}{a.id}.bg.json'
        except Exception as e:  # noqa: BLE001
            say('backdrop', f'Surroundings skipped ({type(e).__name__}: {e})', 90)
    def make_infra():
        try:  # real lights, hydrants, stops and power lines for the scan view; never fail the build over them
            import infra as infra_mod
            ip = os.path.join(OUT, f'{a.id}.infra.json')
            infra_mod.build(out, ip + '.tmp', get, os.path.join(work, 'infra.geojson'), log=lambda m: say('infra', m, 92))
            os.replace(ip + '.tmp', ip); return f'{pre}{a.id}.infra.json'
        except Exception as e:  # noqa: BLE001
            say('infra', f'Infrastructure skipped ({type(e).__name__}: {e})', 94)
    with ThreadPoolExecutor(2) as ex:
        f_bg, f_inf = ex.submit(make_bg), ex.submit(make_infra)
        bg, infra = f_bg.result(), f_inf.result()

    say('save', 'Naming the area and saving', 96)
    # name the area from its roads when the caller did not
    from collections import defaultdict
    tot = defaultdict(float)
    for e in pack['edges']:
        if e.get('n') and e['c'] in ('primary', 'secondary', 'tertiary', 'motorway'):
            tot[e['n']] += sum(math.dist(p, q) for p, q in zip(e['p'], e['p'][1:]))
    top = sorted(tot, key=tot.get, reverse=True)
    main_name = (entry or {}).get('main') or (top[0].split(' ')[0] if top else a.name or a.id)
    sub = a.sub or (entry or {}).get('sub') or (' and '.join(top[:2]) if top else '')
    new = {'id': a.id, 'name': a.name or (entry or {}).get('name') or a.id.replace('-', ' ').title(), 'sub': sub, 'main': main_name,
           'bbox': list(bbox), 'pack': f'{pre}{a.id}.json', 'status': 'ready', 'built': pack['built'], 'lots': len(pack['lots']),
           'parcels': 'city' if city else 'estimated'}
    if custom: new['custom'] = True
    if bg: new['bg'] = bg
    if infra: new['infra'] = infra
    manifest['areas'] = [new if x['id'] == a.id else x for x in manifest['areas']] if entry else manifest['areas'] + [new]
    json.dump(manifest, open(mpath + '.tmp', 'w'), indent=1); os.replace(mpath + '.tmp', mpath)
    say('done', f'{new["name"]}: {len(pack["lots"])} lots, {len(pack["edges"])} streets', 100, area=new, log=log.stdout[-600:])


if __name__ == '__main__':
    try:
        main()
    except SystemExit as e:
        if e.code not in (0, None): say('error', str(e.code)); raise
    except Exception as e:  # noqa: BLE001
        say('error', f'{type(e).__name__}: {e}'); raise
