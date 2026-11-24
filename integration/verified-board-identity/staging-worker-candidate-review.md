# Current staging Worker review — verified PIN reviewer candidate
**2026-11-24. NOT DEPLOYED.**

Input: the saved 69,587-byte staging maintenance intake source (`Pasted text(20261124-154023).txt`) available in the user's file library, previously used in the Gmail setup. This is a historical source snapshot, not verified byte-for-byte against the current deployed staging Worker.

Created a fully patched candidate file in the active conversation: `BPP-Verified-Review-Staging-Worker-CANDIDATE.js` (71,159 characters of patched underlying source, plus no-deploy header). Node.js `--check` passed; source-level assertions for the new verified-review SQL also passed. **No actual D1 integration or concurrency tests have run.**

## Precise modifications
1. Add `bppVerifiedBoardPrincipal` that validates a bearer session via the existing `BPP_SUITE_AUTH` Cloudflare service binding at `/api/auth/me`, and requires a verified administrator identity. Requests without a valid PIN session get 403 even if the static Board staging token is valid.
2. Replace self-declared `body.actor` in the `review` handler with the verified principal's name and user ID, writing `verified_board_user_id` through the existing version-gated staging D1 batch.
3. Mark events with verified reviewer ID; do not accept client-supplied reviewer identity in the event record.
4. Clear `verified_board_user_id` when a resident supplement reopens Board review.
5. Require `verified_board_user_id` before a staging work-order draft can be created; require a verified PIN session in the draft route.
6. No import endpoint, cross-database save, public-facing change, or production credential changes were added.

## Release blockers
- The new column does **not** exist until the additive migration (see `SCHEMA-CURRENT-STAGING-ONLY.sql`). Do not deploy candidate code first or its review queries will fail.
- Review the actual latest staging Worker source for intervening Gmail/notification changes; do not overwrite newer code with the older snapshot.
- Test login, review, resident supplement, and draft creation against a disposable isolated D1 clone; verify D1 batch failure rolls back both review and event insert.
- Define legitimate non-admin Board reviewer roles. Candidate currently restricts approval to admin sessions.
- Keep historical fictional TEST-UNIT-002 excluded from real imports.
- Disable public access to any deployment until separate resident-access validation, Board approval, production atomic import, and rollback strategy are complete.

**Status:** source-level implementation candidate and documentation only. It is not confirmation that the feature works live.
