const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { SECTIONS, PAGES, renderPage } = require('./help');

test('every help destination renders once with a canonical domain and valid local anchors', () => {
  assert.equal(new Set(SECTIONS.map(s => s.path)).size, SECTIONS.length);
  assert.equal(SECTIONS.length, Object.keys(PAGES).length);
  const paths = new Set([...SECTIONS.map(s => s.path), '/help/android-download']);
  for (const s of SECTIONS) {
    const html = renderPage({ key: s.key, ...PAGES[s.key] });
    assert.equal((html.match(/<h1>/g) || []).length, 1, s.key);
    assert.ok(html.includes(`rel="canonical" href="https://kademurdock.com${s.path}"`));
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.equal(new Set(ids).size, ids.length, s.key + ' duplicate IDs');
    for (const [, path] of html.matchAll(/href="(\/help[^"#?]*)/g)) assert.ok(paths.has(path), path);
    for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), s.key + ' missing ' + id);
    if (s.key !== 'home') assert.ok(html.indexOf('<main') < html.indexOf('id="help-topics"'));
  }
});
test('search script compiles and current guidance has no automatic refill promise', () => {
  const script = PAGES.home.main.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(script));
  assert.doesNotMatch(PAGES.troubleshooting.main, /refills automatically every 30 days/);
  assert.doesNotMatch(PAGES.costs.main, /at exactly what things cost|not a penny more/);
  assert.ok(PAGES.home.main.includes('/help/privacy'));
});

test('legacy Railway help links redirect once while the site fetch renders the article', async t => {
  const app = require('express')();
  app.use(require('./help'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/help/projects?q=files`;
  // Node fetch replaces Host; use HTTP directly to exercise the real hostname check.
  const request = headers => new Promise((resolve, reject) => {
    require('node:http').get(url, { headers }, res => {
      let body = '';
      res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      res.on('error', reject);
    }).on('error', reject);
  });
  const legacy = await request({ Host: 'inworld-tts-proxy-production.up.railway.app' });
  assert.equal(legacy.status, 302);
  assert.equal(legacy.headers.location, 'https://kademurdock.com/help/projects?q=files');
  const internal = await request({ Host: 'inworld-tts-proxy-production.up.railway.app', 'X-Kade-Help-Proxy': '1' });
  assert.equal(internal.status, 200);
  assert.match(internal.body, /<h1>Work in a project<\/h1>/);
});
