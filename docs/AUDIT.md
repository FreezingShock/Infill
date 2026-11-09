# Code health and performance audit (9 Nov 2026)

Method: static read of `src/`, `tests/`, CI and tooling, plus node-only checks (no browser, per nate's rule). Frame times below are reasoned from the code, not measured. The Nexus ("classic paper") theme is being removed in its own thread, so it is not audited here.

## Fixed in this PR
| Item | What was wrong | Fix |
| --- | --- | --- |
| Traffic worker ignored road-tool controls | `worker.js` called `buildNet(edges, { signals })` but the page sends `control`. Signals, stop signs and roundabout settings set with the road tools never reached the worker sim (only the rarely used main-thread fallback honoured them). | New `src/sim/host.js` (`applyMessage`, `advance`) used by the worker and the fallback, so they cannot drift again. Test in `tests/sim.test.js`. **Visible change: the real sim now obeys set controls.** |
| `snapshot()` was O(parked x slots) at 20 Hz | `net.slots.indexOf(s)` per parked car (up to ~6000 cars x all slots) every 50 ms in the worker. | Slot index stored once in `setNet` (`s.ix`). |
| Per-frame traffic cost | `tickTraffic` walked all ~7,400 snapshot entries every frame, allocated an array per car, and rewrote parked matrices every snapshot. Parked colours were also reset 20x/s. | Moving cars indexed once per snapshot; the frame loop walks only them. Parked matrices and colours are rewritten only when the parked set changes. |
| Worker crash fallback lost the street network | `w.onerror` swapped in the local backend but never sent it the net. | Last net message is kept and replayed. |
| Label and scale-bar DOM writes every frame | `placeLabels` and `updateScale` ran each frame even with a still camera. | Skipped unless the view moved or labels were rebuilt. |
| Lint warnings tolerated | Two unused variables. | Removed; `npm run check` now uses `--max-warnings 0`. |

## Prioritized list (not done)
**P1, worth doing soon**
1. `preserveDrawingBuffer: true` in `src/app/render.js` is unused (no `toDataURL`/`toBlob`) and costs GPU time on every frame with antialiasing. Remove it; check on localhost that nothing relied on it.
2. `src/app/input.js` (54 KB) and `src/app/inspector.js` (44 KB) are the biggest merge-conflict magnets and mix input, search, camera, labels, area map and save UI. Split into `camera`, `labels`, `search`, `areamap`, `savefile` modules in a dedicated PR when few threads are in flight.
3. Five independent `requestAnimationFrame` loops (`app/input.js`, `ui/index.js`, `views/index.js`, `game/zoning/driver.js`, `camino/index.js`). Move the cheap ones onto one shared ticker (`src/app/ticker.js`) so ordering is explicit and they can be paused when the tab is hidden.
4. Info views (`views/metrics.js` `traffic()`, `parking()`, `comfort()`) are computed on the page thread whenever the 5-minute bucket changes. They are pure over `STATE` and are the best next candidate for the worker pool in `src/workers/`.
5. `syncTraffic` builds `edgeKey` over every edge on every `state.refresh` and clones edges with `JSON.parse(JSON.stringify())` before `postMessage`, which already structured-clones. Drop the JSON round trip (check nothing non-cloneable such as `Map`s is inside) and key off the edit-log length plus a cheap hash.

**P2**
6. Edit-log replay and pack parse still run on the page thread (see `docs/perf-baseline.md`). Replay of a long save is the next freeze after lot geometry.
7. Test gaps: nothing covers `app/state.js`, `input.js`, the areas picker UI or save round-trips through `loadLog`. Add a node test that replays a saved log and compares lot counts. CI does not run the Python pack builders (`tools/pack`), so importer regressions only show up when someone rebuilds packs; add a small fixture test.
8. CI has no bundle-size guard. `core` is 517 KB and `input` 250 KB before gzip. Add a script that fails above a budget.
9. Duplicated helpers: `clamp` (core.js, views/metrics.js, game/zoning/demand.js), `polyLen` (core.js, views/metrics.js), `rng` (engine/core.js and sim/geom.js; the sim copy must stay because it is THREE-free). Pull the pure ones into one `src/engine/mathx.js` that the sim can import.
10. `shadowMap.type` is set in both `app/render.js` and `camino/look.js`; keep one.

**P3, tidy**
11. Unused exports (safe to un-export or delete): `REF_H`, `SUN_OFF`, `MIN_SIDE_M`, `boxesOverlap`, `stamp`, `THEME`, `$` (core), looks.js `KINDS SHOP DRAW wings lookFor metaOf hasLooksData`, `M2_PER_HOME`, `PEOPLE_PER_HOME`, `PAINT_BY_Z`, `RANK`, `SLOT_LEN`, `CAR_LEN`, `LENS`, `ITEMS`, `givesWay`, `pathLen`, roads/ui.js `drawMarkers modeActive selectNode`, `lanesOf`, `Layer`, `decodeLot`, `prewarm`. Do this after the theme removal lands to avoid conflicts.
12. Docs still say "Renovated" in places while the game is sfvOS. Rename in a single sweep with the repo rename.

## What to try on localhost (`integration`)
- Drive or watch traffic: cars should still move smoothly, parked cars still appear and leave. Place a traffic signal or stop sign with the road tools and confirm cars now obey it (this used to be ignored).
- Street labels and the scale bar should still follow the camera while panning, zooming and rotating, and update after you draw a street.
- Open the console: no errors; `[infill] built N lots...` lines unchanged.
