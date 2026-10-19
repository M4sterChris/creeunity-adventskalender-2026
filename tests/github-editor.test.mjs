import test from 'node:test';
import assert from 'node:assert/strict';
import { GitHubEditor, CONTENT_REPOSITORY, encodeBase64, decodeText, detectImage, privateImagePath } from '../github-editor.js';

const data = { version: 1, year: 2026, links: {}, doors: [] };
const encoded = encodeBase64(new TextEncoder().encode(JSON.stringify(data)));
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const repo = { private: true, full_name: CONTENT_REPOSITORY, permissions: { push: true } };
function mock(overrides = {}) {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    const path = url.replace(`https://api.github.com/repos/${CONTENT_REPOSITORY}`, '');
    if (overrides[path]) return overrides[path](options, calls);
    if (!path) return json(repo);
    if (path === '/git/ref/heads/main') return json({ object: { sha: 'HEAD1' } });
    if (path === '/contents/doors-data.json?ref=HEAD1') return json({ sha: 'CONFIG1', encoding: 'base64', content: encoded });
    if (path === '/git/commits/HEAD1') return json({ tree: { sha: 'TREE1' } });
    if (path === '/git/blobs') return json({ sha: `BLOB${calls.length}` });
    if (path === '/git/trees') return json({ sha: 'TREE2' });
    if (path === '/git/commits') return json({ sha: 'HEAD2' });
    if (path === '/git/refs/heads/main') return json({ object: { sha: 'HEAD2' } });
    throw new Error(`Unexpected mock path ${path}`);
  };
  return { calls, fetcher };
}

test('UTF-8 mit Umlauten und Emojis wird verlustfrei übertragen', () => {
  const text = 'Türchen 24 – Grüße 🎄';
  assert.equal(decodeText(encodeBase64(new TextEncoder().encode(text))), text);
});
test('Browser-fetch erhält den globalen statt des Klassen-Aufrufkontexts', async () => {
  const { fetcher } = mock();
  const client = new GitHubEditor('secret', function (...args) {
    assert.equal(this, globalThis);
    return fetcher(...args);
  });
  await client.load();
});
test('Zugriffsschlüssel wird ausschließlich im Authorization-Header an GitHub gesendet', async () => {
  const { calls, fetcher } = mock();
  const client = new GitHubEditor('secret-test-key', fetcher);
  assert.deepEqual(await client.load(), data);
  for (const { url, options } of calls) {
    assert.ok(url.startsWith(`https://api.github.com/repos/${CONTENT_REPOSITORY}`));
    assert.ok(!url.includes('secret-test-key'));
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
  }
  assert.equal(JSON.stringify(client), '{}');
  client.disconnect();
  await assert.rejects(() => client.load(), /erneut/);
});
test('Öffentliche und falsche Repositories werden abgewiesen', async () => {
  for (const value of [{ ...repo, private: false }, { ...repo, full_name: 'other/repo' }, { ...repo, permissions: { push: false } }]) {
    const { fetcher } = mock({ '': () => json(value) });
    // Leerpfad wird vom Mock gesondert behandelt.
    await assert.rejects(() => new GitHubEditor('secret', async (url, options) => url.endsWith(CONTENT_REPOSITORY) ? json(value) : fetcher(url, options)).load());
  }
});
test('Bilder und Text werden atomar in einem Commit ohne force gespeichert', async () => {
  const { fetcher, calls } = mock();
  const client = new GitHubEditor('secret', fetcher); await client.load();
  const bytes = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  await client.save(data, [{ path: './images/door-01.png', bytes }]);
  const tree = JSON.parse(calls.find(c => c.url.endsWith('/git/trees')).options.body);
  assert.equal(tree.base_tree, 'TREE1');
  assert.deepEqual(tree.tree.map(entry => entry.path), ['images/door-01.png', 'doors-data.json']);
  const commits = calls.filter(c => c.url.endsWith('/git/commits'));
  assert.equal(commits.length, 1);
  assert.deepEqual(JSON.parse(commits[0].options.body).parents, ['HEAD1']);
  const update = calls.find(c => c.options.method === 'PATCH');
  assert.deepEqual(JSON.parse(update.options.body), { sha: 'HEAD2', force: false });
});
test('Parallele Änderungen an der Konfiguration werden nicht überschrieben', async () => {
  let reads = 0;
  const { fetcher, calls } = mock({ '/contents/doors-data.json?ref=HEAD1': () => json({ sha: ++reads === 1 ? 'CONFIG1' : 'CHANGED', encoding: 'base64', content: encoded }) });
  const client = new GitHubEditor('secret', fetcher); await client.load();
  await assert.rejects(() => client.save(data), /jemand anderem/);
  assert.ok(!calls.some(c => c.options.method === 'PATCH' || c.url.endsWith('/git/blobs')));
});
test('Branch-Konflikt wird angezeigt und nicht mit force umgangen', async () => {
  const { fetcher, calls } = mock({ '/git/refs/heads/main': () => json({}, 422) });
  const client = new GitHubEditor('secret', fetcher); await client.load();
  await assert.rejects(() => client.save(data), /Zwischenzeitlich/);
  assert.equal(calls.filter(c => c.options.method === 'PATCH').length, 1);
});
test('HTTP-Fehler verraten keine Schlüssel oder private GitHub-Fehlermeldungen', async () => {
  const client = new GitHubEditor('secret-key', async () => json({ message: 'secret-key private data' }, 401));
  await assert.rejects(() => client.load(), error => !error.message.includes('secret-key') && /ungültig/.test(error.message));
});
test('Bilddateien werden anhand ihrer Daten und nicht der Dateiendung geprüft', () => {
  const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  assert.equal(detectImage(png).extension, 'png');
  assert.throws(() => detectImage(new TextEncoder().encode('<script>alert(1)</script>')));
  assert.throws(() => detectImage(new Uint8Array(10 * 1024 * 1024 + 1)));
});
test('Private Bildpfade lassen kein Verlassen des Bilderordners zu', () => {
  assert.equal(privateImagePath('./images/a.png'), 'images/a.png');
  for (const path of ['../a.png', 'images/../a.png', 'images/a\\b.png', 'https://evil.test/a.png', 'images/%2e%2e/a.png']) assert.throws(() => privateImagePath(path));
});
