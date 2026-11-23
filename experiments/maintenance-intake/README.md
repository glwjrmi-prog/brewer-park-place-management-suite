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


## November 21, 2026 — live staging File Search restored; accuracy review and recorded deed lead
**Confirmed by user's Cloudflare/OpenAI screenshots and HTTP output, not simulated:**
- New isolated `bpp-resident-advisor-staging` Worker remains separate from production. Both staging `workers.dev` public URL toggles remained off, but Cloudflare editor's HTTP test could invoke staging.
- User created the `BPP Resident Advisor Staging Documents` vector store in their OpenAI Default project (`vs_6b01a1b2a4e48191a0da38996316e251`) with 30-day inactivity expiration; it contains **only** `BPP Rules_Regs Nov 2025.docx`. User explicitly treats this November 2025 Rules version as current.
- User updated the staging Worker to reference new vector store ID; deployed staging version `544251e8`. On a POST asking whether residents may use guest parking, OpenAI returned HTTP 200 with `status:completed` after approximately **29.6 seconds**, and staging returned HTTP 200 with a substantive answer. This confirms real staging document retrieval/response, **not** production readiness.
- Review against the exact connected Google Drive `BPP Rules_Regs Nov 2025.docx`: Parking §3 explicitly permits resident guest parking **responsibly**, monitored and "accessed" as needed; guest street parking limitations occur in Parking §1; extended parking correspondence appears in §1. The generated answer accurately recognized the resident allowance but added "sparingly" (not a mandatory rule) and optional Board-contact advice not directly required for ordinary parking. The same Rules refer to Bylaws Art. VII §1(k)-(l), which have not yet been uploaded to staging.
- The original 2020 `ByLawspacket-Email.pdf` has a September 27, 2020 cover letter seeking affirmative votes for proposed revised Master Deed and Bylaws. Not proof of adopted recorded text.
- **NEW RECORDED-SOURCE LEAD**: publicly accessible Brewer Park Place property legal descriptions (e.g., a 2026 listing for 54 Brewer Park Circle) identify a `Consolidating Master Deed` **instrument `20201215-0120440`**, after original `20050131-0012405` and 2014 amendment `20141208-0101057`. Verify against the Kent County Register of Deeds **official instrument image and exhibits**, do not assume the 2020 proposed packet exactly matches it. Official free search: https://www.kentcountymi.gov/1892/Online-Deeds-Search (downloads/prints are listed as $1 per page since June 22, 2026).
- Prepared self-contained **staging-only** prompt adjustment `resident-accuracy-instructions.txt`, plus a complete local staging Worker draft `BPP_Staging_Policy_Accuracy_Review.txt` with only the current store ID and instruction additions. Local Node tests: **6/6 passed** (offline mocked requests, not real provider completions). The draft was **not** installed or deployed. Do not put the 2020 unverified amendment packet into the staging store; obtain verified current recorded Master Deed/Bylaws before release. Keep production unchanged and obtain explicit user approval before any production changes.

**Next safe gate**: retrieve the official recorded instrument `20201215-0120440`, check Exhibit A and later recorded amendments, then add verified sources to staging, remove the temporary Rules-only coverage warning, rerun end-to-end source-fidelity and duration tests. 29.6s out of the 35s staging timeout merits latency investigation before go-live.

## 2026-11-23: resident supplements and re-review (isolated development only)

Implemented in the **undeployed** staging prototype: authenticated request owners can submit supplemental information through `POST /api/my-requests/:id/updates` using the existing private session, an exact request version, and a description up to 2,000 characters. They can read only their own updates through GET of that route. The simulated board can read updates through `GET /api/requests/:id/updates`; shared staging resident tokens cannot do so. Wrong owners receive the same 404 as missing requests.

A supplement to a reviewed request invalidates its current decision and moves it back to `pending_board_review` while preserving the prior determination in the *board-only audit history*. The resident inbox shows no stale approved responsibility/message while pending. The action is atomic with a supplemental-update record and audit event, has optimistic concurrency checks, and refuses supplemental edits when a staging work-order draft already exists (to prevent diverging approved work orders). The private inbox now includes safe integer `version` for retry and concurrency handling.

GitHub Actions isolated test run **45189711778** passed following addition of private ownership, stale-write, re-review, and draft-safety tests. This is a synthetic test result, not an operational or staging-server deployment.

