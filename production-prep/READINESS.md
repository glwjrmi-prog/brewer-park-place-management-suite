# BPP Management Suite — PIN login production-readiness gate
**Prepared November 4, 2026. NOT DEPLOYABLE.**

## Verified by staging browser testing
- Access Administrator and ordinary user can sign in with name + six-digit PIN.
- Normal user does not see the **Manage Users** control (UI-only proof; endpoint bypass testing still outstanding).
- Work-order generator selected `WO-2026-060` after numbering patch.
- A new test work order saved and persisted after browser refresh as a 58th staging work order.
- Staging remains a separate, older database: never use its records as production source.
- Source reviewed: `staging-auth/BPP_Staging_PIN_Auth_Worker_2026-11-03.js` and `staging/data-safety/site/staging-bridge.js` on staging branch. These are not approved for production deployment unchanged.

## Engineering work completed November 4, 2026
- Created `WORKER_AUTH_CANDIDATE.js` on this preparation branch, separate from the live staging and production Workers.
- New candidate migrates matching legacy PINs to PBKDF2-SHA256 (310,000 iterations) when a user next signs in; stores a new verifier in `pin_credentials`, while retaining legacy PIN hashes pending an explicit final phase-out.
- Session tokens go into a separate `pin_sessions_v2` table with an account fingerprint. Resetting a PIN, changing a role, or deactivating an account invalidates previously issued v2 tokens on the next request.
- Additive migration is in `SCHEMA_V2.sql`; it must first be tested on a disposable D1 copy.
- Synthetic Node tests are in `auth-candidate.test.mjs`. GitHub Actions syntax check and all synthetic tests **passed** November 4, 2026: https://github.com/glwjrmi-prog/brewer-park-place-management-suite/actions/runs/41826522342
- **NOT DEPLOYABLE YET.** Tests do not constitute live D1 integration testing, nor do they demonstrate full production compatibility. The legacy fast SHA-256 hashes remain in state and must be retired using a coordinated server-side PIN management migration, not merely hidden from responses.
- A fresh read of the actual production Cloudflare Worker source and a fresh read-only production D1 baseline remain necessary. The GitHub repo contains the current website's launcher and staging Worker, not a verified copy of the currently deployed production Worker.

## Blocking security requirements — MUST resolve before live deployment
1. **Six-digit PIN hashing:** existing algorithm uses a per-account salt but is fast `SHA-256(salt + '|' + PIN)`; a six-digit space is small if hashes leak. Use an approved password-based KDF (PBKDF2 with strong parameters, per-account random salts, algorithm/iteration metadata), test migration from legacy hashes or require a controlled PIN reset. Never publish salts/hashes in web responses.
2. **Server-enforced roles:** test actual API calls (not just hidden UI) for regular-user attempted user add, deactivate, PIN reset, role escalation, `_access` edits, privileged `allowDestructive`, bootstrap/restore; all must be rejected. Validate public state snapshots cannot strip/replace protected secret fields.
3. **Session revocation:** PIN reset, account deactivation, role changes, and explicit logout must revoke affected sessions. Existing staging code checks account status on each request, but does not revoke sessions on PIN reset or role change.
4. **Audit/authenticity:** write actor identity from authenticated server-side principal, never trust client-provided actor. Verify checksums, history redaction, and single-revision optimistic concurrency under two browsers.
5. **Shared credential rollback:** production's existing `ACCESS_TOKEN` is accepted as a privileged legacy principal by staging code. Design a temporary, time-limited rollback path and separate actual administrator capability rather than granting all legacy shared-key holders indefinite admin access.
6. **Work-order IDs:** the browser patch finds the highest locally visible number; for simultaneous creations, second save must reject or rebase without overwriting. Never disable server duplicate-ID validation.
7. **Current production compatibility:** full production UI, records, attachments, Grounds & Site Projects, Board Report, and existing authorization must continue to work. The staging site loads a snapshot of the old HTML with several production scripts; verify every inclusion against current production.
8. **CORS:** restrict allowed origins to exact live domain(s). Staging-preview wildcard belongs to staging API only; do not copy that allowance into production.
9. **Rollback:** practice a code-only Worker rollback; do not restore older staging or backup records over active production state. Preserve current production D1 database separately.

