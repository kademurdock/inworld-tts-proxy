'use strict';

/* Oct 30 2026, Kade, comparing one take through several methods: "Grat is my favorite ... Grat
 * actually sounded really naturally." So Brisk and Quick chat speech is sped up with Praat's
 * overlap-add (fish_stretch_worker.py) instead of Fish's own prosody.speed. Measured: about 0.005 s
 * of work per second of speech, but 360 ms to import Python and Praat, hence one long-lived worker
 * and not a process per clip.
 *
 * The same evening, after hearing a whole set of amounts: "we need Prat as the fish speed controler
 * in all methods that use fish." With FISH_SPEED_EXACT=1 (pace.js) every Fish clip with a speed
 * comes here, so each one says which lane it is in, and that sets how long its caller can wait:
 *   call     someone on the line: about 600 ms, and first in the queue
 *   chat     a voice message: 2 s, FISH_STRETCH_TIMEOUT_MS
 *   reading  a book or a described video, nobody at the edge of their seat: 20 s, and the clip
 *            lives through one worker restart, because a clip at the wrong speed costs more than
 *            the wait
 * A clip with no lane (FISH_PACE_STRETCH, the switch being off) behaves as it always did. How long a
 * clip may hold the worker is a separate limit from any of these, so a patient clip can never leave a
 * stuck worker hanging for its whole 20 s.
 *
 * This file's one promise: stretch() never rejects and never loses a clip. If the worker is
 * missing, dead, slow or wrong, the caller gets the very same buffer back, inside timeoutMs, and
 * one short line goes to the log (never any spoken words; the worker only ever sees audio). The
 * caller can tell by comparing buffers: same buffer, nothing was done. */

const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKER = path.join(__dirname, 'fish_stretch_worker.py');
const REQUEST_BYTES = 20; // id u32, ratio f64, sample rate u32, byte count u32
const REPLY_BYTES = 12; // id u32, status u32, byte count u32
const REPLY_MAX_BYTES = 32 * 1024 * 1024;
const OK = 0;

// Too short to analyze at Praat's 75 Hz floor, and nothing anyone would hear hurry.
const MIN_SECONDS = 0.2;
// Fish stops near 47.6 s (its 1,024-token cap, fish-runaway.js); past this it is not a chat clip.
const MAX_SECONDS = 90;
const MAX_QUEUE = 32;
const LENGTH_TOLERANCE = 0.1;
const LOG_EVERY_MS = 30000;
const BACKOFF_MAX_MS = 30000;
// A long clip is allowed more of the worker: 47 s of speech is not stuck at 2 s on a busy server.
const STUCK_MS_PER_SECOND = 100;
const CALL_PATIENCE_MS = 600;
const READING_PATIENCE_MS = 20000;

function intEnv(name, fallback, source = process.env) {
  const value = parseInt(source[name], 10);
  return value > 0 ? value : fallback;
}

/* python: the interpreter, FISH_STRETCH_PYTHON. timeoutMs: the longest a chat clip or one with no
 * lane waits on this, queue included; it is also how long a clip with no lane may run in the worker
 * before the worker is replaced. stuckMs (FISH_STRETCH_STUCK_MS, default timeoutMs): that same limit
 * for a clip with a lane, scaled up for a long clip. callMs, readingMs (FISH_STRETCH_CALL_MS,
 * FISH_STRETCH_READING_MS): the other lanes' patience. startWaitMs: how long a clip waits on a worker that is still importing. healthyClips, healthyMs:
 * the good clips and time up it takes before the restart wait starts over. Both, because one good
 * clip proves nothing about the next, and neither does an idle minute on a quiet server. */
