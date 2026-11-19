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
  board_actor TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
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