## November 3, 2026 production SQL export — offline verified November 4
- Uploaded SQL export parsed successfully in an isolated, in-memory SQLite instance. Four tables: `current_state`, `state_revisions`, `audit_events`, `sqlite_sequence` (the last is SQLite metadata).
- Export snapshot revision **187**, timestamp **2026-11-03T00:39:10.160Z**.
- **72 work orders** (70 Closed, 2 Pending); highest issued `WO-2026-079`, no duplicate IDs. Next new order from that snapshot would be `WO-2026-080`, NOT staging's `WO-2026-060`.
- **11 projects** (7 Complete, 3 Planning, 1 Cancelled), **41 vendors**, **0 violations**, **0 inspections**.
- State also includes `groundsProjects`, knowledge base and `_access`; must preserve each. Backup has **2 account entries**, no account details copied into source control.
- This is a historical backup, not proof of today's live production revision or counts; recheck live production immediately before migration.
- The supplied file is **a SQL database export, not the deployed production Worker JavaScript**, which is still required for Worker compatibility review. No data was loaded into Cloudflare or GitHub.

## Actual production Worker backup received and compared November 4
- Source: uploaded `BPP_Cloudflare_Worker_Backup_2026-11-03.js.txt`. The comment on line 1 says staging, but `API_VERSION` is **`bpp-v9-production-1`**. Confirm actual deployed Worker version separately; a file name/version string alone cannot prove currently deployed code.
- Production-specific behavior: `confirmedSingleDelete` authorizes exactly one requested deletion for maintenance, violations or inspections when the caller supplies a matching `deleteIntent` with `allowDestructive`. The old system allows it to anyone with the shared access token. This must not become a bypass for a regular PIN session.
- Candidate `WORKER_AUTH_CANDIDATE.js` now retains this transitional single-delete mechanism **only for temporary legacy calls**, and requires exact target removal and unchanged other protected records. Ordinary PIN users cannot delete through the API; PIN administrators can use the protected destructive flow.
- New candidate **removes the staging Pages preview-origin wildcard**. Production CORS checks only exact `ALLOWED_ORIGINS` entries.
- Existing production website uses older browser-side PIN/account data. Candidate has an opt-in **`LEGACY_STATE_COMPAT=true`** gate solely for a staged cutover; it exposes the historical account fields *to the existing shared-key client*, so this flag must never become a permanent production configuration. It is off by default and modern PIN sessions never receive those hashes.
- Added `PIN_BRIDGE_CANDIDATE.js`, a client bridge pointed at the production API but **not published or connected to the live site**. Requires integration tests with actual GitHub Pages launcher before deployment.
- Candidate code and tests passed GitHub Actions on Nov 4: https://github.com/glwjrmi-prog/brewer-park-place-management-suite/actions/runs/41828544795
- **Still blocked:** deploy only after live Worker identity verification, live D1 baseline and fresh backup, staged Worker+website cutover testing, and a safe retirement strategy for stored SHA-256 legacy PIN digests and the shared key.

## Offline schema-copy safety check (November 4)
- Loaded the user's November 3 SQL export into **memory-only SQLite**. Applied the exact two proposed new table definitions and indexes from `SCHEMA_V2.sql` on the disposable copy.
- `current_state.revision` remained **187**; `state_json` bytes were identical before/after (SHA-256 begins `2e6eea835108`).
- Verified original counts still 72 work orders, 11 projects, 41 vendors, 0 violations and 0 inspections. Authentication tables `pin_credentials` and `pin_sessions_v2` were created.
- This checks **schema-only safety against the November 3 backup**, NOT Cloudflare runtime, newer production changes, authentication integration or the live migration itself.
- Client bridge syntax and synthetic Worker integration tests passed: https://github.com/glwjrmi-prog/brewer-park-place-management-suite/actions/runs/41828798664

## November 4 follow-up: data-module protection and website compatibility
- The production snapshot also contains `groundsProjects`, `knowledgeBase`, and `recoveryMetadata`. New Worker candidate protections now reject omitted top-level modules, and treat Grounds Projects and Knowledge Base as protected collections. Synthetic regression tests confirm omission/removal is blocked.
- Corrected PIN client login text, created separate production PIN session-storage key, and added an official GitHub Pages origin/path guard to the production-client candidate; the candidate cannot silently call production API when hosted on a staging domain.
- Added `launcher-contract.test.mjs` to check that the existing live launcher remains untouched on the preparation branch and to verify URL routing, expected modules, and production-only origins.
- See `CUTOVER_PLAYBOOK.md` for rehearsal, fresh-backup, cutover, code-only rollback and the outstanding blockers.
- Latest candidate CI including both synthetic auth and launcher contract checks passed: https://github.com/glwjrmi-prog/brewer-park-place-management-suite/actions/runs/41831442677
- **Integration against a real isolated Cloudflare D1/Worker and a complete browser test remains outstanding. No deployment authorized.**

