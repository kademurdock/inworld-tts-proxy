'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('real ask route forwards the brief policy, preserves ordinary asks, and rejects unknown policies', async () => {
  const starts = [];
  const fork = express();
  fork.use(express.json());
  fork.post('/api/auth/login', (_req, res) => res.json({ token: 'offline-test-token' }));
  fork.post('/api/agents/chat', (req, res) => {
    starts.push(req.body);
    res.json({ streamId: 'offline-stream' });
  });
  fork.get('/api/agents/chat/stream/:id', (_req, res) => {
    const final = 'data: ' + JSON.stringify({ final: true, text: 'A short morning brief.' }) + '\n\n';
    res.type('text/event-stream');
    if (starts.length === 2) {
      res.write(final);
      setTimeout(() => res.destroy(), 50);
    } else res.end(final);
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
  try {
    const ask = (extra) => fetch(`http://127.0.0.1:${server.address().port}/librechat/ask`, {
      method: 'POST', headers: { Authorization: 'Bearer offline-secret', 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: 'test-agent', messages: [{ role: 'user', content: 'Write the brief.' }], ...extra }),
    });
    let response = await ask({ toolPolicy: 'morning-brief' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, 'A short morning brief.');
    assert.equal(starts[0].kadeToolPolicy, 'morning-brief');
    response = await ask({});
    assert.equal(response.status, 200);
    assert.equal(Object.hasOwn(starts[1], 'kadeToolPolicy'), false);
    response = await ask({ toolPolicy: 'misspelled-policy' });
    assert.equal(response.status, 400);
    assert.equal(starts.length, 2);
  } finally {
    await Promise.all([new Promise((resolve) => server.close(resolve)), new Promise((resolve) => forkServer.close(resolve))]);
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
