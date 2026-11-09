# Area pack builder

An area pack is one JSON file in `public/areas/` holding everything the game needs for a rectangle of map: terrain, the road graph with blocks, lots, buildings, parking polygons, street props and land use. The game never calls a map server while you play.

**`build_area.py` does all of the steps below for any box** (the game's *Load any spot* screen runs it through `tools/vite-areas.js`):

```sh
python tools/pack/build_area.py --id canoga-park --bbox=-118.6082,34.1955,-118.5958,34.2065   # new area (use --bbox=, the value starts with a minus)
python tools/pack/build_area.py --id wh-topanga --refresh                                      # re-pull the data, keep ids
```

It installs its Python packages into `tools/pack/.venv` on first run, prints progress as `@@{json}` lines, writes `public/areas/<id>.json` and updates `index.json`. With `--refresh` the old pack is read so every lot (county AIN match, else best overlap) and street (same name, same end points) keeps its id; saved edits point at those ids. New lots and streets get fresh ids above the old maximum. Boxes are limited to 2.6 km a side.

The numbered steps below are what it runs, for reference or manual work.

## Setup

```sh
python3 -m venv .venv && . .venv/bin/activate
pip install s3fs pyarrow shapely pillow numpy
mkdir -p tools/pack/work   # raw downloads go here (git-ignored)
```

## Steps

1. **Overture layers** (anonymous S3, release 2026-10-21). `ov.py <theme> <type> <out.geojson> W,S,E,N` reads only the row groups that touch the box:
   - `transportation segment work/seg.geojson`
   - `buildings building work/bld.geojson`
   - `addresses address work/addr.geojson`
   - `base infrastructure work/infra.geojson`
   - `base land_use work/lu.geojson`
2. **Terrain**: AWS Terrain Tiles (terrarium PNG, z15) covering the box, saved as `work/t_<x>_<y>.png` (`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/<x>/<y>.png`).
3. **v1 pack** (terrain grid, roads, buildings, estimated lots): `python3 pack_v1.py work work/pack_v1.json`
4. **City of LA layers** (only inside the city): from data.lacity.org, with `?$where=intersects(the_geom,'POLYGON((...box...))')&$limit=50000`:
   - `qyra-qm2s` BOE parcels with county AIN, `jjxn-vhan` ZONING_PLY, `c3g2-yzgc` GENPLAN_PLY (`.geojson`)
   - addresses by PIN `4ca8-mxuh`, LADBS new-building permits `e67z-kt2n`, `dyxf-7hc4`, `pi9x-tg5x` (`.json`)
5. **Game pack** (road graph, blocks, lots, types, zones, parking, props):
   ```sh
   python3 pack2.py work/pack_v1.json work/infra.geojson work/lu.geojson public/areas/<id>.json \
     work/qyra-qm2s.geojson work/jjxn-vhan.geojson work/c3g2-yzgc.geojson work/addr.json work/new_*.json
   ```
   Without the City of LA arguments it falls back to estimated lots (Voronoi of address points per block), which is fine outside the city: realism is not a goal.
6. Add the area to `public/areas/index.json` with `"status": "ready"` and `"pack": "<id>.json"`.

LA County hosts (Assessor, building outlines) are not used.

## Real infrastructure (`<id>.infra.json`)

`infra.py` writes a sidecar with only what public data has, for the scan view: City of LA street lights and fire hydrants (maps.lacity.org), LA Metro bus stops with boardings, CEC transmission lines (kV, owner) and Overture power poles, lines and substations (OpenStreetMap). No water mains, gas or LADWP distribution lines exist as public data, so none are drawn. `build_area.py` runs it after the pack; the manifest entry gets `"infra": "<id>.infra.json"`.

```sh
python tools/pack/infra.py --all                     # refetch every area (needs maps.lacity.org and arcgis.com)
python tools/pack/infra.py --all --raw DIR           # use pre-fetched <layer>-<id>.geojson + transmission-sfv.geojson
```
