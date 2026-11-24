-- REVIEW ONLY. DO NOT RUN UNTIL TESTED AGAINST AN ISOLATED D1 CLONE.
ALTER TABLE intake_requests ADD COLUMN verified_board_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_intake_verified_board_user_id ON intake_requests(verified_board_user_id);
-- Do not backfill historical Board actor strings as verified identities.
