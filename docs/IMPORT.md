# What the area importer reads, and what it makes of it

`tools/pack/build_area.py` turns open data into one pack per area. Owner: the areas thread. Rule from nate: **a fix to one spot is a fix to the recognition method**, so it is applied to every area and every area built from now on (rebuild with `--refresh`; ids stay stable, so saves survive).

| Source | Used for |
| --- | --- |
| Overture transportation segments | street centrelines, class, name, **one-way** (access restriction against the digitised direction), **posted speed**, ramps (`link`), service roads and **parking aisles** |
| Overture buildings, addresses, land use, infrastructure | footprints and heights, lot addresses, mapped parking polygons, street props |
| City of LA (data.lacity.org) | real parcel boundaries with county AIN, zoning, general plan, permit years |
| AWS terrain tiles | ground height |

## Street rules
- A one-way segment is stored along its direction of travel with `ow: 1` (never `-1`), and gets a one-way cross-section (lanes all one way, no centre turn lane, no yellow centre line). Ramps and freeway carriageways are one-way too.
- A boulevard that the map draws as two one-way carriageways stays two edges. `src/tools/roads/divided.js` pairs them at base build and puts the median between.
- `sp` is the posted limit in mph; the sim uses it.
- Ends of neighbouring segments within 1.8 m share one node, so intersections are single nodes.
- A carriageway's `w` is its own width (about 3.3 m per lane plus kerb), not the whole road, so lots are not trimmed by a road twice as wide as the real one.

## Land cover: surface parking
Map layers miss many lots. `tools/pack/recognize.py` adds `pack.parkingInf` (rings) and `lot.pvi` (recognised paved share). Evidence: service roads and parking aisles running through open ground, or a commercial group of lots with a big open area behind its buildings. It works on **groups of touching lots**, because a back lot usually serves several frontages. The game paves and stripes these exactly like mapped lots, and stalls for traffic and metrics come from the same `lot.pk` rings.
Retrofit an existing pack without refetching: `python tools/pack/recognize.py public/areas/<id>.json`.

## Adding a recognition rule
Put it in `tools/pack/`, make it read the pack (or the work folder) only, write optional fields, add a check to `tests/areas.test.js`, then run `build_area.py --id <area> --refresh` for every ready area.
