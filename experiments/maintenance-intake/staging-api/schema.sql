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
