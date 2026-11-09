// Boot screen for sfvOS: the #loading overlay in index.html while the city builds. Plain DOM with no engine
// imports, so workers and node tests can load it. Every call is a no-op without a document.
// The bar only moves forward and eases toward its target. Steps are the log lines under the bar.
const doc = typeof document === 'undefined' ? null : document;
const $ = (id) => (doc ? doc.getElementById(id) : null);
const reduce = !!(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
const MAX_LOG = 5;

let target = 0, shown = 0, frame = 0;

function paint() {
  frame = 0;
  const gap = target - shown;
  shown = reduce || Math.abs(gap) < 0.05 ? target : shown + gap * 0.16;
  const fill = $('bootFill'); if (fill) fill.style.width = `${shown.toFixed(2)}%`;
  const pct = $('bootPct'); if (pct) pct.textContent = String(Math.floor(shown));
  if (shown !== target) frame = requestAnimationFrame(paint);
}

/** Move the bar to pct (0 to 100). It never goes backwards, and it eases toward the value. */
export function bootProgress(pct) {
  if (!doc) return;
  target = Math.max(target, Math.min(100, pct));
  if (!frame) frame = requestAnimationFrame(paint);
}

/** Start a new step: the previous one is marked done, and this one becomes the status line. */
export function bootStep(msg) {
  if (!doc) return;
  const log = $('bootLog');
  if (log) {
    for (const li of log.querySelectorAll('li.run')) {
      li.classList.replace('run', 'done');
      const mark = li.querySelector('b'); if (mark) mark.textContent = 'OK';
    }
    const li = doc.createElement('li'); li.className = 'run';
    const s = doc.createElement('span'); s.textContent = msg;
    const b = doc.createElement('b'); b.textContent = '…';
    li.append(s, b); log.append(li);
    while (log.children.length > MAX_LOG) log.firstElementChild.remove();
  }
  const m = $('bootMsg'); if (m) m.textContent = msg;
}

/** Name the area being loaded on the boot screen. */
export function bootArea(name) {
  const el = $('bootArea'); if (el) el.textContent = name;
}

/** The city is built: finish the bar, fade the boot screen out and let the HUD in. */
export function bootDone() {
  if (!doc) return;
  bootStep('Ready');
  for (const li of doc.querySelectorAll('#bootLog li.run')) { li.classList.replace('run', 'done'); const b = li.querySelector('b'); if (b) b.textContent = 'OK'; }
  bootProgress(100);
  const el = $('loading');
  setTimeout(() => {
    doc.documentElement.classList.add('is-ready');
    if (!el) return;
    el.classList.add('out');
    setTimeout(() => el.remove(), reduce ? 0 : 800);
  }, reduce ? 0 : 420);
}

/** Startup failed: show the reason in place of the status line and mark the bar as failed. */
export function bootFail(msg) {
  if (!doc) return;
  const m = $('bootMsg'); if (m) m.textContent = `Could not start: ${msg}`;
  const el = $('loading'); if (el) el.classList.add('failed');
}
