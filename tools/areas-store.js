// The files behind custom areas: list, export as one bundle, install a bundle, remove. Plain node (fs + path), no
// Vite, so the dev-server middleware and the node tests share it. Custom areas live in public/areas/custom/
// (git-ignored) and are listed in public/areas/custom/index.json; the shared areas stay in public/areas/index.json.
import fs from 'node:fs';
import path from 'node:path';

export const ID_RE = /^[a-z0-9][a-z0-9-]{1,39}$/;
const SIDECARS = ['bg', 'infra', 'looks', 'streets', 'canopy'];
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; } };

export const areasDir = (root) => path.join(root, 'public', 'areas');
export const customDir = (root) => path.join(areasDir(root), 'custom');
export const sharedManifest = (root) => readJson(path.join(areasDir(root), 'index.json'), { areas: [] });
export const customManifest = (root) => readJson(path.join(customDir(root), 'index.json'), { areas: [] });

function writeJson(p, data, pretty) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(`${p}.tmp`, pretty ? JSON.stringify(data, null, 1) : JSON.stringify(data));
  fs.renameSync(`${p}.tmp`, p);
}

/** Every area the game can list, shared first, with `custom: true` on the ones in the custom folder. */
export function allAreas(root) {
  return [...sharedManifest(root).areas, ...customManifest(root).areas.map((a) => ({ ...a, custom: true }))];
}

/** One area and its files as a single JSON-able bundle the player can keep or hand to someone else. */
export function bundleFor(root, id) {
  const area = allAreas(root).find((a) => a.id === id);
  if (!area || area.status !== 'ready' || !area.pack) throw new Error('That area is not built yet.');
  const pack = readJson(path.join(areasDir(root), area.pack), null);
  if (!pack) throw new Error('The area pack file is missing.');
  const files = { pack };
  for (const k of SIDECARS) {
    const f = path.join(areasDir(root), area.pack.replace(/\.json$/, `.${k}.json`));
    if (fs.existsSync(f)) files[k] = readJson(f, undefined);
  }
  const { custom: _c, pack: _p, bg: _b, infra: _i, ...entry } = area; // file names are rebuilt on install
  return { kind: 'sfvos-area', v: 1, exported: new Date().toISOString().slice(0, 10), area: entry, files };
}

/** Checks a bundle before anything is written; returns the cleaned area entry or throws a message for the player. */
export function checkBundle(b, taken = []) {
  if (!b || b.kind !== 'sfvos-area' || b.v !== 1 || !b.area || !b.files || !b.files.pack) throw new Error('That is not an sfvOS area file.');
  const a = b.area, p = b.files.pack;
  if (!ID_RE.test(a.id || '')) throw new Error('The area has no usable id.');
  if (!Array.isArray(a.bbox) || a.bbox.length !== 4 || a.bbox.some((v) => !Number.isFinite(v))) throw new Error('The area has no map box.');
  if (!p || !Array.isArray(p.edges) || !Array.isArray(p.lots) || !Array.isArray(p.origin) || !Array.isArray(p.buildings)) throw new Error('The area pack is missing streets, lots or buildings.');
  let id = a.id, n = 2;
  while (taken.includes(id)) id = `${a.id.slice(0, 36)}-${n++}`;
  return { ...a, id, name: String(a.name || id).slice(0, 40), sub: String(a.sub || '').slice(0, 80) };
}

/** Writes a checked bundle under custom/ and lists it. Returns the manifest entry. */
export function installBundle(root, bundle) {
  const entry = checkBundle(bundle, allAreas(root).map((a) => a.id));
  const dir = customDir(root), id = entry.id, pre = 'custom/';
  writeJson(path.join(dir, `${id}.json`), bundle.files.pack);
  const out = { ...entry, pack: `${pre}${id}.json`, status: 'ready', custom: true };
  for (const k of SIDECARS) {
    if (bundle.files[k] === undefined) continue;
    writeJson(path.join(dir, `${id}.${k}.json`), bundle.files[k]);
    if (k === 'bg' || k === 'infra') out[k] = `${pre}${id}.${k}.json`;
  }
  out.lots = out.lots ?? bundle.files.pack.lots.length;
  const m = customManifest(root);
  m.areas = [...m.areas.filter((x) => x.id !== id), out];
  writeJson(path.join(dir, 'index.json'), m, true);
  return out;
}

/** Deletes a custom area's files and its listing. Shared areas cannot be removed this way. */
export function removeCustom(root, id) {
  const m = customManifest(root), a = m.areas.find((x) => x.id === id);
  if (!a) throw new Error(sharedManifest(root).areas.some((x) => x.id === id) ? 'Built-in areas cannot be removed. Refresh them instead.' : 'No such custom area.');
  const dir = customDir(root);
  for (const f of fs.readdirSync(dir)) if (f === `${id}.json` || (f.startsWith(`${id}.`) && f.endsWith('.json'))) fs.rmSync(path.join(dir, f), { force: true });
  m.areas = m.areas.filter((x) => x.id !== id);
  writeJson(path.join(dir, 'index.json'), m, true);
  return a;
}
