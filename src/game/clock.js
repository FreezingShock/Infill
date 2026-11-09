// Shared game clock. Light, traffic and the HUD all read it; nothing here is saved (sim state is derived).
// hour is 0..24. speed is game hours per real second (0 = paused).
export const clock = { hour: 14, speed: 0, day: 0 };

export function setHour(h) { clock.hour = ((h % 24) + 24) % 24; }

export function tickClock(dtSec) {
  if (!clock.speed) return false;
  const h = clock.hour + clock.speed * dtSec;
  if (h >= 24) clock.day += Math.floor(h / 24);
  setHour(h);
  return true;
}

export function fmtHour(h) {
  const m = Math.floor(((h % 24) + 24) % 24 * 60), hh = Math.floor(m / 60) % 24, mm = m % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// ---- speed steps and helpers for the HUD and the views (additive; the light thread owns hour/speed/tickClock) ----
// speed is game hours per real second: pause, then a day in about 4 minutes, 80 seconds, 24 seconds.
export const SPEEDS = [0, 0.1, 0.3, 1];
export const SPEED_NAMES = ['Paused', 'Normal', 'Fast', 'Faster'];
let lastRunning = 1;
export function speedIndex() { if (!clock.speed) return 0; let best = 1; for (let i = 1; i < SPEEDS.length; i++) if (Math.abs(Math.log(clock.speed / SPEEDS[i])) < Math.abs(Math.log(clock.speed / SPEEDS[best]))) best = i; return best; }
export function setSpeed(i) { const v = Math.max(0, Math.min(SPEEDS.length - 1, i | 0)); if (v) lastRunning = v; clock.speed = SPEEDS[v]; }
export function togglePause() { if (clock.speed) { lastRunning = speedIndex(); clock.speed = 0; } else clock.speed = SPEEDS[lastRunning]; }
export const minuteOfDay = () => (((clock.hour % 24) + 24) % 24) * 60;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const weekday = () => DAYS[((clock.day % 7) + 7) % 7];
export function clockLabel() { const m = Math.floor(minuteOfDay()), h = Math.floor(m / 60); return { time: `${((h + 11) % 12) + 1}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, day: `${weekday()} · day ${clock.day + 1}` }; }
