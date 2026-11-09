// The build progress view: one overall bar that only moves forward, a clock, and the stages as a checklist in the
// same readout style as the boot screen. build_area.py names every progress line's stage; this paints them.
// Takes the elements to paint, so the picker owns the markup. Without a document it does nothing.
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

export function stageView(el) {
  let target = 0, shown = 0, raf = 0, clock = 0, t0 = 0, stages = [], cur = -1, end = 0, failed = false;
  const times = new Map();
  const paint = () => {
    raf = 0; const gap = target - shown; shown = reduce || Math.abs(gap) < 0.05 ? target : shown + gap * 0.14;
    el.fill.style.width = `${shown.toFixed(2)}%`; el.pct.textContent = String(Math.floor(shown));
    if (shown !== target) raf = requestAnimationFrame(paint);
  };
  const bar = (p) => { target = Math.max(target, Math.min(100, p)); if (!raf) raf = requestAnimationFrame(paint); };
  const draw = () => {
    el.list.innerHTML = '';
    stages.forEach((s, i) => {
      const li = document.createElement('li'), st = failed && i === cur ? 'fail' : i < cur || end ? 'done' : i === cur ? 'run' : 'wait';
      li.className = st; const a = document.createElement('span'), b = document.createElement('b'), c = document.createElement('time');
      a.textContent = s.label; b.textContent = st === 'done' ? 'OK' : st === 'run' ? '…' : st === 'fail' ? 'ERR' : '';
      c.textContent = times.has(s.id) ? `${times.get(s.id).toFixed(1)}s` : ''; li.append(a, c, b); el.list.append(li);
    });
  };
  return {
    start() { target = shown = 0; stages = []; cur = -1; end = 0; failed = false; times.clear(); t0 = Date.now(); el.fill.parentElement.classList.remove('fail', 'ok'); el.fill.style.width = '0'; el.pct.textContent = '0'; el.msg.textContent = 'Starting'; el.msg.className = 'ap-pmsg'; el.time.textContent = '0:00'; el.list.innerHTML = ''; clearInterval(clock); clock = setInterval(() => { el.time.textContent = fmt((Date.now() - t0) / 1000); }, 250); },
    event(ev) {
      if (ev.stages) { stages = ev.stages; draw(); }
      if (ev.msg) el.msg.textContent = ev.msg;
      if (ev.pct != null) bar(ev.pct);
      if (ev.stage) {
        const i = stages.findIndex((s) => s.id === ev.stage);
        if (i > cur) { if (cur >= 0 && ev.t != null) times.set(stages[cur].id, ev.t - (times.get('_t') || 0)); times.set('_t', ev.t || 0); cur = i; draw(); }
      }
      if (ev.step === 'done') { if (cur >= 0 && ev.t != null) times.set(stages[cur].id, ev.t - (times.get('_t') || 0)); end = 1; draw(); }
    },
    finish(msg) { end = 1; bar(100); el.msg.textContent = msg; el.fill.parentElement.classList.add('ok'); clearInterval(clock); draw(); },
    fail(msg) { failed = true; clearInterval(clock); el.fill.parentElement.classList.add('fail'); el.msg.textContent = msg; el.msg.className = 'ap-pmsg err'; draw(); },
    stop() { clearInterval(clock); cancelAnimationFrame(raf); },
  };
}
