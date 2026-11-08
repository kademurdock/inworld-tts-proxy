'use strict';
// Nov 7 2026: the last net (rejection-net.js). A promise rejected with nobody listening that belongs to no request (a timer, a
// background job, code added later) used to end the process; Railway restarts the service at most three times. The net logs it,
// counts it, and lets the proxy go on, except that (1) in the first 30 seconds it ends the process as before, so a deploy that
// cannot start fails its health check, and (2) more than 20 in a minute end it, so a bug that keeps firing still looks like a crash.
// This file tests the net on its own, with the clock, the uptime, exit() and the log passed in.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { createRejectionNet, DEFAULTS } = require('./rejection-net');

function rig(over = {}) {
  const state = { t: 1000000, up: 60000, exits: [], lines: [] };
  const net = createRejectionNet({ uptimeMs: () => state.up, now: () => state.t, exit: (code) => { state.exits.push(code); }, log: (line) => { state.lines.push(line); }, ...over });
  return { net, state };
}
const burst = (net, n, label = 'r') => { for (let i = 0; i < n; i++) net.onRejection(new Error(`${label} ${i}`)); };

test('the numbers: 30 seconds of grace, a one-minute window, more than 20 ends the process', () => {
  assert.deepEqual(DEFAULTS, { graceMs: 30000, windowMs: 60000, limit: 20 });
});

test('after the grace a rejection is logged with its cause and at most five frames, counted, and the process stays up', () => {
  const { net, state } = rig();
  net.onRejection(new TypeError('boom in a timer'));
  assert.deepEqual(state.exits, []);
  assert.equal(state.lines.length, 1);
  const lines = state.lines[0].split('\n');
  assert.equal(lines[0], '[proc] unhandled rejection #1 (1 in the last 60 seconds): it belongs to no request and the proxy stays up: TypeError: boom in a timer');
  assert.ok(lines.length >= 2 && lines.length <= 6, 'a line and one to five frames');
  for (const frame of lines.slice(1)) assert.match(frame, /^\s+at /);
  assert.deepEqual(net.stats(), { total: 1, recent: 1, windowSeconds: 60 });
});

