// Privacy page promises about which hosts keep data (retention review, Nov 14 2026).
const test = require('node:test');
const assert = require('node:assert/strict');
const { PAGES } = require('./help');

const privacy = PAGES.privacy.main;
const describe = PAGES.describe.main;
const bullet = name => {
  const m = privacy.match(new RegExp(`<li><strong>${name}</strong>[\\s\\S]*?</li>`));
  assert.ok(m, `privacy page has a ${name} entry`);
  return m[0];
};
const allowedPara = () => privacy.match(/<p><strong>What they are allowed to do with it\.<\/strong>[\s\S]*?<\/p>/)[0];

test('zero-retention paragraph does not claim Gemini on Vertex is the only exception', () => {
  const p = allowedPara();
  assert.doesNotMatch(p, /with one exception/);
  // Vertex keeps the same way for any model it runs, not only Gemini.
  assert.match(p, /Vertex[^.]*DeepSeek/);
  assert.match(p, /Vertex[^.]*Claude/);
  // OpenRouter screens all traffic, zero retention included, for child sexual abuse material.
  assert.match(p, /child sexual abuse material/);
});

test('Google retention is not described as flagged requests only', () => {
  for (const text of [privacy, describe]) {
    assert.doesNotMatch(text, /may keep a request that its safety checks flag/);
    assert.doesNotMatch(text, /Vertex keeps nothing after it answers/);
  }
  assert.match(bullet('Google'), /mainly ones its safety checks flag/);
});

/* Merge with route savings (Nov 14 2026): the sorter sends every book's title, author and
 * blurb to hosts that may keep them (kadeReadingRoomSort.js has no private-shelf lane), and the
 * repeat check keeps zero retention for uploads and every Library video; only YouTube may keep. */
test('book sorter sends only book details and claims no private-shelf lane', () => {
  const mimo = bullet('MiMo model hosts');
  assert.match(mimo, /sorts Library books[^.]*sends only a book's title, author and blurb/);
  assert.doesNotMatch(mimo, /private shelf/);
});

test('narration listen-back keeps uploads and Library videos on hosts that keep nothing', () => {
  const mimo = bullet('MiMo model hosts');
  assert.match(mimo, /YouTube video/);
  assert.match(mimo, /your own uploaded video, or of any Library video, stays on zero retention hosts/);
  assert.doesNotMatch(mimo, /Library film/);
  // The described-video help names the listen-back too.
  assert.match(describe, /MiMo, through OpenRouter, listens back to it[^.]*\. For your own uploads and Library videos that check uses only hosts that keep nothing/);
  assert.doesNotMatch(describe, /For a public video/);
});

test('DeepSeek entry names errands; Moonshot is past tense', () => {
  assert.match(bullet('DeepSeek model hosts'), /errands/);
  assert.doesNotMatch(bullet('Moonshot AI'), /the models behind deep research/);
});
