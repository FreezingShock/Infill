// Dev-server endpoints that let the game build or refresh an area pack from open data.
//   GET  /api/areas/ping   -> { ok, python }          (the picker shows its build controls only when this answers)
//   POST /api/areas/build  -> streams JSON lines      body: { id, name?, sub?, bbox?, refresh?, custom? }
//   GET  /api/areas/export?id=<id>  -> one JSON bundle of the area (pack and sidecars) as a download
//   POST /api/areas/install -> body: a bundle from export; adds it to the custom areas   -> { area }
//   POST /api/areas/remove  -> body: { id }; deletes a custom area                       -> { ok }
// It runs tools/pack/build_area.py on this machine. Only `npm run dev` has it; a production build does not.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleFor, installBundle, removeCustom } from './areas-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = path.join(ROOT, 'tools', 'pack', 'build_area.py');
let python;
function findPython() {
  if (python !== undefined) return python;
  for (const cmd of [['python3'], ['python'], ['py', '-3']]) {
    const r = spawnSync(cmd[0], [...cmd.slice(1), '--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3\.(\d+)/.test(`${r.stdout}${r.stderr}`) && +RegExp.$1 >= 9) return (python = cmd);
  }
  return (python = null);
}

/** Checks the request body; returns the build_area.py arguments or throws a message for the player. */
export function buildArgs(b) {
  if (!b || typeof b !== 'object') throw new Error('Bad request.');
  if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(b.id || '')) throw new Error('Area id must be letters, digits and dashes.');
  const args = ['--id', b.id];
  if (b.refresh) args.push('--refresh');
  if (b.custom) args.push('--custom');
  if (b.bbox !== undefined) {
    if (!Array.isArray(b.bbox) || b.bbox.length !== 4 || b.bbox.some((v) => typeof v !== 'number' || !Number.isFinite(v))) throw new Error('Bad area box.');
    const [W, S, E, N] = b.bbox;
    if (W < -180 || E > 180 || S < -90 || N > 90 || W >= E || S >= N) throw new Error('Bad area box.');
    args.push(`--bbox=${b.bbox.join(',')}`);
  }
  for (const k of ['name', 'sub']) if (b[k]) args.push(`--${k}`, String(b[k]).slice(0, 80).replace(/[\r\n]/g, ' '));
  return args;
}

export default function areasPlugin() {
  let busy = false;
  return {
    name: 'renovated-areas',
    configureServer(server) {
      server.middlewares.use('/api/areas', (req, res) => {
        const json = (code, o) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
        if (req.method === 'GET' && req.url.startsWith('/ping')) {
          const py = findPython();
          return json(200, { ok: !!py, python: py ? py.join(' ') : null, busy });
        }
        if (req.method === 'GET' && req.url.startsWith('/export')) {
          try {
            const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
            const b = bundleFor(ROOT, id);
            res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="${id}.sfvos-area.json"`); return res.end(JSON.stringify(b));
          } catch (e) { return json(400, { error: e.message }); }
        }
        if (req.method === 'POST' && (req.url.startsWith('/install') || req.url.startsWith('/remove'))) {
          const install = req.url.startsWith('/install'), limit = install ? 200e6 : 4096;
          const chunks = []; let n = 0, tooBig = false;
          req.on('data', (c) => { n += c.length; if (n > limit) { tooBig = true; req.destroy(); } else chunks.push(c); });
          req.on('end', () => {
            if (tooBig) return json(413, { error: 'That file is too large.' });
            try {
              const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
              if (install) return json(200, { area: installBundle(ROOT, body) });
              removeCustom(ROOT, body.id); return json(200, { ok: true });
            } catch (e) { return json(400, { error: e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message }); }
          });
          return;
        }
        if (req.method !== 'POST' || !req.url.startsWith('/build')) return json(404, { error: 'Not found' });
        let raw = '';
        req.on('data', (c) => { raw += c; if (raw.length > 4096) req.destroy(); });
        req.on('end', () => {
          let args;
          try { args = buildArgs(JSON.parse(raw)); } catch (e) { return json(400, { error: e.message }); }
          const py = findPython();
          if (!py) return json(500, { error: 'Python 3.9 or newer was not found. Install it from python.org, then restart npm run dev.' });
          if (busy) return json(409, { error: 'An area is already being built. Wait for it to finish.' });
          busy = true;
          res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store' });
          const child = spawn(py[0], [...py.slice(1), '-u', SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
          let tail = '', finished = false;
          const send = (o) => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
          child.stdout.on('data', (d) => {
            for (const line of String(d).split(/\r?\n/)) if (line.startsWith('@@')) { try { send(JSON.parse(line.slice(2))); } catch { /* partial line */ } }
          });
          child.stderr.on('data', (d) => { tail = (tail + d).slice(-600); });
          child.on('error', (e) => { send({ step: 'error', msg: e.message }); });
          child.on('close', (code) => {
            busy = false; finished = true;
            if (code) send({ step: 'error', msg: `The area builder stopped (exit ${code}).${tail ? ' ' + tail.trim().split('\n').slice(-2).join(' ') : ''}` });
            res.end();
          });
          res.on('close', () => { if (!finished) child.kill(); });
        });
      });
    },
  };
}
