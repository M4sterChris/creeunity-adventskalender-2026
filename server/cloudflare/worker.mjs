import { validateConfig, isConfigDoorUnlocked, isDoorUnlocked } from '../../script.js';
import { selectReleasedContents } from '../../tools/released-calendar.mjs';
import { discordAuthorization, discordIdentity } from '../discord.mjs';
import { SESSION_MS, PARTICIPANT_DELETE_AT } from '../policy.mjs';
import { D1CalendarStore } from './store.mjs';
import { rangedAsset } from './range.mjs';

const PUBLIC_FILES = new Set(['/', '/index.html', '/styles.css', '/script.js', '/theme.js', '/github-editor.js', '/text-format.js', '/puzzles.js', '/puzzle-client.js', '/media.js']);
const SECURITY = {
  'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: blob:; connect-src 'self' https://api.github.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }
const cookie = (name, value, seconds, secure) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
function cookieJar(request) {
  return Object.fromEntries((request.headers.get('Cookie') || '').split(';').map(part => part.trim().split('=')).filter(pair => pair.length === 2));
}
async function jsonBody(request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') || '')) fail(415, 'Bitte sende JSON.');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'Ungültige Eingabe.');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 4096) { await reader.cancel(); fail(413, 'Die Eingabe ist zu groß.'); }
    chunks.push(value);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, 'Ungültige Eingabe.');
    return value;
  } catch { fail(400, 'Ungültige Eingabe.'); }
}

