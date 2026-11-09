// Camino theme switch (sfvOS). Decides the look before the engine builds any material.
// Default is Camino; ?theme=nexus (or the saved choice) brings back the paper-toon Nexus look.
const KEY = 'renovated.theme';
const pick = () => {
  let q = null, saved = null;
  try { q = new URLSearchParams(globalThis.location?.search || '').get('theme'); } catch { /* no location in node */ }
  try { saved = globalThis.localStorage?.getItem(KEY); } catch { /* storage blocked */ }
  const t = q || saved || 'camino';
  if (q) try { globalThis.localStorage?.setItem(KEY, q); } catch { /* ignore */ }
  return t === 'nexus' ? 'nexus' : 'camino';
};
export const THEME = pick();
export const CAMINO = THEME === 'camino';
// index.html sets data-theme and loads the Camino fonts before first paint; this keeps the attribute in step.
if (CAMINO && typeof document !== 'undefined') document.documentElement.dataset.theme = 'camino';
/** Switch themes: the look is chosen at load, so this reloads the page (the edit log is saved in the browser). */
export function setTheme(t) { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } const u = new URL(location.href); u.searchParams.delete('theme'); location.href = u.toString(); }
