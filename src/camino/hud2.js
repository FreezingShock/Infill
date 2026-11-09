// Camino HUD, second pass (sfvOS): one bottom dock with popovers instead of four toolbars, a slim status strip,
// a collapsible City panel, and an inspector card whose sections fold away (progressive disclosure).
// Nothing is rebuilt: the existing bars and card are moved or wrapped, so every feature and key still works.
// The app re-renders #tools, #views, #infobar, #card and .city with innerHTML, so everything here either
// lives on the stable containers or re-applies itself from a MutationObserver.
import { askResetTown } from './reset.js';

const $ = (id) => document.getElementById(id);
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('sfvos.hud.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('sfvos.hud.' + k, JSON.stringify(v)); } catch { /* storage blocked */ } },
};
const svg = (d, w = 16) => `<svg viewBox="0 0 16 16" width="${w}" height="${w}" aria-hidden="true">${d}</svg>`;
const I = {
  layers: '<path d="M8 2l6 3-6 3-6-3z" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 8l6 3 6-3M2 11l6 3 6-3" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  view: '<path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  more: '<circle cx="3" cy="8" r="1.4" fill="currentColor"/><circle cx="8" cy="8" r="1.4" fill="currentColor"/><circle cx="13" cy="8" r="1.4" fill="currentColor"/>',
  undo: '<path d="M5 3L2 6l3 3M2.5 6H10a4 4 0 010 8H6" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  redo: '<path d="M11 3l3 3-3 3M13.5 6H6a4 4 0 000 8h4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  chev: '<path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  info: '<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 7v4M8 4.6v.9" stroke="currentColor" stroke-width="1.6"/>',
  min: '<path d="M3 8h10" stroke="currentColor" stroke-width="1.8"/>',
  max: '<path d="M3 8h10M8 3v10" stroke="currentColor" stroke-width="1.8"/>',
};