function createFishStretch({ python, script = WORKER, timeoutMs, stuckMs, callMs, readingMs, startWaitMs = 1000, startLimitMs = 30000, backoffMs = 1000, backoffMaxMs = BACKOFF_MAX_MS, healthyClips = 5, healthyMs = 60000, log = console.warn } = {}) {
  const limit = () => timeoutMs || intEnv('FISH_STRETCH_TIMEOUT_MS', 2000);
  const stuckLimit = () => stuckMs || intEnv('FISH_STRETCH_STUCK_MS', limit());
  const lanes = {
    call: { patienceMs: () => callMs || intEnv('FISH_STRETCH_CALL_MS', CALL_PATIENCE_MS), first: true },
    chat: { patienceMs: limit },
    reading: { patienceMs: () => readingMs || intEnv('FISH_STRETCH_READING_MS', READING_PATIENCE_MS), patient: true },
  };
  let child = null;
  let ready = false;
  let startWaitedOut = false;
  let stopped = false;
  let startTimer = null;
  let respawnTimer = null;
  let respawnAt = 0;
  // Workers lost since one last did its job. One loss is a blip worth waiting out; after a second,
  // nobody waits (a broken install must not cost every clip of a book its 20 s).
  let losses = 0;
  let stuckTimer = null;
  let delay = backoffMs;
  let nextId = 1;
  let current = null;
  const queue = [];
  const counts = { asked: 0, stretched: 0, kept: 0, restarts: 0 };
  const slowest = { ms: 0, seconds: 0 };
  let lastProblem = null;
  let lastSaid = { problem: null, at: 0 };

  function note(problem) {
    lastProblem = problem;
    const now = Date.now();
    if (problem === lastSaid.problem && now - lastSaid.at < LOG_EVERY_MS) return;
    lastSaid = { problem, at: now };
    log(`[TTS] fish stretch: ${problem} -- original audio kept`);
  }

  function settle(job, out) {
    if (job.done) return;
    job.done = true;
    clearTimeout(job.timer);
    if (out === job.pcm) counts.kept++; else counts.stretched++;
    job.resolve(out);
  }

  function workerDown(proc, problem) {
    if (proc !== child) return;
    child = null;
    ready = false;
    clearTimeout(startTimer);
    clearTimeout(stuckTimer);
    try { proc.kill(); } catch {}
    if (!stopped) note(problem);
    losses++;
    const waiting = queue.splice(0);
    if (current) waiting.unshift(current);
    current = null;
    // A patient clip, the one the worker went down on included, goes again on the next worker, if
    // this is the first loss and that worker can be up in time. Only once per clip: one that takes
    // down two workers is not going to stretch.
    const now = Date.now();
    for (const job of waiting) {
      if (!stopped && !job.done && job.patient && !job.restarted && losses < 2 && job.deadline - now > delay) {
        job.restarted = true;
        queue.push(job);
      } else settle(job, job.pcm);
    }
    if (stopped) return;
    respawnAt = now + delay;
    respawnTimer = setTimeout(() => { respawnTimer = null; counts.restarts++; start(); }, delay);
    respawnTimer.unref?.();
    delay = Math.min(delay * 2, backoffMaxMs);
  }

  function start() {
    if (child || stopped || respawnTimer) return;
    const interpreter = python || process.env.FISH_STRETCH_PYTHON || 'python3';
    // Only what Python needs to run. The server's environment holds every API key; this holds none.
    const { PATH, SYSTEMROOT, SystemRoot, TEMP, TMP } = process.env;
    const env = { OPENBLAS_NUM_THREADS: '1', OMP_NUM_THREADS: '1' };
    for (const [k, v] of Object.entries({ PATH, SYSTEMROOT: SYSTEMROOT || SystemRoot, TEMP, TMP })) if (v) env[k] = v;
    let proc = null;
    try {
      proc = spawn(interpreter, ['-I', script], { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
    } catch {} // a malformed interpreter setting throws here instead of raising 'error'
    if (proc) proc.on('error', (err) => workerDown(proc, `worker could not start (${err.code || 'error'})`));
    child = proc || {};
    ready = false;
    startWaitedOut = false;
    // Out of file handles: Node hands back a process with no pipes at all.
    if (!proc || !proc.stdin || !proc.stdout || !proc.stderr) {
      workerDown(child, 'worker could not start');
      return;
    }
    const startedAt = Date.now();
    let goodClips = 0;
    let complaint = '';
    let head = Buffer.alloc(0);
    let body = null;
    let filled = 0;
    let reply = null;

    const onReply = () => {
      if (reply.id === 0) {
        clearTimeout(startTimer);
        ready = true;
        pump();
        return;
      }
      if (!current || reply.id !== current.id) { workerDown(proc, 'worker answered out of turn'); return; }
      clearTimeout(stuckTimer);
      const job = current;
      current = null;
      const out = body;
      // An odd count is the same kind of nonsense as a wrong length: the worker writes s16.
      const wanted = job.pcm.length / job.ratio;
      if (reply.status !== OK) note(`worker could not stretch a clip (status ${reply.status})`);
      if (reply.status !== OK || !out || out.length % 2 || Math.abs(out.length - wanted) > wanted * LENGTH_TOLERANCE) {
        if (reply.status === OK) note('worker returned the wrong length');
        settle(job, job.pcm);
      } else {
        if (++goodClips >= healthyClips && Date.now() - startedAt >= healthyMs) delay = backoffMs;
        losses = 0;
        const tookMs = Date.now() - job.sentAt;
        if (tookMs > slowest.ms) { slowest.ms = tookMs; slowest.seconds = job.pcm.length / 2 / job.sampleRate; }
        settle(job, out);
      }
      pump();
    };

    proc.stdout.on('data', (data) => {
      if (proc !== child) return;
      let at = 0;
      while (at < data.length && proc === child) {
        if (!reply) {
          const take = Math.min(REPLY_BYTES - head.length, data.length - at);
          head = Buffer.concat([head, data.subarray(at, at + take)]);
          at += take;
          if (head.length < REPLY_BYTES) break;
          reply = { id: head.readUInt32LE(0), status: head.readUInt32LE(4), bytes: head.readUInt32LE(8) };
          head = Buffer.alloc(0);
          if (reply.bytes > REPLY_MAX_BYTES) { workerDown(proc, 'worker sent a frame too large to trust'); return; }
          body = reply.bytes ? Buffer.allocUnsafe(reply.bytes) : null;
          filled = 0;
        }
        if (filled < reply.bytes) {
          const take = Math.min(reply.bytes - filled, data.length - at);
          data.copy(body, filled, at, at + take);
          filled += take;
          at += take;
        }
        if (filled >= reply.bytes) {
          onReply();
          reply = null;
          body = null;
        }
      }
    });
    // Kept for the one log line: a missing module says so on its last line. Never holds speech.
    proc.stderr.on('data', (data) => { complaint = (complaint + data).slice(-300); });
    const lastLine = () => complaint.trim().split(/\r?\n/).pop().slice(0, 120);
    proc.on('close', (code, signal) => workerDown(proc, `worker stopped (${signal || code})${lastLine() ? `: ${lastLine()}` : ''}`));
    // A dying worker's pipes raise EPIPE here; that must never reach the server's own error path.
    proc.stdin.on('error', () => {});
    proc.stdout.on('error', () => {});
    proc.stderr.on('error', () => {});
    startTimer = setTimeout(() => workerDown(proc, 'worker took too long to start'), startLimitMs);
    startTimer.unref?.();
    proc.unref();
    for (const stream of [proc.stdin, proc.stdout, proc.stderr]) stream.unref?.();
  }

  function pump() {
    if (!ready || current || !queue.length) return;
    const proc = child;
    current = queue.shift();
    const head = Buffer.alloc(REQUEST_BYTES);
    head.writeUInt32LE(current.id, 0);
    head.writeDoubleLE(current.ratio, 4);
    head.writeUInt32LE(current.sampleRate, 12);
    head.writeUInt32LE(current.pcm.length, 16);
    current.sentAt = Date.now();
    stuckTimer = setTimeout(() => workerDown(proc, 'worker took too long on a clip'), current.lane
      ? Math.max(stuckLimit(), (current.pcm.length / 2 / current.sampleRate) * STUCK_MS_PER_SECOND)
      : limit());
    stuckTimer.unref?.();
    proc.stdin.write(head);
    proc.stdin.write(current.pcm);
  }

  // pcm: s16 mono. Resolves to the stretched PCM, or to this very buffer when nothing was done.
  // lane: 'call', 'chat' or 'reading' (top of this file); none is how FISH_PACE_STRETCH asks.
  function stretch(pcm, ratio, sampleRate = 24000, { lane } = {}) {
    counts.asked++;
    const keep = () => { counts.kept++; return Promise.resolve(pcm); };
    if (!(ratio > 0) || ratio === 1 || !pcm || pcm.length % 2) return keep();
    const seconds = pcm.length / 2 / sampleRate;
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) return keep();
    const rule = lanes[lane] || null;
    const patienceMs = rule ? rule.patienceMs() : limit();
    const patient = Boolean(rule && rule.patient) && losses < 2;
    if (stopped) return keep();
    // Down: the backoff is running. Only a patient clip waits on it, and only if it can outlast it.
    if (respawnTimer && !(patient && respawnAt - Date.now() < patienceMs)) return keep();
    if (!ready && startWaitedOut && !patient) return keep(); // one clip waited on this start; no others do
    const first = Boolean(rule && rule.first);
    if (queue.length >= MAX_QUEUE && !first) { note('worker queue is full'); return keep(); }
    start();
    if (!child && !(patient && respawnTimer)) return keep();
    return new Promise((resolve) => {
      const job = { id: nextId++, pcm, ratio, sampleRate, resolve, done: false, timer: null, lane, first, patient, restarted: false, deadline: Date.now() + patienceMs, sentAt: 0 };
      if (nextId > 0xfffffff0) nextId = 1;
      job.timer = setTimeout(() => {
        // Waiting in line, or running long: this clip goes out as it is. A worker stuck on it is
        // replaced by stuckTimer, which started when the clip reached the worker.
        const at = queue.indexOf(job);
        if (at >= 0) queue.splice(at, 1);
        if (!ready) startWaitedOut = true;
        note(ready ? 'worker was too slow for a clip' : 'worker was not ready in time');
        settle(job, pcm);
      }, ready || patient ? patienceMs : Math.min(patienceMs, startWaitMs));
      // Live-call clips go ahead of everything but each other and the clip already in the worker.
      if (first) {
        let at = 0;
        while (at < queue.length && queue[at].first) at++;
        queue.splice(at, 0, job);
      } else queue.push(job);
      pump();
    });
  }

  // Start now, so the first voice message after a deploy does not pay for the imports.
  function warm() { start(); }

  function stop() {
    stopped = true;
    clearTimeout(respawnTimer);
    respawnTimer = null;
    if (child) workerDown(child, 'stopped');
  }

  function health() {
    return { ready, ...counts, slowestClipMs: slowest.ms, slowestClipSeconds: Math.round(slowest.seconds * 10) / 10, ...(lastProblem ? { lastProblem } : {}) };
  }

  return { stretch, warm, stop, health, pid: () => (child && child.pid) || null };
}

const fishStretch = createFishStretch();

module.exports = { createFishStretch, fishStretch, BACKOFF_MAX_MS };
