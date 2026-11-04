# BPP Management Suite — PIN login production-readiness gate
**Prepared November 4, 2026. NOT DEPLOYABLE.**

## Verified by staging browser testing
- Access Administrator and ordinary user can sign in with name + six-digit PIN.
- Normal user does not see the **Manage Users** control (UI-only proof; endpoint bypass testing still outstanding).
- Work-order generator selected `WO-2026-060` after numbering patch.
- A new test work order saved and persisted after browser refresh as a 58th staging work order.
- Staging remains a separate, older database: never use its records as production source.
- Source reviewed: `staging-auth/BPP_Staging_PIN_Auth_Worker_2026-11-03.js` and `staging/data-safety/site/staging-bridge.js` on staging branch. These are not approved for production deployment unchanged.

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