// ---------------------------------------------------------------- bottom dock
function mountDock() {
  const app = $('app'); if (!app || $('cdock')) return;
  const dock = document.createElement('div'); dock.className = 'plaque cdock'; dock.id = 'cdock'; dock.setAttribute('role', 'group'); dock.setAttribute('aria-label', 'Tools and views');
  dock.innerHTML = `<div class="cd-seg" id="cdMode"></div><i class="cd-sep"></i><div class="cd-seg" id="cdTools"></div><i class="cd-sep"></i>
    <div class="cd-seg" id="cdEdit"><button class="tool cd-ico" data-proxy="vUndo" aria-label="Undo" title="Undo (Ctrl+Z)">${svg(I.undo)}</button><button class="tool cd-ico" data-proxy="vRedo" aria-label="Redo" title="Redo (Ctrl+Y)">${svg(I.redo)}</button></div><i class="cd-sep"></i>
    <div class="cd-seg" id="cdMenus">
      <div class="cd-menu"><button class="tool cd-m" data-pop="pLayers" aria-expanded="false" title="Info views: traffic, parking, zones, happiness (I)">${svg(I.layers)}<span>Layers</span></button><div class="cd-pop" id="pLayers" role="group" aria-label="Info views"><div class="cd-poph">Info views <kbd>I</kbd></div></div></div>
      <div class="cd-menu"><button class="tool cd-m" data-pop="pView" aria-expanded="false" title="As-built, compare, colour lots, night">${svg(I.view)}<span>View</span></button><div class="cd-pop" id="pView" role="group" aria-label="View options"><div class="cd-poph">View</div></div></div>
      <div class="cd-menu"><button class="tool cd-m" data-pop="pMore" aria-expanded="false" title="Advanced tools, edit log, keys, credits">${svg(I.more)}<span>More</span></button><div class="cd-pop" id="pMore" role="group" aria-label="More"><div class="cd-poph">More</div></div></div>
    </div><div class="cd-tip" id="cdTip" aria-hidden="true"></div>`;
  app.appendChild(dock);

  // move the real bars in: ids, handlers and re-renders keep working because the app only sets their innerHTML
  const take = (id, into) => { const el = $(id); if (!el) return null; el.classList.remove('plaque', 'bar'); into.appendChild(el); return el; };
  const mode = $('camBar'); if (mode) { mode.classList.remove('plaque', 'bar'); $('cdMode').appendChild(mode); }
  take('tools', $('cdTools'));
  take('infobar', $('pLayers'));
  take('views', $('pView'));
  $('pMore').insertAdjacentHTML('beforeend', `<div class="cd-list">
    <button class="cd-row" data-go="cmd"><span>Command bar</span><kbd>/</kbd></button>
    <button class="cd-row" data-go="vAdv"><span>Advanced tools</span><em>box, lasso, brush, paint zones</em></button>
    <button class="cd-row" data-go="vLog"><span>Edit log</span><em>history, save and load</em></button>
    <button class="cd-row" data-go="areaBtn"><span>Change area</span><em>Valley map</em></button>
    <button class="cd-row" data-go="vKeys"><span>Keys and mouse</span><kbd>?</kbd></button>
    <button class="cd-row" data-go="vCred"><span>Credits</span><em>data sources</em></button>
    <button class="cd-row" data-go="reset"><span>Reset town</span><em>back to as-built, asks first</em></button>
    </div>`);

  // popovers: one open at a time, close on outside click, Escape, or choosing a row
  const pops = [...dock.querySelectorAll('.cd-pop')], btns = [...dock.querySelectorAll('[data-pop]')];
  const close = () => { pops.forEach((p) => p.classList.remove('open')); btns.forEach((b) => b.setAttribute('aria-expanded', 'false')); };
  btns.forEach((b) => (b.onclick = (e) => {
    e.stopPropagation(); const p = $(b.dataset.pop), was = p.classList.contains('open'); close();
    if (!was) { p.classList.add('open'); b.setAttribute('aria-expanded', 'true'); }
  }));
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.cd-menu')) close(); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, true);
  $('pMore').addEventListener('click', (e) => {
    const r = e.target.closest('[data-go]'); if (!r) return; const g = r.dataset.go; close();
    if (g === 'reset') askResetTown();
    else if (g === 'cmd') document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
    else $(g)?.click();
  });
  $('pLayers').addEventListener('click', (e) => { if (e.target.closest('[data-view]')) setTimeout(close, 180); });

  // undo and redo live in the dock; the originals stay in the View popover markup but are hidden
  dock.querySelectorAll('[data-proxy]').forEach((b) => (b.onclick = () => $(b.dataset.proxy)?.click()));
  const syncEdit = () => dock.querySelectorAll('[data-proxy]').forEach((b) => { const o = $(b.dataset.proxy); b.disabled = !o || o.disabled; });
  new MutationObserver(syncEdit).observe($('pView'), { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] }); syncEdit();

  // a mono readout above the dock names whatever is hovered or focused (replaces the native tooltip)
  const tip = $('cdTip');
  const show = (t) => {
    const b = t.closest && t.closest('.tool, .cd-row'); if (!b || !dock.contains(b)) return;
    const raw = b.getAttribute('title') || b.dataset.t; if (!raw) return;
    b.dataset.t = raw; b.removeAttribute('title');
    const m = /^(.*?)(?: \(([^)]+)\))?$/.exec(raw);
    tip.innerHTML = `<b>${m[1]}</b>${m[2] ? `<kbd>${m[2]}</kbd>` : ''}`; tip.classList.add('on');
  };
  const hide = () => tip.classList.remove('on');
  dock.addEventListener('pointerover', (e) => show(e.target)); dock.addEventListener('pointerleave', hide);
  dock.addEventListener('focusin', (e) => show(e.target)); dock.addEventListener('focusout', hide);
  dock.addEventListener('click', hide);
}

// ---------------------------------------------------------------- numbers that count to their new value
function mountTicker() {
  const hud = $('hud'); if (!hud) return;
  const prev = [], raf = [];
  const fmtN = (v, dec) => v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  const run = () => {
    [...hud.querySelectorAll('.stat b')].forEach((b, i) => {
      const m = /^(.*?)(\d[\d,]*(?:\.\d+)?)(.*)$/.exec(b.textContent); if (!m) return;
      const to = parseFloat(m[2].replace(/,/g, '')), dec = (m[2].split('.')[1] || '').length, from = prev[i]; prev[i] = to;
      if (from == null || from === to) return;
      b.classList.add('tick'); if (reduce) return;
      cancelAnimationFrame(raf[i]); const t0 = performance.now(), dur = 650;
      const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3; b.textContent = m[1] + fmtN(from + (to - from) * e, dec) + m[3]; if (k < 1) raf[i] = requestAnimationFrame(step); };
      raf[i] = requestAnimationFrame(step);
    });
  };
  new MutationObserver(run).observe(hud, { childList: true }); run();
}

