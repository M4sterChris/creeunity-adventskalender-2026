import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePuzzleAnswer, puzzleIdentity } from '../../puzzles.js';
import { MAX_ATTEMPTS, LOCK_MS, SESSION_MS, PARTICIPANT_DELETE_AT } from '../policy.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const validToken = value => typeof value === 'string' && /^[\w-]{43}$/.test(value);
const deny = () => { const error = new Error('Bitte melde dich erneut an.'); error.status = 401; throw error; };

// D1 batches are transactions. All writes recheck the session inside SQL, so
// concurrent requests cannot reset limits or resurrect a deleted account.
export class D1CalendarStore {
  constructor(db, { deleteAt = PARTICIPANT_DELETE_AT } = {}) {
    this.db = db;
    this.deleteAt = deleteAt;
  }
  sql(query, ...values) { return this.db.prepare(query).bind(...values); }
  async cleanup(now) {
    if (now >= this.deleteAt) {
      await this.db.batch(['sessions', 'oauth_states', 'attempts', 'solved', 'opened', 'users'].map(table => this.sql(`DELETE FROM ${table}`)));
    } else {
      await this.db.batch([this.sql('DELETE FROM sessions WHERE expires <= ?', now), this.sql('DELETE FROM oauth_states WHERE expires <= ?', now)]);
    }
  }
  async readCalendar() {
    const row = await this.sql('SELECT json FROM calendar_config WHERE id = 1').first();
    if (!row) throw new Error('Private calendar not configured');
    return JSON.parse(row.json);
  }
  async user(session, now) {
    if (now >= this.deleteAt || !validToken(session)) return null;
    return this.sql('SELECT user_id AS id FROM sessions WHERE hash = ? AND expires > ?', digest(session), now).first();
  }
  async beginLogin(now) {
    const state = token();
    const result = await this.sql(`INSERT INTO oauth_states (hash, expires)
      SELECT ?, ? WHERE (SELECT COUNT(*) FROM oauth_states) < 10000`, digest(state), now + 600000).run();
    if (!result.meta.changes) throw new Error('Login capacity exceeded');
    return state;
  }
  async consumeLogin(state, cookie, now) {
    if (!validToken(state) || !validToken(cookie) || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return false;
    return !!await this.sql('DELETE FROM oauth_states WHERE hash = ? AND expires > ? RETURNING hash', digest(state), now).first();
  }
  async login(user, now, oldSession) {
    if (now >= this.deleteAt) throw new Error('Participation closed');
    const session = token();
    await this.db.batch([
      this.sql('INSERT INTO users (id) VALUES (?) ON CONFLICT DO NOTHING', user.id),
      this.sql('INSERT INTO sessions (hash, user_id, expires) VALUES (?, ?, ?)', digest(session), user.id, Math.min(now + SESSION_MS, this.deleteAt)),
      this.sql('DELETE FROM sessions WHERE hash = ?', typeof oldSession === 'string' ? digest(oldSession) : ''),
    ]);
    return session;
  }
  async logout(session) {
    if (validToken(session)) await this.sql('DELETE FROM sessions WHERE hash = ?', digest(session)).run();
  }
  guard(session, now) {
    return [typeof session === 'string' ? digest(session) : '', now];
  }
  async opened(userId, year) {
    return (await this.sql('SELECT day FROM opened WHERE user_id = ? AND year = ? ORDER BY day', userId, year).all()).results.map(row => row.day);
  }
  async openDoor(userId, year, day, session, now) {
    const result = await this.sql(`INSERT INTO opened (user_id, year, day)
      SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM sessions WHERE hash = ? AND expires > ? AND user_id = ?)
      ON CONFLICT DO NOTHING`, userId, year, day, ...this.guard(session, now), userId).run();
    if (!result.meta.changes && !await this.user(session, now)) deny();
    return this.opened(userId, year);
  }
  async resetOpened(userId, year, session, now) {
    await this.sql(`DELETE FROM opened WHERE user_id = ? AND year = ?
      AND EXISTS (SELECT 1 FROM sessions WHERE hash = ? AND expires > ? AND user_id = ?)`, userId, year, ...this.guard(session, now), userId).run();
    if (!await this.user(session, now)) deny();
    return [];
  }
  statusStatement(userId, year, door, session, now) {
    return this.sql(`SELECT
      (SELECT failed FROM attempts WHERE user_id = ?1 AND year = ?2 AND day = ?3) AS failed,
      (SELECT locked_until FROM attempts WHERE user_id = ?1 AND year = ?2 AND day = ?3) AS locked_until,
      EXISTS (SELECT 1 FROM solved WHERE user_id = ?1 AND year = ?2 AND day = ?3 AND identity = ?4) AS done,
      EXISTS (SELECT 1 FROM sessions WHERE hash = ?5 AND expires > ?6 AND user_id = ?1) AS authenticated`,
    userId, year, door.day, digest(puzzleIdentity(door.puzzle)), ...this.guard(session, now));
  }
  statusValue(row, door, now) {
    if (!row?.authenticated) deny();
    const done = !!row.done;
    const lockedUntil = !done && row.locked_until > now ? row.locked_until : 0;
    const failed = row.locked_until && row.locked_until <= now ? 0 : row.failed || 0;
    return { day: door.day, solved: done, remainingAttempts: done ? MAX_ATTEMPTS : lockedUntil ? 0 : MAX_ATTEMPTS - failed,
      lockedUntil, serverNow: now,
      ...(done ? { fragment: door.puzzle.type === 'number' ? door.puzzle.fragment : normalizePuzzleAnswer(door.puzzle.answer, 'letters') } : {}),
    };
  }
  async statuses(userId, year, doors, session, now) {
    if (!doors.length) return [];
    const results = await this.db.batch(doors.map(door => this.statusStatement(userId, year, door, session, now)));
    return results.map((result, index) => this.statusValue(result.results[0], doors[index], now));
  }
  async answer(userId, year, door, input, session, now) {
    const answer = normalizePuzzleAnswer(input, door.puzzle.type);
    if (!answer) { const error = new Error('Bitte gib eine gültige Lösung ein. Dieser Versuch zählt nicht.'); error.status = 422; throw error; }
    const correct = timingSafeEqual(Buffer.from(digest(answer), 'hex'), Buffer.from(digest(normalizePuzzleAnswer(door.puzzle.answer, door.puzzle.type)), 'hex'));
    const identity = digest(puzzleIdentity(door.puzzle));
    const operations = correct ? [
      this.sql(`INSERT INTO solved (user_id, year, day, identity)
        SELECT ?1, ?2, ?3, ?4 WHERE EXISTS (SELECT 1 FROM sessions WHERE hash = ?5 AND expires > ?6 AND user_id = ?1)
        AND NOT EXISTS (SELECT 1 FROM attempts WHERE user_id = ?1 AND year = ?2 AND day = ?3 AND locked_until > ?6)
        ON CONFLICT (user_id, year, day) DO UPDATE SET identity = excluded.identity`, userId, year, door.day, identity, ...this.guard(session, now)),
      this.sql(`DELETE FROM attempts WHERE user_id = ?1 AND year = ?2 AND day = ?3
        AND EXISTS (SELECT 1 FROM solved WHERE user_id = ?1 AND year = ?2 AND day = ?3 AND identity = ?4)
        AND EXISTS (SELECT 1 FROM sessions WHERE hash = ?5 AND expires > ?6 AND user_id = ?1)`, userId, year, door.day, identity, ...this.guard(session, now)),
    ] : [
      this.sql(`INSERT INTO attempts (user_id, year, day, failed, locked_until)
        SELECT ?1, ?2, ?3, 1, 0 WHERE EXISTS (SELECT 1 FROM sessions WHERE hash = ?4 AND expires > ?5 AND user_id = ?1)
        AND NOT EXISTS (SELECT 1 FROM solved WHERE user_id = ?1 AND year = ?2 AND day = ?3 AND identity = ?6)
        ON CONFLICT (user_id, year, day) DO UPDATE SET
          failed = CASE WHEN attempts.locked_until > 0 AND attempts.locked_until <= ?5 THEN 1 ELSE attempts.failed + 1 END,
          locked_until = CASE WHEN (CASE WHEN attempts.locked_until > 0 AND attempts.locked_until <= ?5 THEN 1 ELSE attempts.failed + 1 END) >= ?7 THEN ?8 ELSE 0 END
        WHERE attempts.locked_until <= ?5`, userId, year, door.day, ...this.guard(session, now), identity, MAX_ATTEMPTS, now + LOCK_MS),
    ];
    const results = await this.db.batch([...operations, this.statusStatement(userId, year, door, session, now)]);
    const status = this.statusValue(results.at(-1).results[0], door, now);
    return { ...status, correct: status.solved };
  }
  async exportAccount(userId, session, now) {
    const results = await this.db.batch([
      this.sql('SELECT year, day FROM opened WHERE user_id = ? ORDER BY year, day', userId),
      this.sql('SELECT year, day FROM solved WHERE user_id = ? ORDER BY year, day', userId),
      this.sql('SELECT year, day, failed AS failedAttempts, locked_until AS lockedUntil FROM attempts WHERE user_id = ? ORDER BY year, day', userId),
      this.sql('SELECT expires FROM sessions WHERE user_id = ? ORDER BY expires', userId),
      this.sql('SELECT 1 AS ok FROM sessions WHERE hash = ? AND expires > ? AND user_id = ?', ...this.guard(session, now), userId),
    ]);
    if (!results[4].results.length) deny();
    return { discordId: userId, deleteAt: new Date(this.deleteAt).toISOString(), opened: results[0].results,
      solved: results[1].results, attempts: results[2].results, sessionExpiresAt: results[3].results.map(row => row.expires) };
  }
  async deleteAccount(userId, session, now) {
    // ON DELETE CASCADE removes all account records atomically with the user.
    const result = await this.sql(`DELETE FROM users WHERE id = ?
      AND EXISTS (SELECT 1 FROM sessions WHERE hash = ? AND expires > ? AND user_id = ?) RETURNING id`, userId, ...this.guard(session, now), userId).first();
    if (!result) deny();
  }
}
