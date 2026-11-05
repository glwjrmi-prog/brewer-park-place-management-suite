# BPP PIN + Private Activity Log — Controlled Production Cutover

**Status:** Preparation only; not an authorization to deploy. **Do not deploy test-only Worker files to production.**

## Tested
- Isolated Cloudflare Worker: both Test Admin and new Test Member logged in; passwordless six-digit PIN login; administrator created and reset a member credential; migration eliminated legacy credential verifiers in synthetic historical revisions.
- Full Suite `/test-suite` loaded, identified server-authenticated test admin, displayed private activity.
- GitHub CI validates server-only account creation/reset, revocation, role checks, owner-only activity endpoint and protected owner account, isolated-only host routing, and the five-column readable Activity Log.
- Production-shaped *offline* SQLite rehearsal preserved all HOA noncredential data and validated current+186 revision checksums.
- **Not yet done:** production Cloudflare D1 schema migration, production Worker/frontend coordinated cutover, enrollment of two live accounts, snapshot cleanup, and post-cutover live data verification.

## Safety-critical deployment gates

1. Confirm today's actual live production D1 revision and snapshot integrity. Take a **fresh full SQL export** immediately before cutover, store it privately in the Chromebook's Linux Files/Downloads and offline storage. Existing November 4 export is not a substitute if any HOA records have changed. Note file hash and revision. Do not share secrets, PINs or the export via public GitHub.
2. Identify existing production account IDs and roles without exposing PIN data. Assign `SYSTEM_ADMIN_USER_ID` only to the authorized website/system administrator's **stable user ID**. Confirm at least one active board/admin account remains.
3. Provision `PIN_PEPPER` (secret, random >=32 characters; must be backed up in an administrator-managed password manager, never source control) and apply **additive** `SCHEMA_V2.sql` to the correct production D1 after explicit review. Read-only audit of generated tables before continuing.
4. Use a separate, protected nonproduction rehearsal to verify the full website and production-shaped data with the exact production Worker candidate. Do not connect the experimental `/test-enroll` or `/test/scrub` routes to real member data. Do not use `WORKER_PIN_ENROLLMENT_TEST.js` on production.
5. Coordinate production Worker and GitHub Pages website bridge change as a **single short maintenance cutover**. Existing Pages bridge expects the old `ACCESS_TOKEN`. The secure Worker disables that legacy token by default, so changing only one side causes an outage. If any new PIN login fails, immediately restore the previous Worker+website code while the old database remains intact.
6. During the transitional phase, have **both real active accounts sign in privately** with the existing six-digit PINs so a peppered verifier is created for each. The Worker must fail closed if `PIN_PEPPER` is absent; do not solicit or transmit PINs in chat. Test admin vs board-user permissions and private Activity Log from the actual full Suite.
7. **Do not sanitize current or historical PIN hash state until both live accounts are confirmed enrolled** by a credential-only readiness check, and business edits have been paused. Scrub only credential fields, preserve every other user profile and HOA record, recompute all snapshot checksums; clear `pin_credentials.source_pin_hash`. The existing scripts rehearse this *in memory*, not as a production migration command. Create and verify the actual production mutation as a separately reviewed transaction. Verify exactly 187 or the newly updated snapshot count; never rely on stale revision count.
8. Verify all 72 work orders, 41 vendors, 11 projects, knowledge base and any additions made since November 4, plus audit/revision history, remain present; compare IDs/checksums, not counts alone. Test account creation and reset from the actual Suite, audit log identity, session revocation, ordinary edit and admin-only access. Disable transient privileged legacy token recovery flags and retire old exposed test tokens.
9. Re-export and preserve a new **post-cutover** production backup. Document a recovery plan for both before and after credential sanitization. Restoring a pre-cutover backup could reintroduce old PIN hashes and overwrite subsequent HOA edits; it is **not** a data-loss-free automatic rollback.

## Production hard stop

Do not push production until the backup and account mapping are verified, the exact production Worker and bridge are available and tested against a realistic Cloudflare D1 clone, all active accounts have migration paths, and an operator specifically authorizes that cutover.

## Private Activity Log entitlement

- `SYSTEM_ADMIN_USER_ID` matches one stable user ID, not a display name. The server checks this on every request.
- Board administrators can manage authorized accounts but cannot reset, rename or deactivate the system owner's account; they cannot open `/api/admin/activity`.
- All authenticated change records use server-verified identity and user-visible activity is rendered as Date, User, Action, Record and Changes. Safe formatted values are shown for selected fields; other changes show field names without exposing resident notes.

