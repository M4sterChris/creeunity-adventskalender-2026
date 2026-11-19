import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { once } from 'node:events';
import { createCalendarServer } from '../server/app.mjs';
import { LOCK_MS, SESSION_MS, PARTICIPANT_DELETE_AT, CalendarStore } from '../server/store.mjs';
import { DatabaseSync } from 'node:sqlite';
import { CalendarAPI, attemptMessage } from '../puzzle-client.js';

const example = JSON.parse(await readFile(new URL('../examples/doors-data.example.json', import.meta.url), 'utf8'));
const ORIGIN = 'http://127.0.0.1:4173';
async function fixture(t, { publicOrigin = ORIGIN } = {}) {
  const qa = resolve('.qa'); await mkdir(qa, { recursive: true });
  const dir = await mkdtemp(resolve(qa, 'server-test-'));
  const contentDir = resolve(dir, 'private');
  const dataDir = resolve(dir, 'data');
  await mkdir(resolve(contentDir, 'images'), { recursive: true });
  const config = structuredClone(example);
  config.doors[0].puzzle = { type: 'number', answer: '042', fragment: 'GEHEIME-BELOHNUNG' };
  config.doors[1].puzzle = { type: 'letters', answer: 'CREEPER' };
  config.doors[2].puzzle = { type: 'number', answer: '999', fragment: 'ZUKUNFT' };
  config.doors[2].image = './images/future.svg';
  await writeFile(resolve(contentDir, 'images/future.svg'), '<svg>NICHT FREIGEGEBEN</svg>');
  const configFile = resolve(contentDir, 'doors-data.json');
  await writeFile(configFile, JSON.stringify(config));
  const clock = { value: Date.parse('2026-12-02T12:00:00Z') };
  let discordId = '123456789012345678';
  let providerFails = false;
  const options = { contentDir, dataDir, origin: publicOrigin, now: () => clock.value,
    discord: { clientId: 'test-client', clientSecret: 'test-secret' },
    fetchDiscord: async (url, init) => {
      if (providerFails) return new Response('{}', { status: 503 });
      if (url.endsWith('/oauth2/token')) {
        assert.equal(init.headers['Content-Type'], 'application/x-www-form-urlencoded');
        assert.equal(init.body.get('grant_type'), 'authorization_code');
        return Response.json({ access_token: 'mock-discord-token', token_type: 'Bearer' });
      }
      assert.equal(url, 'https://discord.com/api/v10/users/@me');
      assert.equal(init.headers.Authorization, 'Bearer mock-discord-token');
      return Response.json({ id: discordId, username: 'test-creeper', global_name: 'Test Creeper' });
    },
  };
  let server;
  let base;
  async function start() {
    server = await createCalendarServer(options);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    base = `http://127.0.0.1:${server.address().port}`;
  }
  async function stop() { await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose())); }
  await start();
  t.after(async () => {
    await stop();
    if (!dir.startsWith(qa + sep)) throw new Error('Ungültiges Testverzeichnis');
    await rm(dir, { recursive: true, force: true });
  });
  const get = (route, cookie = '') => fetch(base + route, { headers: { Cookie: cookie }, redirect: 'manual' });
  const post = (route, body, cookie = '', origin = publicOrigin) => fetch(base + route, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', 'X-Calendar-Request': '1', Cookie: cookie }, body: JSON.stringify(body), redirect: 'manual' });
  const begin = async () => {
    const response = await get('/api/auth/discord');
    assert.equal(response.status, 303);
    const url = new URL(response.headers.get('location'));
    assert.equal(url.origin, 'https://discord.com');
    assert.equal(url.searchParams.get('scope'), 'identify');
    assert.equal(url.searchParams.get('response_type'), 'code');
    return { state: url.searchParams.get('state'), cookie: response.headers.getSetCookie()[0].split(';')[0] };
  };
  const finish = login => get(`/api/auth/discord/callback?state=${login.state}&code=test-code`, login.cookie);
  const login = async (id = '123456789012345678') => {
    discordId = id;
    const response = await finish(await begin());
    assert.equal(response.headers.get('location'), '/?login=success#kalender');
    const raw = response.headers.getSetCookie().find(value => value.includes('creeunity_session='));
    assert.match(raw, /HttpOnly; SameSite=Lax/);
    assert.match(raw, /Max-Age=/);
    return raw.split(';')[0];
  };
  return { get, post, begin, finish, login, clock, config, configFile, dataDir,
    restart: async () => { await stop(); await start(); },
    providerFail: () => { providerFails = true; },
  };
}
const answer = (f, cookie, value = '100', day = 1) => f.post(`/api/puzzles/2026/${day}/answer`, { answer: value }, cookie);

