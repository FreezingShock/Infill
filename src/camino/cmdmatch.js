// Command bar matching: keeps the rows whose text holds every word of the query, in their original order.
// Pure on purpose, so the node tests can run it without the DOM or three.js.
export function matchRows(rows, query) {
  const terms = String(query ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return rows.slice();
  return rows.filter((r) => {
    const hay = `${r.t} ${r.sub || ''} ${r.w || ''} ${r.g}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
