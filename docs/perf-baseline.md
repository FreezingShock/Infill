# Perf baseline (sfvOS)

Numbers are measured in plain node on the cloud box (no browser, per nate's rule), so treat them as ratios, not frame times. Threads that add per-frame or per-edit cost: add a row with the date.

## Lot geometry (`genLot`), 9 Nov 2026, workstream I
| Area | Lots | Page thread (old path) | Worker job incl. packing | Packed size |
| --- | --- | --- | --- | --- |
| Woodland Hills / Topanga | 1,298 | 1.49 s | n/a | n/a |
| Studio City | 1,096 | 1.34 s | 1.69 s total across workers | 37 MB (positions, colours, lines, normals) |

About 1.2 ms per lot, so a 2.6 km area (~6,000 lots) is roughly 7 s of frozen tab on the old path. Now it is split in batches over up to 4 workers (cores minus 2, leaving the page and the traffic sim), so wall time is about 7 s / workers and the page keeps drawing.

## How the work is split
- **Page thread:** pack parse, edit-log replay (`exec`), merging ready meshes into 110 m chunks, picking, drawing.
- **Lot workers** (`src/workers/`): `genLot` plus flat normals, one transferable `Float32Array` per batch. Used at start-up, and for any commit, undo or redo that needs more than 40 new lots (paint a district, a growth step).
- **Traffic worker** (`src/sim/worker.js`): lane graph, cars, signals. Unchanged.
- Small edits (40 lots or fewer) still build inline: faster than a round trip.
- If workers cannot start, the same lots build on the page in 12 ms slices.

Each worker build logs `[infill] built N lots in X ms on K workers` to the console.

## Area build time, 9 Nov 2026 (area picker overhaul)
Canoga Park box (1.2 km, 965 lots), cloud box, sequential steps before vs parallel after. Infra layers failed (hosts blocked here) in both runs, so the real-network total on a PC will differ a little.
| Step | Before | After |
| --- | --- | --- |
| Overture, 5 layers | 32 s | 6 s (with terrain and City of LA in the same window) |
| City of LA, 7 datasets | 24 s | 1 s (overlapped) |
| Pack, imagery, bulbs | 8 s | 7 s |
| Backdrop + infrastructure | 105 s | 21 s (side by side) |
| **Total** | **173 s** | **35 s** |

## Big areas (3 km a side), 9 Nov 2026, area expansion thread
Plain node on the cloud box, so ratios and not frame times. Old areas: 1.2 km, 630 to 1,300 lots.
| Area | Lots | Pack | Parse | Base city build (page thread) | genLot, every lot | Massing for all buildings |
| --- | --- | --- | --- | --- | --- | --- |
| Woodland Hills | 5,734 | 5.7 MB | 0.13 s | 5.3 s | 12 s CPU (3 s on 4 workers) | 23 MB, 0.22 s |
| Canoga Park | 5,720 | 5.7 MB | 0.08 s | 5.9 s | 14 s CPU | 25 MB, 0.29 s |
| West Hills | 6,779 | 6.0 MB | 0.12 s | 10.5 s | 24 s CPU | 21 MB, 0.30 s |
- Full-detail meshes are about 34 KB a lot, so ~195 MB for 5,700 lots if every lot were detailed. With detail streaming (`src/engine/lod.js`) only the chunks within 320 to 700 m of the camera (a few hundred lots) hold meshes; the rest is the massing above (about 10 times lighter) plus the numbers each lot keeps for the scores.
- The base city build was 11 s before the driveway scan got box rejects (`planDriveway`), same output. What is left in it is the driveway probe per lot; moving `buildBase` into a worker or caching `lot.dw` in the pack is the next step for load time.
- `genLot` still runs once for every lot (scores read it), on the worker pool, but far lots come back without meshes, so the page decodes and merges only the near ones.
