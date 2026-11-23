-- BPP maintenance Gmail setup only; independent of Management Suite's database.
-- Ephemeral sessions, valid for 10 minutes. Never stores PIN session bearer,
-- password/PIN, Gmail OAuth tokens or a plaintext browser setup cookie.
CREATE TABLE IF NOT EXISTS gmail_setup_sessions (
 session_hash TEXT PRIMARY KEY,
 csrf_hash TEXT NOT NULL,
 admin_user_id TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 revoked_at INTEGER,
 CHECK (expires_at>issued_at)
);
CREATE INDEX IF NOT EXISTS idx_gmail_setup_sessions_expiry ON gmail_setup_sessions(expires_at);
