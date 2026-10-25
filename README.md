# Renovated

A cozy city renovation game on real San Fernando Valley map data. Pick a neighborhood, then upgrade houses, repurpose commercial buildings, add streets, change lane layouts and parking, and (soon) watch traffic and parked cars respond.

The plan for where this is going is in [docs/PLAN.md](docs/PLAN.md).

## Run it locally

You need Node 20 or newer.

```sh
npm install
npm run dev
```

Vite opens http://localhost:5173 with Woodland Hills (Topanga Canyon Blvd) loaded. Pick another area with **Change area**; areas marked "needs a pack" are planned and can be built with `tools/pack`.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serves the production build on http://localhost:4173 |
| `npm test` | Engine tests in node (loads the pack, replays every kind of edit, regenerates every lot) |
| `npm run check` | Lint, tests and build |

## Playing

Select lots with the tools at the bottom left (or keys V, R, L, P, S), pick a template or tweak in the card on the right, and watch the scores at the top right. Draw streets with D, edit a street's cross-section with E, clear land for a new neighborhood with A, paint zones with Z. B shows the as-built city, C a before/after slider, N night. Ctrl+Z and Ctrl+Y undo and redo. Press ? in the game for the full key list.

Edits autosave to the browser per area. The edit log (in the view bar at the bottom left) can copy or open a save file.

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
