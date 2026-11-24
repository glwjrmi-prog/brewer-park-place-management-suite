# Verified Board identity for resident maintenance review — offline candidate

**NOT DEPLOYABLE.** No live Worker, staging database, or real work order was modified.

The current staging Board review accepts a static Board token and a self-reported `actor` string. Neither establishes the identity of the person who approved an Association responsibility decision. Live imports must not trust this alone.

The candidate module uses the existing PIN-authenticated Management Suite `/api/auth/me` endpoint through a Cloudflare service binding. It rejects invalid PIN sessions, non-admin roles, malformed server responses, and user-supplied reviewer identity. The reviewer ID is sourced from the authenticated session. The historical fictional TEST-UNIT-002 remains unverified and must never be imported.

A proposed additive migration introduces `verified_board_user_id`, leaving historical records null. The staging review transaction must populate it from the verified session, and the read-only import lookup must refuse records lacking it. This has not been wired or run on D1.

Only `admin` is allowed in this conservative candidate. If other Board members should review, the live authorization model must define explicit maintenance-review permission rather than trusting browser-supplied roles.

Blocking work: service-binding wiring, protected board-auth handoff, staging review transaction, D1 clone tests, actual deployed production security review, and separate Board confirmation plus atomic uniqueness for the final production import.

Run offline tests with `node integration/verified-board-identity/verified-board-identity.test.mjs`.

## Identity-bound review transaction candidate

`verified-review-handler.mjs` now prepares the actual review UPDATE and matching audit INSERT using **only the authenticated PIN principal**, not the browser's `actor` or `residentMessage`. It requires `status='pending_board_review'`, expected request version, and writes `verified_board_user_id` alongside `board_actor`. The paired `verified-review-handler.test.mjs` uses a mock D1 batch and tests forged user-supplied identity, invalid requests, unauthorized reviewers, and revision conflicts. GitHub Actions workflow updated to run both suites.

**Not yet deployed.** This is a *review handler candidate*, not a patched staging Worker. The current static-token review route still exists in the deployed staging Worker until a controlled replacement is performed. Do not enable live work-order imports based on the current staging approval record.

Required prior to deployment: migrate the isolated D1 schema, verify existing review/notification code is preserved, route authentic Suite PIN sessions through a secure handoff, test against staging D1 (including simultaneous requests and batch rollback), keep an audited rollback version, and explicitly disable the legacy self-reported Board review route for any importable record. Non-admin Board members will need permission modeling before adoption.
