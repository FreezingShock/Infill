# Working on sfvOS (read this first)

sfvOS is a Vite + Three.js city game on real San Fernando Valley map data: a live city on real lots and streets, played through the **Camino** surveillance-OS interface. Many Claude threads work here in parallel. Everything merges into `integration`; nate plays `integration` on localhost.

Reading order: this file, then [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (map, theme, recipes), [docs/ROADMAP.md](docs/ROADMAP.md) (who owns what), [docs/IMPORT.md](docs/IMPORT.md) (importer), [docs/nate-preferences.md](docs/nate-preferences.md) (taste). [docs/PLAN.md](docs/PLAN.md) is the original v3 plan, kept for history.

## nate's rules (non-negotiable)
1. **Never test in a headless browser** (no Playwright, no Chromium, no screenshots). Verify with `npm run check`, node tests and static scripts. nate tests on localhost; end each PR thread by telling him what to try.
2. **A reported fix is general.** If nate reports a bad spot, fix the recognition method and apply it to every area (rebuild all ready packs with `--refresh`), every recognition method and every area built later. Never patch one lot. The importer is the root to improve.
3. **No grids.** Real lots and real streets stay. Editing should feel like Cities: Skylines 2 (few verbs, presets, paint and drag), never a grid map.
4. **Scan view shows only real data** (mapped lights, hydrants, transmission, transit stops). No modeled or invented utilities there.
5. **Names.** The game is **sfvOS**; the in-game OS/theme label is **Camino** (it replaced "Vantage"). Do not mass-rename the repo or package unless asked. Never use Ubisoft's "ctOS" name, logos or art.
6. **No emoji in the UI** (cards, toasts, advisor). Use drawn SVG/CSS glyphs in the Camino style (see `SEV` in `src/ui/index.js`).
7. **Realism of rules does not matter** (no assessor data, real heights or zoning accuracy). Realism of look and layout does.
8. **The world is live.** A loaded area has cars, parked cars, turns and a clock. Sim state is derived and never saved; a save is the edit log.
9. **Work in `C:\Users\natea\sfvOS`**, not Backbone, when touching nate's PC.
10. **Models.** Big features use `claude-sonnet-5-5` at medium effort. Quick fixes (including small Camino theme fixes) use `claude-haiku-5-5` at high effort.
11. **Camino is the only look.** The classic paper look is gone; build nothing for it.

## PR flow
1. `git fetch origin integration`, branch from it (the session names your branch). Rebase again before pushing.
2. One focused PR per feature, base `integration`, ready (not draft) unless told otherwise. Small diffs merge cleanly.
3. Run `npm run check` (eslint + node tests + vite build). CI runs the same. Never skip, weaken or delete a test to get green.
4. PR body starts with the attribution block from your session context. Add the requesting user as assignee and reviewer.
5. **Merge into `integration` yourself once CI is green.** nate's standing rule: no waiting for him. Never push to `main`. If a merge conflicts, keep both sides' intent; never discard another thread's work.
6. After merging, tell nate in your thread what to try on localhost (Windows: `git checkout integration`, `git pull`, `npm install`, `npm run dev`).
7. When your PR merges, append a dated line to [docs/nate-preferences.md](docs/nate-preferences.md) if you learned anything about his taste, and add perf numbers to [docs/perf-baseline.md](docs/perf-baseline.md) if you added per-frame cost.

## Folder ownership (new code goes in your own files)
| Folder | Owns |
| --- | --- |
| `src/engine/` | pure data and generation (core, model, templates, commands, looks, renovate, bulbs, street trees). Runs in plain node and in workers. No DOM. |
| `src/app/` | the running game: render, scene, state (edit log), input, camera, inspector, loader, store. **Hot spots:** `input.js`, `state.js`, `scene.js`, `src/main.js`. Touch minimally with a one-line hook; no drive-by reformatting or reordering. |
| `src/sim/` | live traffic, parking, signals. Pure, no THREE, runs in a worker. |
| `src/areas/` | area picker, backdrop, rebase of saves onto refreshed packs, geometry helpers. |
| `src/tools/` | editing tools: `roads/` (draw, divided, lanes, intersection control), `renovate/`. |
| `src/game/` | clock, growth, `zoning/`. |
| `src/views/` | info views (traffic, parking, zones, happiness), light, sky, metrics, live-data `providers.js`. |
| `src/ui/` | shared HUD parts, gauges, advisor. |
| `src/camino/` | the Camino theme: look, sky, scan view, real infrastructure, dock/HUD, command bar, boot screen styles. |
| `src/styles/` | `layout.css`, `hud.css` (shared layout; theme work goes in `src/camino/`). |
| `src/workers/` | lot-geometry worker pool. `src/assets/` optional sidecar loading. |
| `tools/pack/`, `tools/looks/` | Python importers and sidecar builders. `public/areas/` holds the output. |

Rules of thumb: shared shapes (pack, edit-log commands, `World`, street profile) change **additively** with optional fields that tolerate absence; announce a shape change to the coordinator first. Saves are `renovated.builder.<area>.v2` plus an edit log; add a migration in `src/areas/` if a shape must change. Don't edit `package.json` or the lockfile unless you need a dependency. Big refactors go alone, announced first. Tests go in `tests/<feature>.test.js` and run in plain node.

## Commands
`npm run dev` (http://localhost:5173), `npm test`, `npm run check`, `npm run build`. Area: `?area=<id>`. Importer: `python tools/pack/build_area.py --id <id> --refresh`.
