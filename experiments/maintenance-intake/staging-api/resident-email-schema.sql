-- Isolated resident email-auth prototype schema. Apply ONLY to dedicated intake test D1.
-- Tokens and sessions are represented ONLY by SHA-256 digests; no raw links stored.
CREATE TABLE IF NOT EXISTS resident_email_challenges (
  challenge_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resident_email_challenges_expiry ON resident_email_challenges(expires_at);
CREATE TABLE IF NOT EXISTS resident_email_sessions (
  session_hash TEXT PRIMARY KEY,
  challenge_hash TEXT NOT NULL UNIQUE REFERENCES resident_email_challenges(challenge_hash),
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_resident_email_sessions_expiry ON resident_email_sessions(expires_at);
-- Only for NEW intake DB created from a fresh schema; do not migrate production.
-- The owner field is the verified submitting email, not a unit number.
ALTER TABLE intake_requests ADD COLUMN submitter_email TEXT;
CREATE INDEX IF NOT EXISTS idx_intake_submitter_email ON intake_requests(submitter_email,created_at DESC);
