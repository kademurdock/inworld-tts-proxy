'use strict';
// Preload for route-stack-wire.test.js: just before server.js starts listening, take a snapshot of the app's router stack
// and serve it at GET /__stack (added after the snapshot, so it is not part of it). It shows what the server really has
// mounted, in order, instead of what its source text says.
const express = require('express');
const Layer = require('express/lib/router/layer');

const realListen = express.application.listen;
express.application.listen = function listen(...args) {
  const describe = (l, i) => ({
    i,
    name: l.name,
    arity: typeof l.handle === 'function' ? l.handle.length : null,
    route: l.route ? Object.keys(l.route.methods).join(',') + ' ' + l.route.path : null,
    // a mounted router: how many error handlers (four arguments) sit inside it
    innerErrorHandlers: l.handle && Array.isArray(l.handle.stack) ? l.handle.stack.filter((x) => typeof x.handle === 'function' && x.handle.length === 4).length : 0,
  });
  const stack = this._router.stack.map(describe);
  const patched = Layer.prototype.handle_request[Symbol.for('inworld-tts-proxy.async-routes')] === true;
  // the final handler is the app's own `done`: app.handle carries the registered flag, and it is not a layer
  const finalHandler = this.handle[Symbol.for('inworld-tts-proxy.final-handler')] === true;
  this.get('/__stack', (req, res) => res.json({ stack, patched, finalHandler, handleName: this.handle.name }));
  return realListen.apply(this, args);
};
