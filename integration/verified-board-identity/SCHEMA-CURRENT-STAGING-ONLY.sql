-- BPP verified Board review: schema migration candidate for ISOLATED STAGING D1 ONLY.
-- NOT EXECUTED. DO NOT APPLY TO PRODUCTION.
-- Requires review of existing columns with PRAGMA table_info(intake_requests).
-- Execute only once against a disposable D1 clone, then verified staging, after backup.
ALTER TABLE intake_requests ADD COLUMN verified_board_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bpp_intake_verified_board
  ON intake_requests(verified_board_user_id);
-- Historical self-reported board_actor remains unchanged.
-- Do NOT backfill verified_board_user_id for historical records.
-- New approval path must populate this column using a verified PIN session.
-- A resident supplement/reopened review must clear this column.
-- Work order drafts for unverified historical reviews must not be imported.