**No public resident access, photo storage, email sending, Board messaging, or production Management Suite integration was introduced. Keep this PR unmerged.**

## 2026-11-23: reviewed request lifecycle (isolated development only)

Added board-only `POST /api/requests/:id/status` to move a reviewed maintenance request to `scheduled`, `deferred`, or `completed` in **the isolated staging dataset only**. Every transition requires Board staging authorization, the exact current request version, actor and internal notes; approved resident-facing status text is stored separately. Completed items cannot be casually reopened through this endpoint. Owner-only repairs cannot be scheduled as HOA work. Verified residents continue to see approved messages and responsibility through scheduled/deferred/completed stages, but never Board notes.

GitHub Actions isolated run **45190113455** completed successfully with new authorization, stale-version, owner-only, resident-visibility, and lifecycle tests. These statuses are not linked to any contractor, email delivery, or live Management Suite data. **Keep this PR unmerged until the authenticated staging integration and Board authorization workflow are tested.**

## 2026-11-23: safe Suite v9 staging transfer preparation (no deployment)

A new *read-only* `staging-transfer.mjs` wraps the pure work-order adapter. It only accepts an initialized, separately fetched Suite staging state envelope with a positive authoritative revision, requires a Board-reviewed and versioned intake, and creates a proposed state that preserves all existing work orders and other Suite modules unchanged while appending exactly one linked work-order candidate. The operation explicitly returns a preview and **does not perform a database write or reserve a WO number**. The authoritative revision is taken from the server response envelope, never from a potentially stale embedded `_sync` field.

`staging-transfer.test.mjs` uses synthetic Suite data to verify immutable original state, safe incrementing sequence, ownership/review gating, duplicate prevention, and source revision validation. GitHub CI job **137754190326** in workflow run **45192488825** completed successfully.

**Not a release:** A real server-side transaction must fetch the latest authorized Suite state, reject revision conflicts, append the work order, create the intake-to-WO link, log the approved actor and audit record, and be tested for rollback/retry before connecting either production database. No such network/write integration is present.

## 2026-11-23: Cloudflare Console paste workaround — not yet executed on D1

User reported `No SQL statements detected` after pasting the original commented, multi-line setup script into the Cloudflare D1 dashboard Console. The Cloudflare console screenshot showed line comments flattened with SQL statements. A line comment beginning `--` can consume all following content when newlines are removed. The failed attempt does **not** establish schema deployment.

Prepared `staging-api/bootstrap-console-paste.sql`: exactly one line, no comments, containing the same 18 SQL statements as the fresh staging bootstrap, including the owner-email column and all eight intake/auth tables. New SQLite regression test confirms the exact paste file initializes the fresh isolated schema. GitHub Actions job **137763087155**, run **45195033813**, passed.

Only execute this prepared SQL on the user-created **bpp-maintenance-intake-isolated-staging** D1 (UUID `76e65da9-470f-4cc3-947b-5cba829af583`), and only if empty. Do not run on any Suite database. Request dashboard result, then verify with `/tables` or read-only `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;`. Avoid retries after partial execution until checking which tables exist, because the schema contains an `ALTER TABLE` step not fully idempotent. Keep production untouched.

## 2026-11-23: initialized D1 confirmed by operator; packaged Worker still inactive

The user showed the **bpp-maintenance-intake-isolated-staging** Cloudflare Console reporting `This query successfully executed` after submitting the one-line no-comments bootstrap SQL. This confirms the SQL execution result, **not yet an independent inspection of table names/columns or data**. Next safe check is a read-only `/tables` Console command or `SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;` before enabling the staging service. Do not rerun bootstrap or mutate any Suite database.

Prepared `staging-api/worker-dashboard-bundle.mjs` as a standalone copy/paste candidate containing the modular intake Worker, email-challenge primitives and board-only advisory adapter in one file. Both modular and bundled Workers now default to HTTP 503 for all routes unless `STAGING_INTAKE_ENABLED='true'` is explicitly configured. `wrangler.toml.example` sets it to `false`. GitHub Actions isolated test run **45196169502** job **137767070795** passed, including bundle import, fail-closed and health parity checks.

**Not deployed:** No Cloudflare Worker or database binding has been installed, no email provider is connected, and no credentials/actual resident data are available. Do not publish the bundle with shared test credentials on a public origin. A secure staging access boundary must be configured before activating it.

