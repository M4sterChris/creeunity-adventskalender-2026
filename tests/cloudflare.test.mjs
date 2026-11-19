import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createWorker } from '../server/cloudflare/worker.mjs';
import { D1CalendarStore } from '../server/cloudflare/store.mjs';
import { rangedAsset } from '../server/cloudflare/range.mjs';
import { LOCK_MS, SESSION_MS, PARTICIPANT_DELETE_AT } from '../server/policy.mjs';
import { hostedCalendarLocation } from '../script.js';

// D1-shaped real SQLite adapter. The same SQL is additionally exercised by
// Wrangler's workerd runtime before deployment; no account credentials in tests.
class LocalD1 {
  constructor() { this.db = new DatabaseSync(':memory:'); this.db.exec('PRAGMA foreign_keys=ON'); }
  prepare(query) {
    const db = this.db;
    const statement = values => ({
      bind: (...next) => statement(next),
      async first() { return db.prepare(query).get(...values) || null; },
      async all() { return { results: db.prepare(query).all(...values), meta: { changes: 0 } }; },
      async run() { return { results: [], meta: { changes: Number(db.prepare(query).run(...values).changes) } }; },
      execute() {
        const sql = db.prepare(query);
        if (sql.columns().length) return { results: sql.all(...values), meta: { changes: 0 } };
        return { results: [], meta: { changes: Number(sql.run(...values).changes) } };
      },
    });
    return statement([]);
  }
  async batch(statements) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const results = statements.map(statement => statement.execute()); this.db.exec('COMMIT'); return results; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}

test('Old GitHub Pages bookmarks lead to the working hosted calendar and preserve editor links', () => {
  assert.equal(hostedCalendarLocation('https://m4sterchris.github.io/creeunity-adventskalender-2026/?admin=true#kalender'),
    'https://creeunity-adventskalender-2026.creeunity-m4sterchris.workers.dev/?admin=true#kalender');
  assert.equal(hostedCalendarLocation('https://m4sterchris.github.io/another-calendar/'), null);
  assert.equal(hostedCalendarLocation('https://m4sterchris.github.io.evil.example/creeunity-adventskalender-2026/'), null);
  assert.equal(hostedCalendarLocation('https://creeunity-adventskalender-2026.creeunity-m4sterchris.workers.dev/'), null);
});

