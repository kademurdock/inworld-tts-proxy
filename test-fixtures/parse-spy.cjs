'use strict';
// Preload for body-limits-wire.test.js: appends one line to the file named by PARSE_SPY_FILE for every JSON.parse of a text of
// 64 KB or more (a synchronous write, so the line is there before the request that caused it is answered), so a test can say
// "the body of this request was never parsed" instead of timing it. Nothing else about JSON.parse changes.
const fs = require('node:fs');
const realParse = JSON.parse;
JSON.parse = function parse(text, reviver) {
  if (typeof text === 'string' && text.length >= 65536 && process.env.PARSE_SPY_FILE) {
    try { fs.appendFileSync(process.env.PARSE_SPY_FILE, text.length + '\n'); } catch { /* the spy must never change what the server does */ }
  }
  return realParse.call(this, text, reviver);
};