## 2026-11-23: verified Cloudflare Access identity adapter — code only, not active

Implemented isolated `staging-api/access-auth.mjs`, an RSA-signature-verifying Cloudflare Access JWT parser for future **private Board staging** access. It validates the Cloudflare Access issuer, application audience, RS256 signature against the team's JWKS, expiration and not-before timestamps, and email claim before accepting a board identity. A separate explicit server-side allowlist gate excludes any otherwise valid but unauthorized account. The module never trusts client-supplied `X-Email`, `X-Role` or a typed Board member name as authentication.

Synthetic cryptographic regression checks reject forged algorithms, wrong issuer/audience, wrong allowlist, expired/future tokens and tampering. The GitHub Actions isolated test run **45200702450** completed successfully.

**Important:** The module is NOT yet wired into the staging intake Worker and no Cloudflare Access application, team domain, authorized audience or approved Board identity list has been configured. It MUST NOT be interpreted as authorization for exposing the existing shared-token maintenance Worker on a public URL. The currently deployed Cloudflare Worker remains the read-only schema health probe. Configuring Access and replacing test-only Board tokens/actor labels will require separately verified permissions and end-to-end staging tests.

## 2026-11-23: Next release gate — protect only the new staging Worker

The operator successfully deployed the **read-only** D1 health checker to `bpp-maintenance-intake-staging.glwjrmi.workers.dev` and configured the binding `INTAKE_DB`. GitHub Actions run `45199791734` verified a real HTTP 200 `{status:"ready",databaseConnected:true,schemaReady:true}` response from the new staging Worker. **No intake/write handlers are deployed.**

Cloudflare's current Workers Access UI supports enabling Access for **one Worker**, from its **Access** tab > **Protect this Worker behind Access**. To avoid locking or changing unrelated systems, protect **only** `bpp-maintenance-intake-staging`, with **All traffic**, and a Cloudflare-account or exact-email allow rule. **Do not enable account-wide protection**, which might inadvertently gate the public Policy Advisor and Management Suite API. Browser ownership and Cloudflare policy application remain user-controlled.

Prepared `staging-api/d1-access-protected-health.mjs`, an alternative *read-only* health Worker that requires `ctx.access.getIdentity()` before reading database schema. It accepts no client-provided role headers, exposes no email, and performs no writes. It has **NOT been deployed**. Its isolated tests passed in GitHub Actions run **45201136705**.

Also prepared a standalone `access-auth.mjs` JWT-verification module for future server-to-server board authorization, but it is not enabled or integrated. The new Cloudflare native `ctx.access` API is preferable for direct authenticated requests and still needs a Board-role allowlist, per-user audit identity, and separate resident magic-link flow before handling real requests.

## November 23, 2026 — payment-method-free private test gateway (source only)

Cloudflare Zero Trust Free activation requested a billing method and prospective overage authorization. The user opted not to enroll. Do **not** pressure the user to add payment information or activate Zero Trust solely for private intake testing.

Added `staging-api/private-test-gateway.mjs`, an alternative **synthetic integration-test** perimeter. It denies everything by default, even health, unless *both* `STAGING_INTAKE_ENABLED=true` and `STAGING_PRIVATE_TEST_ENABLED=true` are explicitly set. For any enabled request, it requires an out-of-band cryptographically random 256-bit lowercase-hex `STAGING_TEST_SECRET` to match the `X-BPP-Staging-Gate` request header. The secret is never committed, echoed or logged, and the gate is distinct from the separate synthetic Board/resident role credentials. No origin header, request body, unit number, or browser-provided identity is treated as authentication.

**Critical boundaries:** This is a private developer integration test harness, **not sufficient authentication for an operational resident portal**. The secret must be supplied by server-side tools, never placed in publicly served JavaScript. No credential has been configured on Cloudflare, no Worker code has been deployed, and the existing read-only health Worker remains unchanged. Production still requires secure real resident authentication/verification, server-authorized Board identity/roles, CSRF and abuse controls, email delivery, and live acceptance tests.

GitHub Actions isolated test run **45204533745** passed synthetic tests for default-off behavior, wrong/missing gate token, separate Board-role token, and no DB access on denial. No chargeable Cloudflare service or account change was introduced.