test('10 Fehlversuche sperren exakt 15 Minuten, ohne Verlängerung durch weitere Eingaben', async t => {
  const f = await fixture(t); const cookie = await f.login();
  for (let index = 1; index <= 9; index++) {
    const response = await answer(f, cookie);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.remainingAttempts, 10 - index);
    assert.equal(result.lockedUntil, 0);
    assert.equal(result.fragment, undefined);
  }
  const tenth = await answer(f, cookie);
  assert.equal(tenth.status, 429); assert.equal(tenth.headers.get('retry-after'), '900');
  const locked = await tenth.json();
  assert.equal(locked.lockedUntil, f.clock.value + LOCK_MS);
  assert.equal(locked.remainingAttempts, 0);
  f.clock.value += LOCK_MS - 1;
  const tooEarly = await answer(f, cookie, '042');
  assert.equal(tooEarly.status, 429);
  assert.equal((await tooEarly.json()).lockedUntil, locked.lockedUntil);
  f.clock.value++;
  const statuses = await (await f.get('/api/puzzles', cookie)).json();
  assert.equal(statuses.puzzles[0].remainingAttempts, 10);
  const newWrong = await (await answer(f, cookie)).json();
  assert.equal(newWrong.remainingAttempts, 9); assert.equal(newWrong.lockedUntil, 0);
  const correct = await (await answer(f, cookie, '42')).json();
  assert.equal(correct.correct, true); assert.equal(correct.fragment, 'GEHEIME-BELOHNUNG');
});

test('Andere Türchen und andere Discord-Konten haben eigene Versuche', async t => {
  const f = await fixture(t); const first = await f.login();
  for (let i = 0; i < 10; i++) await answer(f, first);
  const otherDay = await (await answer(f, first, ' cree per ', 2)).json();
  assert.equal(otherDay.correct, true); assert.equal(otherDay.fragment, 'CREEPER');
  const second = await f.login('999999999999999999');
  const otherAccount = await (await answer(f, second)).json();
  assert.equal(otherAccount.remainingAttempts, 9);
});
test('Audio-Player kann freigegebene Dateien vorspulen; zukünftiges Audio bleibt auch bei Range-Anfragen gesperrt',async t=>{
  const f=await fixture(t);
  const contentDir=resolve(f.configFile,'..');
  await mkdir(resolve(contentDir,'audio'));
  f.config.doors[0].audio='./audio/tag1.mp3';f.config.doors[2].audio='./audio/tag3.mp3';
  await writeFile(resolve(contentDir,'audio/tag1.mp3'),'ID3abcdefghijklmnop');
  await writeFile(resolve(contentDir,'audio/tag3.mp3'),'ID3ZUKUNFT');
  await writeFile(f.configFile,JSON.stringify(f.config));
  const response=await f.get('/audio/tag1.mp3');
  assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'audio/mpeg');assert.equal(response.headers.get('accept-ranges'),'bytes');
  const base=new URL(response.url).origin;
  const part=await fetch(base+'/audio/tag1.mp3',{headers:{Range:'bytes=3-6'}});
  assert.equal(part.status,206);assert.equal(await part.text(),'abcd');assert.equal(part.headers.get('content-range'),'bytes 3-6/19');
  const future=await fetch(base+'/audio/tag3.mp3',{headers:{Range:'bytes=0-2'}});assert.equal(future.status,404);
  assert.equal((await f.get('/audio/unreferenziert.mp3')).status,404);
  assert.equal((await fetch(base+'/audio/tag1.mp3',{headers:{Range:'bytes=99-'}})).status,416);
});

