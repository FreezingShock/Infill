// Growth pace: how fast city "days" pass for growth, separate from the light clock in ../clock.js.
// The shared game clock. One day passes every DAY_SECONDS of real time at 1x speed.
// Anything that needs "time in the city" (growth, sim, light) reads this; nothing else owns time.
const DAY_SECONDS = 6;
const SPEEDS = [0, 1, 2, 4];

const clock = { day: 0, speed: 1, frac: 0, subs: new Set() };

// Advance by real seconds. Calls every subscriber once per whole game day that passed.
function advance(dt) {
  if (!clock.speed || !(dt > 0)) return 0;
  clock.frac += (dt * clock.speed) / DAY_SECONDS;
  let n = 0;
  while (clock.frac >= 1) { clock.frac -= 1; clock.day++; n++; for (const f of clock.subs) f(clock.day); }
  return n;
}
const onDay = (f) => { clock.subs.add(f); return () => clock.subs.delete(f); };
const setSpeed = (s) => { clock.speed = SPEEDS.includes(s) ? s : 1; };
const reset = () => { clock.day = 0; clock.frac = 0; };

export { DAY_SECONDS, SPEEDS, advance, clock, onDay, reset, setSpeed };
