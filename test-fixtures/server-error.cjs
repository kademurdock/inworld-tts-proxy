'use strict';
// Preload for server-listen-error.test.js: just before server.js starts listening, adds GET /__emit-server-error. It answers at once and
// then, on a later turn of the event loop (the way libuv reports a failed accept: not inside any request handler), makes the HTTP
// server emit the 'error' event a process runs into when it is out of file descriptors (EMFILE on accept).
const express = require('express');

const realListen = express.application.listen;
express.application.listen = function listen(...args) {
  let httpServer = null;
  this.get('/__emit-server-error', (req, res) => {
    setImmediate(() => httpServer.emit('error', Object.assign(new Error('accept EMFILE'), { code: 'EMFILE', syscall: 'accept', errno: -24 })));
    res.json({ scheduled: true });
  });
  httpServer = realListen.apply(this, args);
  return httpServer;
};
