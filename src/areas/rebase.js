// Saved games are an edit log keyed by lot and street ids. Refreshing an area rebuilds its pack with the
// same ids (tools/pack keeps them), so the log replays onto the new data; edits that no longer fit are
// skipped by the engine. This reports what happened the first time a save meets a newer pack.

/** The pack stamp a save should carry. */
export const stamp = (area) => area.built || null;

/** Returns a message when `saved` was written against an older build of this area, else null. */
export function rebaseNote(saved, area, info) {
  if (!saved || !area.built || !saved.built || saved.built === area.built) return null;
  const edits = (saved.log || []).length, skipped = (info?.notes || []).length + (info?.skipped || []).length;
  if (!edits) return `${area.name} was refreshed from the latest open data (${area.built}).`;
  return skipped
    ? `${area.name} was refreshed (${area.built}). ${edits - skipped} of your ${edits} edits carried over; ${skipped} no longer fit the new data and were skipped.`
    : `${area.name} was refreshed (${area.built}). All ${edits} of your edits carried over.`;
}