test('Logout, neue Sitzung, anderer Browser und Serverneustart setzen Sperren nicht zurück', async t => {
  const f = await fixture(t); const cookie = await f.login();
  for (let i = 0; i < 10; i++) await answer(f, cookie);
  await f.post('/api/logout', {}, cookie);
  assert.equal((await answer(f, cookie)).status, 401);
  const secondSession = await f.login();
  assert.equal((await answer(f, secondSession, '042')).status, 429);
  await f.restart();
  assert.equal((await answer(f, secondSession, '042')).status, 429);
  const anotherBrowser = await f.login();
  assert.equal((await answer(f, anotherBrowser, '042')).status, 429);
});

test('Parallele Anfragen können weder mehr als zehn Versuche erhalten noch die Sperre verlängern', async t => {
  const f = await fixture(t); const cookie = await f.login();
  const responses = await Promise.all(Array.from({ length: 25 }, () => answer(f, cookie)));
  assert.equal(responses.filter(response => response.status === 200).length, 9);
  const locked = await Promise.all(responses.filter(response => response.status === 429).map(response => response.json()));
  assert.equal(locked.length, 16);
  assert.ok(locked.every(result => result.lockedUntil === f.clock.value + LOCK_MS && result.remainingAttempts === 0));
});

test('Leere/ungültige Eingaben, CSRF, fehlende Anmeldung und technische Fehler verbrauchen keine Versuche', async t => {
  const f = await fixture(t); const cookie = await f.login();
  assert.equal((await answer(f, '')).status, 401);
  assert.equal((await answer(f, cookie, '')).status, 422);
  assert.equal((await answer(f, cookie, 'keine Zahl')).status, 422);
  assert.equal((await f.post('/api/puzzles/2026/1/answer', { answer: '100' }, cookie, 'https://fremd.example')).status, 403);
  const source = await readFile(f.configFile, 'utf8');
  await writeFile(f.configFile, 'unvollständige Datei');
  assert.equal((await answer(f, cookie)).status, 503);
  await writeFile(f.configFile, source);
  assert.equal((await (await f.get('/api/puzzles', cookie)).json()).puzzles[0].remainingAttempts, 10);
});

test('Zukünftige Tage, fremde Jahre, Lösungen und Prüfwerte bleiben serverseitig geschützt', async t => {
  const f = await fixture(t); const cookie = await f.login();
  const publicConfig = await (await f.get('/doors-data.json')).json();
  assert.deepEqual(publicConfig.doors[0].puzzle, { type: 'number', serverOnly: true });
  assert.doesNotMatch(JSON.stringify(publicConfig), /answerHash|fragment|GEHEIME-BELOHNUNG|ZUKUNFT/);
  assert.equal(publicConfig.doors[2].puzzle, undefined);
  assert.equal((await answer(f, cookie, '999', 3)).status, 404);
  assert.equal((await f.post('/api/puzzles/2025/1/answer', { answer: '042' }, cookie)).status, 404);
  for (const route of ['/images/future.svg', '/.env', '/.git/config', '/server/app.mjs', '/.calendar-data/calendar.sqlite', '/output/Finale%20T%C3%BCrchen/Adventskalender%202026.xlsx']) assert.equal((await f.get(route)).status, 404, route);
  assert.equal((await f.get('/puzzle-client.js')).status, 200);
});

test('Discord-Callback erfordert gebundenen, einmaligen State; fehlgeschlagene Anmeldung zählt nicht', async t => {
  const f = await fixture(t);
  const attempt = await f.begin();
  const forged = await f.finish({ ...attempt, cookie: '' });
  assert.equal(forged.headers.get('location'), '/?login=failed#kalender');
  assert.ok(!forged.headers.getSetCookie().some(value => value.startsWith('creeunity_session=')));
  assert.equal((await f.finish(attempt)).headers.get('location'), '/?login=success#kalender');
  assert.equal((await f.finish(attempt)).headers.get('location'), '/?login=failed#kalender');
  const expired = await f.begin(); f.clock.value += 600001;
  assert.equal((await f.finish(expired)).headers.get('location'), '/?login=failed#kalender');
  f.providerFail();
  assert.equal((await f.finish(await f.begin())).headers.get('location'), '/?login=failed#kalender');
});