## November 23, 2026 — one-file private synthetic-test bundle ready, still not deployed

Prepared `staging-api/private-test-worker-dashboard.mjs` as a **single-file** dashboard copy/paste artifact combining the modular Worker, email-session primitives, and strict two-flag / 256-bit-secret staging gate. Its extra `X-BPP-Staging-Gate` header is distinct from each synthetic Board/resident `Authorization` header. It denies even `/health` unless `STAGING_INTAKE_ENABLED=true`, `STAGING_PRIVATE_TEST_ENABLED=true`, and a strong server-set `STAGING_TEST_SECRET` match. This avoids needing a Zero Trust subscription **for synthetic developer tests only**; it does not replace production resident/Board authentication.

GitHub Actions run **45204862988** job **137797727762** passed packaged-versus-modular behavior tests for the default-off, missing flag, incorrect gate token, and valid private gate conditions.

**No Cloudflare change** performed: the deployed `bpp-maintenance-intake-staging` Worker continues running only its read-only database health code. Do not copy a secret to public JavaScript or reuse a real Board PIN/password. Do not turn on request intake to real users until signed-in identity, email confirmations, rate-limits, Board authorization, and recovery are all implemented and verified.

## November 23, 2026 — test-only intake lifecycle and post-review ownership protections

Further strengthened the unmerged staging prototype: verified resident owners may provide more information while a request is pending or just reviewed, but cannot silently reopen a **scheduled**, **deferred**, or **completed** matter that the Board already controls. The status guard is checked both before and during the database update transaction, with optimistic revision checks and no effect on existing work-order drafts. Both packaged dashboard versions were synchronized with this fix.

The test-only, double-gated dashboard Worker now has an end-to-end **synthetic-only** regression that verifies an invalid private gate cannot create a record, the separate resident role can submit once with idempotent retries, residents cannot list the Board queue or approve responsibility, the Board staging role can review, and an audit trail records the review. No real identity, real emails, external service, or production data is involved. GitHub Actions **45205914021**, job **137801483668**, passed.

The live staging Cloudflare Worker still runs the previously verified **read-only** D1 health probe; no database writes or resident submission routes have been deployed. Development remains in draft PR #3.

## November 23, 2026 — verified Board urgent alert planning (no emails sent)

Added a pure notification planning helper `staging-api/notification-planner.mjs` for eventual urgent maintenance alerts. It produces a separate idempotent event for every **active, verified** Board email recipient and fails closed if the active Board roster is missing, duplicated, or has unverified email addresses. Former Board members and residents do not receive alerts. Notification payloads contain **no resident unit, phone number, or issue narrative**: Board members must sign in to the secure queue for details. Provider acceptance and actual Board acknowledgement are intentionally distinct statuses; the planner never claims an emergency was handled or a contractor dispatched.

The associated synthetic test suite passed in GitHub Actions run **45208616015**, job **137811051990**. **No delivery provider, live Board directory, real email, or worker deployment exists** for this feature. This is a technical building block only. Before operational release, approved Board recipients/contact method, abuse protections, email provider, delivery retries, acknowledgement escalation, and user-tested authentication remain required. The deployed staging Worker remains default-deny.

## November 23, 2026 — bounded staging request bodies (code only)

The test-only maintenance Worker now caps JSON POST bodies at **8 KiB** while reading the stream rather than buffering arbitrary amounts of request data. Oversize submissions receive HTTP **413**, malformed or non-object JSON receives HTTP **400**, and neither creates any intake/audit records. The same protections cover Board review and other POST handlers. The modular Worker and both dashboard bundle variants remain synchronized.

GitHub Actions run **45213533387**, job **137828395007**, completed successfully, including regression cases for oversized resident/Board bodies and no database writes. The code is **not deployed** to the Cloudflare staging Worker; the live Worker remains behind its existing disabled gate. No production or resident data changed.

## November 23, 2026 — verified resident access to their specific units (planning and tests only)

Added `staging-api/unit-authorization.mjs` as a deliberately separate authorization boundary. A resident's verified email session alone must **not** authorize any condo-unit maintenance history or action. Only Board-approved, active, explicitly verified email-to-unit assignments may grant access; unknown, inactive, unverified, duplicated and spoofed unit assignments are denied.

All tests for cross-resident access, inactive Board approvals and spoofed unit identifiers passed in GitHub Actions run **45221880778**, job **137858021065**.