// ---------------------------------------------------------------- City panel: header + switch, bars fold away
function enhanceCity(el) {
  const h = el.querySelector('h4'), grow = el.querySelector('#gGrow'); if (!h || el.dataset.cs === '1') return;
  el.dataset.cs = '1';
  const collapsed = store.get('cityMin', true); el.classList.toggle('min', collapsed);
  const bars = [...el.querySelectorAll('.dem .bar i')].map((i) => Math.min(1, parseFloat(i.style.width || '0') / 50));
  const mini = document.createElement('span'); mini.className = 'mini'; mini.setAttribute('aria-hidden', 'true');
  mini.innerHTML = bars.map((v, k) => `<i style="--v:${(0.2 + v * 0.8).toFixed(2)}" title="${['Homes', 'Shops', 'Work'][k] || ''}"></i>`).join('');
  h.insertBefore(mini, h.querySelector('small'));
  h.setAttribute('role', 'button'); h.tabIndex = 0; h.setAttribute('aria-expanded', String(!collapsed));
  const flip = () => { const m = !el.classList.contains('min'); store.set('cityMin', m); el.classList.toggle('min', m); h.setAttribute('aria-expanded', String(!m)); };
  h.onclick = (e) => { if (!e.target.closest('#gGrow')) flip(); };
  h.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('#gGrow')) { e.preventDefault(); e.stopPropagation(); flip(); } };
  if (grow) { grow.textContent = 'Auto-grow'; grow.setAttribute('role', 'switch'); grow.setAttribute('aria-checked', grow.getAttribute('aria-pressed') || 'false'); grow.classList.add('sw'); h.appendChild(grow); }
}
function mountCity() {
  const host = $('rcol'); if (!host) return;
  const obs = new MutationObserver(() => { const c = host.querySelector('.city'); if (!c) return; enhanceCity(c); if (!c._o) { c._o = new MutationObserver(() => { c.dataset.cs = ''; enhanceCity(c); }); c._o.observe(c, { childList: true }); } });
  obs.observe(host, { childList: true }); const c = host.querySelector('.city'); if (c) { enhanceCity(c); c._o = new MutationObserver(() => { c.dataset.cs = ''; enhanceCity(c); }); c._o.observe(c, { childList: true }); }
}

// ---------------------------------------------------------------- inspector card: sections that fold, notes behind an info button
const KEEP = '.src, .note, .tabs, .skips, #cust, #clrSel, #corr, #eDel, .btn';
const openMap = new Map(Object.entries(store.get('open', {})));
const persistOpen = () => store.set('open', Object.fromEntries([...openMap].slice(-60)));
let lastKey = '';

function section(h3, open) {
  const sec = document.createElement('section'); sec.className = 'cs' + (open ? ' open nt' : '');
  const head = document.createElement('button'); head.type = 'button'; head.className = 'cs-h'; head.setAttribute('aria-expanded', String(open));
  head.innerHTML = `<span class="cs-t">${h3.innerHTML}</span>${svg(I.chev, 12)}`;
  const body = document.createElement('div'); body.className = 'cs-b'; const inner = document.createElement('div'); inner.className = 'cs-in'; body.appendChild(inner); if (!open) inner.inert = true;
  sec.append(head, body);
  const title = (h3.firstChild?.textContent || h3.textContent).trim();
  head.onclick = () => { const o = !sec.classList.contains('open'); sec.classList.remove('nt'); sec.classList.toggle('open', o); head.setAttribute('aria-expanded', String(o)); inner.inert = !o; openMap.set(title, o); persistOpen(); };
  return { sec, inner, title };
}

