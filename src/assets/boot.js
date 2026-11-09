// Loads the optional looks sidecar (public/areas/<id>.looks.json) before the engine starts.
// It never blocks or breaks startup: a missing or mismatched file just means buildings are drawn from footprints alone.
export async function bootAssets(area, pack) {
  try {
    if (!area.pack) return false;
    const res = await fetch(`areas/${area.pack.replace(/\.json$/, '.looks.json')}`);
    const { setLooksData, packChecksum } = await import('../engine/looks.js');
    const sidecar = res.ok ? await res.json() : null;
    const ok = !!sidecar && setLooksData(sidecar, pack.buildings.length, packChecksum(pack.buildings));
    if (ok) globalThis.__RENOVATED_LOOKS__ = sidecar; // the lot workers load the same looks
    try { // street trees from the City of LA inventory, per named street
      const st = await fetch(`areas/${area.pack.replace(/\.json$/, '.streets.json')}`);
      if (st.ok) { const data = await st.json(); (await import('../engine/streettrees.js')).setStreetTrees(data); globalThis.__RENOVATED_STREETS__ = data; }
    } catch (e) { console.warn('street trees skipped', e); }
    return ok;
  } catch (e) { console.warn('looks data skipped', e); return false; }
}
