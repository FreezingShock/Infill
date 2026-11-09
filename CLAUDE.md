# Working on Infill (read this first)

Infill (the game is called Renovated) is a Vite + Three.js city builder on real San Fernando Valley map data. Many Claude threads work in parallel here, each on one workstream. Every PR merges into `integration` automatically once `npm run check` is green; localhost runs from `integration`. Roadmap and who owns what: [docs/ROADMAP.md](docs/ROADMAP.md). What nate likes: [docs/nate-preferences.md](docs/nate-preferences.md).

## Non-negotiables (from nate)
- **No grid map.** Real lots and real streets stay. Editing should feel as easy as Cities: Skylines 2 / CityRT (few verbs, presets, paint and drag), never a grid.
- **Realism of rules does not matter.** It is a toy: no assessor data, no real heights, no zoning law accuracy.
- **Never test in a headless browser** (no Playwright, no Chromium screenshots). Check with `npm run check`, node tests and static scripts. nate plays it on localhost and sends feedback.
- **The world is live.** Whatever area is loaded has cars, parked cars, turns and a clock. Sim state is derived, never saved; a save is the edit log.

## Workflow
1. `git fetch origin integration` and branch from it. Rebase again before you push.
2. One focused PR per feature, base `integration`. Small diffs merge cleanly.
3. Before pushing run `npm run check` (lint + node tests + build). CI runs the same. Never skip or delete a test to get green.
4. Open the PR ready (not draft) with the attribution block from your session context. Merge it into `integration` yourself once check passes (nate's standing rule: no need to wait for him). After a merge, tell nate in your thread what to try on localhost.
5. If another thread's merge conflicts with you, keep both sides' intent. Never discard someone else's work.

## Avoiding conflicts (module ownership)
- New code goes in **new files in your own folder**, wired in with a one-line hook. Hot spots: `src/app/input.js` (frame loop, tools), `src/app/state.js` (edit log, commit), `src/app/scene.js` (world meshes), `src/main.js`. Touch them minimally; no drive-by reformatting, renames or reordering.
- Folders: `src/sim/` traffic, parking and demand (pure, no THREE, runs in a worker); `src/areas/` area loading, versioning, picker, save migration; `src/tools/` editing tools (roads, lanes, zoning); `src/views/` overlays and info views; `src/game/` clock, economy, goals; `src/ui/` shared UI parts; `tools/pack/` pack builders (Python).
- `src/engine/` is pure data and generation. Changes to a shared shape (pack, edit-log commands, `World`) are additive: new optional fields, tolerate missing ones. Announce a shape change to the coordinator before merging.
- Saves: key `renovated.builder.<area>.v2` plus an edit log. Add fields additively; add a migration in `src/areas/` if a shape must change.
- Tests: new files in `tests/`, named for the feature (`tests/sim.test.js`). Engine and sim tests run in plain node.
- Don't edit `package.json` or the lockfile unless you need a dependency. Big refactors get their own PR, announced first, when few threads are in flight.
- Colors and fonts: reuse the tokens in `src/styles/base.css` (dark glass, cyan accent, Helvetica and mono). Camino is the only look.