## November 4: isolated Cloudflare-compatible Worker + D1 integration result
- Added `miniflare-d1.integration.test.mjs` and installed Miniflare in candidate GitHub Actions. The test executes `WORKER_AUTH_CANDIDATE.js` in a Cloudflare Worker emulator with a real local D1 SQLite database created using `SCHEMA_V2.sql`, rather than mocking D1 calls.
- On **synthetic association records only**, tested legacy PIN sign-in + PBKDF2 migration, database credential creation, PIN session verification, secret redaction, direct rejection of missing `groundsProjects`, unauthorized role edit rejection, authorized admin state save + revision increment + history entry, logout invalidation, and rejection of a staging-origin CORS response.
- **All CI checks passed:** https://github.com/glwjrmi-prog/brewer-park-place-management-suite/actions/runs/41834034165
- This is **not** deployment to the user's Cloudflare account. It does not test the complete live website UI or a production D1 clone. The live GitHub Pages launcher and production Worker/database were not changed.
- Outstanding critical gate: coordinated retirement of old PIN digest copies in current state/history and legacy shared-key privilege; browser end-to-end run using a truly isolated remote Cloudflare environment; new production backup immediately before cutover.

## Production data preservation rules
- Production D1 database is the sole source of association records; do not overwrite it with staging data or a static HTML embedded dataset.
- Capture pre-deploy read-only baseline: database ID, revision, checksum, total record counts and key status counts; compare after rollout.
- Make a fresh independently verified production database export before schema changes. Retain the existing November 3 backup too.
- Use only additive, idempotent schema migration for PIN sessions and lockout tables. Do not `DROP`, `DELETE`, `REPLACE`, or load staging `state_json`.
- Keep a maintenance/rollback window. Start with the Worker, verify health and API, then publish live PIN sign-in only after its backend is ready. Abort on unexpected record-count or revision changes.
- Test login, logout, record read, ordinary user permissions, save, concurrent save and recovery using non-sensitive test data.

## Previously observed production dashboard baseline (not current verification)
At the November 3 screenshot: 2 open work orders, 3 active projects, 0 open violations, 0 high-priority work orders. **These are only historical reference counts**, not a substitute for taking a fresh live D1 read-only baseline at deployment time.

## Status and owner actions
- **Current status: PREPARATION ONLY — FAIL security gate.**
- GitHub branch `bpp-pin-production-prep-2026-11-04` is separate from main and does not modify live production.
- Next engineering task: make a tested production candidate from the *current* production Worker + PIN changes, with server-side policy tests and secure PIN hash migration. Do not deploy staging source unchanged.
- Live action requires a final explicit go/no-go with backup and checked production database identity.

## November 4: actual isolated Cloudflare PIN login verified (test only)
- User created a new Worker `bpp-pin-integration-test-api` and new empty D1 `bpp-pin-integration-test` with six required tables, distinct from production and the existing staging infrastructure.
- New test-only secrets `ACCESS_TOKEN` and `ADMIN_TOKEN` set in Cloudflare, plus explicit `ALLOWED_ORIGINS`; secrets were not copied to source control.
- A synthetic user `BPP Test Admin` and synthetic empty data were seeded. The browser screenshot showed `SUCCESS — PIN login verified!`, role admin, and server-side session verification through `/api/auth/me`. No actual association records were imported.
- Cloudflare Issues exposed an otherwise hidden runtime rejection: PBKDF2 calls with 310,000 iterations are unsupported in this Worker environment. A **test-only** code variant uses 100,000 iterations. This is NOT an approved production security setting, and the 310,000-iteration `WORKER_AUTH_CANDIDATE.js` remains incompatible until the design is replaced or revised.
- Added `ISOLATED_TEST_BRIDGE.js`, `ISOLATED_TEST_LOADER.html` and test-Worker-only `/test-suite` to rehearse the full Management Suite against synthetic D1, without touching live or existing staging. Full-suite browser rehearsal has not been performed yet.
- **Production remains blocked** until full browser workflows, secure PIN/legacy hash retirement strategy, privilege removal of shared key, fresh D1 backup, and code-only rollback checks pass.
