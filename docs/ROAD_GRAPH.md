# Road graph fields (owned by the roads workstream, `src/tools/roads/`)

All additive and optional. A missing field means today's behavior. Read them through the helpers in `src/tools/roads/graph.js`.

| Where | Field | Meaning |
| --- | --- | --- |
| edge | `oneway` | `1` cars drive a to b, `-1` b to a, absent = two-way. Set by `street.oneway` |
| edge | `speed` | speed limit in mph, absent = by class. Set by `street.speed` |
| edge | `ring` | `1` on roundabout ring pieces (always `oneway: 1`, counterclockwise on screen = decreasing `atan2(z, x)`) |
| state | `S.ctrl[nodeIndex]` | `signal`, `allway`, `stop` (side streets stop), `yield`, `roundabout`. Absent = automatic |
| state | `S.rounds[nodeIndex]` | `{ r }` radius of a converted roundabout |

| edge | `rc` | road class: `local`, `collector`, `arterial`, `freeway` (`src/tools/roads/classes.js`, from OSM class, speed and width). Absent = derived from `c` |
| edge | `front` | what faces the street: `commercial`, `residential`, `mixed`, `open`. Commercial fronts trade the planted strip for plain sidewalk, same total width |
| edge | `divided`, `taper`, `dn` | carriageway of a divided road; `taper` = one of the two pieces that meet the two-way road at a merge node; `dn` lanes per carriageway |
| edge | `dp`, `nose` | merge pieces only: `dp` is the path to draw along (parallel to the road axis, ends beside the merge node), `e.p` is still the traffic path and ends on the node. `nose` = `{from, to, rev, len}`: the median is full width up to `from` metres and narrows to a point at `to` |

Helpers: `nodeEdges(S, n)`, `isJunction(S, n)`, `nodeControl(S, n)` (explicit choice or the automatic default, `'none'` for non-junctions), `givesWay(S, n, edge)`, `isOneWay(edge)`, `nearestNode(S, x, z, tol)`.

Edit-log commands added: `street.batch`, `street.profs`, `street.oneway`, `street.speed`, `node.ctrl`, `node.roundabout`, `roundabout.new`. All replay deterministically from the log; roundabout rewrites the graph (spokes end on the ring), so rebuild lane graphs whenever the street key changes.

Per-element lane direction (`dir` on cross-section elements) is not in yet.

## Road-class model (src/tools/roads/)

`classes.js` (class, frontage, ARTERIAL numbers), `swerves.js` (rounds corners on arterials and collectors), `divided.js` (corridors), `roadway.js` (is this point on the pavement), `markings.js` (junction boxes, ladders, noses).

- A divided road is the undivided road with its centre turn lane replaced by a median of `ARTERIAL.median` (3 m). Both come from the same numbers, so total width never changes.
- Carriageways are pulled to exactly one row apart (medians touch). At a merge node they stay parallel and the median narrows to a nose; nothing is drawn as a V. Use `drawPath(e)` to draw, `e.p` for traffic.
- Junction rule by class (`rankOf`): the bigger road flows through (no stop bar or crosswalk across it, lines run through, median ends in a rounded nose), smaller streets stop. Equal classes take turns. Two carriageways of one divided road never make a signal by themselves; a signal needs two crossing roads or a mapped signal.
- A fork (one road splitting in two) gets no box, crosswalk or stop bar.
- Trees, props and furniture are tested against `roadwayIndex` and kept off lanes and parking.
- Not built yet: left-turn pocket at the nose, hatched yellow, per-element lane direction, upgrading a street in place.

