// Cinematic idle camera: after load the camera eases onto a bird's-eye ring around the area centre and keeps
// turning. Any input hands control to the player where the camera is (no jump) and it stays off until the next load.
import * as THREE from 'three';
import { ORBIT_PERIOD, fitOrbit } from './camera.js';

const EASE = 2.5; // seconds to settle onto the ring
const v = new THREE.Vector3();
// ?orbitdebug logs every state change to the console so a failed run can be pasted back.
const DEBUG = typeof location !== 'undefined' && new URLSearchParams(location.search).has('orbitdebug');
const log = (...a) => { if (DEBUG) console.log('[orbit]', ...a); };

export function createOrbit({ cam, controls, canvas, bounds, elev, enabled = true }) {
  let lastBeat = 0, on = false, t0 = 0, last = 0, from = null, az = 0;
  const INPUTS = ['pointerdown', 'wheel', 'keydown', 'touchstart'];

  function stop(e) {
    if (!on) return;
    log('stopped by', e && e.type ? e.type : 'code', e && e.key ? `key=${e.key}` : '', 'after', Math.round(performance.now() - t0), 'ms');
    on = false;
    removeEventListener('pointermove', onMove, true);
    for (const t of INPUTS) removeEventListener(t, stop, true);
    controls.update(); // re-reads the camera as it is now: control resumes from here
  }
  let moved = 0; // a few px of cursor drift (or the cursor sitting under a lifting boot screen) is not an input
  const onMove = (e) => { if (e.pointerType === 'touch') return stop(e); moved += Math.abs(e.movementX || 0) + Math.abs(e.movementY || 0); if (moved > 12) stop(e); };

  function start(now) {
    log('start requested', { enabled, alreadyOn: on, hidden: document.hidden });
    if (!enabled || on) return;
    const spherical = new THREE.Spherical().setFromVector3(v.copy(cam.position).sub(controls.target));
    from = { target: controls.target.clone(), dist: spherical.radius, polar: spherical.phi };
    az = spherical.theta; t0 = last = now; on = true; moved = 0;
    log('running', { dist: Math.round(from.dist), polar: +from.polar.toFixed(2), az: +az.toFixed(2), fit: fitOrbit(bounds(), cam.aspect) });
    addEventListener('pointermove', onMove, true);
    for (const t of INPUTS) addEventListener(t, stop, { capture: true, passive: true });
  }

  /** Call every frame before controls.update(). Returns true while it owns the camera. */
  function tick(now) {
    if (!on) return false;
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (DEBUG && now - lastBeat > 2000) { lastBeat = now; log('tick', { az: +az.toFixed(2), pos: cam.position.toArray().map(Math.round), target: controls.target.toArray().map(Math.round) }); }
    const f = fitOrbit(bounds(), cam.aspect);
    const k = Math.min(1, (now - t0) / 1000 / EASE), e = k * k * (3 - 2 * k); // smoothstep
    az += (Math.PI * 2 / ORBIT_PERIOD) * dt * e;
    const ty = elev(f.cx, f.cz);
    controls.target.set(from.target.x + (f.cx - from.target.x) * e, from.target.y + (ty - from.target.y) * e, from.target.z + (f.cz - from.target.z) * e);
    const dist = from.dist + (f.dist - from.dist) * e, polar = from.polar + (f.polar - from.polar) * e;
    cam.position.setFromSphericalCoords(dist, polar, az).add(controls.target);
    cam.lookAt(controls.target);
    return true;
  }
  return { start, stop, tick, get active() { return on; } };
}
