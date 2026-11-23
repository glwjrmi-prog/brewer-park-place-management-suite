-- BPP Maintenance Notifications: isolated STAGING OAuth handshake only.
-- This schema is NOT in any live D1 database.
-- A Google OAuth callback must validate the one-time nonce and short expiry.
-- No access token, refresh token, client secret, or mailbox content is persisted.
CREATE TABLE IF NOT EXISTS gmail_oauth_handshakes (
 state_hash TEXT PRIMARY KEY,
 admin_session_hash TEXT NOT NULL,
 pkce_verifier TEXT NOT NULL,
 oidc_nonce TEXT NOT NULL,
 issued_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 consumed_at INTEGER,
 CHECK(expires_at>issued_at)
);
CREATE INDEX IF NOT EXISTS idx_gmail_oauth_expiry ON gmail_oauth_handshakes(expires_at);
