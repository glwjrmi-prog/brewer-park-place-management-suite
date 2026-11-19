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