**Not connected to live identity or D1**: a real Board-controlled resident/unit directory, identity lifecycle, unit-transfer/revocation procedure and consent verification still have to be implemented before this module can be used for production. No resident data, emails or Suite records were accessed or changed.

## November 23, 2026 — dedicated verified resident-unit registry (not deployed)

Created `staging-api/verified-unit-registry.schema.sql` defining an **isolated staging D1** table with one Board-controlled email/unit assignment, explicit active flag, Board approver and approval time, and optional revocation time. The companion `verified-unit-registry.mjs` provides read-only resolution of currently active, Board-approved assignments and explicit authorization checks, failing closed when the database or registry is missing. Revoking a previously active assignment immediately removes its unit from authorized reads in the synthetic tests.

The in-memory SQLite test suite passed in GitHub Actions run **45222331120**, job **137859609786**, including email separation, inactive/revoked unit access, unknown email, invalid unit identifiers, missing database, and rejection of unapproved active rows.

**Important release boundary:** The registry code is **not** wired into real resident routes and the new schema has **not** been applied to Cloudflare D1. A separately authenticated, audited Board approval/revocation flow and resident privacy checks on *all* reads/updates, not only submissions, are required before integration. No real resident directory or unit mappings were imported, no live DB was modified, and the draft PR remains unmerged.

## November 23, 2026 — Board-verified unit checks wired into private staging routes

Extended the isolated staging Worker so **opt-in** `STAGING_VERIFIED_UNIT_ACCESS_ENABLED=true` enforces the dedicated Board-verified unit access registry for short-lived verified-email resident sessions. Private resident submissions require an active Board-approved assignment *before* idempotency reads and request creation, the resident's `/api/my-requests` list is filtered by current unit assignments, and existing request supplements require both original submitter email and current unit authorization. `GET /api/my-units` returns only the signed-in resident's currently authorized units. Removing an assignment immediately denies subsequent list, submit, and supplement calls in the synthetic test.

The registry remains **opt-in for legacy isolated tests**, not production-secure when disabled. Under the opt-in, a missing database table or registry error fails closed (HTTP 503). No real resident identities, production keys, or Cloudflare schema modifications are used. The source modules and both future dashboard bundles were synchronized. Synthetic CI run **45223770786**, job **137864679649**, passed, including tests for cross-account access, revocation and missing registry.

**Not yet public-ready:** the live staging Worker remains globally disabled and does not have the new unit-access table. No real Board approvals or revocations, resident mailbox delivery, app sessions, Turnstile, photo storage, operational notifications, or real Suite transfer are deployed. The legacy shared test-token routes remain development-only and must not be enabled for live residents. Any production transition must require verified unit access unconditionally and protect concurrent revocation during database writes.

## November 23, 2026 — close private resident unit-revocation write race (code only)

Improved unit-scoped staging writes so Board-approved unit authorization is not merely checked **before** writes but also **inside the D1 write transaction**. A resident submit now conditionally inserts the request only if the unit assignment is still active at execution time; the audit event and simulated urgent outbox are inserted only when that specific request was actually inserted. Supplements also recheck the active email/unit assignment in the guarded update. If Board access is revoked immediately before a resident transaction, no resident update, audit event or fake alert is created. A duplicate retry cannot bypass a newly revoked unit assignment.

The regression suite simulates revocation **between** initial authorization and database batch execution for both new urgent requests and existing-request supplements. GitHub Actions **45224456285**, job **137867092809**, passed, including all previously established isolated staging tests and public disabled-gate checks.

This is development code only: Cloudflare staging remains globally disabled; no live D1 migrations, real resident changes, production email sends or Management Suite modifications were performed. Before release, shared staging role tokens must be replaced with actual per-user authentication and Board assignments must be maintained in an audited admin flow.

## November 23, 2026 — private sign-in email orchestration with CAPTCHA and rate limits (not deployed)

Prepared `staging-api/resident-login-orchestrator.mjs` for a future *separately secured* resident sign-in endpoint. It verifies a Cloudflare Turnstile token using a server-held secret, requires active Board-approved unit assignments before issuing a one-use, 15-minute email login link, and redeems only once into a short-lived session. Provider calls are injected as a mockable interface: **no actual email provider is configured and no email is sent**. Undelivered links are immediately marked unusable. Unknown emails receive the same generic public response and do not produce a login link. Login-token link uses an HTTPS fragment to reduce proxy logging exposure; the frontend must erase the fragment immediately.

