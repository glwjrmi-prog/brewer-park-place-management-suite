-- Isolated maintenance staging only. Never run against Management Suite D1.
-- Opaque HMAC subject IDs; no raw email or IP address is stored.
CREATE TABLE IF NOT EXISTS resident_login_attempt_limits (
 scope TEXT NOT NULL CHECK(scope IN ('email','requester')),
 subject_hash TEXT NOT NULL,
 window_start INTEGER NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 1 CHECK(attempt_count>=1),
 PRIMARY KEY(scope,subject_hash)
);
