// A small pool of module workers with a shared job queue. `run(msg)` resolves with the worker's reply.
// If workers cannot start (old browser, blocked, crash) the pool marks itself dead and callers fall back to the page thread.
class WorkerPool {
  constructor(make, size, initMsg) {
    this.queue = []; this.idle = []; this.all = []; this.dead = false; this.nextId = 1; this.jobs = new Map();
    try {
      for (let i = 0; i < size; i++) {
        const w = make(); w.onmessage = (e) => this.onMsg(w, e.data); w.onerror = (e) => this.fail(w, e && e.message);
        w.postMessage(initMsg); this.all.push(w); this.idle.push(w);
      }
    } catch (err) { this.fail(null, String(err)); }
  }
  get size() { return this.all.length; }
  run(msg, transfer = []) {
    if (this.dead) return Promise.reject(new Error('worker pool is not available'));
    return new Promise((resolve, reject) => { this.queue.push({ id: this.nextId++, msg, transfer, resolve, reject }); this.pump(); });
  }
  pump() {
    while (this.queue.length && this.idle.length) {
      const w = this.idle.pop(), job = this.queue.shift();
      this.jobs.set(w, job); w.postMessage({ ...job.msg, id: job.id }, job.transfer);
    }
  }
  onMsg(w, m) {
    if (m.type === 'ready') return;
    const job = this.jobs.get(w);
    if (m.type === 'fail' && !job) return this.fail(w, m.error);
    if (!job) return;
    this.jobs.delete(w); this.idle.push(w);
    if (m.type === 'fail') job.reject(new Error(m.error)); else job.resolve(m);
    this.pump();
  }
  fail(w, why) {
    this.dead = true;
    const err = new Error('worker pool failed: ' + why);
    for (const j of this.jobs.values()) j.reject(err);
    for (const j of this.queue) j.reject(err);
    this.jobs.clear(); this.queue.length = 0;
    for (const x of this.all) x.terminate();
    this.all = []; this.idle = [];
  }
}

export { WorkerPool };
