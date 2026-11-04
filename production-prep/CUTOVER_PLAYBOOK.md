# Controlled PIN sign-in cutover checklist — NOT a deployment authorization
Prepared November 4, 2026 for BPP Management Suite.

## Engineering gates still open
- **Full real Cloudflare integration not run.** Create a **new isolated** test Worker + D1 database and a separate temporary website. Do not reuse either the live production Worker/D1 or the working staging D1 with its test data.
- **Client login UI review incomplete.** Verify full Management Suite after login: Administrator, regular User, Grounds Projects, Knowledge Base, vendors, Board Report, attachments/Drive picker, work orders, violation and inspection dialogs, and actual account/PIN management.
- **Legacy PIN digest removal unresolved.** The candidate migrates verification to PBKDF2 but does not remove legacy fast-hash copies from `current_state` or historical revisions. Design and test a secure administrator PIN reset endpoint before asserting all PINs are securely stored.
- **Authentication semantics:** user registration, password resets, role changes, lockouts, invalidating sessions, account removal/deactivation, and direct unauthorized API requests need explicit Cloudflare integration tests.
- **Legacy shared access key remains a powerful rollback credential.** This cannot be presented as fully removed. Require an end date and planned key rotation; remove `LEGACY_STATE_COMPAT` after the transition.

## Preconditions for live cutover
1. Confirm the actual currently deployed production Worker version by read-only comparison with November 3 `BPP_Cloudflare_Worker_Backup_2026-11-03.js.txt`. The backup might be older than the live code.
2. Verify the Worker binding named `DB` points to the exact **production** database, not staging.
3. Export a **new** production D1 backup and verify it opens offline. November 3 file is a safety reference, not necessarily today's state.
4. Record a fresh read-only snapshot: current revision, checksum, work orders (total and status), projects (total and status), vendors, violations, inspections, Grounds Projects, Knowledge Base, and highest issued work-order ID.
5. Capture a recovery copy of current Worker code/variables/routing and a copy of the **current** website root. Keep Secrets in Cloudflare; never commit them.
6. Stage the new additive SQL schema **only after** live database backup and successful isolated Cloudflare rehearsal.
7. Configure production origins as exact allowed sites, such as `https://glwjrmi-prog.github.io`, if that is the current authenticated site. Staging preview wildcard must remain disabled in the production Worker.
8. During a quiet editing window, deploy the verified Worker; confirm `/health`, read-only data and existing UI before changing the live launcher.
9. Deploy the tested PIN-enabled launcher, sign in as both administrator and normal user, validate server-side permissions and test safe non-destructive read/edit workflows.
10. Compare revision and record IDs with predeploy baseline. Stop immediately if there is any unexplained missing or altered record.
11. Remove the transitional compatibility path, rotate the old shared key, test full login/rollback procedures, and only then mark production PIN access as complete.

## Rollback rules
- Roll back Worker and website *code* using recorded deployment versions. Restoring an older SQL snapshot over newer production records is **not** an acceptable routine rollback.
- Never copy staging `state_json` into production.
- If a data change occurs after the release, reconcile against audit/revision history before any recovery; do not overwrite newer legitimate work.
- If sign-in fails while data is intact, pause edits and roll back the authentication code first, not the data.

## Tested so far
- Staging login, save, persistence after reload confirmed by user screenshots.
- Candidate Node synthetic tests for PBKDF2 upgrade, session invalidation, authorization, lockout, CORS and deletion protections passed.
- Production data-shape preservation tests passed for Grounds Projects, Knowledge Base and recovery metadata.
- GitHub Pages launcher contract checks passed; no live site rewrite was committed.
- Offline D1 schema test against November 3 SQL backup left its data byte-for-byte unchanged.

**Release status: BLOCKED.** Do not deploy from this document.

## Hardened PIN prototype status — November 4

Code-only isolated research prototype: `WORKER_PEPPER_EXPERIMENT.js`; its Miniflare test is `peppered-pin.integration.test.mjs`. Neither file is a production release candidate. The prototype uses an additional **server-side `PIN_PEPPER` Cloudflare Secret**, HMAC-SHA256 bound to account ID, and PBKDF2-SHA256 at 100,000 iterations (the maximum shown compatible in the real isolated Worker). A missing/short secret fails closed on login. Shared `ACCESS_TOKEN` bypass is disabled by default; `LEGACY_ADMIN_ROLLBACK=enabled` would have to be deliberately configured to restore it and must not be left enabled indefinitely.

### Critical design caveat
Existing `current_state.state_json` and `state_revisions.state_json` may still contain legacy six-digit PIN fast-hash verifiers and salts. **A server pepper protects new PIN verifier storage against D1-only offline attacks only after legacy fast hashes have been retired.** Migrating new credential table entries without removing historical fast hashes does not solve that problem. Historical revisions must also be protected against reintroducing legacy credentials through restore. Never purge association history without independently tested non-credential data preservation, verified backups, and explicit approval. Old backups and restored historical copies containing fast hashes remain sensitive.

### Required release sequence (not yet implemented)
1. Produce and verify a fresh production backup and compare current state revision, checksum, work order IDs/counts, vendor/project/grounds modules and revision history.
2. Provide an administrator-only credential enrollment/reset endpoint independent of `/api/state`. It must accept plaintext PIN only over HTTPS, never echo it, produce server-peppered KDF verifiers, and revoke all affected sessions.
3. Separate **public profile metadata** from credential verification records; block browser writes to PIN salt/hash fields and prohibit returning legacy hashes to any client, including rollback clients.
4. Design a reversible, fully tested **credential-only historical sanitization** of current state and revision snapshots, updating integrity metadata. Retain every association record and audit detail, and verify checksums/counts/IDs for each revision; do not simply delete historical revisions. Restore must never silently restore old credential hashes.
5. Retire and rotate privileged legacy tokens, remove the compatibility gate and confirm no bypass of PIN authorization. Provide a separate tightly controlled rollback not dependent on reopening permanent shared admin access.
6. Rehearse the revised Worker + full website on a realistic non-production D1 clone in Cloudflare, including multi-user concurrency, account resets, and code-only rollback.
7. Only then request a go/no-go for the live deployment. **No production changes are authorized by this document.**
