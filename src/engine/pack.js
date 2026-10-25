// The area pack the engine runs on (terrain, road graph, blocks, lots, buildings, props).
// main.js fetches it and sets it here before importing the engine; tests do the same in node.
const PACK = globalThis.__RENOVATED_PACK__;
if (!PACK) throw new Error('No area pack loaded: set globalThis.__RENOVATED_PACK__ before importing the engine');
const AREA = globalThis.__RENOVATED_AREA__ || { id: 'area', name: 'Area', sub: '', main: '' };
const AREAS = globalThis.__RENOVATED_AREAS__ || { region: null, areas: [AREA] };

export { AREA, AREAS, PACK };
