# BPP — production PIN enrollment without interrupting the existing Suite

**Not a deployment authorization.** This document describes a planned, operator-controlled transition. No sensitive real PINs, Cloudflare secrets, production SQL exports, or residents' data should be committed to GitHub.

## State verified by operator on November 5, 2026

- Original production Worker: `bpp-management-suite-production-api`, currently working version prefix **235eae41** (full Cloudflare version ID must be retrieved before an emergency CLI rollback).
- Existing GitHub Pages site still works with both original accounts; System Administrator and authorized-user logins succeeded.
- Production D1: `bpp-management-suite-production`, revision **187** before the authentication schema migration.
- SQL backup `bpp-production-before-pin-2026-11-05.sql` is in the user's private Linux home folder (~18 MB).
- Additive `pin_credentials`, `pin_sessions_v2`, `pin_attempts` tables and two session indexes installed; verified snapshot revision remains 187 and credentials count was 0.
- Production Worker settings already include encrypted `PIN_PEPPER` and the correct owner `SYSTEM_ADMIN_USER_ID`. Their values must not appear in source files.
- A test Worker/D1 clone completed test user logins, PIN resets, privacy permissions and full-Suite integration. `WORKER_PIN_RELEASE_CANDIDATE.js` adds only a temporary host-locked browser enrollment page to the tested Worker logic; GitHub CI uses synthetic D1 data.

## Temporary compatibility settings — set before the Worker changes

These are temporary **production Worker runtime variables**, not secrets, and are intentionally ignored by the currently working Worker version:

- `LEGACY_ADMIN_ROLLBACK=enabled`: permits existing production website's shared cloud key while the new Worker is active.
- `LEGACY_STATE_COMPAT=true`: preserves the old website's original login state during the transition.
- `PIN_ENROLLMENT_OPEN=enabled`: enables only `https://bpp-management-suite-production-api.glwjrmi.workers.dev/pin-enrollment` on the exact production Worker hostname. The same page will be unavailable if this variable is disabled or missing.

These settings maintain **temporary legacy shared-token exposure**. During this short window, browser edits are not yet guaranteed to be attributable to a verified individual. They must be disabled promptly after both accounts are confirmed and the secure frontend is deployed. Keep the historical shared cloud keys secret, and do not expose them in chat or public code.

## Controlled release sequence — do not skip steps

1. Operator reviews current live revision, working website, and **fresh backup** immediately before cutover. Retrieve exact Worker rollback target using `npx wrangler deployments list --name bpp-management-suite-production-api` (read-only; full version ID can be obtained using Wrangler versions list if needed). Record current GitHub `main` commit for website rollback.
2. Add the three temporary compatibility variables above to the **production Worker only**. Since the old Worker ignores them, verify the live website still works and no database revision changed. Do not add `TEST_MODE` or deploy the isolated test Worker to production.
3. **Require an explicit go/no-go** from the operator before replacing the production Worker's JavaScript with `production-prep/WORKER_PIN_RELEASE_CANDIDATE.js` from the release branch. Confirm the correct worker name and unchanged production D1 binding before clicking Deploy.
4. On production Worker new version, check `/health`; verify the existing GitHub Pages Suite still works with one old login while legacy compatibility is temporarily active. If it fails, roll back Worker code to the known working version before any credential-history or website migration and recheck revision.
5. Use exact production-host URL `/pin-enrollment` to sign in once as each preexisting account with its **own existing six-digit PIN**. The page checks `/api/auth/me` and signs out immediately. It never displays PINs or tokens. Account names are blank by default; users type the real names. Do not send PINs through ChatGPT. If either fails, stop, retain legacy site, resolve the account, and do not proceed.
6. Read-only verify `pin_credentials` has exactly the existing active account IDs (no PIN hashes printed). Confirm both authorizations with the verified sign-in result and a comparison against `current_state._access.users`. Only after both pass, proceed to website deployment.
7. Switch the GitHub Pages loader **and** server-authenticated bridge together using `production-prep/PRODUCTION_PIN_LAUNCHER_CANDIDATE.html` as site `index.html`, with `production-prep/PIN_BRIDGE_CANDIDATE.js` already available at the same branch/merged location. Do not change the site's publicly deployed main branch until the source path is present in main; the loader's relative path would otherwise fail.
8. Test Gordy's new login, private activity, view/edit of known BPP record and cloud revision; then test Jennifer's new login and absence of private activity, and sign out. Do **not** delete or modify real work orders for a test. Check record counts and stable IDs.
9. Disable `LEGACY_ADMIN_ROLLBACK`, `LEGACY_STATE_COMPAT`, and `PIN_ENROLLMENT_OPEN` production variables. Confirm old shared token no longer authenticates, and PIN sessions continue working. Rotate/revoke the former `ACCESS_TOKEN` and `ADMIN_TOKEN` when recovery is provided by a separate authorized method.
10. **Historical SHA-256 PIN hashes remain in current and revision snapshots** until a separately implemented and tested credential-only migration removes them. The current automated in-memory scrub is **not a production Cloudflare migration**. Do not declare complete security hardening or turn `CREDENTIALS_ONLY=enabled` on until a preservation-checked production scrub is available. Never apply the isolated `/test/scrub` endpoint to the production database.
11. Produce a post-cutover backup and a separate status note. Rollback Worker and website **as a pair** if needed. Database data is not rolled back by Worker rollback; historical state restores may overwrite subsequent edits and reintroduce insecure verifiers.

## Recovery

- Cloudflare official dashboard: Workers & Pages → Worker → Deployments → the three dots on an **older** stable version → Rollback. The current active version's three-dot menu displays only View logs. Rollback creates a new active deployment; it does not alter D1. Source: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/
- Wrangler alternative: `npx wrangler rollback FULL_VERSION_ID --name bpp-management-suite-production-api`. Obtain the exact full version ID first; do not guess a prefix or invoke without an incident requiring recovery.
- GitHub Pages: restore saved previous `main` website loader+bridge commit together. Do not restore the SQL database unless a separate data recovery procedure explicitly calls for it.
