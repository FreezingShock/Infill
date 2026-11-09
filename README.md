# sfvOS

**A live city builder on real San Fernando Valley data.** Open a neighborhood and you get its actual streets, lots, buildings, parking and terrain. Then rebuild it the way you would in Cities: Skylines 2: a few verbs, presets, paint and drag. It runs in the browser, played through the **Camino** interface.

No grids. Every lot is a real parcel and every street is a real centreline, so the city feels like the place it came from.

## What you can do

- **Open any part of the Valley.** Twelve neighborhoods ship ready (Woodland Hills, Encino, Sherman Oaks, Studio City, North Hollywood, Van Nuys, Panorama City, Reseda, Northridge, Chatsworth, Granada Hills, Canoga Park). Search an address or drag a box on the map and the game builds a new area from open data.
- **Renovate lots.** Add floors, ADUs, solar, trees and roofs, swap building templates, repurpose commercial buildings into homes, shops or offices, and see the cost before you click.
- **Paint like tiles, on real lots.** Pick from the palette, then click or drag across lots, a whole block, or a rectangle.
- **Reshape streets.** Draw new streets and change existing ones with presets for lanes, medians, parking, one-ways and crosswalks. Road rules (hierarchy, right of way, median openings, lane markings) are general and apply to any area on load.
- **Watch it live.** Cars drive and park, signals cycle, and a day and night clock runs over the city.
- **Scan view.** A Camino overlay of the real infrastructure in the area, drawn only from mapped data.
- **Undo anything.** Your work is an edit log, so it saves per area in the browser and carries over when an area's data is refreshed.

## Run it locally

You need Node 20 or newer. Localhost runs the `integration` branch, where every feature lands first, so it is always the newest playable build.

```sh
git clone https://github.com/FreezingShock/sfvOS.git && cd sfvOS
git checkout integration
npm install
npm run dev
```

Vite serves the game at http://localhost:5173 with Woodland Hills loaded. Pick another area with **Change area**. Vite reloads the page by itself while `npm run dev` runs.

### Load any spot, or refresh an area

With `npm run dev` running (and Python 3 installed), **Change area** has a *Load any spot in the Valley* box: search an address or place, or click or drag a box on the map, name it and press **Build this area**. It pulls real streets, buildings, parking and terrain (Overture Maps, AWS terrain) and, inside the City of LA, the real parcel boundaries, zoning and permit years from data.lacity.org, then opens the result. The first build installs a few Python packages into `tools/pack/.venv`; after that it takes about a minute. Outside the city the lots are estimated from address points.

**The edge of the map** is not a wall: the real surroundings (terrain, main streets, buildings as soft blocks) fade into the fog. Point at them to see the box you could open, and click to open the area already built there or to start a new one. Each area's `<id>.bg.json` is built with it (`tools/pack/backdrop.py`).

**Refresh this area's data** re-pulls the data for the highlighted area. Lots and streets keep their ids, so your saved edits carry over; any that no longer fit are skipped and counted when the area reopens. The same builder runs from the command line: `python tools/pack/build_area.py --id canoga-park --bbox=-118.6082,34.1955,-118.5958,34.2065` (add `--refresh` to rebuild an existing area).

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build on http://localhost:4173 |
| `npm test` | Engine tests in node (loads the pack, replays every kind of edit, regenerates every lot) |
| `npm run check` | Lint, tests and build (what CI runs) |

## Playing

Four tools at the bottom left:

- **Look (V)**: click a lot for quick changes that fit it (with homes and cost shown before you click), Copy look, Save as my design, whole block and similar lots. Click a street for one-click street presets. "Customize every detail" opens the full template, tweak, lot and select controls.
- **Build (P)**: pick anything on the palette (add or remove a floor, ADU, solar, trees, roofs, colours, every template, your copied look and saved designs), then click a lot or drag across lots to apply it, like painting tiles. Hover previews the result. Shift-drag applies to a rectangle, double-click to a whole block.
- **Roads (D)**: click open ground to draw a new street, or click an existing street to change it.
- **Bulldoze (X)**: click or drag across lots to clear them, or click a street piece to remove it.

**Advanced** (in the view bar) opens the precise tools (box, lasso, brush, along a street, edit streets, new area, paint zones), lot lines and the edit log. B shows the as-built city, C a before/after slider, N night. Ctrl+Z and Ctrl+Y undo and redo. Press ? in the game for the full key list.

Edits autosave to the browser per area. Saved designs are kept in the browser across areas.

## Data

Every shape comes from open data, packed once per area, and nothing is traced from Google imagery.

| Source | Used for |
| --- | --- |
| Overture Maps (mostly OpenStreetMap, ODbL) | streets, one-ways and speeds, buildings and heights, addresses, parking, street furniture, land use |
| City of LA open data (data.lacity.org) | parcel boundaries with county AIN, zoning, general plan, permit years |
| AWS Terrain Tiles (USGS 3DEP) | ground height |
| USGS NAIP imagery | aerial color for recognizing roofs and tree cover; never copied as geometry |

Import details are in [docs/IMPORT.md](docs/IMPORT.md) and [tools/pack/README.md](tools/pack/README.md).

## Project layout

```
index.html            page shell
src/main.js           picks the area, loads its pack, starts the app
src/engine/           pure data and generation, also runs in node (model, templates, edit log)
src/app/              renderer, scene, state, inspector, input
src/camino/           the Camino interface: HUD, command bar, scan view, sky
src/areas/            area picker, backdrop, edit rebase on refresh
src/sim/              live traffic and parking
src/game/             zoning, growth, clock
src/views/            info views
src/workers/          off-main-thread lot generation
public/areas/         area manifest and packs
tools/pack/           Python builders that turn open data into area packs
tests/                node tests
docs/                 architecture, roadmap, import notes, road graph, plan
```

Start with [CLAUDE.md](CLAUDE.md), then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md). Pull requests branch from `integration`, run `npm run check`, and merge back into it. `main` carries the stable line.

## Credits

Map data (c) OpenStreetMap contributors and Overture Maps Foundation, City of Los Angeles, USGS. The in-game credits dialog lists them too.
