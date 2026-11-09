# Road graph fields (owned by the roads workstream, `src/tools/roads/`)

All additive and optional. A missing field means today's behavior. Read them through the helpers in `src/tools/roads/graph.js`.

| Where | Field | Meaning |
| --- | --- | --- |
| edge | `oneway` | `1` cars drive a to b, `-1` b to a, absent = two-way. Set by `street.oneway` |
| edge | `speed` | speed limit in mph, absent = by class. Set by `street.speed` |
| edge | `ring` | `1` on roundabout ring pieces (always `oneway: 1`, counterclockwise on screen = decreasing `atan2(z, x)`) |
| state | `S.ctrl[nodeIndex]` | `signal`, `allway`, `stop` (side streets stop), `yield`, `roundabout`. Absent = automatic |
| state | `S.rounds[nodeIndex]` | `{ r }` radius of a converted roundabout |

Helpers: `nodeEdges(S, n)`, `isJunction(S, n)`, `nodeControl(S, n)` (explicit choice or the automatic default, `'none'` for non-junctions), `givesWay(S, n, edge)`, `isOneWay(edge)`, `nearestNode(S, x, z, tol)`.

Edit-log commands added: `street.batch`, `street.profs`, `street.oneway`, `street.speed`, `node.ctrl`, `node.roundabout`, `roundabout.new`. All replay deterministically from the log; roundabout rewrites the graph (spokes end on the ring), so rebuild lane graphs whenever the street key changes.

Per-element lane direction (`dir` on cross-section elements) is not in yet.
