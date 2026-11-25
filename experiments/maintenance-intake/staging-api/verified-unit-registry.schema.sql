-- ISOLATED STAGING ONLY. Apply to NEW maintenance intake D1, never Suite D1.
-- No self-service unit enrollment; Board approvals must be performed by a
-- separately authenticated, audited administrative workflow (NOT implemented).
CREATE TABLE IF NOT EXISTS intake_verified_unit_access (
 verified_email TEXT NOT NULL COLLATE NOCASE,
 unit_id TEXT NOT NULL COLLATE NOCASE,
 active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0,1)),
 approved_by TEXT,
 approved_at TEXT,
 revoked_at TEXT,
 PRIMARY KEY (verified_email,unit_id),
 CHECK (active=0 OR (approved_by IS NOT NULL AND approved_at IS NOT NULL AND revoked_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_verified_unit_email_active ON intake_verified_unit_access(verified_email,active);
