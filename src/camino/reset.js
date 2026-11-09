// sfvOS Camino: "Reset town" asks once, in Camino's style, before the area goes back to its as-built pack.
// Keep town has focus and is the default, so Enter, Escape or a click outside all keep the town.
import './reset.css';
import { esc } from '../engine/core.js';
import { CUR } from '../app/state.js';
import { resetTown } from '../app/input.js';

let dlg = null, returnFocus = null;

const close = () => {
  if (!dlg || dlg.hidden) return;
  dlg.hidden = true;
  (document.getElementById('view') || returnFocus)?.focus?.();
};

function build() {
  const area = globalThis.__RENOVATED_AREA__ || {};
  dlg = document.createElement('div');
  dlg.className = 'rsdlg'; dlg.id = 'resetm'; dlg.hidden = true;
  dlg.innerHTML = `<div class="rspanel" role="alertdialog" aria-modal="true" aria-labelledby="rsTitle" aria-describedby="rsBody">
    <div class="rskick">Reset town</div>
    <h2 class="rstitle" id="rsTitle">Put ${esc(area.name || 'this area')} back as built?</h2>
    <p class="rsbody" id="rsBody"></p>
    <div class="rsact">
      <button type="button" class="rsbtn" data-act="keep">Keep town</button>
      <button type="button" class="rsbtn rsgo" data-act="reset">Reset town</button>
    </div>
  </div>`;
  document.getElementById('app').appendChild(dlg);

  dlg.addEventListener('click', (e) => {
    const act = e.target.closest?.('button[data-act]')?.dataset.act;
    if (act === 'reset') { close(); resetTown(); }
    else if (act === 'keep' || e.target === dlg) close();
  });

  // while the confirm is up, keys stay here: no camera, tool or "/" shortcuts fire behind it
  addEventListener('keydown', (e) => {
    if (!dlg || dlg.hidden) return;
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Tab') {
      e.preventDefault();
      const bs = [...dlg.querySelectorAll('button')], i = bs.indexOf(document.activeElement);
      bs[(i + (e.shiftKey ? bs.length - 1 : 1)) % bs.length].focus();
    }
  }, true);
}

// Opens the confirm. Called from the More popover row and from the "/" command bar.
export function askResetTown() {
  if (!dlg) build();
  const n = CUR;
  dlg.querySelector('#rsBody').textContent = n
    ? `This clears ${n} edit${n === 1 ? '' : 's'}, with zoning, growth, the budget and undo history, plus the saved copy in this browser. The city goes back to what was built. To keep a copy, export the edit log first (More, Edit log).`
    : 'Nothing is edited yet. Reset still clears the saved copy and any groups in this browser, and the city stays as built.';
  returnFocus = document.activeElement;
  dlg.hidden = false;
  dlg.querySelector('[data-act="keep"]').focus();
}
