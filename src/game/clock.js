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
