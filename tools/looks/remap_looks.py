"""Carry a looks sidecar over to a rebuilt pack (bigger box, refreshed data): buildings are matched by footprint centre.

A refresh keeps the pack origin, so the same real building sits at the same local metres. Buildings that are new in
the pack (outside the old box, or new in the data) get null, which draws them from their footprint alone until
build_looks.py is run for the whole box.

  python3 remap_looks.py --old old-pack.json --old-looks old.looks.json --pack ../../public/areas/wh-topanga.json
"""
import argparse, json, math, sys
ap = argparse.ArgumentParser()
ap.add_argument('--old', required=True); ap.add_argument('--old-looks', required=True); ap.add_argument('--pack', required=True); ap.add_argument('--out')
ap.add_argument('--tol', type=float, default=1.5, help='metres between footprint centres')
a = ap.parse_args()
old, new, sc = json.load(open(a.old)), json.load(open(a.pack)), json.load(open(a.old_looks))
if old['origin'] != new['origin']: sys.exit('origins differ: the buildings cannot be matched by position')
ctr = lambda b: (sum(p[0] for p in b['r']) / len(b['r']), sum(p[1] for p in b['r']) / len(b['r']))
cell = {}
for i, b in enumerate(old['buildings']):
    x, z = ctr(b); cell.setdefault((int(x // 4), int(z // 4)), []).append((x, z, i))
out, hit = [], 0
for b in new['buildings']:
    x, z = ctr(b); best = None
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for ox, oz, i in cell.get((int(x // 4) + dx, int(z // 4) + dz), []):
                d = math.hypot(ox - x, oz - z)
                if d <= a.tol and (best is None or d < best[0]): best = (d, i)
    m = sc['b'][best[1]] if best else None
    hit += m is not None; out.append(m)
chk = 0
for b in new['buildings']: chk += math.floor(b['r'][0][0] * 10 + 0.5) + math.floor(b['r'][0][1] * 10 + 0.5) * 3
json.dump({**sc, 'n': len(out), 'chk': chk, 'b': out}, open(a.out or a.pack.replace('.json', '.looks.json'), 'w'), separators=(',', ':'))
print(f'{hit} of {len(out)} buildings carried over')
