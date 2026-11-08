'use strict';
// Preload for body-limits-wire.test.js: just before server.js starts listening, take a snapshot of every route the app really has,
// including the ones inside mounted routers, with the handlers of each route in order, and serve it at GET /__routes (added after
// the snapshot, so it is not part of it). It shows what the running server does, not what its source text says.
const express = require('express');

const realListen = express.application.listen;
express.application.listen = function listen(...args) {
  const routes = [];
  const topLevel = [];
  const handlers = (route) => route.stack.map((l) => ({ name: l.name || '<anonymous>', parsesJson: l.handle.parsesJson === true }));
  const walk = (stack, depth) => {
    for (const l of stack) {
      if (l.route) {
        for (const method of Object.keys(l.route.methods)) routes.push({ method, path: String(l.route.path), chain: handlers(l.route), depth });
      } else if (l.handle && Array.isArray(l.handle.stack)) {
        walk(l.handle.stack, depth + 1);
      } else if (depth === 0) {
        topLevel.push(l.name || '<anonymous>');
      }
    }
  };
  walk(this._router.stack, 0);
  this.get('/__routes', (req, res) => res.json({ routes, topLevel }));
  return realListen.apply(this, args);
};