test('Gelöste Rätsel werden wiederhergestellt; eine geänderte Lösung entwertet den alten Erfolg', async t => {
  const f = await fixture(t); const cookie = await f.login();
  assert.equal((await (await answer(f, cookie, '042')).json()).correct, true);
  await f.restart();
  const solved = await (await f.get('/api/puzzles', cookie)).json();
  assert.equal(solved.puzzles[0].fragment, 'GEHEIME-BELOHNUNG');
  assert.equal((await (await answer(f, cookie, '100')).json()).correct, true);
  f.config.doors[0].puzzle.answer = '043';
  await writeFile(f.configFile, JSON.stringify(f.config));
  const changed = await (await f.get('/api/puzzles', cookie)).json();
  assert.equal(changed.puzzles[0].solved, false); assert.equal(changed.puzzles[0].fragment, undefined);
});

test('HTTPS-Cookies sind Secure, HttpOnly, hostgebunden und werden beim Logout gelöscht', async t => {
  const f = await fixture(t, { publicOrigin: 'https://advent.example.org' });
  const initial = await f.get('/api/auth/discord');
  assert.match(initial.headers.getSetCookie()[0], /^__Host-creeunity_discord_state=/);
  assert.match(initial.headers.getSetCookie()[0], /Path=\/; HttpOnly; SameSite=Lax; Max-Age=600; Secure/);
  assert.equal(new URL(initial.headers.get('location')).searchParams.get('redirect_uri'), 'https://advent.example.org/api/auth/discord/callback');
  const cookie = await f.login();
  assert.match(cookie, /^__Host-creeunity_session=/);
  const logout = await f.post('/api/logout', {}, cookie);
  assert.match(logout.headers.getSetCookie()[0], /Max-Age=0; Secure/);
  assert.equal((await f.get('/api/session', cookie).then(response => response.json())).user, null);
});

test('Discord-Abbruch erteilt keine Sitzung und verbraucht den State', async t => {
  const f = await fixture(t);
  const start = await f.begin();
  const denied = await f.get(`/api/auth/discord/callback?state=${start.state}&error=access_denied`, start.cookie);
  assert.equal(denied.headers.get('location'), '/?login=cancelled#kalender');
  assert.ok(denied.headers.getSetCookie().every(value => !value.includes('creeunity_session=')));
  assert.equal((await f.finish(start)).headers.get('location'), '/?login=failed#kalender');
});

test('Eine Sitzung bleibt 14 Tage gültig und erfordert danach eine neue Anmeldung', async t => {
  const f = await fixture(t); const cookie = await f.login();
  f.clock.value += SESSION_MS - 1;
  assert.equal((await f.get('/api/session', cookie).then(response => response.json())).user.authenticated, true);
  f.clock.value++;
  assert.equal((await answer(f, cookie)).status, 401);
});

test('Es werden nur die Discord-ID und technische Kontodaten gespeichert, keine Profilnamen oder Rohsitzungsschlüssel', async t => {
  const f = await fixture(t); const cookie = await f.login();
  const session = await (await f.get('/api/session', cookie)).json();
  assert.deepEqual(session.user, { authenticated: true });
  assert.equal(session.deleteAt, PARTICIPANT_DELETE_AT);
  const db = new DatabaseSync(resolve(f.dataDir, 'calendar.sqlite'), { readOnly: true });
  try {
    assert.deepEqual(db.prepare('PRAGMA table_info(users)').all().map(column => column.name), ['id']);
    assert.equal(db.prepare('SELECT id FROM users').get().id, '123456789012345678');
    const saved = db.prepare('SELECT hash, expires FROM sessions').get();
    assert.notEqual(saved.hash, cookie.split('=')[1]);
    assert.equal(saved.expires, f.clock.value + 14 * 24 * 60 * 60 * 1000);
  } finally { db.close(); }
});

