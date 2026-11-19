import { createServer } from 'node:http';
import { readFile, mkdir, realpath, stat } from 'node:fs/promises';
import { resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CalendarStore, SESSION_MS, PARTICIPANT_DELETE_AT } from './store.mjs';
import { discordAuthorization, discordIdentity } from './discord.mjs';
import { isDoorUnlocked, validateConfig } from '../script.js';
import { selectReleasedContents, localImagePath } from '../tools/publish-doors.mjs';
import { privateAudioPath } from '../media.js';
import { sendFile } from '../tools/send-file.mjs';

const PUBLIC_FILES = new Set(['index.html', 'styles.css', 'script.js', 'theme.js', 'github-editor.js', 'text-format.js', 'puzzles.js', 'puzzle-client.js', 'media.js']);
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
function cookies(request) {
  return Object.fromEntries((request.headers.cookie || '').split(';').map(part => part.trim().split('=')).filter(pair => pair.length === 2));
}
function cookie(name, value, seconds, secure) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
}
async function jsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) fail(415, 'Bitte sende JSON.');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > 4096) fail(413, 'Die Eingabe ist zu groß.');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Ungültige Eingabe.');
    return value;
  } catch { fail(400, 'Ungültige Eingabe.'); }
}

export async function createCalendarServer({
  root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  contentDir = resolve(root, '.private-repository'), dataDir = resolve(root, '.calendar-data'),
  origin = 'http://127.0.0.1:4173', discord = {}, now = () => Date.now(), fetchDiscord = fetch,
  deleteAt = PARTICIPANT_DELETE_AT,
} = {}) {
  if (!Number.isFinite(deleteAt)) throw new Error('Ungültige Löschfrist.');
  const publicUrl = new URL(origin);
  if (publicUrl.origin !== origin || publicUrl.username || publicUrl.password || (publicUrl.protocol !== 'https:' && !['http://localhost', 'http://127.0.0.1', 'http://[::1]'].some(prefix => origin === prefix || origin.startsWith(prefix + ':')))) {
    throw new Error('PUBLIC_ORIGIN muss eine HTTPS-Origin ohne Pfad sein. HTTP ist nur für localhost erlaubt.');
  }
  const secure = publicUrl.protocol === 'https:';
  const SESSION_COOKIE = `${secure ? '__Host-' : ''}creeunity_session`;
  const STATE_COOKIE = `${secure ? '__Host-' : ''}creeunity_discord_state`;
  const discordConfig = { ...discord, redirectUri: `${origin}/api/auth/discord/callback` };
  const authEnabled = !!(discord.clientId && discord.clientSecret);
  const readCalendar = async () => {
    const config = validateConfig(JSON.parse(await readFile(resolve(contentDir, 'doors-data.json'), 'utf8')));
    if (config.doors.some(door => door.puzzle && typeof door.puzzle.answer !== 'string')) throw new Error('Der Server benötigt die private Kalenderdatei mit vollständigen Lösungen.');
    return config;
  };
  // Fail before listening if someone accidentally supplies a public manifest.
  await readCalendar();
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  const store = new CalendarStore(resolve(dataDir, 'calendar.sqlite'), { deleteAt });
  store.cleanup(now());
  const server = createServer(async (request, response) => {
    const headers = {
      'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob:; connect-src 'self' https://api.github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    };
    const send = (status, value, extra = {}) => {
      response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra });
      response.end(request.method === 'HEAD' ? undefined : JSON.stringify(value));
    };
    const redirect = (url, extra = {}) => { response.writeHead(303, { ...headers, Location: url, ...extra }); response.end(); };
    try {
      const url = new URL(request.url, origin);
      const pathname = decodeURIComponent(url.pathname);
      const time = now();
      if (time >= deleteAt) store.cleanup(time);
      const jar = cookies(request);
      const user = store.user(jar[SESSION_COOKIE], time);
      if (!['GET', 'HEAD', 'POST'].includes(request.method)) { send(405, { message: 'Methode nicht erlaubt.' }, { Allow: 'GET, HEAD, POST' }); return; }
      if (request.method === 'POST') {
        // Same-origin JSON + a custom header prevent login/logout and answer CSRF.
        if (request.headers.origin !== origin || request.headers['x-calendar-request'] !== '1') fail(403, 'Bitte verwende die Kalenderseite für diese Aktion.');
      }
      if (pathname === '/api/session' && request.method === 'GET') {
        send(200, { user: user ? { authenticated: true } : null, authEnabled: authEnabled && time < deleteAt, closed: time >= deleteAt, serverNow: time, deleteAt }); return;
      }
      if (pathname === '/api/auth/discord' && request.method === 'GET') {
        if (time >= deleteAt) fail(410, 'Die Teilnahme ist beendet. Die gespeicherten Teilnehmerdaten wurden gelöscht.');
        if (!authEnabled) fail(503, 'Die Discord-Anmeldung ist noch nicht eingerichtet.');
        const state = store.beginLogin(time);
        redirect(discordAuthorization(discordConfig, state), { 'Set-Cookie': cookie(STATE_COOKIE, state, 600, secure) }); return;
      }
      if (pathname === '/api/auth/discord/callback' && request.method === 'GET') {
        const clear = cookie(STATE_COOKIE, '', 0, secure);
        if (!authEnabled || !store.consumeLogin(url.searchParams.get('state'), jar[STATE_COOKIE], time)) {
          redirect('/?login=failed#kalender', { 'Set-Cookie': clear }); return;
        }
        if (url.searchParams.has('error')) { redirect('/?login=cancelled#kalender', { 'Set-Cookie': clear }); return; }
        const code = url.searchParams.get('code');
        if (!code || code.length > 2048) { redirect('/?login=failed#kalender', { 'Set-Cookie': clear }); return; }
        try {
          const identity = await discordIdentity(discordConfig, code, fetchDiscord);
          if (now() >= deleteAt) { store.cleanup(now()); redirect('/?login=expired#kalender', { 'Set-Cookie': clear }); return; }
          const token = store.login(identity, now());
          // Rotate the session on login; the limits remain bound to the user ID.
          store.logout(jar[SESSION_COOKIE]);
          redirect('/?login=success#kalender', { 'Set-Cookie': [clear, cookie(SESSION_COOKIE, token, Math.max(0, Math.floor((Math.min(now() + SESSION_MS, deleteAt) - now()) / 1000)), secure)] });
        } catch { redirect('/?login=failed#kalender', { 'Set-Cookie': clear }); }
        return;
      }
      if (pathname === '/api/logout' && request.method === 'POST') {
        await jsonBody(request);
        store.logout(jar[SESSION_COOKIE]);
        send(200, { user: null }, { 'Set-Cookie': cookie(SESSION_COOKIE, '', 0, secure) }); return;
      }
      if (pathname === '/api/account/export' && request.method === 'GET') {
        if (!user) fail(401, 'Bitte melde dich zuerst mit Discord an.');
        send(200, store.exportAccount(user.id), { 'Content-Disposition': 'attachment; filename="creeunity-meine-daten.json"' }); return;
      }
      if (pathname === '/api/account/delete' && request.method === 'POST') {
        if (!user) fail(401, 'Bitte melde dich zuerst mit Discord an.');
        const body = await jsonBody(request);
        if (body.confirm !== true) fail(400, 'Bitte bestätige die Löschung deiner Kalenderdaten.');
        store.deleteAccount(user.id);
        send(200, { deleted: true }, { 'Set-Cookie': [cookie(SESSION_COOKIE, '', 0, secure), cookie(STATE_COOKIE, '', 0, secure)] }); return;
      }
      if (pathname === '/api/puzzles' && request.method === 'GET') {
        if (!user) fail(401, 'Melde dich mit Discord an, um deine Lösung zu prüfen.');
        const config = await readCalendar();
        const statusTime = now();
        if (statusTime >= deleteAt) { store.cleanup(statusTime); fail(410, 'Die Teilnahme ist beendet.'); }
        if (!store.user(jar[SESSION_COOKIE], statusTime)) fail(401, 'Bitte melde dich erneut an.');
        const statuses = config.doors.filter(door => door.puzzle && isDoorUnlocked(door.day, config.year, new Date(statusTime)))
          .map(door => store.status(user.id, config.year, door, statusTime));
        const opened = store.opened(user.id, config.year).filter(day => isDoorUnlocked(day, config.year, new Date(statusTime)));
        send(200, { year: config.year, puzzles: statuses, opened, serverNow: statusTime }); return;
      }
      const openedPath = /^\/api\/opened\/(\d{4})\/(\d{1,2}|reset)$/.exec(pathname);
      if (openedPath && request.method === 'POST') {
        if (!user) fail(401, 'Bitte melde dich zuerst mit Discord an.');
        const body = await jsonBody(request);
        const config = await readCalendar();
        const openedTime = now();
        if (openedTime >= deleteAt) { store.cleanup(openedTime); fail(410, 'Die Teilnahme ist beendet.'); }
        if (!store.user(jar[SESSION_COOKIE], openedTime)) fail(401, 'Bitte melde dich erneut an.');
        if (Number(openedPath[1]) !== config.year) fail(404, 'Dieser Kalender ist nicht verfügbar.');
        if (openedPath[2] === 'reset') {
          if (body.confirm !== true) fail(400, 'Bitte bestätige das Zurücksetzen der geöffneten Türchen.');
          send(200, { year: config.year, opened: store.resetOpened(user.id, config.year) }); return;
        }
        const day = Number(openedPath[2]);
        if (!config.doors.some(door => door.day === day) || !isDoorUnlocked(day, config.year, new Date(openedTime))) fail(404, 'Dieses Türchen ist noch nicht verfügbar.');
        send(200, { year: config.year, opened: store.openDoor(user.id, config.year, day).filter(value => isDoorUnlocked(value, config.year, new Date(openedTime))) }); return;
      }
      const answerPath = /^\/api\/puzzles\/(\d{4})\/(\d{1,2})\/answer$/.exec(pathname);
      if (answerPath && request.method === 'POST') {
        if (!user) fail(401, 'Melde dich mit Discord an, um deine Lösung zu prüfen.');
        const body = await jsonBody(request);
        if (typeof body.answer !== 'string' || body.answer.length > 120) fail(422, 'Bitte gib eine gültige Lösung ein. Dieser Versuch zählt nicht.');
        const config = await readCalendar();
        const answerTime = now();
        if (answerTime >= deleteAt) { store.cleanup(answerTime); fail(410, 'Die Teilnahme ist beendet.'); }
        if (!store.user(jar[SESSION_COOKIE], answerTime)) fail(401, 'Bitte melde dich erneut an.');
        const day = Number(answerPath[2]);
        const door = config.doors.find(item => item.day === day);
        if (Number(answerPath[1]) !== config.year || !door?.puzzle || !isDoorUnlocked(day, config.year, new Date(answerTime))) fail(404, 'Dieses Rätsel ist noch nicht verfügbar.');
        const result = store.answer(user.id, config.year, door, body.answer, answerTime);
        send(result.lockedUntil ? 429 : 200, result, result.lockedUntil ? { 'Retry-After': String(Math.ceil((result.lockedUntil - answerTime) / 1000)) } : {});
        return;
      }
      if (pathname.startsWith('/api/')) fail(404, 'Nicht gefunden.');
      if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'Methode nicht erlaubt.');
      if (pathname === '/healthz') { send(200, { ok: true }); return; }
      if (pathname === '/doors-data.json') { send(200, selectReleasedContents(await readCalendar(), new Date(time))); return; }
      let file;
      let allowedRoot = root;
      if (PUBLIC_FILES.has(pathname.slice(1)) || pathname === '/') file = resolve(root, pathname === '/' ? 'index.html' : pathname.slice(1));
      else if (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..')) {
        const dated = /^\/assets\/released\/(\d{4})\/day-(\d{2})-/.exec(pathname);
        if (dated && !isDoorUnlocked(Number(dated[2]), Number(dated[1]), new Date(time))) fail(404, 'Nicht gefunden.');
        file = resolve(root, `.${pathname}`);
        allowedRoot = resolve(root, 'assets');
      } else if (/^\/images\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..')) {
        const config = await readCalendar();
        if (!config.doors.some(door => isDoorUnlocked(door.day, config.year, new Date(time)) && /^(?:\.\/)?images\//.test(door.image) && `/${localImagePath(door.image)}` === pathname)) fail(404, 'Nicht gefunden.');
        file = resolve(contentDir, `.${pathname}`);
        allowedRoot = resolve(contentDir, 'images');
      } else if (/^\/audio\/[a-zA-Z0-9_./-]+$/.test(pathname) && !pathname.split('/').includes('..')) {
        const config = await readCalendar();
        if (!config.doors.some(door => door.audio && isDoorUnlocked(door.day, config.year, new Date(time)) && /^(?:\.\/)?audio\//.test(door.audio) && `/${privateAudioPath(door.audio)}` === pathname)) fail(404, 'Nicht gefunden.');
        file = resolve(contentDir, `.${pathname}`);
        allowedRoot = resolve(contentDir, 'audio');
      } else fail(404, 'Nicht gefunden.');
      const actualRoot = await realpath(allowedRoot);
      const actualFile = await realpath(file);
      if (!actualFile.startsWith(actualRoot + sep) || !(await stat(actualFile)).isFile()) fail(404, 'Nicht gefunden.');
      await sendFile(request, response, actualFile, headers);
    } catch (error) {
      const status = error.status || (error.code === 'ENOENT' || error instanceof URIError ? 404 : 503);
      // Never return or log provider tokens, answers, private paths or SQL errors.
      if (!response.headersSent) send(status, { message: error.status ? error.message : status === 404 ? 'Nicht gefunden.' : 'Gerade nicht verfügbar. Dein Versuch wurde nicht gezählt.' });
      else response.end();
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  const cleanupTimer = setInterval(() => {
    try { store.cleanup(now()); }
    catch { console.error('Automatische Datenbereinigung fehlgeschlagen. Serverbetrieb prüfen.'); }
  }, 60000);
  cleanupTimer.unref();
  server.on('close', () => { clearInterval(cleanupTimer); store.close(); });
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 4173);
  const production = process.env.NODE_ENV === 'production';
  if (production && (!process.env.PUBLIC_ORIGIN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET)) {
    throw new Error('PUBLIC_ORIGIN, DISCORD_CLIENT_ID und DISCORD_CLIENT_SECRET fehlen für den Produktivbetrieb.');
  }
  if (production && !process.env.PUBLIC_ORIGIN.startsWith('https://')) throw new Error('Der Produktivbetrieb benötigt eine HTTPS-Adresse.');
  const server = await createCalendarServer({
    contentDir: resolve(process.env.PRIVATE_CALENDAR_DIR || '.private-repository'),
    dataDir: resolve(process.env.CALENDAR_DATA_DIR || '.calendar-data'),
    origin: process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${port}`,
    discord: { clientId: process.env.DISCORD_CLIENT_ID, clientSecret: process.env.DISCORD_CLIENT_SECRET },
    deleteAt: process.env.PARTICIPANT_DELETE_AT ? Date.parse(process.env.PARTICIPANT_DELETE_AT) : PARTICIPANT_DELETE_AT,
  });
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Kalenderserver gestartet. Port ${port}.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
}
