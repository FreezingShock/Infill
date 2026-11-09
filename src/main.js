// Entry point: pick the area from ?area=, load its pack, then start the game.
// The engine reads the pack when its modules evaluate, so it is imported only after the pack is in.
import { CAMINO } from './camino/theme.js'; // picks the look before any material exists
import { bootArea, bootDone, bootFail, bootProgress, bootStep } from './app/loader.js'; // the boot screen in index.html
const $ = (id) => document.getElementById(id);

async function boot() {
  bootStep('Reading the area list');
  const manifest = await (await fetch('areas/index.json')).json();
  const want = new URLSearchParams(location.search).get('area');
  const ready = manifest.areas.filter((a) => a.status === 'ready' && a.pack);
  const area = ready.find((a) => a.id === want) || ready.find((a) => a.id === manifest.default) || ready[0];
  if (!area) throw new Error('No area pack is ready in public/areas/index.json');
  $('areaName').textContent = area.name; $('areaSub').textContent = area.sub || '';
  bootArea(area.name);
  document.title = `sfvOS · ${area.name}`;
  bootStep(`Loading ${area.name}`); bootProgress(5);
  const res = await fetch(`areas/${area.pack}`);
  if (!res.ok) throw new Error(`Area pack ${area.pack} did not load (${res.status})`);
  globalThis.__RENOVATED_AREAS__ = manifest;
  globalThis.__RENOVATED_AREA__ = area;
  globalThis.__RENOVATED_PACK__ = await res.json(); bootProgress(12);
  bootStep('Looks, street trees and canopy');
  await (await import('./assets/boot.js')).bootAssets(area, globalThis.__RENOVATED_PACK__); // optional open-data building looks
  bootProgress(22);
  bootStep('Building the city'); bootProgress(25); // the lot builds below report 25 to 90 (src/workers/warm.js)
  await import('./app/input.js');
  await import('./ui/index.js'); // info views, clock and advisor
  bootProgress(92);
  if (CAMINO) { bootStep('Placing real infrastructure'); await import('./camino/index.js'); } // sfvOS Camino: realistic street view, scan view, real infrastructure
  bootDone();
}

boot().catch((e) => {
  console.error(e);
  bootFail(e.message);
});
