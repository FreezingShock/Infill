// Entry point: pick the area from ?area=, load its pack, then start the game.
// The engine reads the pack when its modules evaluate, so it is imported only after the pack is in.
const $ = (id) => document.getElementById(id);

async function boot() {
  const manifest = await (await fetch('areas/index.json')).json();
  const want = new URLSearchParams(location.search).get('area');
  const ready = manifest.areas.filter((a) => a.status === 'ready' && a.pack);
  const area = ready.find((a) => a.id === want) || ready.find((a) => a.id === manifest.default) || ready[0];
  if (!area) throw new Error('No area pack is ready in public/areas/index.json');
  $('areaName').textContent = area.name; $('areaSub').textContent = area.sub || '';
  document.title = `Renovated · ${area.name}`;
  const res = await fetch(`areas/${area.pack}`);
  if (!res.ok) throw new Error(`Area pack ${area.pack} did not load (${res.status})`);
  globalThis.__RENOVATED_AREAS__ = manifest;
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = await res.json();
  await import('./app/input.js');
}

boot().catch((e) => {
  console.error(e);
  const el = $('loading'); if (el) el.textContent = `Could not start: ${e.message}`;
});
