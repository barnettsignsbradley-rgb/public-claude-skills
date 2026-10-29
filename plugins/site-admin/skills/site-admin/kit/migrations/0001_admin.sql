-- site-admin kit: the tables every site's /admin needs, whatever else it has.
-- D1 (SQLite). The Postgres version is in references/stores.md.

CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('owner', 'staff')),
  password_hash TEXT NOT NULL,
  must_change   INTEGER NOT NULL DEFAULT 0,   -- 1 after a reset: change on next sign-in
  disabled      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id  INTEGER PRIMARY KEY AUTOINCREMENT,
  ip  TEXT NOT NULL,
  ok  INTEGER NOT NULL,
  ts  INTEGER NOT NULL                        -- ms since epoch
);
CREATE INDEX IF NOT EXISTS admin_login_attempts_ts ON admin_login_attempts (ts);

CREATE TABLE IF NOT EXISTS admin_reset_tokens (
  token_hash TEXT PRIMARY KEY,                -- sha256 of the emailed token
  admin_id   INTEGER NOT NULL,
  expires    INTEGER NOT NULL,                -- ms since epoch
  used       INTEGER NOT NULL DEFAULT 0
);

-- Every write made from /admin: who, what, to what.
CREATE TABLE IF NOT EXISTS admin_audit (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  ts       TEXT NOT NULL DEFAULT (datetime('now')),
  admin_id INTEGER,
  email    TEXT,
  action   TEXT NOT NULL,
  target   TEXT,
  detail   TEXT                               -- JSON
);
CREATE INDEX IF NOT EXISTS admin_audit_ts ON admin_audit (ts);

-- Settings the owner changes without a deploy (form recipients, toggles).
CREATE TABLE IF NOT EXISTS admin_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                   -- JSON
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);
