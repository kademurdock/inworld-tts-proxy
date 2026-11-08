'use strict';
// Preload for avatar-gen-reset.test.js: the https requests the avatar-generation route makes to bfl.test go to a plain http server on the
// loopback instead (the test's own, on BFL_FIXTURE_PORT), so the response is a real IncomingMessage that can be cut off in the middle;
// every other https request is blocked. Only https.request is touched (the route uses the raw https module, pinned to IPv4).
const https = require('node:https');
const http = require('node:http');

https.request = function request(options, callback) {
  if (options && typeof options === 'object' && options.hostname === 'bfl.test') {
    return http.request({ hostname: '127.0.0.1', port: Number(process.env.BFL_FIXTURE_PORT), path: options.path, method: options.method, headers: options.headers, timeout: options.timeout }, callback);
  }
  throw new Error('External network blocked by fixture: ' + (options && options.hostname));
};
