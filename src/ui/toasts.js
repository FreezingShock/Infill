// sfvOS Camino toasts: a stack of ctOS-style notices, newest on top.
// Older notices tuck back, dim and shrink. Each notice has a type tag, a drawn glyph and a timer bar.
// Hover or focus pauses that notice's timer. Copy is plain text and the glyphs are drawn, never emoji.
// Markup is built here; the look lives in src/camino/notify.css. Nothing here touches the DOM at import time.

const MAX = 4;        // notices on screen at once; past this the oldest leaves
const LEAVE_MS = 360; // matches the collapse transition in src/camino/notify.css

const KIND = {
  note: { tag: 'Notice', life: 4200, glyph: '<rect x="1.5" y="1.5" width="9" height="9" fill="none" stroke="currentColor" stroke-width="1.4"/><rect x="4" y="4" width="4" height="4" fill="currentColor"/>' },
  done: { tag: 'Done', life: 3400, glyph: '<circle cx="6" cy="6" r="4.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M3.9 6.1l1.4 1.4 2.8-2.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' },
  warn: { tag: 'Hold', life: 5200, glyph: '<path d="M6 1.2l5.2 9.4H.8z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M6 4.8v2.6M6 8.8v.2" stroke="currentColor" stroke-width="1.5"/>' },
};

// Past-tense results read as "done"; instructions and refusals read as "hold". Everything else is a plain notice.
const DONE_RE = /^(Saved|Copied|Loaded|Selected|Filled|Removed|Picked|Undid|Redid|Town reset|Back to|Whole block|Welcome back)/;
const WARN_RE = /doesn't|don't|isn't|not a|skipped|stay lower|at least|^(Nothing|No |Paste|Pick|Press|Click|Drag|Draw|Give|Every|A street|Paint|Save text|Try)/;

export function kindOf(msg) {
  const s = String(msg);
  if (DONE_RE.test(s)) return 'done';
  if (WARN_RE.test(s)) return 'warn';
  return 'note';
}

const stack = []; // newest first: { row, text, kind, bar, timer, left, started, hover }
let host = null;

function relayout() {
  stack.forEach((n, i) => n.row.style.setProperty('--d', String(i)));
}

// (Re)start a notice's timer. A notice under the pointer keeps its full time and waits for the pointer to leave.
function arm(n, ms) {
  clearTimeout(n.timer); n.timer = 0; n.left = ms;
  n.bar.style.animation = 'none'; void n.bar.offsetWidth;
  n.bar.style.animation = `tnBar ${ms}ms linear forwards`;
  n.bar.style.animationPlayState = n.hover ? 'paused' : 'running';
  if (!n.hover) { n.started = performance.now(); n.timer = setTimeout(() => dismiss(n), ms); }
}

// Pause on hover or focus, resume with the time that was left.
function hold(n, on) {
  if (n.hover === on || !stack.includes(n)) return;
  n.hover = on;
  if (on) {
    if (n.timer) { clearTimeout(n.timer); n.timer = 0; n.left = Math.max(0, n.left - (performance.now() - n.started)); }
    n.bar.style.animationPlayState = 'paused';
  } else {
    n.started = performance.now(); n.timer = setTimeout(() => dismiss(n), n.left);
    n.bar.style.animationPlayState = 'running';
  }
}

function dismiss(n) {
  const i = stack.indexOf(n);
  if (i < 0) return;
  stack.splice(i, 1);
  clearTimeout(n.timer); n.timer = 0;
  n.row.classList.remove('in'); n.row.classList.add('out');
  relayout();
  setTimeout(() => n.row.remove(), LEAVE_MS);
}

function build(text, kind) {
  const k = KIND[kind];
  const row = document.createElement('div');
  row.className = 'tn-row';
  row.setAttribute('role', 'none');
  row.innerHTML = `<div class="tn" data-kind="${kind}">`
    + `<span class="tn-tag"><svg viewBox="0 0 12 12" aria-hidden="true">${k.glyph}</svg>${k.tag}</span>`
    + `<p class="tn-msg"></p>`
    + `<button class="tn-x" type="button" aria-label="Dismiss notice"><svg viewBox="0 0 10 10" aria-hidden="true"><path d="M1.5 1.5l7 7M8.5 1.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg></button>`
    + `<i class="tn-bar" aria-hidden="true"></i></div>`;
  row.querySelector('.tn-msg').textContent = text;
  return row;
}

// Show a notice. Same text as one already on screen just restarts that notice's timer.
// opts.kind: 'note' | 'done' | 'warn'. Without it the kind is read from the text.
export function toast(msg, opts = {}) {
  host = host || document.getElementById('toast');
  if (!host) return;
  const text = String(msg), kind = KIND[opts.kind] ? opts.kind : kindOf(text);
  const twin = stack.find((n) => n.text === text && n.kind === kind);
  if (twin) { arm(twin, KIND[kind].life); return; }

  const row = build(text, kind);
  const n = { row, text, kind, bar: row.querySelector('.tn-bar'), timer: 0, left: KIND[kind].life, started: 0, hover: false };
  row.querySelector('.tn-x').addEventListener('click', () => dismiss(n));
  row.addEventListener('mouseenter', () => hold(n, true));
  row.addEventListener('mouseleave', () => hold(n, false));
  row.addEventListener('focusin', () => hold(n, true));
  row.addEventListener('focusout', (e) => { if (!row.contains(e.relatedTarget)) hold(n, false); });

  stack.unshift(n);
  host.prepend(row);
  relayout();
  arm(n, KIND[kind].life);
  void row.offsetHeight; // commit the collapsed state so the expand transition runs
  row.classList.add('in');
  while (stack.length > MAX) dismiss(stack[stack.length - 1]);
}