test('the first 30 seconds are fatal: a rejection ends the process after the log line; at 30 seconds it no longer does', () => {
  const { net, state } = rig();
  state.up = 29999;
  net.onRejection(new Error('while starting'));
  assert.deepEqual(state.exits, [1]);
  assert.match(state.lines[0], /^\[proc\] unhandled rejection while starting up, ending the process so the deploy fails its health check: Error: while starting/);
  state.up = 30000;
  net.onRejection(new Error('a bit later'));
  assert.deepEqual(state.exits, [1], 'no second exit');
  assert.match(state.lines[1], /^\[proc\] unhandled rejection #2 /);
  state.up = 0;
  net.onRejection(new Error('right at the start'));
  assert.deepEqual(state.exits, [1, 1]);
});

test('the log line is written before the process is told to exit', () => {
  const order = [];
  const net = createRejectionNet({ uptimeMs: () => 0, now: () => 1, exit: () => order.push('exit'), log: () => order.push('log') });
  net.onRejection(new Error('x'));
  assert.deepEqual(order, ['log', 'exit']);
});

test('a storm ends the process: 20 in a minute is tolerated, the 21st ends it, with the count in the log', () => {
  const { net, state } = rig();
  burst(net, 20);
  assert.deepEqual(state.exits, []);
  assert.equal(net.stats().recent, 20);
  net.onRejection(new Error('the straw'));
  assert.deepEqual(state.exits, [1]);
  assert.match(state.lines.at(-1), /^\[proc\] 21 unhandled rejections in the last 60 seconds, ending the process so the platform restarts it; the last one: Error: the straw/);
});

test('the window slides: rejections older than a minute stop counting, to the millisecond', () => {
  const a = rig();
  burst(a.net, 20);
  a.state.t += 59999;
  a.net.onRejection(new Error('just inside'));
  assert.deepEqual(a.state.exits, [1], 'the 20 are still inside the window: this is the 21st');
  const b = rig();
  burst(b.net, 20);
  b.state.t += 60000;
  b.net.onRejection(new Error('just outside'));
  assert.deepEqual(b.state.exits, [], 'a minute later the 20 are gone: this is the first');
  assert.equal(b.net.stats().recent, 1);
  assert.equal(b.net.stats().total, 21, 'the total keeps counting');
  burst(b.net, 19);
  assert.deepEqual(b.state.exits, []);
});

test('stats() reflects the window at the moment it is asked, and never counts a rejection twice', () => {
  const { net, state } = rig();
  burst(net, 5);
  assert.deepEqual(net.stats(), { total: 5, recent: 5, windowSeconds: 60 });
  state.t += 30000;
  burst(net, 2);
  assert.deepEqual(net.stats(), { total: 7, recent: 7, windowSeconds: 60 });
  state.t += 30000;
  assert.deepEqual(net.stats(), { total: 7, recent: 2, windowSeconds: 60 });
  state.t += 60000;
  assert.deepEqual(net.stats(), { total: 7, recent: 0, windowSeconds: 60 });
});

test('whatever was rejected, even something that cannot be printed, is handled: nothing throws, the count goes up, a line is written', () => {
  const deep = JSON.parse('['.repeat(30000) + ']'.repeat(30000));
  const hostile = new Proxy({}, { get() { throw new Error('no'); }, getPrototypeOf() { throw new Error('no'); }, has() { throw new Error('no'); }, ownKeys() { throw new Error('no'); } });
  const values = [Symbol('s'), Object.create(null), undefined, null, 0, '', 'text', { toString: 1 }, deep, hostile, { get message() { throw new Error('no'); } }, Object.defineProperty(new Error('e'), 'stack', { get() { throw new Error('no stack'); } })];
  const { net, state } = rig({ limit: 1000 });
  for (const v of values) net.onRejection(v);
  assert.equal(net.stats().total, values.length);
  assert.equal(state.lines.length, values.length);
  assert.deepEqual(state.exits, []);
});

test('a log function that throws, or an exit that throws, cannot make the net itself fail', () => {
  const net = createRejectionNet({ uptimeMs: () => 60000, now: () => 1, exit: () => { throw new Error('exit failed'); }, log: () => { throw new Error('stderr closed'); } });
  net.onRejection(new Error('x'));
  assert.equal(net.stats().total, 1);
  const startup = createRejectionNet({ uptimeMs: () => 0, now: () => 1, exit: () => { throw new Error('exit failed'); }, log: () => {} });
  startup.onRejection(new Error('x'));
  assert.equal(startup.stats().total, 1);
});

test('the settings can be changed: no grace, a limit of 2, a window of a second', () => {
  const { net, state } = rig({ graceMs: 0, limit: 2, windowMs: 1000 });
  state.up = 0;
  burst(net, 2);
  assert.deepEqual(state.exits, [], 'a grace of zero is no grace');
  state.t += 1000;
  burst(net, 2);
  assert.deepEqual(state.exits, []);
  net.onRejection(new Error('third in the window'));
  assert.deepEqual(state.exits, [1]);
  assert.match(state.lines.at(-1), /3 unhandled rejections in the last 1 seconds/);
});

test('a limit of 0 makes the first rejection after the grace a storm', () => {
  const { net, state } = rig({ limit: 0 });
  net.onRejection(new Error('x'));
  assert.deepEqual(state.exits, [1]);
});

test('if the net itself fails while handling a rejection it says so, and the count still went up', () => {
  const { net, state } = rig({ now: () => { throw new Error('the clock broke'); } });
  net.onRejection(new Error('x'));
  assert.deepEqual(state.lines, ['[proc] the rejection net failed while handling a rejection']);
  assert.deepEqual(state.exits, []);
});

test('the starting-up rule does not depend on the clock: a broken clock cannot stop a failing boot from ending', () => {
  const { net, state } = rig({ now: () => { throw new Error('the clock broke'); } });
  state.up = 100;
  net.onRejection(new Error('while starting'));
  assert.deepEqual(state.exits, [1]);
  assert.match(state.lines[0], /while starting up/);
});

test('with nothing injected the window runs on a monotonic clock: a wall clock stepped back does not keep old rejections alive', (t) => {
  let wall = 1700000000000;
  let monotonic = 5000;
  t.mock.method(Date, 'now', () => wall);
  t.mock.method(performance, 'now', () => monotonic);
  const exits = [];
  const net = createRejectionNet({ uptimeMs: () => 60000, exit: (code) => exits.push(code), log: () => {} });
  for (let i = 0; i < 15; i++) net.onRejection(new Error('a' + i));
  monotonic += 90000;   // ninety seconds really pass
  wall -= 120000;       // and somebody sets the wall clock back two minutes
  for (let i = 0; i < 6; i++) net.onRejection(new Error('b' + i));
  assert.deepEqual(exits, []);
  assert.equal(net.stats().recent, 6);
  assert.equal(net.stats().total, 21);
});

// ── install(): once per process, settings from the environment ────────────────────────────────────
function inChild(script, env = {}) {
  const r = spawnSync(process.execPath, ['-e', script], { cwd: __dirname, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 20000 });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

test('install() puts one listener on the process, a second call returns the same net, and the environment sets the numbers', () => {
  const script = `
    const rn = require('./rejection-net');
    const a = rn.install();
    const b = rn.install();
    console.log(JSON.stringify({ same: a === b, listeners: process.listenerCount('unhandledRejection') }));
    Promise.reject(new Error('one'));
    Promise.reject(new Error('two'));
    setTimeout(() => { console.log(JSON.stringify(a.stats())); process.exit(0); }, 100);
  `;
  const r = inChild(script, { PROXY_BOOT_GRACE_MS: '0', PROXY_REJECTION_WINDOW_MS: '5000', PROXY_REJECTION_LIMIT: '5' });
  assert.equal(r.code, 0, r.err);
  const [first, second] = r.out.trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(first, { same: true, listeners: 1 });
  assert.deepEqual(second, { total: 2, recent: 2, windowSeconds: 5 });
  assert.match(r.err, /\[proc\] unhandled rejection #1 \(1 in the last 5 seconds\)/);
});

test('install() with nothing set uses 30 s, 60 s and 20, and ignores nonsense in the environment', () => {
  const script = `
    const rn = require('./rejection-net');
    const net = rn.install();
    Promise.reject(new Error('during startup'));
    setTimeout(() => { console.log('still alive'); process.exit(0); }, 300);
  `;
  const plain = inChild(script, { PROXY_BOOT_GRACE_MS: '', PROXY_REJECTION_WINDOW_MS: 'abc', PROXY_REJECTION_LIMIT: '-3' });
  assert.equal(plain.code, 1, 'inside the 30 seconds a rejection is fatal (exit 1)');
  assert.match(plain.err, /unhandled rejection while starting up/);
  assert.doesNotMatch(plain.out, /still alive/);
  const stats = inChild(`
    const net = require('./rejection-net').install();
    console.log(JSON.stringify(net.stats()));
  `, { PROXY_BOOT_GRACE_MS: 'x', PROXY_REJECTION_WINDOW_MS: 'abc', PROXY_REJECTION_LIMIT: '-3' });
  assert.deepEqual(JSON.parse(stats.out), { total: 0, recent: 0, windowSeconds: 60 });
  // a blank or whitespace setting is no setting (Number(" ") is 0, which would switch the starting-up rule off), and Infinity is nonsense
  const blank = inChild(script, { PROXY_BOOT_GRACE_MS: ' ' + String.fromCharCode(10), PROXY_REJECTION_WINDOW_MS: 'Infinity' });
  assert.equal(blank.code, 1, 'still fatal during startup: ' + blank.err);
  const infinite = inChild(`
    const net = require('./rejection-net').install();
    console.log(JSON.stringify(net.stats()));
  `, { PROXY_REJECTION_WINDOW_MS: 'Infinity', PROXY_BOOT_GRACE_MS: 'Infinity' });
  assert.deepEqual(JSON.parse(infinite.out), { total: 0, recent: 0, windowSeconds: 60 });
  // a limit of 0 is nonsense too (every rejection would be a storm): the default 20 holds
  const survive = inChild(`
    const net = require('./rejection-net').install();
    for (let i = 0; i < 3; i++) Promise.reject(new Error('r' + i));
    setTimeout(() => { console.log(JSON.stringify(net.stats())); process.exit(0); }, 100);
  `, { PROXY_BOOT_GRACE_MS: '0', PROXY_REJECTION_LIMIT: '0' });
  assert.equal(survive.code, 0, survive.err);
  assert.equal(JSON.parse(survive.out).total, 3);
});
