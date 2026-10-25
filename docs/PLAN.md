# Renovated: plan v3

**A playable city renovator for the San Fernando Valley, with traffic and parked cars.**
25 Oct 2026. Replaces plan v2 (the builder plan) and builds on the builder preview, which is now this repo. Illustrated version: https://claude.ai/artifact/6hdd7XPEycSyFYDPH39TyJ

## What changed

- **Realism is no longer a goal.** Real open data gives us the starting map (streets, lots, buildings, parking, props). After that it is a game. We stop chasing LA County Assessor records and 2023 building heights, and "Real rules" becomes a simplified **City rules** mode next to **Dream**.
- **It is a renovator for the infrastructure around you.** Houses can be upgraded, commercial centers and buildings repurposed, streets added or re-laned, parking added, removed or recognized.
- **Things move.** Cars drive the street network and park in real stalls, both in lots and along the curb. Street edits change how traffic flows.
- **You pick where to play.** A map screen covers the San Fernando Valley; pick a neighborhood or draw your own rectangle.
- **It runs locally.** The game is a Vite + Three.js app in this repo (`npm run dev`, then `http://localhost:5173`). Claude artifacts are no longer the delivery format for the game.

## 1. What the preview does today

Inventory from going through every module of the builder preview (now `src/`).

### World and data (`engine/model.js`, area pack)

| Piece | Today |
| --- | --- |
| Area | Woodland Hills, Topanga Canyon Blvd from Ventura Blvd to Lopez St, 1.15 × 1.22 km, one pack (`public/areas/wh-topanga.json`, 1 MB) |
| Lots | 1,298 City of LA parcels (AIN, real zoning strings, general plan), trimmed at the street model. Types: 956 house, 111 main street, 85 vacant, 82 apartments, 30 small multi, 22 parking, 12 civic |
| Buildings | 1,626 Overture footprints with heights (1,427 residential, 124 commercial, a few school/civic/industrial) |
| Streets | Road graph of 302 edges (152 drivable, already noded: 79 intersections, 1 overpass crossing). Each edge has a cross-section profile (a Streetmix-style list of elements: sidewalk, tree strip, median, parking, car lane, turn lane, bike, bus, shared, plaza) |
| Parking | 58 mapped parking polygons, clipped per lot, striped with stalls |
| Props | 98 mapped signals, lamps, bus stops, benches, poles, bins, bike racks |
| Terrain | AWS terrain tiles (USGS 3DEP), 6 m grid, everything draped on it |

### Rendering (`app/render.js`, `app/scene.js`)

Orthographic toon view with ink outlines (Nexus look). Lots generate into meshes and merge into 110 m chunks; only dirty chunks rebuild. Trees and cars are instanced. Streets are built from their cross-section with lane markings. Night lighting, before/after compare slider, as-built view, color lots by type or zone, street labels, scale bar and compass.

### Templates (`engine/templates.js`)

21 template buildings in 6 shelves, plus "as-built" (the existing footprints, rebuilt):

- **House** (5): refreshed house, house + ADU, SB 9 duplex, cottage pair, garden house
- **Small multi** (3): courtyard fourplex, stacked flats, townhouse row
- **Apartments** (2): courtyard apartments, mid-rise with roof garden
- **Main street** (3): shopfronts, mixed-use 3 to 5 storeys, market hall
- **Parking** (4): shaded parking with solar, plaza, pocket park, apartments over tuck-under parking
- **Civic** (4): playground, community garden, library, sports court

Every template fits itself into the lot's setback envelope and explains in words when it cannot. Tweaks per lot: storeys, roof, palette, setbacks, ADU, trees, solar, fence.

### Selecting and editing (`app/input.js`, `app/inspector.js`, `engine/commands.js`)

