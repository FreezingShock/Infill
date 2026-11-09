// Camino dropdowns: every native <select> in the app (now or added later by the inspector and menus) is
// wrapped with an on-theme button and popup. The real select stays in the DOM, hidden, so existing code that
// reads .value or listens for "change" keeps working. Plain DOM, no engine imports.
const doc = typeof document === 'undefined' ? null : document;
const CARET = '<svg class="cs-caret" viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 3.5 5 7l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
let open = null, uid = 0;

function items(sel) {
  const out = [];
  for (const n of sel.children) {
    if (n.tagName === 'OPTGROUP') { out.push({ group: n.label }); for (const o of n.children) out.push({ o }); } else if (n.tagName === 'OPTION') out.push({ o: n });
  }
  return out;
}
const labelOf = (sel) => { const o = sel.selectedOptions[0]; return o ? o.textContent.trim() : ''; };

export function closeDropdown() {
  if (!open) return;
  const { pop, btn, off } = open; open = null;
  pop.remove(); btn.setAttribute('aria-expanded', 'false'); off();
}

function openDropdown(sel, btn) {
  closeDropdown();
  const pop = doc.createElement('div'); pop.className = 'cs-pop'; pop.setAttribute('role', 'listbox'); pop.id = `cs-pop-${uid++}`;
  const rows = [];
  for (const it of items(sel)) {
    if (it.group != null) { const g = doc.createElement('div'); g.className = 'cs-grp'; g.textContent = it.group; pop.append(g); continue; }
    const b = doc.createElement('button'); b.type = 'button'; b.className = 'cs-opt'; b.setAttribute('role', 'option'); b.textContent = it.o.textContent.trim() || ' ';
    b.setAttribute('aria-selected', String(it.o.selected)); if (it.o.disabled) b.setAttribute('aria-disabled', 'true'); b.tabIndex = -1;
    b._o = it.o; rows.push(b); pop.append(b);
  }
  doc.body.append(pop); btn.setAttribute('aria-expanded', 'true');
  const r = btn.getBoundingClientRect(), ph = Math.min(pop.scrollHeight, 280), up = innerHeight - r.bottom < ph + 12 && r.top > innerHeight - r.bottom;
  pop.style.minWidth = `${Math.max(160, r.width)}px`; pop.style.left = `${Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8))}px`;
  pop.style.top = up ? `${Math.max(8, r.top - ph - 6)}px` : `${r.bottom + 6}px`; pop.style.maxHeight = `${Math.max(120, up ? r.top - 14 : innerHeight - r.bottom - 14)}px`; pop.classList.toggle('up', up);
  let hi = Math.max(0, rows.findIndex((b) => b._o.selected));
  const mark = () => { rows.forEach((b, i) => b.classList.toggle('hi', i === hi)); rows[hi]?.scrollIntoView({ block: 'nearest' }); };
  const pick = (b) => {
    if (!b || b._o.disabled) return;
    const changed = sel.value !== b._o.value || !b._o.selected;
    sel.value = b._o.value; closeDropdown(); sync(sel); btn.focus();
    if (changed) { sel.dispatchEvent(new Event('input', { bubbles: true })); sel.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  pop.addEventListener('click', (e) => pick(e.target.closest('.cs-opt')));
  pop.addEventListener('pointermove', (e) => { const i = rows.indexOf(e.target.closest('.cs-opt')); if (i >= 0 && i !== hi) { hi = i; mark(); } });
  let typed = '', t = 0;
  const key = (e) => {
    if (!open || open.pop !== pop) return;
    const k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDropdown(); btn.focus(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); hi = (hi + (k === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; mark(); return; }
    if (k === 'Home' || k === 'End') { e.preventDefault(); hi = k === 'Home' ? 0 : rows.length - 1; mark(); return; }
    if (k === 'Enter' || k === ' ') { e.preventDefault(); e.stopPropagation(); pick(rows[hi]); return; }
    if (k.length === 1 && !e.ctrlKey && !e.metaKey) { // type to jump
      clearTimeout(t); typed += k.toLowerCase(); t = setTimeout(() => (typed = ''), 700);
      const i = rows.findIndex((b) => b.textContent.trim().toLowerCase().startsWith(typed)); if (i >= 0) { hi = i; mark(); }
      e.stopPropagation();
    }
  };
  const away = (e) => { if (!pop.contains(e.target) && !btn.contains(e.target)) closeDropdown(); };
  const scroll = (e) => { if (!pop.contains(e.target)) closeDropdown(); };
  doc.addEventListener('keydown', key, true); doc.addEventListener('pointerdown', away, true); addEventListener('resize', closeDropdown); doc.addEventListener('scroll', scroll, true);
  open = { pop, btn, off: () => { doc.removeEventListener('keydown', key, true); doc.removeEventListener('pointerdown', away, true); removeEventListener('resize', closeDropdown); doc.removeEventListener('scroll', scroll, true); } };
  mark();
}

function sync(sel) {
  const w = sel._cs; if (!w) return;
  w.v.textContent = labelOf(sel); w.btn.disabled = sel.disabled;
  const a = sel.getAttribute('aria-label') || (sel.id && doc.querySelector(`label[for="${sel.id}"]`)?.textContent) || '';
  if (a) w.btn.setAttribute('aria-label', `${a}: ${labelOf(sel)}`);
}

export function enhanceSelect(sel) {
  if (!doc || sel._cs || sel.multiple || sel.size > 1 || sel.hasAttribute('data-native')) return;
  const wrap = doc.createElement('span'); wrap.className = 'cs'; if (sel.closest('.row') && !sel.closest('.ctrl')) wrap.classList.add('block');
  const btn = doc.createElement('button'); btn.type = 'button'; btn.className = 'cs-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  const v = doc.createElement('span'); v.className = 'cs-val'; btn.append(v); btn.insertAdjacentHTML('beforeend', CARET);
  sel.before(wrap); wrap.append(btn, sel); sel.classList.add('cs-native'); sel.tabIndex = -1; sel._cs = { wrap, btn, v };
  btn.addEventListener('click', () => (open && open.btn === btn ? closeDropdown() : openDropdown(sel, btn)));
  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); if (!open) openDropdown(sel, btn); } else if (e.key.length === 1 || e.key === 'Escape') e.stopPropagation();
  });
  sel.addEventListener('change', () => sync(sel));
  new MutationObserver(() => sync(sel)).observe(sel, { childList: true, subtree: true, attributes: true, attributeFilter: ['selected', 'disabled'] });
  sync(sel);
}

/** Upgrade every select in the page and watch for new ones. */
export function mountControls() {
  if (!doc || doc.documentElement.dataset.csOn) return; doc.documentElement.dataset.csOn = '1';
  const scan = (root) => { if (root.nodeType !== 1) return; if (root.tagName === 'SELECT') enhanceSelect(root); else root.querySelectorAll?.('select').forEach(enhanceSelect); };
  scan(doc.body);
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(scan); }).observe(doc.body, { childList: true, subtree: true });
}
