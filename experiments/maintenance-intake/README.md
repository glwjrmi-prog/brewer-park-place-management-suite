# BPP maintenance intake — protected development prototype (2026-11-19)

**NOT LIVE. DO NOT MERGE OR DEPLOY AS-IS.** Draft PR #3. No changes have been made to the resident website, production Management Suite, existing D1 databases, PIN login, or live work orders.

## Two independent parts

1. `index.html` — **browser-only UX demo** for a resident form and simulated board review queue. It uses in-memory sample data; refreshing clears everything. It does not make network requests.
2. `staging-api/worker.mjs`, `schema.sql`, and `wrangler.toml.example` — **undeployed isolated Cloudflare Worker candidate** and separate D1 schema. These are source files only, not a configured or operational endpoint. The backend accepts simulated resident submissions, returns tracking IDs, keeps pending items board-only, and records board review decisions. **It does not create Management Suite work orders**.

## Intended staged API contract
- `POST /api/requests` — staging resident token; requires `Idempotency-Key`; validated unit, area, category, description, escalation. Creates an intake request pending board review.
- `GET /api/requests` — staging board token; returns board queue and a clearly unverified advisory placeholder (no fabricated governing-document citations).
- `POST /api/requests/:id/review` — staging board token; requires reviewer, notes, responsibility, priority, and current optimistic concurrency version. Rejects a stale review.
- `GET /health` — minimal staging health result.

## Safety boundaries
- The Worker **must be bound to a newly created dedicated `INTAKE_DB`**; never reuse the Suite's production D1, Suite staging D1, or Cloudflare binding.
- All staging secrets must be created out-of-band. The temporary shared resident token / board token are suitable for a **private integration test only**, not a public resident website. Public rollout requires existing BPP signed-in user identity, verified unit permissions, board role verification, CSRF protection and rate limits.
- Browser demo's board tab is not access controlled: never publish it as an actual board view.
- No AI calls or actual governing document content are installed. Initial decision is `not_assessed`; only board reviewers can determine responsibility and priority.
- Never accept responsibility, priority or board approval from a resident.
- Intake IDs and idempotency keys are separate from authoritative Suite work-order IDs.
- This API has no code path or binding for reading/updating Suite v9 authoritative state.
- Production Suite revision history, conflict checks and undo/restore must remain unchanged.
- No sensitive personal data should be used in this prototype. Do not commit resident submissions.

## Before a deployment even to private staging
1. Validate and test schema and Worker with isolated synthetic data; stage secrets and origin restrictions.
2. Verify submission retry with the same key returns the original ID; same key with modified payload returns conflict; invalid fields and forbidden roles are rejected.
3. Validate board concurrent review conflicts, audit history completeness, privacy isolation and authentication failures.
4. Add server-side rate limiting and verification suitable for any test exposure beyond a trusted private setting.
5. Integrate the existing authenticated resident/board roles; don't put any shared API secret in a public website.
6. Build a verified AI Policy Advisor interface with **exact Maintenance Matrix / deed / bylaws / rules citations and version stamps**. Distinguish maintenance task owner from cost allocation and flag disagreement or uncertainty.
7. Add server-owned work-order append adapter to Suite v9 **on staging only**, preserving revision safety, no destructive overwrites, audit and rollback.
8. Include duplicates by issue/location, resident request status, photo-upload security, controlled notifications, and emergency handling.
9. Run multi-user, retries, policy ambiguity, malicious input, offline, failure, and full rollback acceptance tests.
10. Obtain **explicit approval before any production publication or deployment**.

## Safe UI demo
Open `index.html` locally; enter invented unit details only. Use the Board review simulation tab to approve a demo request. No changes persist.


## Work-order mapping preview (not connected)
The pure `work-order-adapter.mjs` implements a **side-effect-free** conversion from an explicitly board-reviewed, association/shared-responsibility sample request to the existing Management Suite v9 work-order field names. It uses the highest current work-order sequence rather than array length, refuses unreviewed or owner-only issues, rejects duplicate linked requests, and leaves the supplied state untouched. `work-order-adapter.test.mjs` contains Node regression tests. **No actual work order is written by this adapter**. Production integration requires fresh authoritative state and a revision-checked backend save, never a browser-side copy.


