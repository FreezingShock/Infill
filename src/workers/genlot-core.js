// The worker-side job: generate lots from programs. Imports the engine, so it can only be loaded once the pack
// is set on globalThis (genlot.worker.js does that) or, in tests, after the test sets the pack itself.
import { PACK } from '../engine/pack.js';
import { genLot } from '../engine/templates.js';
import { packChecksum, setLooksData } from '../engine/looks.js';
import { encodeBatch } from './codec.js';

function applyLooks(sidecar) {
  if (sidecar) setLooksData(sidecar, PACK.buildings.length, packChecksum(PACK.buildings));
}

// jobs: [{ h, lot, demo }] where demo lists the demolished building indexes that touch this lot.
// genLot only reads S.demo (through liveBuildings), so that is all the worker needs of the city state.
function genBatch(jobs) {
  return encodeBatch(jobs.map((j) => ({ h: j.h, g: genLot(j.lot, { demo: new Set(j.demo) }) })));
}

export { applyLooks, genBatch };
