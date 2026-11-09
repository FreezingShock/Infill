// Plug-in points for live data. The sim thread (workstream A) registers real numbers here and the views
// switch from estimates to them with no other change:
//   provide('edgeFlow', (minuteOfDay) => Map<edgeId, 0..1.4 congestion>)
//   provide('parking',  (minuteOfDay) => ({ edgeOcc: Map<edgeId, 0..1.5>, lotOcc: Map<lotId, 0..1.5>, want, have, curbHave, short }))
//   provide('curbOcc',  (minuteOfDay) => Map<edgeId, 0..1.5>)   live curb fill; overrides the estimate per street, lots stay estimated
const P = new Map();
export const provide = (name, fn) => P.set(name, fn);
export const unprovide = (name) => P.delete(name);
export const provided = (name) => P.get(name) || null;