test('Datenauskunft und Löschung sind auf das angemeldete Konto beschränkt und löschen alle seine Sitzungen', async t => {
  const f = await fixture(t); const first = await f.login(); const anotherSession = await f.login();
  const second = await f.login('999999999999999999');
  await answer(f, first, '042'); await answer(f, first, 'falsch', 2);
  await answer(f, second, '042');
  await f.post('/api/opened/2026/1', {}, first);
  await f.post('/api/opened/2026/2', {}, second);
  assert.equal((await f.get('/api/account/export')).status, 401);
  const exported = await (await f.get('/api/account/export?userId=999999999999999999', first)).json();
  assert.equal(exported.discordId, '123456789012345678');
  assert.deepEqual(exported.solved, [{ year: 2026, day: 1 }]);
  assert.deepEqual(exported.opened, [{ year: 2026, day: 1 }]);
  assert.equal(exported.attempts[0].failedAttempts, 1);
  assert.doesNotMatch(JSON.stringify(exported), /mock-discord-token|test-creeper|Test Creeper|hash|identity/);
  assert.equal((await f.post('/api/account/delete', {}, first)).status, 400);
  assert.equal((await f.post('/api/account/delete', { confirm: true }, first, 'https://fremd.example')).status, 403);
  const deleted = await f.post('/api/account/delete', { confirm: true, userId: '999999999999999999' }, first);
  assert.equal(deleted.status, 200);
  assert.ok(deleted.headers.getSetCookie().every(value => value.includes('Max-Age=0')));
  assert.equal((await f.get('/api/account/export', first)).status, 401);
  assert.equal((await f.get('/api/account/export', anotherSession)).status, 401);
  const remaining = await (await f.get('/api/account/export', second)).json();
  assert.equal(remaining.discordId, '999999999999999999');
  assert.equal(remaining.solved.length, 1);
  assert.deepEqual(remaining.opened, [{ year: 2026, day: 2 }]);
});

test('Am 1. Februar 2027 Berliner Zeit werden Teilnehmerdaten gelöscht und keine neuen Anmeldungen erlaubt', async t => {
  const f = await fixture(t); const cookie = await f.login();
  await answer(f, cookie, '042');
  await f.post('/api/opened/2026/1', {}, cookie);
  f.clock.value = PARTICIPANT_DELETE_AT - 1000;
  const start = await f.begin();
  const lastLogin = await f.finish(start);
  assert.match(lastLogin.headers.getSetCookie().find(value => value.includes('creeunity_session=')), /Max-Age=1(?:;|$)/);
  f.clock.value = PARTICIPANT_DELETE_AT;
  const session = await (await f.get('/api/session', cookie)).json();
  assert.equal(session.user, null); assert.equal(session.closed, true); assert.equal(session.authEnabled, false);
  assert.equal((await f.get('/api/auth/discord')).status, 410);
  assert.equal((await f.get('/api/account/export', cookie)).status, 401);
  const db = new DatabaseSync(resolve(f.dataDir, 'calendar.sqlite'), { readOnly: true });
  try {
    for (const table of ['users','sessions','oauth_states','attempts','solved','opened']) assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
  } finally { db.close(); }
  await f.restart();
  assert.equal((await f.get('/api/auth/discord')).status, 410);
});

test('Eine alte lokale Datenbank verliert die Namensspalte und erhält die bestehenden Konten', async t => {
  const f = await fixture(t); const file = resolve(f.dataDir, 'legacy.sqlite');
  const legacy = new DatabaseSync(file);
  legacy.exec('CREATE TABLE users (id TEXT PRIMARY KEY, name TEXT NOT NULL)');
  legacy.prepare('INSERT INTO users VALUES (?, ?)').run('123456789012345678', 'Alter Profilname');
  legacy.close();
  const upgraded = new CalendarStore(file);
  try {
    assert.deepEqual(upgraded.db.prepare('PRAGMA table_info(users)').all().map(column => column.name), ['id']);
    assert.equal(upgraded.db.prepare('SELECT id FROM users').get().id, '123456789012345678');
  } finally { upgraded.close(); }
  assert.ok(!(await readFile(file)).includes(Buffer.from('Alter Profilname')));
});

test('Client zeigt Restversuche und einen nicht negativen Countdown an', () => {
  assert.match(attemptMessage({ remainingAttempts: 9, lockedUntil: 0 }, 1000), /9 von 10/);
  assert.match(attemptMessage({ remainingAttempts: 0, lockedUntil: 901000 }, 1000), /15:00/);
  assert.match(attemptMessage({ remainingAttempts: 0, lockedUntil: 901000 }, 901000), /10 von 10/);
});

