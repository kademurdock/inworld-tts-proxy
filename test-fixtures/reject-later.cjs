'use strict';
// Preload for rejection-net-wire.test.js: makes the proxy see unhandled promise rejections, on purpose.
//   REJECT_COUNT            how many, all at once (0 = none), as soon as /healthz answers, so the proxy is certainly serving
//   REJECT_AGAIN_AFTER_MS   (optional) the same number once more, this many milliseconds after the first burst
// It uses node's http module, not fetch: provider.cjs, preloaded too, replaces fetch with a stub that blocks everything else.
const http = require('node:http');

const count = Number(process.env.REJECT_COUNT || 0);
const again = Number(process.env.REJECT_AGAIN_AFTER_MS || 0);

function burst(label) {
  for (let i = 0; i < count; i++) Promise.reject(new Error(`fixture rejection ${label} ${i + 1}`));
}

if (count > 0) {
  const tick = () => {
    const req = http.get({ host: '127.0.0.1', port: process.env.PORT, path: '/healthz', timeout: 500 }, (res) => {
      res.resume();
      burst('after listen');
      if (again > 0) setTimeout(() => burst('again'), again);
    });
    req.on('error', () => setTimeout(tick, 100));
    req.on('timeout', () => req.destroy());
  };
  setTimeout(tick, 100);
}
