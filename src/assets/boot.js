// Loads the optional looks sidecar (public/areas/<id>.looks.json) before the engine starts.
// It never blocks or breaks startup: a missing or mismatched file just means buildings are drawn from footprints alone.
export async function bootAssets(area, pack) {
  try {
    if (!area.pack) return false;
    const res = await fetch(`areas/${area.pack.replace(/\.json$/, '.looks.json')}`);
    const { setLooksData, packChecksum } = await import('../engine/looks.js');
    const ok = res.ok && setLooksData(await res.json(), pack.buildings.length, packChecksum(pack.buildings));
    try { // street trees from the City of LA inventory, per named street
      const st = await fetch(`areas/${area.pack.replace(/\.json$/, '.streets.json')}`);
      if (st.ok) (await import('../engine/streettrees.js')).setStreetTrees(await st.json());
    } catch (e) { console.warn('street trees skipped', e); }
    return ok;
  } catch (e) { console.warn('looks data skipped', e); return false; }
}
