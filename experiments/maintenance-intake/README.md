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


## 2026-11-20 documented /ask route test
Original resident Advisor implementation notes (recovered from the user's stored document) specify `POST /ask` carrying JSON `{question}`, unlike the Suite integration's current `POST /`. A no-resident-data GitHub Actions test of the live `/ask` endpoint (workflow run 44758193038) also timed out at ~12 seconds (`AbortError`), so merely switching paths is **not** a demonstrated fix. The diagnostic workflow passes only because it completes the evidence collection; the route test itself was NOT successful. Do not change the live endpoint or assume a routing-only defect. Historical project discussion mentioned an OpenAI `insufficient_quota` / `credit_balance_exhausted` incident in August 2026; this is a troubleshooting lead, not proof of present billing state.

The original resident-policy-advisor implementation notes were retrieved; the accessible Cloudflare backup is a different Management Suite v9 Worker, **not** the Advisor source. The Advisor's deployed source remains unavailable here. Exact AI upstream failure cannot be established from these network tests. Keep all development isolated and consult current Cloudflare POST handler logs and OpenAI API project usage/billing status without exposing secrets before changing production.


## 2026-11-20 safe upstream isolation diagnosis ready, not run on account
Original implementation memory and resident setup notes indicate the Advisor called OpenAI Responses API (`/v1/responses`) with `gpt-5` and `web_search`, not a local lookup. The exact deployed Cloudflare Worker source is still unavailable, so this is a historical design lead rather than current-source verification.

Staging-only `staging-api/advisor-upstream-diagnostics.mjs` now offers two sequential provider probes that use synthetic `Reply exactly with OK` input: (1) basic model with no tools; (2) the same model with `web_search`. They test for actual output text rather than treating HTTP 200 alone as a valid answer. Error responses are reduced to safe categories (missing binding, authentication/permissions, quota/billing, rate limiting, provider status, no output, network error, timeout), with bounded execution and **no prompt/answer/API key logging**. Probes are synthetic-tested in the read-only CI; they have **NOT** executed with the user's live OpenAI API credential and cannot establish the current account's quota, model access or document retrieval state. Testing against the real account requires securely running the probe in a private Cloudflare staging context that has its own secret binding; never paste an API key into chat or commit to GitHub.

The available shared Library backup is a Management Suite D1 Worker, **not** the Policy Advisor. Do not overwrite the Advisor or add this module to production without confirming its actual deployed source, governing sources, secure private staging configuration, provider response, backups, and explicit approval.
NaN

## November 20, 2026: source-preserving Worker repair candidate
Historical prior conversation includes the original board/early policy-advisor Worker outline (August 19–22, 2026): a Cloudflare `fetch(request, env)` handler checks OPTIONS/GET/POST; POST parses `question`, passes governing document `instructions`, `input`, `model`, `web_search` and `store:false` to OpenAI Responses API, then extracts `output_text`. The historical implementation lacked an explicit upstream timeout. This is evidence of the **old source design**, not proof that the currently deployed Resident Worker still uses the same code.

The new **unapplied** staging module `staging-api/responses-worker-repair.mjs` isolates bounded OpenAI Responses API calling, safe client errors, status validation, and both top-level `output_text` and nested `output[].content[].text` extraction. It preserves the calling Worker's instructions, model, query, tools, and existing governing-document materials without modification. It overrides `store` to `false`, never repeats failed calls automatically, and does not log secret keys or the request/response contents. Includes regression tests for complete answer extraction, incomplete output, empty output, status denial, missing credentials, malformed response, abort and pre-aborted client.

**IMPORTANT:** This helper is a repair candidate for a private development copy, not a drop-in full Worker replacement. No actual Policy Advisor Worker source/secret binding has been accessed, and the helper has not been run against the live API credential. To complete the repair requires authorized safe access to the deployed Worker code/configuration, test deployment in an isolated namespace, and functional verification of original governing-document citations and responses. No production system changes have occurred.


## November 20: live resident website contract independently reviewed
Inspected the current public `glwjrmi-prog/brewer-park-place-condos/index.html` (read only). Its resident Policy Advisor form sends `POST https://bpp-resident-policy-advisor.glwjrmi.workers.dev/` with `Content-Type: application/json` and body `{question}`, exactly matching the Management Suite integration's current network contract. Thus a wrong POST path/payload in the resident website is **not supported as the cause** of the current timeout. The website's `askResidentPolicyAdvisor()` lacks an explicit request deadline and attempts `response.json()`; a hanging Worker can hold the UI indefinitely.

Prepared **unpublished** `staging-api/resident-advisor-browser.mjs` with a 30-second default deadline covering network + body parsing, cancellation support, single request only (no auto retry), and a generic resident-safe failure message. Mocked regression tests passed in isolated CI workflow run 44771365968. This is a **frontend failure-handling fix only**: it cannot correct the upstream Worker/OpenAI timeout and has NOT been committed to or deployed on the actual resident website repo.

To diagnose and fix the real upstream failure without asking the user to inspect keys/code, an authorized private Cloudflare dashboard browser session is required. Recommended supported workflow: open ChatGPT Work mode's Cloud Browser, sign into Cloudflare oneself and direct the assistant to inspect **only** `bpp-resident-policy-advisor`'s code and sanitised logs, creating an independent staging copy before making changes. Read secrets' *names* only; never expose plaintext values or place them in source control. Production changes require separate final approval.


## November 20: ACTUAL deployed Worker request body revealed (read-only, user screenshot and pasted excerpt)
The Cloudflare `bpp-resident-policy-advisor` worker.js source shows its OpenAI API call (approx lines 110+): `POST https://api.openai.com/v1/responses`, Authorization secret `env.OPENAI_API_KEY`, `model: "gpt-5"`, `instructions`, `input: question`, `tools: [{ type:"file_search", vector_store_ids:["vs_6a8a42e54954819186e4e74e5bc3d2da"], max_num_results:12 }]`, `store:false`. Immediately awaits `response.json()`, checks `response.ok`, logs `console.log("OpenAI error:", data)` (potential raw error content in logs), and loops through `data.output[].content[]` to concatenate `output_text`. No explicit timeout appears in the pasted call and parsing block. More code exists outside visible excerpt; do not assert whole Worker lacks error wrapping.

This explains a key ambiguity: the Nov 18 API log from a **different** request had `gpt-5-mini-2025-08-07` with ~35k input tokens including governing documents, and may belong to the Board Advisor or an earlier version. It is **not evidence that the currently deployed Resident File Search vector store works**. Need verify vector store exists, is indexed/complete and accessible to the project/key, and inspect status of actual Resident request. No key value disclosed.

Do not remove File Search, switch models, or hardcode the governing-document corpus to 'fix' timeouts without validated coverage/citations and board approval. Stage new diagnostics against the actual current File Search request payload. On provider HTTP error, log only numeric status and provider error *code* after allowlist, not `data` or prompt text. Explicit timeout with generic resident-facing failure should be tested in isolation. No changes to production.


## November 20: confirmed live Resident Worker termination and catch behavior
User shared the **last ~30 lines** of the actual production `worker.js` (total 171 lines). After `const data = await response.json()`, the Worker walks `data.output` message content for `output_text`, then returns `Response.json({answer: answer || "No answer was returned."},{headers:corsHeaders})`. There is an outer `catch(error)` returning HTTP 500 with generic resident-facing text but calling `console.log(error)`. Therefore the original Worker **does have an exception handler**, correcting any earlier assumption that it lacks catch handling. A hanging `await fetch("https://api.openai.com/v1/responses",...)` will not enter the catch until the underlying promise rejects; no explicit timeout was present in the shared fetch code. Canceled caller at ~15/45 sec is consistent with a pending upstream operation, but does not establish a specific OpenAI fault. A 200 response with `status: incomplete` or failed status might currently produce `"No answer was returned."`, obscuring error cause. Actual production code has NOT been edited or deployed.

Before production modification, use an isolated copy of the full Worker and original 171-line source/instructions, with secure secret binding. Existing safe helpers are development **candidates** only, not proven full Worker patches. Test with current `gpt-5` and `file_search` vector store, not the historical `gpt-5-mini` + directly supplied documents flow. Check upstream HTTP status, Responses `status` and non-sensitive `error.code`; never log raw `data`, raw exception, documents or credentials.


## Nov 20 — contract-focused offline tests and corrected assessment
The last code screenshots and pasted excerpt establish current Resident Worker: `model:"gpt-5"`, `tools:[{type:"file_search",vector_store_ids:["vs_6a8a42e54954819186e4e74e5bc3d2da"],max_num_results:12}]`, `store:false`. Added `resident-file-search-contract.test.mjs` using this exact **synthetic** request (no user data or real credentials). The tests verify preservation of the tool/store/model settings, safe handling of a mocked HTTP 404 vector-store error and a `status:"incomplete"` response. No change to deployed systems.

**Important inference correction:** The user's own Personal / Default project UI currently displays no files or vector stores and the Nov 18 35,241-token response is associated with the **Board Policy Advisor 2** key. This does NOT prove the Cloudflare Resident Advisor's secret points to that project. Additionally, a nonexistent vector store should generally surface as an explicit API error; the observed caller-aborted pending request after 15/45 seconds is **not diagnostic** of a missing vector store. Keep the possibilities separate. The only definitive way to test the live dependency is to run a **sanitized** staging request with the actual secret and currently configured vector store or inspect the real upstream HTTP response within a private Cloudflare session.

The deployed Cloudflare Worker has outer catch handler and a generic success response even with empty answer, but no explicit upstream timeout in the provided code. The fast local mitigation is to enforce explicit timeout on a **staging copy**, return sanitized failure if exhausted, avoid logging raw provider error payloads, and handle `response.status` + Responses `status` distinctly.

End-user action still required only for secure access to the full deployed source or authorization for an isolated test Worker to use the same Secret; do not ask them to reveal a key. Keep PR #3 draft, no merge/deploy.
