import { liveBuildings } from '../../engine/model.js';
import { USES } from '../../engine/renovate.js';
import { uid } from '../../engine/commands.js';
import { STATE } from '../../app/state.js';

// =====================================================================
// Repurpose shelf for the Build palette: keep the walls, change what the building is for.
// Each item is a normal palette item ({ id, name, icon, blurb, fits, cmd }) that emits ordinary edit-log commands.
// =====================================================================
const svg = (body) => `<svg viewBox="0 0 44 30" aria-hidden="true">${body}</svg>`;
const SHELL = (wall) => `<path d="M7 27V12h30v15z" fill="${wall}" stroke="currentColor" stroke-width="2"/>`;
const ICON = {
  shops: svg(SHELL('#f2dfa2') + '<path d="M5 12h34l-2 5H7z" fill="#c4613b" stroke="currentColor" stroke-width="1.5"/><path d="M11 20h8v7h-8zM25 20h8v7h-8z" fill="#3b5866" stroke="currentColor" stroke-width="1.5"/>'),
  mixed: svg('<path d="M7 27V5h30v22z" fill="#eedcc0" stroke="currentColor" stroke-width="2"/><path d="M5 17h34l-2 4H7z" fill="#c4613b" stroke="currentColor" stroke-width="1.5"/><path d="M11 22h8v5h-8zM25 22h8v5h-8z" fill="#3b5866"/><path d="M12 8h4v4h-4zM20 8h4v4h-4zM28 8h4v4h-4z" fill="#3b5866"/>'),
  homes: svg(SHELL('#f1e2c4') + '<path d="M4 12L22 4l18 8z" fill="#bb5836" stroke="currentColor" stroke-width="2"/><path d="M19 27v-8h6v8z" fill="#6d4a33" stroke="currentColor" stroke-width="1.5"/>'),
  office: svg('<path d="M9 27V6h26v21z" fill="#dfe6ea" stroke="currentColor" stroke-width="2"/><path d="M12 9h20M12 14h20M12 19h20M12 24h20" stroke="#3b5866" stroke-width="3"/>'),
  facelift: svg(SHELL('#f4eadb') + '<path d="M4 12L22 4l18 8z" fill="#3b4f7a" stroke="currentColor" stroke-width="2"/><path d="M36 3l1.5 3.2 3.3.4-2.5 2.2.7 3.3-3-1.7-3 1.7.7-3.3-2.5-2.2 3.3-.4z" fill="#d6ad57"/>'),
  center: svg('<path d="M3 27V13h16v14zM25 27V13h16v14z" fill="#f2dfa2" stroke="currentColor" stroke-width="2"/><path d="M19 20h6" stroke="#c4613b" stroke-width="3"/><path d="M2 13h18l-1 4H3zM24 13h18l-1 4H25z" fill="#c4613b"/>'),
};

const hasShell = (l) => (l.prog.t === 'asb' && liveBuildings(l, STATE).length ? null : l.prog.t !== 'asb' ? 'Set it back to As-built first, then repurpose the building' : 'No building here to repurpose');
const useItem = (id, blurb, extra = {}) => ({
  id: 'use.' + id, name: USES[id].name, icon: ICON[id], blurb, fits: hasShell,
  cmd: (ids) => ({ op: 'tweak', lots: ids, f: { use: id, add: extra.add ?? null } }),
});

const ITEMS = [
  useItem('shops', 'Ground-floor shopfronts and awnings in the same building'),
  useItem('mixed', 'Shops below, two new floors of homes on top of low buildings'),
  useItem('homes', 'Turn shops or offices into homes, with doors and porches'),
  useItem('office', 'Glass-banded offices behind the same walls'),
  { id: 'use.facelift', name: 'Facelift', icon: ICON.facelift, blurb: 'Fresh paint, a new roof, trees and solar. Same use, same walls', fits: () => null,
    cmd: (ids) => ({ op: 'tweak', lots: ids, f: { pl: 'sand', rf: 'gable', trees: 1, solar: 1 } }) },
  { id: 'use.center', name: 'One center', icon: ICON.center, blurb: 'Join touching lots (a strip mall, a block of shops) into one lot and treat it as one thing',
    fits: () => null, cmd: (ids) => (ids.length > 1 ? { op: 'merge', lots: ids, id: uid('c') } : null) },
];
const byId = new Map(ITEMS.map((i) => [i.id, i]));

const repurposeShelf = () => ({ k: 'use', name: 'Repurpose · keep the walls', items: ITEMS });
const repurposeItem = (id) => byId.get(id) || null;
export { ITEMS, repurposeItem, repurposeShelf };
