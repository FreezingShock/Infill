# Architecture (sfvOS)

How the pieces fit, and the recipes you need most. Rules and ownership are in [../CLAUDE.md](../CLAUDE.md).

## Boot sequence (`src/main.js`)
1. Fetch `public/areas/index.json`, choose the area (`?area=`, else the manifest default), fetch its pack, put it on `globalThis.__RENOVATED_PACK__` (the engine reads it when its modules evaluate, so it must be in before any engine import).
3. `assets/boot.js` loads optional sidecars next to the pack: `<id>.looks.json`, `.streets.json`, `.canopy.json`. Missing or mismatched files are skipped, never fatal.
4. Import `app/input.js` (builds the world, lots on the worker pool), then `ui/index.js` (gauges, advisor, info views).
5. Import `camino/index.js` (infrastructure from `<id>.infra.json`, scan view, HUD dock, command bar).
Progress is reported to the boot screen in `index.html` via `app/loader.js`.

## Data flow
- **Pack** (`public/areas/<id>.json`) -> `engine/pack.js` -> `World`/`BASE` (streets, lots, buildings, terrain). Read it through the engine, never from other modules directly.
- **Edit log**: every player action is a command in `engine/commands.js`, applied by `app/state.js` and replayed deterministically on load/undo/redo. The save is this log. A new command must replay from the log and be covered by a replay test.
- **Lots**: `engine/looks.js` decides a kind and look per building; geometry is generated in `engine/` and, for large batches, on `workers/` (typed arrays, transferable).
- **Traffic**: `sim/` runs a fixed 10 Hz step in `sim/worker.js` on the lane graph built from the street profile; `views/traffic.js` draws cars as one instanced mesh and registers live numbers with `views/providers.js`.
- **Info views** (`views/`): metrics are estimates until a provider (`provide('edgeFlow', ...)`) supplies live data, then they switch with no other change.

## Theme system
- **Camino is the only theme.** The old paper look is gone (nate's request) and there is no switch. Materials are always lit standard materials; `toon()` in `app/render.js` keeps its name only.
- `index.html` sets `data-theme="camino"` and links `base.css` (layout and controls, with the Camino palette as its `:root` tokens) and `camino.css` before first paint (no flash). Camino rules hang off `html[data-theme=camino]`; do not edit `layout.css` for theme work.
- Camino pieces: `look.js` (realistic street view: lighting, PBR-ish materials), `sky.js`, `scan.js` + `infra*.js` + `tags.js` (scan view, key **F**), `hud.js`/`hud2.js` (title, dossier, FPS, bottom dock with popovers, status strip), `commandbar.js` (`/` or Ctrl+K), `notify.css`.
- Scan view draws **only real data** from the `<id>.infra.json` sidecar (`tools/pack/infra.py`): lights, hydrants, transmission, transit stops. Do not add modeled layers.
- Design kit for outside use: `/mnt/project-files/camino-design-system/`.
- The dock moves the existing bars into popovers instead of rebuilding them, because the app re-renders `#tools`, `#views`, `#infobar`, `#card` with `innerHTML`. Hook stable containers or use a `MutationObserver`; never assume your DOM node survives a render.

## Importer
`tools/pack/build_area.py` builds a pack for any box; details, sources and recognition rules are in [IMPORT.md](IMPORT.md). Summary: Overture segments/buildings/addresses/land use + City of LA parcels and zoning + AWS terrain + NAIP imagery checks -> `public/areas/<id>.json` plus `.bg.json` (backdrop), `.infra.json` (scan data), `.looks.json`, `.streets.json`, `.canopy.json`. Lots and streets keep stable ids across `--refresh`, so saves survive.

## Recipes

### Add a recognition rule or fix an importer bug
Edit `tools/pack/` (recognize, pack2, bulbs, rowwidth), write optional fields only, add a case to `tests/areas.test.js`, rebuild **every** ready area with `build_area.py --id <area> --refresh`, document it in IMPORT.md. nate's rule: the fix covers all areas.

### Add a building model or look
1. Classification lives in `engine/looks.js` (`KINDS`, `classify`, `drawBuilding`). Add a kind or a draw variant there and keep it falling back to the footprint box when data is absent.
2. Per-building data comes from the looks sidecar (`tools/looks/build_looks.py`); extend its fields additively and bump nothing unless the shape breaks (`setLooksData` checks version, count and checksum).
3. Any external 3D model file goes in `public/models/` and **must** be CC0 or CC-BY, listed in `public/models/LICENSES.md` with source URL and licence. Google/Apple/Bing imagery or 3D tiles are off limits.
4. Buildings a player places come from `engine/templates.js`; add a template there and cover it in `tests/engine.test.js` (every template must answer availability).

### Add a menu, tool or command
- A tool: add it to `TOOLS`/`ADV_TOOLS` in `app/input.js` (one line) and put its logic in a file under `src/tools/<name>/`. Add a row to `commands()` in `camino/commandbar.js` calling the same function the button calls (the command bar must not create edit-log entries of its own).
- A dock popover entry: extend `camino/hud2.js` through its stable containers (`#pLayers`, `#pView`, `#pMore`), not by rewriting the dock.
- Styling: Camino tokens and components, no emoji, glyphs as inline SVG, honour `prefers-reduced-motion`, keep labels from clipping at 1280x720 and 375x667.

### Add a data layer (info view or scan layer)
- **Info view**: add an entry to `VIEWS` in `views/index.js`, a metric in `views/metrics.js` and a colour ramp in `views/overlay.js`. If the sim can supply live numbers, `provide(name, fn)` in `views/providers.js`.
- **Scan layer**: only from real open data. Extend `tools/pack/infra.py` to write the field into the sidecar, then draw it in `camino/infra.js` and list it in `camino/infra-data.js`; rebuild all areas.
- **New sidecar file**: load it in `assets/boot.js` with a try/catch (optional), keyed by `<id>.<name>.json`, and add it to `public/areas/index.json` if the picker needs it.

### Add an edit-log command
`engine/commands.js` (apply) + `app/state.js` (commit/undo wiring) + a replay case in `tests/engine.test.js`. Fields on shared shapes are additive and optional.

### Add a worker job
Use `src/workers/pool.js`; send typed arrays as transferables; keep the page-thread fallback (12 ms slices) working. Log timings in `docs/perf-baseline.md`.

## Tests
`npm test` runs `node --test tests/*.test.js`. Engine, sim, views, roads, camino and areas tests all run in plain node (DOM stubbed where needed). `npm run check` adds eslint and a production build; CI (`.github/workflows/check.yml`) runs it on every PR to `integration` and `main`.
