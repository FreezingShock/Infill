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
if (CAMINO && typeof document !== 'undefined') {
  document.documentElement.dataset.theme = 'camino';
  const l = document.createElement('link'); l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Arimo:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap';
  document.head.appendChild(l);
}
/** Switch themes: the look is chosen at load, so this reloads the page (the edit log is saved in the browser). */
export function setTheme(t) { try { localStorage.setItem(KEY, t); } catch { /* ignore */ } const u = new URL(location.href); u.searchParams.delete('theme'); location.href = u.toString(); }
