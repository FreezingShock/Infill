// Camino HUD chip for a running area build: stage, percent and ETA, one click back to the picker.
// Sits in the top-left stack under the area plaque, only while a build is running (or has failed).
import { watch } from '../areas/buildwatch.js';
import { clock } from '../areas/eta.js';

export function mountBuildChip({ open }) {
  const host = document.querySelector('#app .tl'); if (!host || document.getElementById('buildChip')) return;
  const b = document.createElement('button');
  b.id = 'buildChip'; b.type = 'button'; b.className = 'plaque bchip'; b.hidden = true;
  b.innerHTML = '<span class="bc-tag"><i></i><em>Build</em></span><span class="bc-main"><b class="bc-name"></b><small class="bc-sub"></small></span><span class="bc-num"><b class="bc-pct">0</b><span>%</span></span><span class="bc-eta"></span><i class="bc-bar" aria-hidden="true"><i></i></i>';
  const q = (c) => b.querySelector(c);
  host.insertBefore(b, host.querySelector('.area-pl')?.nextSibling || null);
  b.onclick = open;
  watch.subscribe((st) => {
    const on = !!st && (st.status === 'run' || st.status === 'fail');
    b.hidden = !on; if (!on) return;
    const fail = st.status === 'fail';
    b.classList.toggle('fail', fail);
    q('.bc-name').textContent = st.name;
    q('.bc-sub').textContent = fail ? st.msg : (st.stage || st.msg || 'Starting');
    q('.bc-pct').textContent = String(Math.floor(st.pct));
    q('.bc-eta').textContent = fail ? 'Open' : st.eta >= 1 ? `ETA ${clock(st.eta)}` : 'Almost done';
    q('.bc-bar > i').style.width = `${st.pct}%`;
    b.setAttribute('aria-label', fail ? `Build of ${st.name} failed. Open the area picker.` : `Building ${st.name}, ${Math.floor(st.pct)} percent, ${q('.bc-eta').textContent}. Open the area picker.`);
  });
}
