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
