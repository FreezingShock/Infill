// Loads the optional looks sidecar (public/areas/<id>.looks.json) before the engine starts.
// It never blocks or breaks startup: a missing or mismatched file just means buildings are drawn from footprints alone.
export async function bootAssets(area, pack) {
  try {
    if (!area.pack) return false;
    const res = await fetch(`areas/${area.pack.replace(/\.json$/, '.looks.json')}`);
    if (!res.ok) return false;
    const { setLooksData, packChecksum } = await import('../engine/looks.js');
    return setLooksData(await res.json(), pack.buildings.length, packChecksum(pack.buildings));
  } catch (e) { console.warn('looks data skipped', e); return false; }
}