export function createWorker({ now = () => Date.now(), fetchDiscord = fetch } = {}) {
  return {
    async fetch(request, env) {
      const send = (status, body, extra = {}) => new Response(request.method === 'HEAD' ? null : JSON.stringify(body), {
        status, headers: { ...SECURITY, 'Content-Type': 'application/json; charset=utf-8', ...extra },
      });
      const redirect = (location, values = []) => {
        const headers = new Headers({ ...SECURITY, Location: location });
        for (const value of values) headers.append('Set-Cookie', value);
        return new Response(null, { status: 303, headers });
      };
      try {
        const url = new URL(request.url);
        const origin = env.PUBLIC_ORIGIN;
        const configured = new URL(origin);
        if (configured.origin !== origin || configured.username || configured.password ||
          (configured.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(configured.hostname))) throw new Error('Invalid origin');
        if (url.origin !== origin) fail(421, 'Bitte verwende die Kalenderadresse.');
        const path = decodeURIComponent(url.pathname);
        const secure = configured.protocol === 'https:';
        const sessionName = `${secure ? '__Host-' : ''}creeunity_session`;
        const stateName = `${secure ? '__Host-' : ''}creeunity_discord_state`;
        const jar = cookieJar(request);
        const time = now();
        // Fixed policy deadline is intentionally not browser- or URL-configurable.
        const store = new D1CalendarStore(env.DB);
        const checkTime = async () => {
          const current = now();
          if (current >= PARTICIPANT_DELETE_AT) {
            await store.cleanup(current);
            fail(410, 'Die Teilnahme ist beendet. Die gespeicherten Teilnehmerdaten wurden gelöscht.');
          }
          return current;
        };
        if (time >= PARTICIPANT_DELETE_AT) await store.cleanup(time);
        const authEnabled = !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET) && time < PARTICIPANT_DELETE_AT;
        const discord = { clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET, redirectUri: `${origin}/api/auth/discord/callback` };
        const readCalendar = async () => {
          const config = validateConfig(await store.readCalendar());
          if (config.doors.some(door => door.puzzle && typeof door.puzzle.answer !== 'string')) throw new Error('Private calendar required');
          return config;
        };
        const requireUser = async () => {
          const current = await checkTime();
          const user = await store.user(jar[sessionName], current);
          if (!user) fail(401, 'Bitte melde dich zuerst mit Discord an.');
          return user;
        };
        if (!['GET', 'HEAD', 'POST'].includes(request.method)) return send(405, { message: 'Methode nicht erlaubt.' }, { Allow: 'GET, HEAD, POST' });
        if (request.method === 'POST' && (request.headers.get('Origin') !== origin || request.headers.get('X-Calendar-Request') !== '1')) fail(403, 'Bitte verwende die Kalenderseite für diese Aktion.');

        if (path === '/healthz' && request.method === 'GET') {
          // Verifies binding and private contents without returning any records.
          await readCalendar();
          return send(200, { ok: true, authEnabled });
        }
        if (path === '/api/session' && request.method === 'GET') {
          const user = await store.user(jar[sessionName], time);
          return send(200, { user: user ? { authenticated: true } : null, authEnabled, closed: time >= PARTICIPANT_DELETE_AT, serverNow: time, deleteAt: PARTICIPANT_DELETE_AT });
        }
        if (path === '/api/auth/discord' && request.method === 'GET') {
          await checkTime();
          if (!authEnabled) fail(503, 'Die Discord-Anmeldung ist noch nicht eingerichtet.');
          const state = await store.beginLogin(time);
          return redirect(discordAuthorization(discord, state), [cookie(stateName, state, 600, secure)]);
        }
        if (path === '/api/auth/discord/callback' && request.method === 'GET') {
          const clear = cookie(stateName, '', 0, secure);
          if (!authEnabled || !await store.consumeLogin(url.searchParams.get('state'), jar[stateName], time)) return redirect('/?login=failed#kalender', [clear]);
          if (url.searchParams.has('error')) return redirect('/?login=cancelled#kalender', [clear]);
          const code = url.searchParams.get('code');
          if (!code || code.length > 2048) return redirect('/?login=failed#kalender', [clear]);
          try {
            const identity = await discordIdentity(discord, code, fetchDiscord);
            const loginTime = await checkTime();
            const session = await store.login(identity, loginTime, jar[sessionName]);
            await checkTime();
            return redirect('/?login=success#kalender', [clear, cookie(sessionName, session, Math.max(0, Math.floor((Math.min(loginTime + SESSION_MS, PARTICIPANT_DELETE_AT) - loginTime) / 1000)), secure)]);
          } catch { return redirect(`/?login=${now() >= PARTICIPANT_DELETE_AT ? 'expired' : 'failed'}#kalender`, [clear]); }
        }
        if (path === '/api/logout' && request.method === 'POST') {
          await jsonBody(request);
          await store.logout(jar[sessionName]);
          return send(200, { user: null }, { 'Set-Cookie': cookie(sessionName, '', 0, secure) });
        }
        if (path === '/api/account/export' && request.method === 'GET') {
          const user = await requireUser();
          const result = await store.exportAccount(user.id, jar[sessionName], await checkTime());
          await checkTime();
          return send(200, result, { 'Content-Disposition': 'attachment; filename="creeunity-meine-daten.json"' });
        }
        if (path === '/api/account/delete' && request.method === 'POST') {
          const body = await jsonBody(request);
          const user = await requireUser();
          if (body.confirm !== true) fail(400, 'Bitte bestätige die Löschung deiner Kalenderdaten.');
          await store.deleteAccount(user.id, jar[sessionName], await checkTime());
          const response = send(200, { deleted: true });
          response.headers.append('Set-Cookie', cookie(sessionName, '', 0, secure));
          response.headers.append('Set-Cookie', cookie(stateName, '', 0, secure));
          return response;
        }
        if (path === '/api/puzzles' && request.method === 'GET') {
          const user = await requireUser();
          const config = await readCalendar();
          const current = await checkTime();
          const doors = config.doors.filter(door => door.puzzle && isConfigDoorUnlocked(door.day, config, new Date(current)));
          const puzzles = await store.statuses(user.id, config.year, doors, jar[sessionName], current);
          const opened = (await store.opened(user.id, config.year)).filter(day => isConfigDoorUnlocked(day, config, new Date(current)));
          await requireUser();
          return send(200, { year: config.year, puzzles, opened, serverNow: current });
        }
        const openedPath = /^\/api\/opened\/(\d{4})\/(\d{1,2}|reset)$/.exec(path);
        if (openedPath && request.method === 'POST') {
          const body = await jsonBody(request);
          const user = await requireUser();
          const config = await readCalendar();
          const current = await checkTime();
          if (Number(openedPath[1]) !== config.year) fail(404, 'Dieser Kalender ist nicht verfügbar.');
          if (openedPath[2] === 'reset') {
            if (body.confirm !== true) fail(400, 'Bitte bestätige das Zurücksetzen der geöffneten Türchen.');
            const opened = await store.resetOpened(user.id, config.year, jar[sessionName], current);
            await checkTime();
            return send(200, { year: config.year, opened });
          }
          const day = Number(openedPath[2]);
          if (!config.doors.some(door => door.day === day) || !isConfigDoorUnlocked(day, config, new Date(current))) fail(404, 'Dieses Türchen ist noch nicht verfügbar.');
          const opened = await store.openDoor(user.id, config.year, day, jar[sessionName], current);
          await checkTime();
          return send(200, { year: config.year, opened: opened.filter(value => isConfigDoorUnlocked(value, config, new Date(current))) });
        }
        const answerPath = /^\/api\/puzzles\/(\d{4})\/(\d{1,2})\/answer$/.exec(path);
        if (answerPath && request.method === 'POST') {
          const body = await jsonBody(request);
          const user = await requireUser();
          if (typeof body.answer !== 'string' || body.answer.length > 120) fail(422, 'Bitte gib eine gültige Lösung ein. Dieser Versuch zählt nicht.');
          const config = await readCalendar();
          const current = await checkTime();
          const day = Number(answerPath[2]);
          const door = config.doors.find(item => item.day === day);
          if (Number(answerPath[1]) !== config.year || !door?.puzzle || !isConfigDoorUnlocked(day, config, new Date(current))) fail(404, 'Dieses Rätsel ist noch nicht verfügbar.');
          const result = await store.answer(user.id, config.year, door, body.answer, jar[sessionName], current);
          await checkTime();
          return send(result.lockedUntil ? 429 : 200, result, result.lockedUntil ? { 'Retry-After': String(Math.ceil((result.lockedUntil - current) / 1000)) } : {});
        }
        if (path.startsWith('/api/')) fail(404, 'Nicht gefunden.');
        if (!['GET', 'HEAD'].includes(request.method)) fail(405, 'Methode nicht erlaubt.');
        if (path === '/doors-data.json') return send(200, selectReleasedContents(await readCalendar(), new Date(time)));

        let allowed = PUBLIC_FILES.has(path);
        if (/^\/assets\/[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').some(part => part === '..' || part.startsWith('.'))) {
          const dated = /^\/assets\/released\/(\d{4})\/(?:test-(11)\/)?day-(\d{2})-/.exec(path);
          allowed = !dated || isDoorUnlocked(Number(dated[3]), Number(dated[1]), new Date(time), Number(dated[2] || 12));
        }
        if (/^\/(?:images|audio)\/[a-zA-Z0-9_./-]+$/.test(path) && !path.split('/').some(part => part === '..' || part.startsWith('.'))) {
          const config = await readCalendar();
          allowed = config.doors.some(door => isConfigDoorUnlocked(door.day, config, new Date(time)) &&
            [door.image, door.audio].some(value => typeof value === 'string' && `/${value.replace(/^\.\//, '')}` === path));
        }
        if (!allowed) fail(404, 'Nicht gefunden.');
        const size = request.headers.has('Range') && /^\/(?:audio|images)\//.test(path)
          ? (await env.DB.prepare('SELECT size FROM asset_sizes WHERE path = ?').bind(path).first())?.size : undefined;
        const asset = await rangedAsset(request, await env.ASSETS.fetch(request), size);
        const headers = new Headers(asset.headers);
        for (const [name, value] of Object.entries(SECURITY)) headers.set(name, value);
        return new Response(request.method === 'HEAD' ? null : asset.body, { status: asset.status, headers });
      } catch (error) {
        const status = error.status || (error instanceof URIError ? 404 : 503);
        return send(status, { message: error.status ? error.message : status === 404 ? 'Nicht gefunden.' : 'Gerade nicht verfügbar. Dein Versuch wurde nicht gezählt.' });
      }
    },
    async scheduled(_event, env) {
      await new D1CalendarStore(env.DB).cleanup(now());
    },
  };
}

export default createWorker();