function enhanceCard(card) {
  const kids = [...card.children]; if (!kids.length) return;
  const headEl = kids[0]; headEl.classList.add('cd-head');
  const eyebrow = headEl.querySelector('.eyebrow')?.textContent || '', title = headEl.querySelector('h2')?.textContent || '';
  const idle = /^Click a lot or a street$/.test(title);
  card.classList.toggle('idle', idle);
  const notes = [];
  const out = [headEl];
  let cur = null, afterTabs = false, first = true, afterCust = false;
  for (const k of kids.slice(1)) {
    if (k.tagName === 'H3') {
      const t = (k.firstChild?.textContent || k.textContent).trim();
      const def = afterTabs || afterCust || first; first = false;
      cur = section(k, openMap.has(t) ? openMap.get(t) : def); out.push(cur.sec); continue;
    }
    if (k.classList.contains('tabs')) afterTabs = true;
    if (k.id === 'cust' || k.querySelector('#cust')) afterCust = true;
    if (k.matches('.src') || (k.matches('.note') && !k.querySelector('a, input, button') && !k.id)) { notes.push(k); continue; }
    if (k.matches(KEEP) || k.querySelector('#cust, #clrSel, #corr, #eDel')) { cur = null; out.push(k); continue; }
    if (cur) cur.inner.appendChild(k); else out.push(k);
  }
  if (idle) { // the empty Look card: just the numbers, shortcuts folded
    const keep = out.filter((n) => n === headEl || n.matches?.('.facts'));
    const rest = out.filter((n) => !keep.includes(n) && !n.matches?.('.cs'));
    const para = rest.filter((n) => n.tagName === 'P'); para.forEach((p) => notes.push(p));
    const rows = rest.filter((n) => n.tagName !== 'P');
    if (rows.length) { const fake = document.createElement('h3'); fake.textContent = 'Quick selects'; const s = section(fake, openMap.get('Quick selects') ?? false); rows.forEach((r) => s.inner.appendChild(r)); keep.splice(1, 0, s.sec); }
    out.length = 0; out.push(...keep);
  }
  // header controls: info (notes) and fold
  const ctr = document.createElement('div'); ctr.className = 'cd-ctr';
  let panel = null;
  if (notes.length) {
    panel = document.createElement('div'); panel.className = 'cd-notes'; panel.hidden = true; notes.forEach((n) => panel.appendChild(n));
    const ib = document.createElement('button'); ib.type = 'button'; ib.className = 'cd-cb'; ib.title = 'About this panel'; ib.setAttribute('aria-label', 'About this panel'); ib.setAttribute('aria-expanded', 'false'); ib.innerHTML = svg(I.info, 14);
    ib.onclick = () => { panel.hidden = !panel.hidden; ib.setAttribute('aria-expanded', String(!panel.hidden)); ib.classList.toggle('on', !panel.hidden); };
    ctr.appendChild(ib);
  }
  const mb = document.createElement('button'); mb.type = 'button'; mb.className = 'cd-cb'; mb.setAttribute('aria-label', 'Fold this panel');
  const paintMin = () => { const m = card.classList.contains('min'); mb.innerHTML = svg(m ? I.max : I.min, 14); mb.title = m ? 'Unfold' : 'Fold'; mb.setAttribute('aria-expanded', String(!m)); };
  mb.onclick = () => { card.classList.toggle('min'); store.set('cardMin', card.classList.contains('min')); paintMin(); };
  ctr.appendChild(mb); paintMin();
  headEl.appendChild(ctr);
  if (panel) out.splice(1, 0, panel);
  card.replaceChildren(...out);
  // a new subject (different street, lot or tool) draws itself in; re-renders of the same one do not
  const key = eyebrow + '|' + title;
  if (key !== lastKey) { lastKey = key; if (!reduce) { card.classList.remove('scanin'); void card.offsetWidth; card.classList.add('scanin'); } }
  requestAnimationFrame(() => card.querySelectorAll('.cs.nt').forEach((s) => s.classList.remove('nt')));
}
function mountCard() {
  const card = $('card'); if (!card) return;
  card.classList.toggle('min', store.get('cardMin', false));
  const obs = new MutationObserver(() => { obs.disconnect(); try { enhanceCard(card); } finally { obs.observe(card, { childList: true }); } });
  obs.observe(card, { childList: true }); if (card.children.length) { obs.disconnect(); enhanceCard(card); obs.observe(card, { childList: true }); }
}

// ---------------------------------------------------------------- small things
function mountMisc() {
  const area = $('areaBtn'); if (area) area.textContent = 'Change';
  const sw = $('trfOn'); if (sw) sw.setAttribute('role', 'switch');
}

export function mountHud2() {
  mountDock(); mountTicker(); mountCity(); mountCard(); mountMisc();
}
