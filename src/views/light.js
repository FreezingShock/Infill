// Time of day: sun path, sky colours and lamp glow from the shared clock.
import * as THREE from 'three';
import { clock, fmtHour } from '../game/clock.js';

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const hex = (h) => [(h >> 16 & 255) / 255, (h >> 8 & 255) / 255, (h & 255) / 255];
const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;

const SUN_DAY = hex(0xfff1d6), SUN_LOW = hex(0xffa468), SUN_NIGHT = hex(0x9fb4e8);
const SKY = { day: [hex(0xa9d2ec), hex(0xe9efe4)], dusk: [hex(0x6f7fb0), hex(0xf6b98a)], night: [hex(0x141a2b), hex(0x2c3550)] };
const HEMI_SKY_DAY = hex(0xeaf3ff), HEMI_SKY_NIGHT = hex(0x5a6a99), HEMI_GROUND = hex(0x8a7a5a);

/** Everything the renderer needs for a given hour (0..24). Pure, testable in node. */
export function lightAt(hour) {
  const h = ((hour % 24) + 24) % 24;
  const rise = 6, set = 19.5;
  const dayT = (h - rise) / (set - rise); // 0..1 across the day
  const el = dayT > 0 && dayT < 1 ? Math.sin(dayT * Math.PI) : 0; // sun height 0..1
  const day = sstep(0.02, 0.28, el); // 0 night .. 1 full day
  const low = (1 - sstep(0.1, 0.55, el)) * (el > 0 ? 1 : 0); // golden hour weight
  const night = 1 - sstep(0.0, 0.14, el);
  // sun travels east to west (x from -1 to 1) and tilts south; at night a fixed moon takes over
  const az = lerp(-1, 1, Math.min(1, Math.max(0, dayT)));
  const shadowEl = Math.max(0.22, el); // keep shadows from stretching to infinity
  const dir = el > 0
    ? [az * 0.85, shadowEl * 1.05 + 0.18, 0.45]
    : [-0.5, 0.85, 0.35];
  const len = Math.hypot(...dir);
  const sunCol = mix(mix(SUN_DAY, SUN_LOW, low), SUN_NIGHT, night);
  const sunI = lerp(0.45, 2.1, day);
  const hemiI = lerp(0.35, 1.15, day);
  const hemiSky = mix(HEMI_SKY_NIGHT, HEMI_SKY_DAY, day);
  const skyTop = mix(mix(SKY.day[0], SKY.dusk[0], low * 0.8), SKY.night[0], night);
  const skyBottom = mix(mix(SKY.day[1], SKY.dusk[1], low * 0.8), SKY.night[1], night);
  // true sky positions (the shadow dir above is clamped): sun rises east, moon crosses the night half
  const nightT = h >= set ? (h - set) / (24 - set + rise) : (h + 24 - set) / (24 - set + rise);
  const mEl = Math.sin(Math.min(1, Math.max(0, nightT)) * Math.PI);
  const skyDir = el > 0 || dayT > -0.03 && dayT < 1.03 ? [az * 0.85, Math.sin(Math.min(1, Math.max(-0.03, dayT)) * Math.PI) * 0.92 - 0.0, 0.45] : [0, -1, 0];
  const moonDir = [-Math.min(1, Math.max(0, nightT)) * 1.6 + 0.8, mEl * 0.9 + 0.02, -0.4];
  return { skyDir, moonDir, golden: low, dir: dir.map((v) => v / len), sunCol, sunI, hemiI, hemiSky, hemiGround: HEMI_GROUND, skyTop, skyBottom, night, glow: night, isNight: night > 0.5 };
}

export const SUN_DIST = 520;

/** Push a lightAt() result onto the scene. Cheap; call when the hour moves. */
export function applyLight(env, L) {
  const { sun, hemi, scene, glassMat, lampMat, app, sky } = env;
  if (sky) sky.update(L);
  sun.userData.dir = L.dir;
  sun.color.setRGB(...L.sunCol); sun.intensity = L.sunI;
  hemi.intensity = L.hemiI; hemi.color.setRGB(...L.hemiSky); hemi.groundColor.setRGB(...L.hemiGround);
  const g = L.glow;
  glassMat.emissive.setRGB(0.6 * g, 0.48 * g, 0.25 * g);
  if (lampMat) lampMat.emissive.setRGB(1 * g, 0.82 * g, 0.48 * g);
  if (app) {
    app.style.setProperty('--sky-top', css(L.skyTop)); app.style.setProperty('--sky-bottom', css(L.skyBottom));
    app.classList.toggle('night', L.isNight);
  }
  if (!scene.fog) scene.fog = new THREE.Fog(0xffffff, 1000, 3000);
  scene.fog.color.setRGB(...L.skyBottom);
}

/** Small clock dock: time label, slider, play and Day/Night. Returns { sync } to refresh after external changes. */
export function mountClockDock(parent, { onChange }) {
  const st = document.createElement('style');
  st.textContent = `.clockdock{position:absolute;left:50%;bottom:max(16px,env(safe-area-inset-bottom,0px));transform:translateX(-50%);display:flex;align-items:center;gap:8px;padding:6px 12px;z-index:3;font:12.5px var(--body);color:var(--ink)}
.clockdock .t{min-width:44px;font-variant-numeric:tabular-nums;font-weight:700}
.clockdock input[type=range]{width:150px;accent-color:var(--terracotta)}
.clockdock .tool{padding:5px 8px}
@media (max-width:980px){.clockdock{display:none}}`;
  document.head.appendChild(st);
  const el = document.createElement('div'); el.className = 'plaque clockdock'; el.setAttribute('role', 'group'); el.setAttribute('aria-label', 'Time of day');
  el.innerHTML = '<span class="t" id="clkT">14:00</span><input id="clkR" type="range" min="0" max="24" step="0.05" aria-label="Time of day"><button class="tool" id="clkPlay" aria-pressed="false" title="Let time run">Run</button><button class="tool" id="clkFast" aria-pressed="false" title="Faster">Fast</button>';
  parent.appendChild(el);
  const r = el.querySelector('#clkR'), t = el.querySelector('#clkT'), play = el.querySelector('#clkPlay'), fast = el.querySelector('#clkFast');
  const sync = () => { r.value = clock.hour; t.textContent = fmtHour(clock.hour); play.setAttribute('aria-pressed', String(clock.speed > 0)); fast.setAttribute('aria-pressed', String(clock.speed > 0.5)); };
  r.addEventListener('input', () => { clock.hour = +r.value; sync(); onChange(); });
  play.onclick = () => { clock.speed = clock.speed > 0 ? 0 : 0.2; sync(); };
  fast.onclick = () => { clock.speed = clock.speed > 0.5 ? 0.2 : 1.5; sync(); };
  sync();
  return { sync };
}