Added `staging-api/resident-login-rate-limit.mjs` and isolated quota schema. Attempts by both approved and unknown addresses are throttled by mailbox and a trusted-edge requester identifier, storing only server-HMAC subject hashes. Neither address nor IP is stored in the quota table. **This does not replace Cloudflare edge abuse protection.** The requester identifier must come from trusted Cloudflare request metadata, not from a caller-supplied form field or spoofable forwarding header. Tests cover mailbox/requester quotas, missing configuration, no provider, no approved registry, Turnstile failure, provider failure, one-time redemption and revocation.

GitHub Actions **45227148928** / job **137876595744** passed all isolated regressions, including the newly added login tests.

**Release blockers unchanged:** these modules are intentionally *not wired to the live Worker* and its disabled-gate still blocks resident requests. Before integration, an authorized email delivery service and sender domain, verified Turnstile hostname/action, live Board-approved resident registry and revocation workflow, network-abuse controls, protected Board identity, and delivery/acceptance testing are required. No public or Suite code was changed, and no resident or email data was used.

## November 23, 2026 — Board notification delivery adapter (source only)

Added `staging-api/board-dispatch.schema.sql` and `board-dispatch.mjs` to move beyond merely planning urgent notifications. The **isolated staging adapter** persists one recipient-specific outbox entry for each currently active and verified Board email, deduplicates by incident and recipient, and makes a single atomic claim before calling an injected/mock email provider. It keeps unit number, request description, resident email, and the full Board recipient list out of notification payloads. It preserves the distinction between **provider accepted** and **Board acknowledged**, requiring separate Board action for acknowledgment.

The adapter intentionally **never automatically retries** a claimed notification after a provider exception, rejection, or ambiguous result, because retrying without a real provider idempotency guarantee could send duplicates. An ambiguous or stuck claimed item needs authorized operational reconciliation before any retry. Changes to Board membership after initial queueing prevent a removed/unverified Board account from being dispatched. The test suite covers unique recipient queueing, single-claim concurrency, privacy, recipient revocation and provider ambiguity.

All isolated CI tests passed in GitHub Actions **45257652462**, job **137983588714**.

**Not connected to live email or endpoints**. No production email service, credentials, resident information or Suite data were used. Before release, an approved transactional email provider and sender domain, secure server-side Board directory, authenticated scheduled/queued dispatch, provider idempotency policy, delivery monitoring, on-call escalation policy, and complete acceptance tests are still needed. Do not publish staging credentials or enable the disabled staging Worker.

## November 23, 2026 — Gmail selected as BPP association email service; sender adapter prepared

User confirmed BPP uses Gmail. Added `staging-api/gmail-board-sender.mjs` as a **staging source-only** Gmail API adapter intended solely for Board urgent-maintenance alerts. It encodes fixed, nonresident-identifying Board alert text as RFC 2822 MIME/base64url and invokes the official Gmail `users.messages.send` REST endpoint with a server-provided OAuth access token. It validates individual recipients, blocks arbitrary email subject/body injection, requires a valid unique dispatch ID, maps provider acceptance to a provider message identifier and does not claim actual delivery or Board acknowledgment. Authentication/permission errors, provider rate limiting, network timeouts and malformed replies fail closed without returning credential or message details. Paired synthetic tests passed in GitHub Actions **45258681653**, job **137987210024**. No Gmail API calls or emails were made.

**Production considerations:** Gmail API sending requires OAuth with only `https://www.googleapis.com/auth/gmail.send` (not full mailbox access), a trusted server token lifecycle and consent/verification appropriate to the Google account type. Google OAuth authorization for unverified external apps in Testing mode may yield short-lived 7-day refresh tokens. Gmail limits automated sending and does not offer native idempotent deduplication by our dispatch key, so the previously implemented one-time-claim outbox and delivery reconciliation must be used. The user needs to clarify whether the association email is a consumer `@gmail.com` account or a Google Workspace mailbox on a custom domain before a final provider authorization approach is chosen.

This sender adapter is **not configured with any Gmail credentials**, not wired into the disabled staging Worker or public website, and has not changed any production accounts, secrets, resident data, or Management Suite records.