test('Geöffnete Türchen bleiben in neuer Sitzung und nach Serverneustart erhalten', async t => {
  const f = await fixture(t); const first = await f.login();
  const paths = [1,2,1,2,1].map(day => `/api/opened/2026/${day}`);
  const writes = await Promise.all(paths.map(path => f.post(path, {}, first)));
  assert.ok(writes.every(response => response.status === 200));
  const newBrowser = await f.login();
  assert.deepEqual((await (await f.get('/api/puzzles', newBrowser)).json()).opened, [1,2]);
  await f.restart();
  assert.deepEqual((await (await f.get('/api/puzzles', newBrowser)).json()).opened, [1,2]);
});

test('Öffnen braucht eine Anmeldung, richtige Origin und einen freigegebenen Tag im richtigen Jahr', async t => {
  const f = await fixture(t); const cookie = await f.login();
  assert.equal((await f.post('/api/opened/2026/1', {})).status, 401);
  assert.equal((await f.post('/api/opened/2026/1', {}, cookie, 'https://fremd.example')).status, 403);
  for (const path of ['/api/opened/2025/1','/api/opened/2026/0','/api/opened/2026/25','/api/opened/2026/3']) assert.equal((await f.post(path, {}, cookie)).status, 404, path);
  assert.deepEqual((await (await f.get('/api/puzzles', cookie)).json()).opened, []);
  f.clock.value = Date.parse('2026-12-04T12:00:00Z');
  assert.equal((await f.post('/api/opened/2026/4', {}, cookie)).status, 200);
  assert.deepEqual((await (await f.get('/api/puzzles', cookie)).json()).opened, [4]);
});

test('Zurücksetzen von Öffnungen betrifft nur das eigene Konto und erhält Lösungen und Sperren', async t => {
  const f = await fixture(t); const first = await f.login(); const second = await f.login('999999999999999999');
  await f.post('/api/opened/2026/1', { userId:'999999999999999999' }, first);
  await f.post('/api/opened/2026/2', {}, second);
  await answer(f, first, 'CREEPER', 2);
  for (let i=0; i<10; i++) await answer(f, first);
  assert.equal((await f.post('/api/opened/2026/reset', {}, first)).status, 400);
  assert.equal((await f.post('/api/opened/2026/reset', {confirm:true}, first, 'https://fremd.example')).status, 403);
  assert.deepEqual((await (await f.get('/api/puzzles', first)).json()).opened, [1]);
  assert.deepEqual((await (await f.get('/api/puzzles', second)).json()).opened, [2]);
  const reset = await f.post('/api/opened/2026/reset', {confirm:true,userId:'999999999999999999'}, first);
  assert.equal(reset.status, 200);
  const progress = await (await f.get('/api/puzzles', first)).json();
  assert.deepEqual(progress.opened, []);
  assert.equal(progress.puzzles[1].solved, true);
  assert.equal(progress.puzzles[0].remainingAttempts, 0);
  assert.ok(progress.puzzles[0].lockedUntil > f.clock.value);
  assert.deepEqual((await (await f.get('/api/puzzles', second)).json()).opened, [2]);
});

test('API-Client behandelt eine Rätselsperre als Status und technische Fehler als Fehler', async () => {
  const client = new CalendarAPI(async (_url, init) => {
    assert.equal(init.headers['X-Calendar-Request'], '1');
    assert.equal(init.credentials, 'same-origin');
    return Response.json({ lockedUntil: 1000, remainingAttempts: 0 }, { status: 429 });
  });
  assert.equal((await client.answer(2026, 1, '123')).lockedUntil, 1000);
  const broken = new CalendarAPI(async () => Response.json({ message: 'Nicht verfügbar.' }, { status: 503 }));
  await assert.rejects(broken.session(), /Nicht verfügbar/);
});

test('Browser-fetch wird ohne den API-Client als Aufrufkontext ausgeführt', async () => {
  const client = new CalendarAPI(function () {
    assert.equal(this, undefined);
    return Promise.resolve(Response.json({ user: null }));
  });
  await client.session();
});
