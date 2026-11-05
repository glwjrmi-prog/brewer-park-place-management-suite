-- Brewer Park Place Management Suite v9 staging schema
-- Cloudflare D1 / SQLite

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS current_state (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  revision INTEGER NOT NULL DEFAULT 0,
  state_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS state_revisions (
  revision INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  saved_by TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_state_revisions_saved_at
  ON state_revisions(saved_at DESC);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  revision INTEGER,
  actor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON audit_events(created_at DESC);