async function fixture(t) {
  const DB = new LocalD1();
  DB.db.exec(await readFile(new URL('../server/cloudflare/migrations/0001_calendar.sql', import.meta.url), 'utf8'));
  DB.db.exec(await readFile(new URL('../server/cloudflare/migrations/0002_asset_sizes.sql', import.meta.url), 'utf8'));
  const config = JSON.parse(await readFile(new URL('../examples/doors-data.example.json', import.meta.url), 'utf8'));
  config.releaseMonth = 11;
  config.doors[0].image = './images/ready.png';
  config.doors[0].audio = './audio/ready.mp3';
  config.doors[0].puzzle = { type: 'number', answer: '042', fragment: 'PRIVATE-REWARD' };
  config.doors[1].puzzle = { type: 'letters', answer: 'SCHNEE' };
  config.doors[19].image = './images/future.png';
  config.doors[19].audio = './audio/future.mp3';
  config.doors[19].text = 'FUTURE-TEXT';
  config.doors[19].puzzle = { type: 'number', answer: '825', fragment: 'FUTURE-REWARD' };
  DB.db.prepare('INSERT INTO calendar_config VALUES(1, ?)').run(JSON.stringify(config));
  const clock = { value: Date.parse('2026-11-19T12:00:00Z') };
  const assets = [];
  const env = { DB, PUBLIC_ORIGIN: 'https://calendar.example', DISCORD_CLIENT_ID: 'test-client', DISCORD_CLIENT_SECRET: 'test-secret',
    ASSETS: { fetch: async request => { assets.push(new URL(request.url).pathname); return new Response('MEDIA-BYTES', { headers: { 'Content-Type': 'image/png' } }); } },
  };
  const worker = createWorker({ now: () => clock.value, fetchDiscord: async (url, init) => {
    if (url.endsWith('/oauth2/token')) {
      assert.equal(init.body.get('client_secret'), 'test-secret');
      return Response.json({ access_token: 'DISCARD-THIS-TOKEN', token_type: 'Bearer' });
    }
    assert.equal(init.headers.Authorization, 'Bearer DISCARD-THIS-TOKEN');
    return Response.json({ id: '123456789012345678', username: 'DO-NOT-STORE', email: 'DO-NOT-STORE@example.test' });
  } });
  const call = (path, { method = 'GET', body, session = '', headers = {} } = {}) => worker.fetch(new Request(env.PUBLIC_ORIGIN + path, {
    method, headers: { ...(method === 'POST' ? { Origin: env.PUBLIC_ORIGIN, 'Content-Type': 'application/json', 'X-Calendar-Request': '1' } : {}),
      ...(session ? { Cookie: session } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }), env);
  const login = async () => {
    const start = await call('/api/auth/discord');
    assert.equal(start.status, 303);
    const location = new URL(start.headers.get('Location'));
    assert.equal(location.searchParams.get('scope'), 'identify');
    const cookie = start.headers.getSetCookie()[0].split(';')[0];
    const callback = `/api/auth/discord/callback?state=${location.searchParams.get('state')}&code=test`;
    const response = await call(callback, { session: cookie });
    assert.equal(response.headers.get('Location'), '/?login=success#kalender');
    const session = response.headers.getSetCookie().find(value => value.startsWith('__Host-creeunity_session='));
    assert.match(session, /HttpOnly; SameSite=Lax; Max-Age=1209600; Secure/);
    return { session: session.split(';')[0], cookie, callback };
  };
  const answer = (session, value, day = 1) => call(`/api/puzzles/2026/${day}/answer`, { method: 'POST', body: { answer: value }, session });
  t.after(() => DB.db.close());
  return { DB, env, call, worker, clock, config, assets, login, answer };
}

test('Cloudflare manifest and all direct media routes keep future contents and solutions private', async t => {
  const f = await fixture(t);
  const response = await f.call('/doors-data.json');
  assert.equal(response.status, 200);
  const text = await response.text();
  for (const secret of ['PRIVATE-REWARD', 'FUTURE-REWARD', 'FUTURE-TEXT', 'answer', 'answerHash', 'test-secret']) assert.ok(!text.includes(secret), secret);
  const data = JSON.parse(text);
  assert.equal(data.doors.filter(door => door.released).length, 19);
  assert.deepEqual(data.doors[0].puzzle, { type: 'number', serverOnly: true });
  for (const path of ['/images/future.png', '/audio/future.mp3', '/assets/released/2026/test-11/day-20-hidden.png', '/.env', '/.git/config', '/calendar.sql', '/server/cloudflare/store.mjs']) {
    for (const method of ['GET', 'HEAD']) assert.equal((await f.call(path, { method, headers: { Range: 'bytes=0-3' } })).status, 404, path);
  }
  assert.deepEqual(f.assets, []);
  assert.equal((await f.call('/images/ready.png')).status, 200);
  assert.equal((await f.call('/audio/ready.mp3')).status, 200);
  f.clock.value = Date.parse('2026-11-20T00:00:00+01:00');
  assert.equal((await f.call('/audio/future.mp3')).status, 200);
});

test('Cloudflare OAuth states are bound, single-use; only Discord IDs persist', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/puzzles')).status, 401);
  const { session, cookie, callback } = await f.login();
  assert.equal((await f.call(callback, { session: cookie })).headers.get('Location'), '/?login=failed#kalender');
  assert.deepEqual(f.DB.db.prepare('SELECT * FROM users').all().map(row => ({ ...row })), [{ id: '123456789012345678' }]);
  const dump = JSON.stringify(['users', 'sessions', 'oauth_states'].map(table => f.DB.db.prepare(`SELECT * FROM ${table}`).all()));
  for (const secret of ['DO-NOT-STORE', 'DISCARD-THIS-TOKEN', session.split('=')[1]]) assert.ok(!dump.includes(secret));
  assert.equal((await (await f.call('/api/session', { session })).json()).user.authenticated, true);
  f.clock.value += SESSION_MS;
  assert.equal((await (await f.call('/api/session', { session })).json()).user, null);
});

test('Cloudflare atomic attempts hold under concurrent requests and across sessions', async t => {
  const f = await fixture(t);
  const a = await f.login();
  const b = await f.login();
  assert.equal((await f.answer(a.session, 'not-a-number')).status, 422);
  assert.equal(f.DB.db.prepare('SELECT COUNT(*) AS n FROM attempts').get().n, 0);
  const results = await Promise.all(Array.from({ length: 24 }, (_, index) => f.answer(index % 2 ? a.session : b.session, '111')));
  assert.equal(results.filter(response => response.status === 200).length, 9);
  assert.equal(results.filter(response => response.status === 429).length, 15);
  const row = f.DB.db.prepare('SELECT * FROM attempts').get();
  assert.equal(row.failed, 10);
  assert.equal(row.locked_until, f.clock.value + LOCK_MS);
  assert.equal((await f.answer(a.session, '042')).status, 429);
  assert.equal((await f.answer(b.session, 'SCHNEE', 2)).status, 200);
  await f.call('/api/opened/2026/reset', { method: 'POST', body: { confirm: true }, session: a.session });
  assert.equal((await f.answer(a.session, '042')).status, 429);
  f.clock.value += LOCK_MS;
  const wrong = await (await f.answer(a.session, '111')).json();
  assert.equal(wrong.remainingAttempts, 9);
  const solved = await (await f.answer(b.session, '42')).json();
  assert.equal(solved.correct, true);
  assert.equal(solved.fragment, 'PRIVATE-REWARD');
  const states = await (await f.call('/api/puzzles', { session: a.session })).json();
  assert.equal(states.puzzles.find(door => door.day === 1).fragment, 'PRIVATE-REWARD');
});

test('Cloudflare progress sync, CSRF protection, export and atomic account deletion', async t => {
  const f = await fixture(t);
  const a = await f.login();
  const b = await f.login();
  assert.equal((await f.call('/api/opened/2026/1', { method: 'POST', body: {}, session: a.session, headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal((await f.call('/api/opened/2026/20', { method: 'POST', body: {}, session: a.session })).status, 404);
  await f.call('/api/opened/2026/1', { method: 'POST', body: {}, session: a.session });
  assert.deepEqual((await (await f.call('/api/puzzles', { session: b.session })).json()).opened, [1]);
  const exported = await (await f.call('/api/account/export', { session: a.session })).json();
  assert.equal(exported.discordId, '123456789012345678');
  assert.deepEqual(exported.opened, [{ year: 2026, day: 1 }]);
  assert.equal((await f.call('/api/account/delete', { method: 'POST', body: { confirm: true }, session: b.session })).status, 200);
  for (const table of ['users', 'sessions', 'attempts', 'solved', 'opened']) assert.equal(f.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal((await f.answer(a.session, '042')).status, 401);
});

test('Cloudflare scheduled and request-time deletion enforce the fixed February deadline', async t => {
  const f = await fixture(t);
  const { session } = await f.login();
  await f.answer(session, '042');
  f.clock.value = PARTICIPANT_DELETE_AT;
  await f.worker.scheduled({}, f.env);
  for (const table of ['users', 'sessions', 'oauth_states', 'attempts', 'solved', 'opened']) assert.equal(f.DB.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  assert.equal((await f.answer(session, '042')).status, 410);
  assert.equal((await (await f.call('/api/session')).json()).closed, true);
  assert.equal((await f.call('/api/auth/discord')).status, 410);
  assert.equal(f.DB.db.prepare('SELECT COUNT(*) AS n FROM calendar_config').get().n, 1);
});

test('Cloudflare missing credentials and provider faults do not enable unverified logins', async t => {
  const f = await fixture(t);
  delete f.env.DISCORD_CLIENT_SECRET;
  assert.equal((await (await f.call('/api/session')).json()).authEnabled, false);
  assert.equal((await f.call('/api/auth/discord')).status, 503);
  const response = await f.worker.fetch(new Request('https://wrong.example/api/session'), f.env);
  assert.equal(response.status, 421);
  assert.equal(f.DB.db.prepare('SELECT COUNT(*) AS n FROM users').get().n, 0);
});

test('Cloudflare asset ranges support seeking, suffixes, HEAD and invalid ranges', async () => {
  for (const [value, status, text] of [['bytes=2-4', 206, '234'], ['bytes=-2', 206, '89'], ['bytes=8-', 206, '89'], ['bytes=100-', 416, ''], ['bytes=0-1,4-5', 416, '']]) {
    const request = new Request('https://calendar.example/audio/file.mp3', { headers: { Range: value } });
    const response = await rangedAsset(request, new Response('0123456789', { headers: { 'Content-Length': '10' } }));
    assert.equal(response.status, status);
    assert.equal(await response.text(), text);
    assert.equal(response.headers.get('Accept-Ranges'), 'bytes');
  }
  const response = await rangedAsset(new Request('https://calendar.example/audio/file.mp3', { method: 'HEAD', headers: { Range: 'bytes=2-4' } }), new Response(null, { headers: { 'Content-Length': '10' } }));
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('Content-Length'), '3');
  assert.equal(await response.text(), '');
});
