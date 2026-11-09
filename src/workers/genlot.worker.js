// Worker that generates lot geometry in parallel with the page. The page sends the pack once ('init'),
// then batches of lots ('gen'); results come back as one transferable Float32Array per batch.
let ready = null;

onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') {
    ready = (async () => {
      globalThis.__RENOVATED_PACK__ = m.pack;
      globalThis.__RENOVATED_AREA__ = m.area;
      const core = await import('./genlot-core.js'); // after the globals: the engine reads the pack when it loads
      core.applyLooks(m.looks);
      return core;
    })();
    ready.then(() => postMessage({ type: 'ready' }), (err) => postMessage({ type: 'fail', error: String(err && err.message || err) }));
  } else if (m.type === 'gen') {
    Promise.resolve(ready).then((core) => {
      const t0 = performance.now(), { buf, metas } = core.genBatch(m.jobs);
      postMessage({ type: 'done', id: m.id, buf, metas, ms: performance.now() - t0 }, [buf.buffer]);
    }).catch((err) => postMessage({ type: 'fail', id: m.id, error: String(err && err.message || err) }));
  }
};
