-- BPP MAINTENANCE INTAKE: staging-only provider delivery tracking.
-- Do not run this against the live Management Suite DB.
-- Email addresses are not stored in this outbox; recipient IDs map through a
-- separately verified Board directory in a trusted server process.
CREATE TABLE IF NOT EXISTS board_notification_dispatch (
 incident_id TEXT NOT NULL REFERENCES intake_requests(id),
 recipient_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','accepted','retry','permanent_failure')),
 claim_token TEXT,
 claimed_at INTEGER,
 provider_message_id TEXT,
 attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0 AND attempts<=10),
 next_attempt_at INTEGER NOT NULL,
 last_error_code TEXT,
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(incident_id,recipient_id)
);
CREATE INDEX IF NOT EXISTS idx_board_dispatch_due ON board_notification_dispatch(status,next_attempt_at);
