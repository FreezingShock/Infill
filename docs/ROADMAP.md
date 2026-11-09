# sfvOS roadmap: the live city (updated 9 Nov 2026)

Goal from nate: whatever area you load is **alive** (cars driving, parked cars, turns, signals, a clock), it **keeps evolving** with new iterations, and it plays as close to Cities: Skylines 2 / CityRT as we can get, **on real lots and real streets, never a grid**. Existing cities must be easy to **update**, not just create. Builds on [PLAN.md](PLAN.md) (v3, historical); where they differ, this file wins. How the code fits together: [ARCHITECTURE.md](ARCHITECTURE.md). Rules and PR flow: [../CLAUDE.md](../CLAUDE.md).

## How threads work here
Many threads, one focused PR each, merged into `integration` by the thread itself once CI is green, strict folder ownership so PRs rarely touch the same file, a `CLAUDE.md` with the rules, and a living backlog plus a taste file ([nate-preferences.md](nate-preferences.md)) that every thread appends to when its PR merges. Big refactors go alone. Runtime multithreading is the other half: the heavy work moves off the main thread (see Workers).

## Workstreams

| # | Workstream | Owns (new code goes here) | Status |
| --- | --- | --- | --- |
| A | **Live traffic**: lane graph, cars (IDM), turns, signals and stops, on-street and lot parking, parked cars, trips from lots | `src/sim/`, `src/views/traffic.js` | thread running |
| B | **Areas: load and update**: area picker, build-from-game, versioned packs with stable lot ids, "Refresh area" that rebases your edit log onto new data, save migration | `src/areas/`, `tools/pack/`, `public/areas/` | thread running |
| C | **CS2-style road tools and intersection edits**: curve, arc and grid-in-3-clicks presets, snapping, upgrade or replace in place, lane editor, one-ways, intersection control, speed limits, quick house/commercial edits | `src/tools/roads/` | thread running ("Add road tools and easy intersection edits") |
| J | **Realistic building models**: open-licensed models and imagery-derived looks for buildings, loaded as assets | `src/assets/`, `public/models/`, `src/engine/looks.js` | thread running ("Get realistic building models") |
| D | **Zoning and growth**: paint districts with a brush, demand bars (homes, shops, work), buildings level up on their own, the city reacts to your edits | `src/game/zoning/`, `src/game/growth.js` | started (check `src/`) |
| E | **Camera, light and feel**: CS2-like orbit/pitch camera, soft shadows, day/night tied to the clock, placement ghosts, sound, reduced-motion | `src/app/camera.js`, `src/views/light.js`, `src/audio/` | started (check `src/`) |
| F | **Info views and HUD**: Traffic, Parking, Zones, Happiness views, CS2-style info panels and advisor bar, clock controls | `src/views/`, `src/ui/` | started (check `src/`) |
| G | **Renovate and repurpose**: keep-the-shell upgrades, strip mall to homes over shops, centers as one thing | `src/engine/renovate.js`, `src/tools/renovate/` | first slice in PR (Repurpose shelf: shops, mixed, homes, offices, facelift, one center) |
| H | **People and transit**: pedestrians at crossings, bus routes from mapped stops, bikes | `src/sim/people/`, `src/sim/transit/` | later |
| I | **Infra and speed**: shared worker pool, lot-gen and chunk meshing off the main thread, perf baseline, store module for edit-log state | `src/workers/`, `src/app/store.js`, `docs/perf-baseline.md` | first slice in PR: lot geometry on a worker pool, work store, perf baseline. Next: view metrics, edit-log store, feature registry |

### Contracts between threads (so A, B, C, D can build in parallel)
1. **Pack and area id.** B owns the pack schema. Lots keep a stable id (county AIN where it exists), streets a stable edge id. New fields are optional. A reads streets, profiles, parking polygons and props from `World`/`BASE`; it never reads the pack file directly.
2. **Street profile.** C extends each cross-section element with an optional `dir` (`fwd`, `back`, `both`) and each street with optional `oneway`, `speed`; A treats a missing field as today's behavior. A's lane graph rebuilds on the same key the road mesh uses.
3. **Sim state is derived.** A saves nothing. A save stays the edit log, so B's "Refresh area" only has to rebase edits, never cars.
4. **Frame and clock.** One shared game clock (F/D read it, A drives cars from it). It lives in `src/game/clock.js` (added by whichever thread needs it first; others import it).
5. **Hot-spot hooks.** Features plug into `input.js`, `state.js` and `scene.js` with a one-line import and call; don't restructure them. I (workstream I) will replace those hooks with a small feature registry when few threads are in flight.

### Workers (the multithreading plan)
- Sim runs at a fixed 10 Hz in a Web Worker on typed arrays; the renderer interpolates and draws cars as one instanced mesh. Cars are capped (about 2,500) and fall back to flow coloring when zoomed out.
- Lot generation and chunk meshing move to a small worker pool (I), so painting a big block never stalls the frame.
- Pack building and area refresh run in the dev-server (Python/Node), streamed to a progress bar (B).
- Start with `postMessage` and transferable typed arrays. `SharedArrayBuffer` only if measured needs it, since it requires COOP/COEP headers in Vite.
- Every workstream that adds per-frame cost writes its numbers into `docs/perf-baseline.md`.

## Order of merges
1. This PR (rules, CI, roadmap). 2. A and B first slices (parking and live cars; area picker and refresh). 3. C, D, F start once A's lane graph lands. 4. E can start now (no dependency). 5. G after C. 6. I when A and B have merged. 7. H last.

## Interface: Camino (workstream K)
| # | Workstream | Owns | Status |
| --- | --- | --- | --- |
| K | **Camino theme**: realistic street view, scan view of real infrastructure, bottom dock and popovers, command bar, boot screen, notifications | `src/camino/`, `public/areas/*.infra.json`, `tools/pack/infra.py` | shipped as the only theme (PRs #33 to #40). Next: refinements from nate's playtests, FPS and label stability, more real scan data |

## Current phase (9 Nov 2026)
The foundation is in. Work now is **refinement** (small fixes from nate's localhost tests), **multithreaded feature threads** (one per workstream above) and occasional **big additions** (new building models, better menus, more real data). Pick work from the table, keep PRs small, and fix importer problems at the method level for all areas.

## Open questions for nate
Tracked in the thread; answers get recorded in [nate-preferences.md](nate-preferences.md).
