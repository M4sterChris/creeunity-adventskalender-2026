import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { normalizePuzzleAnswer, puzzleIdentity } from '../puzzles.js';

export const MAX_ATTEMPTS = 10;
export const LOCK_MS = 15 * 60 * 1000;
export const SESSION_MS = 14 * 24 * 60 * 60 * 1000;
export const PARTICIPANT_DELETE_AT = Date.parse('2027-02-01T00:00:00+01:00');
export const digest = value => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

// SQLite transactions bind limits to the Discord account, year and day. There
// is deliberately no browser-provided counter, reset endpoint or device ID.
export class CalendarStore {
  constructor(file, { deleteAt = PARTICIPANT_DELETE_AT } = {}) {
    this.deleteAt = deleteAt;
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS attempts (
        user_id TEXT NOT NULL REFERENCES users(id), year INTEGER NOT NULL, day INTEGER NOT NULL,
        failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, year, day));
      CREATE TABLE IF NOT EXISTS solved (
        user_id TEXT NOT NULL REFERENCES users(id), year INTEGER NOT NULL, day INTEGER NOT NULL,
        identity TEXT NOT NULL, PRIMARY KEY(user_id, year, day));
      CREATE TABLE IF NOT EXISTS opened (
        user_id TEXT NOT NULL REFERENCES users(id), year INTEGER NOT NULL, day INTEGER NOT NULL,
        PRIMARY KEY(user_id, year, day));`);
    // Remove display names from databases created by the earlier local version.
    if (this.db.prepare('PRAGMA table_info(users)').all().some(column => column.name === 'name')) {
      this.db.exec('ALTER TABLE users DROP COLUMN name');
      this.compact();
    }
  }
  close() { this.db.close(); }
  compact() { this.db.exec('PRAGMA wal_checkpoint(TRUNCATE); VACUUM; PRAGMA wal_checkpoint(TRUNCATE);'); }
  cleanup(now) {
    if (now >= this.deleteAt) {
      const hasData = ['users','sessions','oauth_states','attempts','solved','opened'].some(table => this.db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get());
      if (hasData) { this.purge(); return true; }
    } else {
      this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
      this.db.prepare('DELETE FROM oauth_states WHERE expires <= ?').run(now);
    }
    return false;
  }
  purge() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.exec('DELETE FROM sessions; DELETE FROM oauth_states; DELETE FROM attempts; DELETE FROM solved; DELETE FROM opened; DELETE FROM users; COMMIT;');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.compact();
  }
  exportAccount(userId) {
    return {
      discordId: userId, deleteAt: new Date(this.deleteAt).toISOString(),
      opened: this.db.prepare('SELECT year, day FROM opened WHERE user_id = ? ORDER BY year, day').all(userId),
      solved: this.db.prepare('SELECT year, day FROM solved WHERE user_id = ? ORDER BY year, day').all(userId),
      attempts: this.db.prepare('SELECT year, day, failed AS failedAttempts, locked_until AS lockedUntil FROM attempts WHERE user_id = ? ORDER BY year, day').all(userId),
      sessionExpiresAt: this.db.prepare('SELECT expires FROM sessions WHERE user_id = ? ORDER BY expires').all(userId).map(row => row.expires),
    };
  }
  deleteAccount(userId) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      for (const table of ['sessions','attempts','solved','opened']) this.db.prepare(`DELETE FROM ${table} WHERE user_id = ?`).run(userId);
      this.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    this.compact();
  }
  beginLogin(now) {
    this.db.prepare('DELETE FROM oauth_states WHERE expires <= ?').run(now);
    this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now);
    if (this.db.prepare('SELECT COUNT(*) AS count FROM oauth_states').get().count >= 10000) throw new Error('Anmeldung ausgelastet.');
    const state = newToken();
    this.db.prepare('INSERT INTO oauth_states VALUES (?, ?)').run(digest(state), now + 600000);
    return state;
  }
  consumeLogin(state, cookie, now) {
    if (typeof state !== 'string' || typeof cookie !== 'string' || !/^[\w-]{43}$/.test(state) || !/^[\w-]{43}$/.test(cookie)) return false;
    if (!timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) return false;
    return !!this.db.prepare('DELETE FROM oauth_states WHERE hash = ? AND expires > ? RETURNING hash').get(digest(state), now);
  }
  login(user, now) {
    if (now >= this.deleteAt) throw new Error('Der Zeitraum für die Teilnahme ist beendet.');
    const token = newToken();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO users VALUES (?) ON CONFLICT(id) DO NOTHING').run(user.id);
      this.db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(digest(token), user.id, Math.min(now + SESSION_MS, this.deleteAt));
      this.db.exec('COMMIT');
      return token;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  user(token, now) {
    if (typeof token !== 'string' || !/^[\w-]{43}$/.test(token)) return null;
    return this.db.prepare('SELECT users.id FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.hash = ? AND sessions.expires > ?').get(digest(token), now) || null;
  }
  logout(token) { if (typeof token === 'string') this.db.prepare('DELETE FROM sessions WHERE hash = ?').run(digest(token)); }
  opened(userId, year) { return this.db.prepare('SELECT day FROM opened WHERE user_id = ? AND year = ? ORDER BY day').all(userId, year).map(row => row.day); }
  openDoor(userId, year, day) {
    this.db.prepare('INSERT INTO opened VALUES (?, ?, ?) ON CONFLICT(user_id, year, day) DO NOTHING').run(userId, year, day);
    return this.opened(userId, year);
  }
  resetOpened(userId, year) {
    this.db.prepare('DELETE FROM opened WHERE user_id = ? AND year = ?').run(userId, year);
    return [];
  }
  status(userId, year, door, now) {
    const row = this.db.prepare('SELECT failed, locked_until FROM attempts WHERE user_id = ? AND year = ? AND day = ?').get(userId, year, door.day);
    const identity = digest(puzzleIdentity(door.puzzle));
    const done = this.db.prepare('SELECT identity FROM solved WHERE user_id = ? AND year = ? AND day = ?').get(userId, year, door.day)?.identity === identity;
    const lockedUntil = !done && row?.locked_until > now ? row.locked_until : 0;
    const failed = row?.locked_until && row.locked_until <= now ? 0 : row?.failed || 0;
    return { day: door.day, solved: done, remainingAttempts: done ? MAX_ATTEMPTS : lockedUntil ? 0 : MAX_ATTEMPTS - failed,
      lockedUntil, serverNow: now, ...(done ? { fragment: door.puzzle.type === 'number' ? door.puzzle.fragment : normalizePuzzleAnswer(door.puzzle.answer, 'letters') } : {}) };
  }
  answer(userId, year, door, input, now) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.status(userId, year, door, now);
      let result;
      if (current.solved) result = { ...current, correct: true };
      else if (current.lockedUntil) result = { ...current, correct: false };
      else {
        const answer = normalizePuzzleAnswer(input, door.puzzle.type);
        if (!answer) { const error = new Error('Bitte gib eine gültige Lösung ein. Dieser Versuch zählt nicht.'); error.status = 422; throw error; }
        const expected = normalizePuzzleAnswer(door.puzzle.answer, door.puzzle.type);
        const correct = timingSafeEqual(Buffer.from(digest(answer), 'hex'), Buffer.from(digest(expected), 'hex'));
        if (correct) {
          this.db.prepare('INSERT INTO solved VALUES (?, ?, ?, ?) ON CONFLICT(user_id, year, day) DO UPDATE SET identity = excluded.identity')
            .run(userId, year, door.day, digest(puzzleIdentity(door.puzzle)));
          this.db.prepare('DELETE FROM attempts WHERE user_id = ? AND year = ? AND day = ?').run(userId, year, door.day);
        } else {
          const failed = MAX_ATTEMPTS - current.remainingAttempts + 1;
          const locked = failed >= MAX_ATTEMPTS ? now + LOCK_MS : 0;
          this.db.prepare('INSERT INTO attempts VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, year, day) DO UPDATE SET failed = excluded.failed, locked_until = excluded.locked_until')
            .run(userId, year, door.day, failed, locked);
        }
        result = { ...this.status(userId, year, door, now), correct };
      }
      this.db.exec('COMMIT');
      return result;
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
}
