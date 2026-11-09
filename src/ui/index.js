// CS2-style HUD parts: clock and speed controls, the info-view bar with its legend, and the advisor.
// Everything is built into the existing page; the only hooks into the app are the 'infill:state' event and main.js's import.
import '../styles/hud.css';
import '../styles/layout.css';
import { SPEEDS, SPEED_NAMES, clock, clockLabel, minuteOfDay, setSpeed, speedIndex, togglePause } from '../game/clock.js';
import { lightAt } from '../views/light.js';
import { VIEWS, cycleView, current, legend, onChange, setView, stats } from '../views/index.js';
import { tripsAt } from '../views/metrics.js';
import { esc } from '../engine/core.js';

const $ = (id) => document.getElementById(id);
const ICON = { pause: '<path d="M4 3h3v10H4zM9 3h3v10H9z" fill="currentColor"/>', play: '<path d="M4 2.5l9 5.5-9 5.5z" fill="currentColor"/>', play2: '<path d="M2 3l6 5-6 5zM8 3l6 5-6 5z" fill="currentColor"/>', play3: '<path d="M1 3l5 5-5 5zM6 3l5 5-5 5zM11 3l4.5 5-4.5 5z" fill="currentColor"/>' };
const ICONS = ['pause', 'play', 'play2', 'play3'];
const svg = (inner) => `<svg viewBox="0 0 16 16" aria-hidden="true">${inner}</svg>`;

// ---------- clock plaque (goes first in the top-right cluster) ----------
const clockEl = document.createElement('div');
clockEl.className = 'plaque clockbar'; clockEl.id = 'clockbar';
clockEl.innerHTML = `<div class="sky" id="skyDot" aria-hidden="true"></div>
  <div class="when" aria-live="off"><b id="clkTime">7:00 AM</b><small id="clkDay"></small></div>
  <div class="speeds" role="group" aria-label="Game speed">${SPEEDS.map((_, i) => `<button class="spd" data-speed="${i}" title="${SPEED_NAMES[i]}${i ? ` (${i})` : ' (Space)'}" aria-pressed="${speedIndex() === i}">${svg(ICON[ICONS[i]])}</button>`).join('')}</div>
  <div class="gauges"><div class="gauge" id="gTraffic" title="Average traffic on the busier streets right now"><small>Traffic</small><div class="meter"><i></i></div></div>
  <div class="gauge" id="gMood" title="How happy the homes are with their surroundings"><small>Happy</small><div class="meter"><i></i></div></div></div>`;
const tr = document.querySelector('.tr'); (tr || document.getElementById('app')).prepend(clockEl);
clockEl.querySelectorAll('.spd').forEach((b) => (b.onclick = () => setSpeed(+b.dataset.speed)));

// the light thread's frame loop moves clock.hour; this reads it every frame and touches the DOM only when something changed
let shownMin = -1, shownSpeed = -1;
function paintClock() {
  const m = Math.floor(minuteOfDay());
  if (clock.speed !== shownSpeed) { shownSpeed = clock.speed; const si = speedIndex(); clockEl.querySelectorAll('.spd').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.speed === si))); clockEl.classList.toggle('paused', clock.speed === 0); }
  if (m === shownMin) return; shownMin = m;
  const l = clockLabel(); $('clkTime').textContent = l.time; $('clkDay').textContent = l.day;
  const d = 1 - lightAt(clock.hour).night; $('skyDot').style.setProperty('--d', d.toFixed(2));
}
paintClock();

// ---------- info-view bar and legend ----------
const bl = document.querySelector('.bl');
const bar = document.createElement('div'); bar.className = 'plaque bar'; bar.id = 'infobar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Info views');
bar.innerHTML = `<span class="barlabel">Info views</span>` + VIEWS.map((v) => `<button class="tool" data-view="${v.id}" aria-pressed="false" title="${v.name}${v.key ? ` (${v.key} cycles)` : ''}">${svg(v.icon)}${v.name}</button>`).join('');
const lg = document.createElement('div'); lg.className = 'plaque legend'; lg.id = 'legend'; lg.hidden = true; lg.setAttribute('aria-live', 'polite');
if (bl) { bl.prepend(bar); bl.prepend(lg); } else document.getElementById('app').append(bar, lg);
bar.querySelectorAll('[data-view]').forEach((b) => (b.onclick = () => setView(b.dataset.view)));
function paintViews() {
  const v = current();
  bar.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(!!v && b.dataset.view === v.id)));
  const L = legend(); lg.hidden = !L; if (!L) return;
  const est = (L.id === 'traffic' || L.id === 'parking') && !stats().live;
  lg.innerHTML = `<b>${esc(L.name)}</b>` +
    (L.chips ? `<div class="chips">${L.chips.map((c) => `<span class="chipb"><i style="background:#${c.hex.toString(16).padStart(6, '0')}"></i>${esc(c.name)}</span>`).join('')}</div>`
      : `<div class="ramp"><i style="background:${L.gradient}"></i><span>${esc(L.lo)}</span><span>${esc(L.hi)}</span></div>`) +
    `<p>${esc(L.what)}${est ? ' <em>Estimated from road size and land use until live cars arrive.</em>' : ''}</p>`;
}
onChange(paintViews); paintViews();

