# Renovated

A cozy city renovation game on real San Fernando Valley map data. Pick a neighborhood, then upgrade houses, repurpose commercial buildings, add streets, change lane layouts and parking, and (soon) watch traffic and parked cars respond.

The plan for where this is going is in [docs/PLAN.md](docs/PLAN.md).

## Run it locally

You need Node 20 or newer. Localhost runs the `integration` branch: every project thread's work is merged there first, so it is always the newest playable build.

```sh
git clone https://github.com/FreezingShock/Infill.git && cd Infill
git checkout integration
npm install
npm run dev
```

To pick up new work later: `git pull` on `integration`, then `npm install` if `package.json` changed. Vite reloads the page by itself while `npm run dev` is running.

Vite opens http://localhost:5173 with Woodland Hills (Topanga Canyon Blvd) loaded. Pick another area with **Change area**.

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
| `npm run check` | Lint, tests and build |

## Playing

Four tools at the bottom left:

- **Look (V)**: click a lot for quick changes that fit it (with homes and cost shown before you click), Copy look, Save as my design, whole block and similar lots. Click a street for one-click street presets. "Customize every detail" opens the full template, tweak, lot and select controls.
- **Build (P)**: pick anything on the palette (add or remove a floor, ADU, solar, trees, roofs, colours, every template, your copied look and saved designs), then click a lot or drag across lots to apply it, like painting tiles. Hover previews the result. Shift-drag applies to a rectangle, double-click to a whole block.
- **Roads (D)**: click open ground to draw a new street, or click an existing street to change it.
- **Bulldoze (X)**: click or drag across lots to clear them, or click a street piece to remove it.

**Advanced** (in the view bar) opens the precise tools (box, lasso, brush, along a street, edit streets, new area, paint zones), lot lines and the edit log. B shows the as-built city, C a before/after slider, N night. Ctrl+Z and Ctrl+Y undo and redo. Press ? in the game for the full key list.

Edits autosave to the browser per area. Saved designs are kept in the browser across areas.

## Branches

- `integration`: what runs on localhost. Feature branches open their pull requests against it and get merged here.
- `main`: stable. `integration` is merged into `main` when a milestone is done.

## Layout

```
index.html            page shell (Nexus look: cream plaques, Fraunces + Capriola)
src/main.js           picks the area from ?area=, loads its pack, starts the app
src/engine/           pure data and generation, runs in node too
  pack.js             the loaded area pack
  core.js             geometry helpers, terrain sampling, mesh accumulators
  model.js            lot types, zones, street elements and presets, base state, lot frames
  templates.js        template buildings and the lot generator
  commands.js         the edit log: every command and replay
src/app/              rendering and UI
  render.js           renderer, camera, controls, toon materials
  scene.js            chunked lot meshes, roads, trees, cars, terrain, props
  state.js            city state, undo/redo, overlays, scores, saves, selection
  inspector.js        the right-hand card (build, tweak, lot, select tabs, street and area panels)
  input.js            tools, picking, drawing, modals, area picker, start-up and frame loop
src/styles/nexus.css  all styles
public/areas/         area manifest (index.json) and area packs
tools/pack/           Python scripts that build area packs from open data
tests/                node tests
docs/PLAN.md          the plan
```

## Data

Every shape comes from open data, packed once per area: Overture Maps (streets, buildings, addresses, parking, street furniture, land use; mostly OpenStreetMap, ODbL), City of LA open data (parcels, zoning, general plan, addresses, permits) and AWS Terrain Tiles (USGS 3DEP). Nothing is traced from Google imagery. See the credits dialog in the game and `tools/pack/README.md`.
