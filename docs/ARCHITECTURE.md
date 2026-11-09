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
  Junction rules (general, never per street): a car enters the box only if the exit lane has room; minor roads and turns give way by **time gap** (`GAP` in `sim/sim.js`), ignoring queues that have stood still; cars stop 0.8 m short of the line and hold braking once committed (`hold`); turn speed comes from the connector's bend (`turnSpeed` in `sim/net.js`) and cars plan their slowing at a comfortable 2.2 m/s2; accel changes are jerk-limited; snapshot poses use both axles so cars stay continuous across lane-to-turn handovers and turn smoothly. Signal phase logic is owned by the signals thread; `canGo` only asks `green(node, group)` plus a permissive-left gap check.
- **Signals**: `sim/signals.js` picks the phasing for every signalized junction by rule from road class, lane count and the turns that exist (`permissive` yielding lefts, `leadlag` protected arrow that ends while the other side continues, `dual` both lefts first, `split` one approach at a time). The sim asks `stateAt(plan, t, leg, 'T'|'L')`: 0 red, 1 permissive green (yield), 2 protected green, 3 yellow. A protected left turns the inner lane into a left-turn pocket (`lane.leftOnly`). The worker posts `exportSignals(net)` (mast arms, a head per lane, the plan) after each net swap; `views/signals.js` draws corner poles, arms over the lanes and far-side heads and colours the lamps from the sim clock.
- **Info views** (`views/`): metrics are estimates until a provider (`provide('edgeFlow', ...)`) supplies live data, then they switch with no other change.

## Theme system
- **Camino is the only theme.** The old paper look is gone (nate's request) and there is no switch. Materials are always lit standard materials; `toon()` in `app/render.js` keeps its name only.
- `index.html` sets `data-theme="camino"` and links `base.css` (layout and controls, with the Camino palette as its `:root` tokens) and `camino.css` before first paint (no flash). Camino rules hang off `html[data-theme=camino]`; do not edit `layout.css` for theme work.
- Camino pieces: `look.js` (realistic street view: lighting, PBR-ish materials), `sky.js`, `scan.js` + `infra*.js` + `tags.js` (scan view, key **F**), `hud.js`/`hud2.js` (title, dossier, FPS, bottom dock with popovers, status strip), `commandbar.js` (`/` or Ctrl+K), `notify.css`.
- Scan view draws **only real data** from the `<id>.infra.json` sidecar (`tools/pack/infra.py`): lights, hydrants, transmission, transit stops. Do not add modeled layers.
- Design kit for outside use: `/mnt/project-files/camino-design-system/`.
- The dock moves the existing bars into popovers instead of rebuilding them, because the app re-renders `#tools`, `#views`, `#infobar`, `#card` with `innerHTML`. Hook stable containers or use a `MutationObserver`; never assume your DOM node survives a render.

- **Levels**: `engine/levels.js` plans bridges, cut ground and node levels once on the base city; `app/bridges.js` and `app/roadside.js` draw decks, barriers and freeway vegetation; `tools/roads/deck.js` is the pure reader the sim also uses. Rules in [ROAD_GRAPH.md](ROAD_GRAPH.md).

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

## Big areas: detail streaming (`src/engine/lod.js`, `src/app/lod.js`)
An area with more than 2,500 lots (Woodland Hills, Canoga Park and West Hills are about 3 km a side, 5,000 to 6,000 lots) cannot keep full-detail meshes for every lot (about 34 KB each). So `lod.on` is set at start-up and:
- **Chunks** are the 110 m lot chunks `World` already merges. `DETAIL` (a `DetailSet`) holds the chunks near the view centre (radius 320 to 700 m, grows with zoom, drops at 1.35x so edges do not flicker) plus **pinned** chunks, those holding any lot that differs from the base city (edits, growth, demolitions), which always keep detail.
- **Slim lots.** Every lot is still generated once (on the worker pool), because scores read its units, parking and so on, but a lot outside `DETAIL` is encoded without meshes (`geo: false` in `workers/codec.js`) and keeps its trees and parked cars only as numbers. `genCached(lot, S, geo)` returns the slim copy for stats and upgrades it only when `geo` is asked for. Anything that just needs numbers (scores, palette, zoning driver) calls it as before.
- **Massing.** `massingChunks` merges plain extruded footprints and parking pads of every base building into one mesh per chunk; it is hidden wherever the world has a detailed chunk. Yard trees and parked cars are only instanced in detailed chunks (street trees and mapped scenery are always drawn).
- **Streaming.** `lodTick(target, dist)` runs every frame and does nothing until the view moves 30 m or zooms 15%; then it updates `DETAIL`, builds meshes for newly near lots through `prewarm(STATE, true)` and re-syncs the world. The as-built world (`beforeW`) is only built the first time it is shown.
- Small areas keep `lod.on = false` and run exactly as before. Force it with `?lod=1` or `?lod=0`.
New code that needs per-lot meshes must go through `genCached(lot, S, true)`; code that only needs numbers must not.

## Tests
`npm test` runs `node --test tests/*.test.js`. Engine, sim, views, roads, camino and areas tests all run in plain node (DOM stubbed where needed). `npm run check` adds eslint and a production build; CI (`.github/workflows/check.yml`) runs it on every PR to `integration` and `main`.

## Frontage rule (driveways, curb cuts, front yards)
`engine/driveways.js` plans one driveway per house lot (`lot.dw`) from the lot ring, its live buildings and the street it fronts: it picks a clear strip on the real front boundary, a curb cut depth from the street profile, a front yard and a walkway. `model.js` runs it on load and in `lotMeta`, `templates.js` paints it (`paintFrontage`), and `sim/net.js` leaves the kerb at each driveway unparked, filling the free runs between driveways evenly (islands). No per-area data; every area and every later lot gets it.