// ---------- gauges and the advisor: a system alert with a severity tag, the place, one line of copy and one action ----------
const adv = document.createElement('div'); adv.className = 'plaque advisor'; adv.id = 'advisor'; adv.setAttribute('role', 'status');
document.querySelector('.tl')?.append(adv);
let tip = null, lastStat = 0;
// severity glyphs are drawn in the theme colour, never emoji: triangle = alert, diamond = watch, ring = all clear
const SEV = {
  alert: { label: 'Alert', glyph: '<path d="M6 1.2l5.2 9.4H.8z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 4.8v2.6M6 8.8v.2" stroke="currentColor" stroke-width="1.6"/>' },
  warn: { label: 'Watch', glyph: '<path d="M6 .9l5.1 5.1L6 11.1.9 6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M6 3.8v2.8" stroke="currentColor" stroke-width="1.6"/><path d="M6 8.4v.2" stroke="currentColor" stroke-width="1.9"/>' },
  ok: { label: 'Clear', glyph: '<circle cx="6" cy="6" r="4.9" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M3.9 6.1l1.4 1.4 2.8-2.9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>' },
};
function advise(s) {
  const out = [];
  if (s.worstStreet && s.jam > 0) out.push({ sev: 'alert', topic: 'Traffic', loc: s.worstStreet, text: 'Jammed right now. Add a lane, or a bus lane, to carry more people.', view: 'traffic' });
  if (s.parkShort > 15) out.push({ sev: 'warn', topic: 'Parking', loc: null, text: `About ${s.parkShort} cars can't find a space. Add stalls, or give them somewhere to go.`, view: 'parking' });
  if (s.lonelyHomes > 25) out.push({ sev: 'warn', topic: 'Comfort', loc: null, text: `${s.lonelyHomes} homes have no shop or park nearby. A corner shop or pocket park helps.`, view: 'comfort' });
  if (!out.length) out.push({ sev: 'ok', topic: 'Status', loc: null, text: tripsAt() < 0.2 ? 'The city sleeps. Fast-forward to see the morning rush.' : 'Traffic is flowing and homes are settled. Try something bold.', view: null });
  return out[0];
}
function paintAdvisor() {
  const s = stats(), t = advise(s);
  $('gTraffic').querySelector('i').style.width = Math.round(Math.min(1, s.traffic / 0.9) * 100) + '%';
  $('gTraffic').querySelector('i').style.background = s.traffic > 0.7 ? 'var(--warn)' : s.traffic > 0.45 ? 'var(--gold)' : 'var(--sage)';
  $('gMood').querySelector('i').style.width = Math.round(s.comfort * 100) + '%';
  const key = [t.sev, t.topic, t.loc, t.text, t.view].join('|');
  if (tip === key) return; tip = key;
  const sv = SEV[t.sev];
  adv.dataset.sev = t.sev;
  adv.innerHTML = `<div class="adv-head"><span class="adv-tag"><svg viewBox="0 0 12 12" aria-hidden="true">${sv.glyph}</svg>${sv.label}</span><span class="adv-loc"><b>${esc(t.topic)}</b>${t.loc ? ` · ${esc(t.loc)}` : ''}</span></div>`
    + `<p>${esc(t.text)}</p>${t.view ? `<div class="adv-act"><button class="btn ghost small" data-show="${t.view}">Show me</button></div>` : ''}`;
  adv.querySelector('[data-show]')?.addEventListener('click', (e) => { const id = e.currentTarget.dataset.show; if (current()?.id !== id) setView(id); });
}
// statistics are cheap but not free: refresh about once a second, and right after an edit
const refreshStats = () => { lastStat = performance.now(); paintAdvisor(); };
addEventListener('infill:state', () => setTimeout(refreshStats, 0));
(function statLoop() { if (performance.now() - lastStat > 1000) refreshStats(); setTimeout(statLoop, 500); })();
setTimeout(refreshStats, 0);

// ---------- the loop and the keys ----------
(function loop() { paintClock(); requestAnimationFrame(loop); })();
if (!clock.speed) setSpeed(1); // a live city: time runs from the start (Space pauses)
addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target.closest ? e.target : document.body;
  if (t.closest('input, select, textarea, [role=slider]') || (e.key === ' ' && t.closest('button'))) return; // typing, or Space that belongs to a focused button
  if (['areas', 'credits', 'logm', 'keysm'].some((id) => $(id) && !$(id).hidden)) return;
  const k = e.key.toLowerCase();
  if (e.key === ' ') { e.preventDefault(); togglePause(); }
  else if (k === '1' || k === '2' || k === '3') setSpeed(+k);
  else if (k === 'i') cycleView();
});
const keys = document.querySelector('#keysm .keys');
if (keys) keys.insertAdjacentHTML('beforeend', '<div><kbd>Space</kbd> Pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> Speed</div><div><kbd>I</kbd> Cycle the info views</div>');

// ---------- dock the loose parts into their homes: scrub slider joins the clock bar, traffic chip joins the corner cluster ----------
function dockParts() {
  const dock = document.querySelector('.clockdock'); if (dock && dock.parentNode !== clockEl) clockEl.append(dock);
  const chip = document.querySelector('.trafficchip'), br = document.querySelector('.br'); if (chip && br && chip.parentNode !== br) br.prepend(chip);
}
dockParts(); setTimeout(dockParts, 0); addEventListener('load', dockParts);
