-- BPP Maintenance Intake: new isolated D1 database bootstrap only.
-- Target: bpp-maintenance-intake-isolated-staging (76e65da9-470f-4cc3-947b-5cba829af583)
-- NEVER run on BPP Management Suite production/staging databases.
-- Fresh database only: do not rerun this script after data exists.

-- ISOLATED MAINTENANCE INTAKE STAGING DATABASE ONLY. Never run against Suite production D1.
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS intake_requests (
  id TEXT PRIMARY KEY,
  submission_key TEXT NOT NULL UNIQUE,
  unit TEXT NOT NULL,
  area TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  escalation INTEGER NOT NULL DEFAULT 0 CHECK (escalation IN (0,1)),
  status TEXT NOT NULL DEFAULT 'pending_board_review',
  responsibility TEXT,
  priority TEXT,
  review_notes TEXT,
  resident_message TEXT,
  board_actor TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  urgent_ack_by TEXT,
  urgent_ack_at TEXT,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_intake_status_created ON intake_requests(status,created_at DESC);
CREATE TABLE IF NOT EXISTS intake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES intake_requests(id),
  event_type TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  event_at TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_intake_events_request ON intake_events(request_id,id);

-- Simulated per-board-member alert outbox: no email addresses and no provider delivery.
-- A real deployment requires an authenticated board directory and delivery service.
CREATE TABLE IF NOT EXISTS urgent_alert_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES intake_requests(id),
  recipient_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'simulation_pending' CHECK (status IN ('simulation_pending','disabled')),
  created_at TEXT NOT NULL,
  UNIQUE(request_id,recipient_key)
);
CREATE INDEX IF NOT EXISTS idx_urgent_outbox_request ON urgent_alert_outbox(request_id,id);

-- Staging-only draft work orders, never a Suite v9 work order or a dispatch.
-- Unique intake ID prevents multiple board-side draft creation.
CREATE TABLE IF NOT EXISTS staged_work_order_drafts (
  id TEXT PRIMARY KEY,
  intake_request_id TEXT NOT NULL UNIQUE REFERENCES intake_requests(id),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status='draft')
);
CREATE INDEX IF NOT EXISTS idx_work_order_draft_created ON staged_work_order_drafts(created_at DESC);

-- Board-only unverified Policy Advisor response. Never included in resident views.
CREATE TABLE IF NOT EXISTS intake_policy_advice (
  request_id TEXT PRIMARY KEY REFERENCES intake_requests(id),
  answer TEXT NOT NULL,
  question TEXT NOT NULL,
  advisor_source TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  request_version INTEGER NOT NULL
);

-- Resident-owned supplemental updates. Board review must be repeated after a new
-- update to an already reviewed intake; never edit an authoritative Suite work order.
CREATE TABLE IF NOT EXISTS intake_resident_updates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES intake_requests(id),
  submitter_email TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_intake_resident_updates_request ON intake_resident_updates(request_id,id);

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
