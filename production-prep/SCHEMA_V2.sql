-- BPP PIN authentication candidate: additive D1 schema only.
-- These are NEW tables. Neither table replaces the current_state/revision/audit tables.
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

-- Existing pin_sessions and pin_attempts tables are intentionally left untouched.
-- The candidate can use existing pin_attempts. Do not remove them in rollout.
