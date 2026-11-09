// Callout tags for the scan view: street names, signals, bus stops with route badges, hydrants, power lines.
// One pooled DOM layer; the set is re-chosen four times a second and positioned every frame in whole pixels,
// after the frame has rendered, so tags never shimmer or trail the camera.
import * as THREE from 'three';
import { PACK } from '../engine/pack.js';
import { elev, esc, polyLen } from '../engine/core.js';
import { STATE } from '../app/state.js';
import { cam, canvas } from '../app/render.js';
import { SRC } from './infra-data.js';

const nf = new Intl.NumberFormat('en-US');
const CAP = { road: 9, stop: 6, signal: 5, hyd: 6, power: 4, sub: 3 };
const RANGE = { road: 2600, stop: 1500, signal: 1200, hyd: 520, power: 3200, sub: 2400 };
const bullets = (lines, n = 3) => lines.slice(0, n).map((l) => `<span class="bullet">${esc(l)}</span>`).join('');
function mid(p) { const L = polyLen(p); let acc = 0; for (let k = 1; k < p.length; k++) { const s = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); if (acc + s >= L / 2) { const t = (L / 2 - acc) / (s || 1); return [p[k - 1][0] + (p[k][0] - p[k - 1][0]) * t, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * t]; } acc += s; } return p[0]; }

export function anchors(I) {
  const A = [];
  const named = new Map();
  for (const e of STATE.edges.values()) { if (!e.n || !e.g || !['primary', 'secondary', 'tertiary'].includes(e.c) || e.p.length < 2) continue; const L = polyLen(e.p); if (L < 90) continue; const q = mid(e.p); const list = named.get(e.n) || []; if (list.some((r) => Math.hypot(r[0] - q[0], r[1] - q[1]) < 420)) continue; list.push(q); named.set(e.n, list); A.push({ k: 'road', x: q[0], y: elev(q[0], q[1]) + 2, z: q[1], html: esc(e.n), cls: 'road' }); }
  let n = 0; for (const [k, x, z] of PACK.props) if (k === 'signal') A.push({ k: 'signal', x, y: elev(x, z) + 7, z, html: `Signal ${String(++n).padStart(3, '0')}<i>LINKED</i>`, cls: 'cy' });
  if (I) {
    for (const s of I.stops) A.push({ k: 'stop', x: s.x, y: elev(s.x, s.z) + 3, z: s.z, html: `${bullets(s.lines)}${esc(s.name.split(' / ')[0])}<i>${nf.format(s.ons)}/day · ${SRC.stops}</i>`, cls: '' });
    for (const h of I.hydrants) A.push({ k: 'hyd', x: h.x, y: elev(h.x, h.z) + 1.2, z: h.z, html: `Hydrant${h.size ? ' ' + esc(h.size) : ''}<i>${SRC.hydrants}</i>`, cls: 'red' });
    const seen = new Set(); for (const t of I.trans) { const key = t.kv + ':' + Math.round(t.mid[0] / 500) + ',' + Math.round(t.mid[1] / 500); if (seen.has(key)) continue; seen.add(key); A.push({ k: 'power', x: t.mid[0], y: elev(t.mid[0], t.mid[1]) + 30, z: t.mid[1], html: `${esc(t.owner || 'Transmission')}${t.kv ? ' ' + t.kv + ' kV' : ''}<i>${SRC.transmission}</i>`, cls: 'cy' }); }
    for (const l of I.plines) if (l.len > 80) A.push({ k: 'power', x: l.mid[0], y: elev(l.mid[0], l.mid[1]) + 9.6, z: l.mid[1], html: `${l.kv ? 'Line ' + l.kv + ' kV' : 'Power line'}<i>${SRC.power}</i>`, cls: '' });
    for (const s of I.subs) A.push({ k: 'sub', x: s.x, y: elev(s.x, s.z) + 4, z: s.z, html: `${s.k === 'plant' ? 'Power plant' : 'Substation'}<i>${SRC.power}</i>`, cls: 'red' });
  } else for (const [k, x, z] of PACK.props) if (k === 'bus') A.push({ k: 'stop', x, y: elev(x, z) + 3, z, html: 'Bus stop<i>OSM</i>', cls: '' });
  return A;
}

export function createTags(parent, list) {
  const layer = document.createElement('div'); layer.id = 'camTags'; layer.setAttribute('aria-hidden', 'true'); parent.appendChild(layer);
  const pool = [], v = new THREE.Vector3(), cp = new THREE.Vector3();
  let chosen = [], lastPick = 0, on = false;
  const el = (i) => { while (pool.length <= i) { const d = document.createElement('div'); d.className = 'ctag'; layer.appendChild(d); pool.push({ d, a: null }); } return pool[i]; };
  function pick() {
    const w = canvas.clientWidth, h = canvas.clientHeight, per = {}, cand = [];
    cam.getWorldPosition(cp);
    for (const a of list) {
      const dist = Math.hypot(a.x - cp.x, a.y - cp.y, a.z - cp.z); if (dist > RANGE[a.k]) continue;
      v.set(a.x, a.y, a.z).project(cam); if (v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.9) continue;
      cand.push([Math.hypot(v.x, v.y * 1.2) + dist / RANGE[a.k] * 0.6, a]);
    }
    cand.sort((p, q) => p[0] - q[0]); chosen = [];
    const boxes = [];
    for (const [, a] of cand) {
      if ((per[a.k] || 0) >= CAP[a.k]) continue;
      v.set(a.x, a.y, a.z).project(cam); const x = (v.x + 1) / 2 * w, y = (1 - v.y) / 2 * h;
      if (boxes.some(([bx, by]) => Math.abs(bx - x) < 120 && Math.abs(by - y) < 26)) continue; // no stacked tags
      boxes.push([x, y]); per[a.k] = (per[a.k] || 0) + 1; chosen.push(a);
    }
  }
  function place(now) {
    if (!on) return;
    if (now - lastPick > 250) { pick(); lastPick = now; }
    const w = canvas.clientWidth, h = canvas.clientHeight;
    chosen.forEach((a, i) => {
      const p = el(i); if (p.a !== a) { p.a = a; p.d.className = 'ctag ' + a.cls; p.d.innerHTML = a.html; p.d.hidden = false; }
      v.set(a.x, a.y, a.z).project(cam);
      p.d.style.transform = `translate3d(${Math.round((v.x + 1) / 2 * w)}px, ${Math.round((1 - v.y) / 2 * h)}px, 0)`;
    });
    for (let i = chosen.length; i < pool.length; i++) if (!pool[i].d.hidden) { pool[i].d.hidden = true; pool[i].a = null; }
  }
  return { place, show(b) { on = b; layer.hidden = !b; if (b) lastPick = 0; } };
}
