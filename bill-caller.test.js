'use strict';
// Sep 25 2026 (Part 291 review F11): the fork bills a voice turn to the person on the line only
// when the start request says kadeBillCaller: true. The call lane (/librechat/ask-stream) forwards
// it only when the bridge asked (billCaller === true); /librechat/ask (friend texts, previews,
// briefs, canaries) never sends it, whatever its body says.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('only a call-lane turn the bridge marked carries kadeBillCaller to the fork', async () => {
  const starts = [];
  const fork = express();
  fork.use(express.json());
  fork.post('/api/auth/login', (_req, res) => res.json({ token: 'offline-test-token' }));
  fork.post('/api/agents/chat', (req, res) => {
    starts.push(req.body);
    res.json({ streamId: 'offline-stream' });
  });
  fork.get('/api/agents/chat/stream/:id', (_req, res) => {
    res.type('text/event-stream');
    res.end('data: ' + JSON.stringify({ final: true, text: 'Hello there.' }) + '\n\n');
  });
  const forkServer = fork.listen(0, '127.0.0.1');
  await new Promise((resolve) => forkServer.once('listening', resolve));
  const env = {
    LIBRECHAT_BASE: `http://127.0.0.1:${forkServer.address().port}`,
    LIBRECHAT_USER: 'offline@example.invalid', LIBRECHAT_PASS: 'offline',
    LIBRECHAT_PROXY_SECRET: 'offline-secret', LIBRECHAT_MIN_GAP_MS: '1',
  };
  const oldEnv = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  const app = express();
  app.use(express.json());
  app.use(require('./librechat'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const post = async (route, extra) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}${route}`, {
      method: 'POST', headers: { Authorization: 'Bearer offline-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'test-agent', messages: [{ role: 'user', content: 'Hi.' }], userEmail: 'amber@example.invalid', ...extra }),
    });
    assert.equal(r.status, 200);
    return r.text();
  };
  try {
    // A caller-started call turn: forwarded.
    assert.match(await post('/librechat/ask-stream', { billCaller: true }), /Hello there\./);
    assert.equal(starts[0].kadeBillCaller, true);
    assert.equal(starts[0].kadeOnBehalfOf, 'amber@example.invalid');
    // An outbound call, a Spotter session or an old bridge: no flag, nothing forwarded.
    await post('/librechat/ask-stream', {});
    assert.equal(Object.hasOwn(starts[1], 'kadeBillCaller'), false);
    assert.equal(starts[1].kadeOnBehalfOf, 'amber@example.invalid', 'tools still act as the person');
    // Only the boolean true counts.
    await post('/librechat/ask-stream', { billCaller: 'true' });
    assert.equal(Object.hasOwn(starts[2], 'kadeBillCaller'), false);
    // The ask lane never forwards it, even when a body asks.
    await post('/librechat/ask', { billCaller: true, kadeBillCaller: true, deleteAfter: true });
    assert.equal(Object.hasOwn(starts[3], 'kadeBillCaller'), false);
    assert.equal(starts[3].kadeOnBehalfOf, 'amber@example.invalid');
    assert.equal(starts.length, 4);
  } finally {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => forkServer.close(resolve))]);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