- Tools: select, box, lasso, brush, along a street, draw street, edit streets, new area, paint zones. Double-click selects a block.
- Filters by type, lot size, year, storeys, zone, distance to street. Select similar, saved groups, quick picks.
- Edits are a log of commands: `apply`, `tweak`, `rezone`, `restore`, `fill` (by zone), `merge`, `split` (SB 9 or n-way), `street.add` (splits crossings, cuts lots), `street.move`, `street.del` (freed right-of-way becomes land), `street.prof` (7 presets or custom), `area.new` (grid, curvy, superblock or your own streets, then subdivides into lots).
- Undo and redo, edit log, autosave to the browser, save file export and import.
- Score HUD: homes, trees, shade, walkability, parking acres, budget (a $500M pot), with a delta pop-up after every edit.

### Gaps this plan closes

1. Nothing moves. Cars exist only as static props in lot stalls.
2. On-street parking is a painted strip with no stalls and no cars.
3. Existing buildings can be rebuilt as-built or replaced by a template, but not upgraded in place or repurposed (a strip mall cannot become housing over shops while keeping its shell).
4. Lane structure is one profile per street piece: no one-ways, no per-direction lane counts, no intersection control.
5. One area, chosen in code.
6. No game around the builder: no clock, no goals, no economy beyond a fixed budget.

## 2. Pillars

### 2.1 Traffic simulation

**Lane graph.** Built from the road graph and each edge's cross-section. Every `lane`, `bus`, `shared` and `turn` element becomes a directed lane; elements left of the centerline run against the edge direction unless the street is one-way. At each node, connectors (short curves) join incoming lanes to outgoing lanes by turn movement; turn lanes feed left turns, no U-turns. The lane graph rebuilds whenever the street key changes, the same trigger the road mesh already uses.

**Cars.** Each car has a lane, a position along it and a speed. Car following uses the Intelligent Driver Model (smooth, stable, cheap). Lane changes use a simple gap check (MOBIL-lite) before turns.

**Intersections.** Signals where the pack has a signal prop within 25 m of the node or where two primary roads meet (fixed-time cycles, protected left when there is a turn lane). All-way stops at residential crossings, yield at T-junctions. The player can change any node's control (see 2.3).

**Demand.** Trips come from lots, not from thin air:

- Homes produce trips in proportion to units; shops, offices, schools and civic lots attract them by floor area.
- A game clock drives a daily curve (morning out, midday errands, evening home, quiet night). Realism does not matter, so the curve is a tunable toy, not a survey.
- Gateways at the map edge on primary roads add through traffic (Topanga, Ventura). The freeway runs as background flow only.

**Routing.** A* over the lane graph by travel time. Zones are blocks; routes are cached per zone pair and refreshed every few game minutes from each edge's moving-average speed, so congestion causes rerouting.

**Performance.** Target 2,000 to 3,000 cars in a 1.5 km² area at 60 fps on a laptop. The sim runs at a fixed 10 Hz in a Web Worker on typed arrays; the renderer interpolates and draws cars as one instanced mesh (already how cars are drawn). Zoomed out, lanes switch to a flow color instead of individual cars.

**What the player sees.** A Traffic view (lanes colored by speed against free flow), average trip time, a congestion score in the HUD, and per-street counts in the street card. A road diet shows up as slower cars on that street and more on the parallel one.

### 2.2 Parked cars and on-street parking

**Stalls are first-class.** One supply model for every place a car can sit:

- Lot stalls: already laid out by `stallsIn` for parking lots and paved areas.
- Garage and tuck-under stalls from templates (they already count `ctx.stalls`).
- **On-street stalls**: generated along every `park` element, one per 6.1 m, skipping driveways (each lot's frontage point), 6 m clear of intersections and crosswalks, and bus stops.

**Recognizing existing parking.** As-built profiles already put a parking lane on most residential, tertiary and secondary streets and on wide primaries. Where the source data tags curb parking (OpenStreetMap `parking:lane` carried through Overture, when present) it overrides the rule. Since realism does not matter, the rule is the default and the player can correct it.

**Occupancy.** Each stall is empty or holds a parked car. Overnight, cars park near the homes that own them; by day, shoppers and workers fill stalls near destinations. Trips end by finding a free stall close to the destination; if none is free the car circles (a "cruising for parking" count is a fun, visible metric). Parked cars pull out into the traffic sim when their next trip starts.

**Tools.** A Parking tool: sweep along a curb to add or remove parking on that side; convert a parking lane to a bike lane, a parklet, a bus lane or a wider sidewalk; switch parallel to angled where the street is wide enough. Parking lots can be resized, restriped, or replaced (the existing parking templates).

**Metrics.** Stalls versus demand, occupancy by time of day, parking acres (already in the HUD), cruising cars.

### 2.3 Streets and lane structure

Already there: draw streets that split crossings and cut lots, reshape, delete, and set a cross-section from 7 presets or a custom element list.

New:

- **Lane editor.** A Streetmix-style strip in the street card: drag elements to reorder, drag edges to resize, arrows to set each lane's direction, a total that must fit the right-of-way (or widens it, cutting lots as today).
- **One-way streets** and per-direction lane counts.
- **Turn pockets** near intersections instead of a turn lane along the whole block.
- **Intersection control** per node: signal, all-way stop, two-way stop, roundabout, mini-roundabout. Crosswalk toggles.
- **Speed limit** per street, feeding the car model.
- **Corridor edits.** Select a whole street with the along-street tool and apply one profile to every piece (bulk `street.prof`).
- New commands: `node.ctrl`, `street.dir`, `street.speed`, `curb.set` (parking per side). The existing `street.prof` grows a direction per element.

### 2.4 Renovating and repurposing buildings

Today, as-built lots rebuild their real footprints and templates replace them. New "keep the shell" programs work on the existing footprints:

- **Upgrade:** add floors, refresh the facade (palette, roof), porches, solar, garden roof, ADU. Cheaper than a rebuild.
- **Repurpose commercial:**
  - Strip mall to homes over shops: keep the ground floor, add two to four floors stepped back from the street.
  - Office or retail to apartments: same massing, new windows and balconies, units from floor area.
  - Big box to market hall, indoor sports, or a courtyard block (cut a courtyard into the footprint).
  - Gas station or drive-through to café, plaza or pocket park.
  - Parking structure to housing (later).
- **Extend or wrap:** add a wing that fills the setback envelope; wrap the edge of a parking lot with a liner building of shops or townhomes.
- **Commercial centers as one thing.** Detect centers (main-street and parking lots on one block that share an owner pattern or touch) and give them a Center card with whole-center retrofits: pull shops to the sidewalk, move parking behind, cut a new internal street.

Program schema: as-built programs gain `mods`, an ordered list such as `{ k: 'floors', n: 2 }`, `{ k: 'use', to: 'homes' }`, `{ k: 'facade', pl: 'sage' }`, `{ k: 'courtyard' }`. A new `renovate` command sets them on a selection, so bulk renovation works like bulk templates. Use matters to the sim: it decides trips produced and attracted and parking demand.

### 2.5 Area picker for the San Fernando Valley

- **Selection screen** on start and from "Change area": a light SFV basemap (major roads and neighborhood names, packed once into a small file), the preset neighborhoods, and "Draw your own" (a rectangle up to about 1.5 × 1.5 km).
- **Presets** live in `public/areas/index.json`. This PR seeds it with Woodland Hills (ready) and 11 planned spots with rough rectangles: Canoga Park, Chatsworth, Northridge, Granada Hills, Reseda, Encino, Van Nuys, Panorama City, Sherman Oaks, Studio City, North Hollywood.
- **Pack builder.** `tools/pack/build_area.py --id <id> --bbox W,S,E,N` generalizes today's scripts (which hard-code the Woodland Hills box): Overture roads, buildings, addresses, infrastructure and land use from S3; AWS terrain; City of LA parcels and zoning from data.lacity.org where the box is inside the city (most of the Valley), else estimated lots (the v1 Voronoi path). Writes the pack and updates the manifest.
- **Build from the game.** A dev-server endpoint (Vite plugin, `POST /api/areas`) runs the builder for a drawn rectangle and streams progress; the picker shows a progress bar, then opens the new area. Requires the Python deps listed in `tools/pack/README.md`.
- Budget about 1 to 1.5 MB of pack per km².

### 2.6 The game around it

- **Flow:** title screen, area picker, play. Save slots per area (IndexedDB; save files already export and import).
- **Clock:** pause, 1×, 4×, 16×. Day and night (night lighting exists). Traffic and parking follow the clock.
- **Economy (light):** income from homes and shops each game month, costs per edit (estimates exist), street work costs by length and width. Budget can go negative in Dream mode.
- **Goals per area (optional missions):** for example "Add 500 homes without average trips getting slower than 12 minutes", "Halve parking acres on Topanga", "Walkability 70". Sandbox stays the default.
- **Rules:** City rules (simplified zoning, renamed from Real rules) and Dream.

## 3. Tech

- **This repo (done in the first PR).** Vite dev server, ES modules (`src/engine` for pure data and generation, `src/app` for rendering and UI), area packs and manifest in `public/areas`, node tests for the engine, ESLint, the pack scripts in `tools/pack`.
- **Next refactors:** move UI state (the edit log, current state, selection) into one store module instead of module-level variables; move lot generation and the traffic sim into Web Workers; keep the sim deterministic per seed so tests can assert on it.
- **Sim state is derived, not saved.** A save stays the edit log; traffic and parked cars regenerate from the city when it loads.
- **Testing:** engine and sim tests run in node; nate tests the game in the browser. No headless-browser tests.

## 4. Roadmap

| Milestone | What ships | Done when |
| --- | --- | --- |
| **M0 Repo** (this PR) | Vite project, ES modules, area manifest and picker scaffold, README, engine tests | `npm run dev` opens Woodland Hills on localhost and plays like the preview |
| **M1 Parking** | Stall supply model, on-street stalls, parked cars drawn everywhere, Parking tool, recognized defaults | Every curb with a parking lane shows parked cars; removing parking on a side clears them |
| **M2 Traffic v1** | Lane graph, IDM cars, stop and signal intersections, trips from lots, worker sim, Traffic view | Cars drive between homes and shops, queue at signals, park at the end of a trip |
| **M3 Lanes** | Lane editor, one-way, turn pockets, intersection control, speed limits, corridor edits, traffic metrics in HUD | A road diet on Topanga visibly shifts traffic |
| **M4 Renovate** | Keep-the-shell programs, commercial repurposing, Center card, `renovate` command | A strip mall becomes homes over shops in two clicks |
| **M5 Valley** | SFV basemap, `build_area.py`, build-from-game endpoint, presets built | Draw a rectangle in Van Nuys and play it a minute later |
| **M6 Game** | Title screen, clock and speeds, economy, missions, save slots, performance pass | A full session from title to saved city |
| Later | Buses on routes from bus stops, bikes, pedestrians, more templates, shared saves | |

M1 comes before traffic because stalls are where trips start and end, and it is the quickest visible win.

## 5. Risks

- **Traffic performance in JavaScript.** Worker plus typed arrays, a hard cap on cars, and flow coloring when zoomed out.
- **Road data quirks.** The Woodland Hills graph is clean (one crossing, an overpass), but other areas may need noding in the pack builder (split lines at crossings, then drop grade-separated ones by layer).
- **Edits that break the lane graph** (deleted streets, odd drawn shapes). The lane graph rebuilds from scratch on any street change, and dead ends get turnarounds.
- **Python setup for building new areas** (s3fs, pyarrow, shapely, pillow). Presets ship prebuilt so the game works without it.
- **Attribution.** Overture (ODbL and others), City of LA open data and USGS terrain stay credited in the credits dialog.

## 6. Sources the game uses

Overture Maps (transportation, buildings, addresses, base infrastructure and land use, release 2026-10-21, mostly from OpenStreetMap under ODbL); City of LA open data on data.lacity.org (BOE parcels, ZONING_PLY, GENPLAN_PLY, addresses, LADBS permits); AWS Terrain Tiles (USGS 3DEP, public domain). No geometry traced from Google imagery.