### Junction rules (apply to every area on load)
These come from the data (OSM class, speed, width, names, zoning frontage) plus basic traffic rules; nothing is special-cased per street.
- **Hierarchy decides right of way.** The higher class flows through; a lower class stops or yields (`nodeControl`, `givesWay`). Two big roads with distinct names signal; merge nodes of a divided road have no control at all.
- **Yielding means waiting for a gap.** A yielding connector only goes when no higher-priority car is within `10 + max(v,6)*6` m of the conflict (`canGo`).
- **Divided meets undivided: lanes slide together.** The carriageways keep their lane widths and move together over ~`to-from` m (smoothstep) into a double yellow. No lens, no centre object. Roads under 25 m wide get no centre turn lane.
- **Side street into a divided road (`xmed`).** The median is opened symmetrically in both carriageways, ends are rounded noses flush with the strip, the box is paved as the major road. Major-road traffic may turn off; minor-road traffic is limited to right turns unless the opening allows more.
- **Lane lines never enter a box.** Lines are trimmed to the box plus 0.5 m on every priority leg.
- **Pavement is exclusive.** Trees, props and footpaths are clipped or nudged by `roadwayIndex`; paths cross only at crosswalks.
- **Not modelled yet:** left-turn pockets, hatching and arrows, left turns from a side street in the sim.

## Levels, bridges and freeways (apply to every area on load)
Planned once on the base city by `src/engine/levels.js` (`planLevels`), drawn by `src/app/bridges.js`, read by traffic through `src/tools/roads/deck.js`.

| Where | Field | Meaning |
| --- | --- | --- |
| edge | `lv` | from the pack: `[[from, to, level]]`, metres along the edge; 1 = bridge, -1 = tunnel (tools/pack/levels.py) |
| edge | `dk` | planned spans `{ a, b, L, h[], d }`: surface height at evenly spaced stations a..b; L = 1 bridge, -1 tunnel, 0 a graded stretch on the ground (freeways and ramps). Absent = draped on the ground |
| edge | `dkp` | path length the deck was planned for; `spansOf(e)` ignores `dk` if an edit reshaped the edge |
| edge | `l0`, `l1` | level of the start and end node for traffic (0 unless the deck carries on across that node) |

Rules (never per road):
- **Crossing without a shared node is grade separation.** The map splits roads at every real junction, so two paths that cross with no node are at different levels. The tagged span decides which is on top; untagged, a freeway or ramp passes over any other road, a ramp passes under its mainline, and two ordinary streets are left alone (a stray crossing is a data glitch).
- **Freeways and ramps are graded, not draped.** One profile for the whole edge: the ground with bridge spans straightened, low-passed (the DEM is coarse and bumpy), at most 7 percent, both ends on the ground. The ground under the road bed is cut and filled to meet it, with side slopes blending back over 8 m. Bridges run straight between the profile's own heights at their two ends, so a deck always joins the road on either side.
- **A deck** grades straight between the ground at its two ends (inferred decks run 16+ m each side of the crossing and never touch an edge end). A deck over a deck clears it by 6.2 m. A tunnel dips 6.5 m under the ground between its portals.
- **The road below passes under.** The ground under a deck is cut away to 5.6 m clearance; the road beneath dips into the cut at an 8 percent approach grade and gets concrete retaining walls where the cut is deeper than a kerb. The cut lowers `HG` (the terrain grid) once at load, so every `elev` call agrees.
- **Bridges are drawn** as slab (soffit and fascia), parapets (unless the profile has its own barrier), an abutment at each end and, on spans over 32 m, piers clear of the road beneath.
- **Traffic follows levels.** The sim keys a node by place and level (`x,z` plus `^1` when elevated); an elevated end that shares a spot with a ground end is a different node, so nothing turns between levels. Cars carry their deck height in the snapshot (column 7 of `STRIDE`, NaN on the ground) and ride the deck.
- **Freeways** (class `motorway`/`trunk`, ramps included) get `freewayProfile` in `engine/model.js`: concrete barrier on both outer edges (and a median barrier if the map has one two-way road), 1.0 m inner and 2.2 m outer shoulder, 3.5 m lanes, solid yellow edge line on the median side, solid white on the right, long dashes between lanes, no planted strips and no street trees. `src/app/roadside.js` plants natural, varied cover beside them (eucalyptus stands, oak and sycamore, dry scrub) from noise, thicker on slopes, never on pavement or lots. Two or more motorway-class legs meeting (merge or diverge) have no stop bars or crosswalks; a ramp yields by time gap.
- Not built yet: a bridge continuing across several segments is graded per span (each rests on the ground at its own ends); footbridges and rail; terrain cut is not seen by the lot-geometry workers.
