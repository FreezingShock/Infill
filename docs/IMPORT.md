# What the area importer reads, and what it makes of it

`tools/pack/build_area.py` turns open data into one pack per area. Owner: the areas thread. Rule from nate: **a fix to one spot is a fix to the recognition method**, so it is applied to every area and every area built from now on (rebuild with `--refresh`; ids stay stable, so saves survive).

| Source | Used for |
| --- | --- |
| Overture transportation segments | street centrelines, class, name, **one-way** (access restriction against the digitised direction), **posted speed**, ramps (`link`), service roads and **parking aisles** |
| Overture buildings, addresses, land use, infrastructure | footprints and heights, lot addresses, mapped parking polygons, street props |
| City of LA (data.lacity.org) | real parcel boundaries with county AIN, zoning, general plan, permit years |
| AWS terrain tiles | ground height |
| USGS NAIP aerial imagery (imagery.nationalmap.gov, public domain) | checks and trims recognised paving: asphalt-like pixels (not vegetation by NDVI, not colourful, mid-dark) outside buildings; the imagery is never stored |

## Street rules
- A one-way segment is stored along its direction of travel with `ow: 1` (never `-1`), and gets a one-way cross-section (lanes all one way, no centre turn lane, no yellow centre line). Ramps and freeway carriageways are one-way too.
- A boulevard that the map draws as two one-way carriageways stays two edges. `src/tools/roads/divided.js` pairs them at base build and puts the median between.
- `sp` is the posted limit in mph; the sim uses it.
- Ends of neighbouring segments within 1.8 m share one node, so intersections are single nodes.
- A carriageway's `w` is its own width (about 3.3 m per lane plus kerb), not the whole road, so lots are not trimmed by a road twice as wide as the real one.

## Land cover: surface parking
Map layers miss many lots. `tools/pack/recognize.py` adds `pack.parkingInf` (rings) and `lot.pvi` (recognised paved share). Evidence: service roads and parking aisles running through open ground, or a commercial group of lots with a big open area behind its buildings. It works on **groups of touching lots**, because a back lot usually serves several frontages. The game paves and stripes these exactly like mapped lots, and stalls for traffic and metrics come from the same `lot.pk` rings.
With imagery (the default when the host answers) the paving is the asphalt-like ground outside buildings, at least a parking bay wide (no paths or driveways) and at least 180 m2; without it the aisle rules above apply. Retrofit an existing pack: `python tools/pack/recognize.py public/areas/<id>.json --naip` (drop `--naip` for the map-data rules only).

## Adding a recognition rule
Put it in `tools/pack/`, make it read the pack (or the work folder) only, write optional fields, add a check to `tests/areas.test.js`, then run `build_area.py --id <area> --refresh` for every ready area.

## Surroundings (backdrop)
`tools/pack/backdrop.py` writes `<id>.bg.json` for each area: a 3.2 km ring around the playable box with a 40 m terrain grid, simplified streets by class and a 30 m raster of building coverage and height (a blur of the real footprints). `src/areas/backdrop.js` draws it and lets you point at it to open or build that part of the Valley. It is read-only, optional (the game runs without the file) and uses the pack's local metres and base height, so it joins the playable terrain without conversion. A future step is streaming real neighbouring tiles into the playable area as you scroll; for now one area is one pack, at most 2.6 km a side.

## Cul-de-sacs and sidewalks (`bulbs.py`, `rowwidth.py`)
Both read the parcels, so they need no network and run in `build_area.py` after paving recognition (and as retrofits: `python tools/pack/bulbs.py public/areas/<id>.json`).
- **Bulbs** (`pack.bulbs = [[x, z, r, node]]`): at each interior dead-end residential street, the biggest circle of 6 to 18 m near the end (wider than the street itself; the centre may sit off the last node; service roads running on past the end do not count) that overlaps no parcel and has parcels around at least 40% of a rim ring. Fields, trails and ends into one lot find none. The game draws the bulb as road plus a sidewalk ring (`src/engine/bulbs.js`) only while the street still ends at that node.
- **Right-of-way width** (`edge.rw`, 12 to 20 m): the median gap between the parcels either side of a local street. `defaultProfile` fills the gap beyond the carriageway with a sidewalk plus a planted parkway when it is at least 4.8 m wider than the street, so the street meets the property lines instead of leaving bare ground. With NAIP crowns loaded the parkway's own tree strip is skipped; the imagery trees stand there instead.

## Build speed, stages and custom areas (area picker overhaul, 9 Nov 2026)
Profile of a 1.2 km build (Canoga Park box, cloud box): **173 s before, about 35 s after.** Where the time went and what changed:
- **Overture** was 32 s: each layer listed all the parquet files (buildings alone is 512) and read every footer to find the few row groups that touch the box, and the backdrop repeated it. The Valley touches 1 to 3 files per layer. `tools/pack/ov-index/<release>-<theme>-<type>.json` now holds the row-group boxes (committed, a few KB; built automatically if a release changes, or run `python tools/pack/ov.py warm`). Boxes outside the Valley fall back to scanning footers. Output is identical to the old reader.
- **City of LA** was 24 s because seven datasets were asked for one after another; they are now asked at once, alongside the five Overture layers and the terrain tiles (also fetched in parallel).
- **Backdrop and infrastructure** (40 s and 64 s of retries) now run side by side; the four infrastructure layers are fetched in parallel with 2 tries each; the backdrop ring fetches its two layers together.
- Every progress line now carries its **stage** (`data`, `streets`, `lots`, `imagery`, `extras`, `save`) and elapsed time; the picker shows them as a staged bar (`src/areas/stages.js`).
- **`--custom`** builds into `public/areas/custom/` (git-ignored, listed in `custom/index.json`, merged into the area list by `main.js`). `tools/areas-store.js` exports an area as one `.sfvos-area.json` bundle, installs a bundle (id collisions get a suffix), and removes custom areas. Dev-server endpoints: `/api/areas/export`, `/install`, `/remove`.
- **Valley map** (`python tools/pack/valley.py`, run once, files committed): `valley.webp` (Camino render: hillshade, parks, water, every street), `valley-sat.jpg` (NAIP), `valley.map.json` (named arterials, used for street and intersection search and crisp zoomed drawing).
