// sfvOS Camino: wires the realistic street look, the scan view, real infrastructure and the HUD parts into the running game.
// Loaded by main.js after the app and the HUD when the Camino theme is on (src/camino/theme.js).
import './camino.css';
import './look.js';
import { PACK } from '../engine/pack.js';
import { X0, X1, Z0, Z1 } from '../engine/core.js';
import { scene } from '../app/render.js';
import { buildInfra } from './infra.js';
import { infraTotals, layoutInfra } from './infra-data.js';
import { initScan, onScan, scanOn, setScan, tick } from './scan.js';
import { anchors, createTags } from './tags.js';
import { skyState } from './sky.js';
import { mountFps, mountKeys, mountSwitch, mountTitle, showDossier } from './hud.js';
import { mountCommandBar } from './commandbar.js';

const AREA = globalThis.__RENOVATED_AREA__ || {};
let D = null;
if (AREA.infra) { try { const r = await fetch(`areas/${AREA.infra}`); if (r.ok) D = await r.json(); } catch { /* sidecar is optional */ } }
const lamps = PACK.props.filter((p) => p[0] === 'lamp').map(([, x, z]) => [x, z]);
const I = layoutInfra(D, lamps, [X0 - 60, Z0 - 60, X1 + 60, Z1 + 60]);
const infra = buildInfra(I); scene.add(infra.group);
initScan({ infra, I });

mountTitle(); mountKeys();
const syncSwitch = mountSwitch(setScan);
const tags = createTags(document.getElementById('app'), anchors(I)); tags.show(false);
onScan((on) => { tags.show(on); syncSwitch(on); });
showDossier(AREA, infraTotals(I));
const fps = mountFps();
mountCommandBar(); // "/" or Ctrl+K: views, tools, areas, Street/Scan and addresses

addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest && e.target.closest('input, select, textarea')) return;
  if (['areas', 'credits', 'logm', 'keysm'].some((id) => { const m = document.getElementById(id); return m && !m.hidden; })) return;
  if (e.key.toLowerCase() === 'f') setScan(!scanOn());
});

let lastGlow = -1;
(function loop(now) {
  const L = skyState.L; if (L && Math.abs(L.glow - lastGlow) > 0.01) { lastGlow = L.glow; infra.setGlow(L.glow); }
  tick(now); tags.place(now); fps(now);
  requestAnimationFrame(loop);
})(performance.now());
