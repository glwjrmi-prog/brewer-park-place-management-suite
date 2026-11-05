# BPP historical PIN cleanup — live migration hold / implementation contract

Status: **NOT DEPLOYABLE**. The Nov 5 live system now authenticates through server-side peppered PBKDF2 credentials for two existing accounts. The private post-enrollment backup is ~18 MB and remote revision was 187. A local in-memory dry run removed 192 obsolete verifier fields across 187 snapshots with identical noncredential association records and verified checksums. Both `pin_credentials.source_pin_hash` strings remain 64 characters, so cleanup is required.

## Mandatory invariant

For each account, the credential row's `verifier` and `salt` must remain byte-identical; only `source_pin_hash` becomes the empty string. Simultaneously, remove only `pinHash`, `salt`, and `passwordHash` properties from each `_access.users` object in `current_state.state_json` and **every** `state_revisions.state_json`. Recompute SHA-256 of each exact final UTF-8 JSON string and update the matching `checksum`. Do not modify `audit_events`, noncredential user fields, any operational record, counts, or timestamps.

## Implementation safety checks, before any live write

1. Freeze Suite writes and take a newer live Wrangler SQL export; capture current revision, checksum and `MAX(state_revisions.revision)`. Never assume revision 187 forever.
2. Verify user ID set in current state matches every active credential row, and each has salt length 48, verifier length 64, iterations 100000, and source hash length 64; verify hashes match current profile `pinHash` without revealing them.
3. Run `credential_migration_rehearsal.py` in memory on the newest export and demand unchanged noncredential identities for every snapshot and all association records.
4. Generate a specific migration transaction with **optimistic concurrency preconditions** for the exact source revision/checksum and row counts, and a private off-site copy of the export. Use a tested Cloudflare D1 transactional batch/rollback mechanism, not 187 unrelated commands that could partially apply.
5. Verify transaction all-or-nothing behavior and a failure injection in a real Cloudflare nonproduction D1 clone using the **exact same Worker build**, not only Miniflare. Ensure timeout/batch-size limits are observed.
6. During the write, preserve session safety; no user may continue editing until post-commit check completes. The old shared access path and temporary enrollment are already disabled.
7. Post-commit check: new `current_state` and every historical `state_revisions` checksum validates; no `pinHash`, `salt`, or `passwordHash` in user profiles; all active `pin_credentials.source_pin_hash` empty; account roles and IDs unchanged; old `audit_events` and HOA data identical.
8. Set `CREDENTIALS_ONLY=enabled` **only after** cleanup passes. Verify actual owner and member login in fresh sessions, owner-only Activity Log, server-verified actor, and user restrictions.
9. Ensure historical restore code can never reintroduce legacy credential properties. Treat all old backups as confidential because they retain historic PIN hashes.
10. Rotate dormant old shared `ACCESS_TOKEN` and `ADMIN_TOKEN` once operational recovery no longer depends on them; keep `PIN_PEPPER` securely backed up.

## STOP / no-go

Current experimental and live Worker code can authenticate against scrubbed profile/verifier rows, but no fully tested *atomic production-history cleanup endpoint or transaction* exists. Do not run direct `UPDATE pin_credentials SET source_pin_hash=''` yet: with unsanitized current profiles, login fails. Do not enable `CREDENTIALS_ONLY` or make direct D1 edits without the validated all-or-nothing transaction.