## Resident / board walkthrough v2
`demo-v2.html` is the preferred visual walkthrough for the **first owner usability test**, still completely offline and synthetic:
- Resident submits a sample request and receives a tracking number.
- Identical repeat submissions from the same unit/category/description are blocked and redirected to the existing ticket.
- Resident can review status and add new information to the same request.
- Board can see escalation flags, inspect resident updates, and require a documented review reason before approving responsibility.
- After approval, board can mark scheduled, deferred or completed; resident can see the approved decision and lifecycle status.
- When a resident updates an already reviewed request it returns to the board queue.
- No real resident authentication, AI, citations or Suite work-order writes are performed. Board tab is a **simulation**, not a secure role boundary.

## Current verification
The pure work-order adapter has been exercised with synthetic input for sequence generation, unchanged original state, version propagation, and rejection of unreviewed/owner-only requests. The new UI is committed but browser usability testing is pending. The isolated Worker/D1 schema is written but not deployed or integration-tested. These are not production acceptance test results.


## Urgent alert walkthrough (offline only)
`demo-v3.html` illustrates a safety message for reported urgency, a simulated simultaneous alert to all active board members, and an explicit claim-of-coordination action. No messages are sent and no actual emergency contact is assumed. The user-facing downloadable preview may be distributed as a local HTML file for private evaluation; it is not a deployed or access-controlled service. Before real use, confirm board contacts, notification provider, verified resident authentication and escalation plan.


## Urgent board-wide staging workflow — source implemented, not deployed
The isolated `staging-api/schema.sql` now includes an urgent acknowledgement owner/time, and a unique per-request recipient outbox. The Worker creates an urgent request, its intake audit entry, and one simulated alert entry per configured test board identity in a single D1 transaction. It intentionally has **no email-delivery implementation**. The temporary recipient identities are opaque strings supplied through `STAGING_BOARD_RECIPIENT_KEYS` (JSON array such as `["test-board-a","test-board-b","test-board-c"]`). No live board emails, account list, resident contacts or real notifications are accessed.

The new board-only `POST /api/requests/:id/acknowledge` endpoint uses a version-checked, compare-and-swap claim and records an audit event in the same transaction. It rejects nonurgent requests, already-acknowledged items, and stale versions. `GET /api/requests` returns acknowledgement status for the *staging board*, not a public resident endpoint. Source syntax was checked, but **database and end-to-end tests are still pending**.

Do not treat staging token roles, client-supplied reviewer names, or temporary recipient configuration as production authentication. Before any public website connection, replace them with server-verified existing BPP identity and dynamically fetched active board membership. No delivery, acknowledgement SLA, or emergency dispatch guarantee is in place.


## Regression test suite (added 2026-11-19)
`staging-api/worker.test.mjs` uses Node's in-memory SQLite adapter and synthetic input to test role restrictions, duplicate submit, altered-payload conflict, urgency outbox fan-out, first-board-member acknowledgement, stale duplicate claim, board approval, missing configuration and untrusted-origin rejection. `.github/workflows/maintenance-intake-tests.yml` is a **read-only CI check** that only runs these tests and the existing pure work-order tests. It has no deployment steps and has no permissions to alter production.
Run manually: `node --experimental-sqlite --test experiments/maintenance-intake/staging-api/worker.test.mjs experiments/maintenance-intake/work-order-adapter.test.mjs`.
**Test execution not yet confirmed**: creating test code and CI configuration is not evidence of successful test results. GitHub may not run it until Actions is enabled or triggered.


## Resident email-identity security prototype (2026-11-19)
A separate unconnected module (`staging-api/resident-access.mjs`) and isolated database addition (`resident-email-schema.sql`) now implement hashed 256-bit one-time email challenge tokens (15-minute TTL), one-hour hashed private sessions, one-use redemption, normalization and strictly email-scoped resident request listing that removes board-only notes. `resident-access.test.mjs` uses synthetic data and includes separate residents in the **same unit**, so unit number alone never gives access. The CI workflow now includes these tests.

**Not integrated into the staging Worker HTTP routes**, because there is no approved email sender or verified resident identity yet. No link is sent, no browser cookie is issued, no actual resident is authenticated, and no real resident list is exposed. Before integration: replace shared resident test tokens, add email provider and generic no-enumeration responses, rate limiting, session cookies/CSRF, secure account/board role integration, and web security review.
