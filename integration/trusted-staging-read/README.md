# BPP trusted staging lookup — offline candidate ONLY

This code is **not deployable** and makes **no changes to either Worker**. It is one piece of a trusted bridge for eventual Board-confirmed work-order imports.

Proposed `GET /internal/approved-intake/:id` (must be separately wired in a staging Worker) requires:
- A production-to-staging **service binding**, plus a separate server-only shared secret `BPP_IMPORT_SERVICE_SECRET`.
- A disabled-by-default flag `STAGING_IMPORT_LOOKUP_ENABLED`.
- A server-side authenticated, nonlegacy Board administrator and explicit approval **before the production save**, plus a production atomic source-ID uniqueness/revision transaction.
- A separately verified Board reviewer identity. The current staging Board workflow accepts static bearer tokens and a **self-reported actor name**, not sufficient as production proof of Board approval.

Read-only response has no resident email, tokens, private resident updates, or CORS. It never writes to D1 or creates a work order.

**No production deployment; never import the fictional TEST-UNIT-002.**

Tests: `node integration/trusted-staging-read/staging-trusted-read.test.mjs`. Mock D1 only; Cloudflare D1 service-binding test still required.

**Blocking:** verify real Board authenticated reviewer provenance; server-to-server trust; actual D1 transaction concurrency tests; code currentness and PIN hardening; real Board approval of production release.
## Identity hardening update (2026-11-24)

The lookup now requires a syntactically valid `verified_board_user_id` in addition to reviewed/Association status and a matching draft. It returns that user ID for source attribution and rejects historical self-reported-only approvals. This is a **candidate schema column**, not a deployed field; the candidate cannot function against staging D1 until its migration and an authenticated review-write path are implemented and tested. An offline CI workflow was added, but successful GitHub Actions execution has not been confirmed here.
