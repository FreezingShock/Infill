"""Street-tree sidecar: public/areas/<id>.streets.json, from the City of LA Street Tree Inventory (data.lacity.org vt5t-mscf, CC0).

The inventory's coordinates are rounded to 3 decimals (about 100 m), so single trees cannot be placed from it. What it does give
reliably is, per street, how many trees were planted and which species, so the game plants each named street at that density with
that mix of tree shapes. (1990s survey: streets planted since then are under-counted.)

  python3 build_street_trees.py --pack ../../public/areas/wh-topanga.json [--trees work/trees.json]
Needs network access to data.lacity.org unless --trees (a saved copy of the query below) is given.
"""
import argparse, json, math, re, urllib.parse, urllib.request
from collections import Counter, defaultdict
ap = argparse.ArgumentParser(); ap.add_argument('--pack', required=True); ap.add_argument('--trees'); ap.add_argument('--out')
a = ap.parse_args()
pack = json.load(open(a.pack)); W, S, E, N = pack['bbox']
if a.trees: rows = json.load(open(a.trees))
else:
    q = urllib.parse.urlencode({'$where': f'x between {W - 0.001} and {E + 0.001} AND y between {S - 0.001} and {N + 0.001}', '$limit': 20000, '$select': 'on_strt,common,x,y'})
    rows = json.load(urllib.request.urlopen('https://data.lacity.org/resource/vt5t-mscf.json?' + q, timeout=120))
SUF = {'rd': 'road', 'st': 'street', 'av': 'avenue', 'ave': 'avenue', 'dr': 'drive', 'bl': 'boulevard', 'blvd': 'boulevard', 'ln': 'lane', 'ct': 'court', 'pl': 'place', 'wy': 'way', 'cir': 'circle', 'ter': 'terrace'}
def norm(s): return ' '.join(SUF.get(w, w) for w in re.sub(r'[^a-z ]', ' ', (s or '').lower()).split())
def kind(common):
    c = (common or '').upper()
    if any(k in c for k in ('CYPRESS', 'PINE', 'CEDAR', 'REDWOOD', 'JUNIPER', 'FIR')): return 1
    if 'PALM' in c: return 2
    return 0
per = defaultdict(list)
for r in rows:
    c = (r.get('common') or '').upper()
    if any(k in c for k in ('VACANT', 'STUMP', 'EMPTY', 'NO TREE')): continue   # planting sites, not trees
    if r.get('on_strt') and r['on_strt'] != 'NULL': per[norm(r['on_strt'])].append(r.get('common'))
length = Counter()
for e in pack['edges']:
    if e.get('n') and e.get('s') != 'driveway': length[norm(e['n'])] += sum(math.hypot(q[0] - p[0], q[1] - p[1]) for p, q in zip(e['p'], e['p'][1:]))
out = {}
for name, L in length.items():
    t = per.get(name, [])
    if len(t) < 4 or L < 40: continue
    spacing = max(7.0, min(40.0, 2 * L / len(t)))
    kinds = Counter(kind(c) for c in t); mix = [k for k, n in sorted(kinds.items()) for _ in range(max(1, round(8 * n / len(t))))]
    top = [c.title() for c, _ in Counter(c for c in t if c and c != 'NULL').most_common(3)]
    out[name] = {'sp': round(spacing, 1), 'k': mix[:8], 'top': top}
o = a.out or a.pack.replace('.json', '.streets.json')
json.dump({'v': 1, 'src': 'City of LA Street Tree Inventory (1990s), CC0', 'streets': out}, open(o, 'w'), separators=(',', ':'))
print(len(rows), 'trees,', len(out), 'streets planted; wrote', o)
