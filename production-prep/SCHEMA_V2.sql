-- BPP PIN authentication candidate: additive D1 schema only.
-- These are NEW authentication tables. None replaces current_state/state_revisions/audit_events.
-- Run against a separately backed-up STAGING TEST DATABASE first.
-- Do NOT run against production until the complete release is approved.
CREATE TABLE IF NOT EXISTS pin_credentials (
  user_id TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  verifier TEXT NOT NULL,
  iterations INTEGER NOT NULL,
  source_pin_hash TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pin_sessions_v2 (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  account_fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_v2_user
  ON pin_sessions_v2(user_id);
CREATE INDEX IF NOT EXISTS idx_pin_sessions_v2_expiry
  ON pin_sessions_v2(expires_at);

-- Production legacy database has no pin_attempts table; create it additively.
-- IF NOT EXISTS also preserves any previously installed test/staging table.
CREATE TABLE IF NOT EXISTS pin_attempts (
  identifier TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0
);

-- Never drop historical association data or preexisting authentication tables.
