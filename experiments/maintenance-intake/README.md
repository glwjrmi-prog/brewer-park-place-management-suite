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


## 2026-11-19 private resident request API — isolated staging code only
The staging Worker now offers `POST /api/private/requests` and `GET /api/my-requests`, both requiring a valid one-hour resident session produced from a consumed email challenge. The private submission stores the verified email as owner; it ignores unverified request-body email. Existing test-token resident submissions remain unowned and **cannot appear in a private resident inbox**. The private list returns only owner-matched requests and excludes board notes/AI commentary. Stale, invalid, shared resident test tokens cannot query a private inbox. Idempotency retries must match both the payload and verified owner.

Synthetic HTTP tests include two verified residents with the same unit number, cross-user idempotency conflicts, and unverified-session rejections. This is deliberately **not a deployable resident website flow**: email delivery, public challenge request/redeem endpoints, abuse protection, cookie/CSRF controls, actual approved board membership, and true staging deployment are not in place. Never deploy the candidate publicly as-is; keep PR draft. All tests run only in CI against temporary in-memory SQLite.


## 2026-11-19 isolated work-order draft integration
The staging-only D1 schema now includes `staged_work_order_drafts`, with one unique draft per intake request. A board staging role can `POST /api/requests/:id/work-order-draft` only after the request was reviewed, has a reviewer and time, and responsibility is HOA or shared/disputed. Owner-only and unreviewed requests cannot create an association draft. Stale versions, duplicate creation and resident attempts are rejected. The list route `GET /api/work-order-drafts` is board-only and limited to the isolated database. Each draft creation creates an audit event in the same staging database transaction.

**Important:** A staging draft is NOT a live Management Suite v9 maintenance/work-order record. It does not assign a WO-number, import a project, send notices, trigger a vendor, or update Suite authoritative state. The separate `work-order-adapter.mjs` remains read-only until an authenticated server-side integration can use a freshly fetched, revision-checked isolated Suite snapshot and pass preservation/rollback tests. Do not treat these routes or staging token roles as production authorization.


## 2026-11-19 approved resident communications — staging-only
Board review now stores a **separate resident_message** from internal review_notes, with a safe default for each board decision and an optional 1,000-character message explicitly submitted by the board reviewer. The verified resident `GET /api/my-requests` view withholds responsibility and all resident decision messages until the request is in reviewed state. After review, only the decision category and approved resident message are returned; internal notes, reviewer identity, provisional AI material and event audit details are excluded. Additional synthetic HTTP tests cover pending/reviewed boundaries, rejected resident approvals, message-length validation and internal-note non-disclosure.

**Still no real Policy Advisor call, Maintenance Matrix verification, or authentic governing-document citations.** No AI output may be treated as a verified association determination, and a board reviewer must check the actual source documents before signing off. The latest changes are staging source only and must not be deployed publicly.


## 2026-11-19 Policy Advisor connection — adapter implemented, network off
Existing production Suite `policy-advisor-integration.js` was inspected. It sends `POST https://bpp-resident-policy-advisor.glwjrmi.workers.dev/` with JSON `{question}` and expects JSON `{answer}`. The isolated staging Worker now has `GET/POST /api/requests/:id/policy-advice` for board staging role only. The POST must be explicitly initiated by a board user while the request is pending, with matching version and reviewer. It sends a **general category and area-type question only** (not resident email, name, unit, phone, attachments or raw description), and accepts only a nonempty bounded advisor response. Results are labeled **unverified**, stored in a board-only D1 table and excluded from all resident-facing views. Repeated requests are rejected; unavailability fails closed. The answer never substitutes for a board determination or verified source provisions.

`POLICY_ADVISOR_ENABLED` must equal `true` in a privately configured staging environment to permit a live external request; it is **off by default**, and this Worker is not deployed. Automated tests use a fake network client and verify the outgoing JSON shape, the sanitized payload, permissions, duplicate prevention and failure behavior. These tests do **not** prove the real endpoint is currently reachable or that its governing sources are complete/correct. A private staging deployment and real integration test with manually validated source citations are still required. No production website, database or Policy Advisor deployment was changed.


## 2026-11-20 actual Policy Advisor live connectivity check
A read-only GitHub Actions job sent one generic `POST {question}` maintenance query, with **no resident information**, to the existing configured BPP Policy Advisor endpoint. The call **timed out after 15 seconds**; GitHub job 44742995192 failed with `TimeoutError`. The existing connection contract and synthetic endpoint tests previously passed, but **a functioning real Policy Advisor connection has NOT been verified**. Possible causes include service unavailability, network filtering, or upstream request time; no cause is yet established. Do not invent or release a responsibility assessment/citation from this check.

The staging integration remains disabled by default (`POLICY_ADVISOR_ENABLED` not set to `true`). The user’s live BPP website, Suite and Policy Advisor were not modified. A future verified live test requires resolving the endpoint timeout and independently checking the governing-document references. The test file is `staging-api/policy-advisor-live-check.mjs`, workflow `.github/workflows/maintenance-advisor-connection-check.yml`. It has no deployment permissions.


## 2026-11-20 GET/POST diagnostic — confirmed failure
A read-only Actions workflow `maintenance-advisor-diagnostics.yml`, run 44750410087, compared a GET status request with one generic POST question to the existing Policy Advisor endpoint. **GET returned HTTP 200 in 234 ms** with JSON `status`. **POST did not return within 45,002 ms** and failed `TimeoutError`. User's own browser GET also showed the online status. No resident data was sent. Therefore a healthy GET handler does **not** establish a functioning AI answer handler. This is consistent with a stalled POST handler or downstream inference call, but the underlying cause cannot be determined without the Cloudflare Worker logs/traces or service code.

**Safety:** No production changes, no keys accessed and no deployment. `POLICY_ADVISOR_ENABLED` stays disabled in staging. Do not increase public timeout blindly or claim verified citations. Next: inspect Cloudflare request logs/Workers observability for the question POST and verify upstream AI credentials, limits, API endpoint, network behavior and handler error handling, then retest.


## 2026-11-20 failure-safe improvement, no production fix claimed
Connected GitHub repositories were inspected for the production Policy Advisor Worker source. Only the Management Suite client adapter was located; **the deployed Cloudflare Worker handler source is not present in those accessible repos**. The live diagnostic already establishes GET health 200 in 234 ms and question POST timing out at approximately 45 seconds; the Cloudflare event confirms `outcome: canceled`, `wallTimeMs: 44969`, `cpuTimeMs: 0`. This **does not** prove a particular upstream AI provider, credential failure or causal bug.

To protect the resident/board workflow, the isolated maintenance adapter now bounds question requests to 10 seconds, aborts the network request, avoids automatic retries, returns a generic upstream-unavailable error without leaking internal exception text, and leaves maintenance responsibility entirely with board/manual governing-document review. It does not modify the deployed Advisor service. New synthetic tests cover timeout, invalid output, failed network, upstream non-OK response and caller cancellation. The test workflow has no deploy steps. The Policy Advisor remains disabled by default until its deployed POST handler and upstream service can be investigated safely without sharing secret values.
