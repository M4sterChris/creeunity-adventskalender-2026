-- Schema only: actual solutions and participant data must never appear here.
CREATE TABLE IF NOT EXISTS calendar_config (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires);
CREATE TABLE IF NOT EXISTS oauth_states (hash TEXT PRIMARY KEY, expires INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth_states(expires);
CREATE TABLE IF NOT EXISTS attempts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, day INTEGER NOT NULL,
  failed INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, year, day)
);
CREATE TABLE IF NOT EXISTS solved (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, day INTEGER NOT NULL, identity TEXT NOT NULL,
  PRIMARY KEY(user_id, year, day)
);
CREATE TABLE IF NOT EXISTS opened (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL, day INTEGER NOT NULL,
  PRIMARY KEY(user_id, year, day)
);
