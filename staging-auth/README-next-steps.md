# BPP six-digit PIN authentication — STAGING ONLY

**Do not deploy this branch to the live BPP website or production API.** This branch is for isolated testing with the staging database only.

## Prepared files
- `staging-auth/BPP_Staging_PIN_Auth_Worker_2026-11-03.js`: staging API Worker with project-specific CORS preview support and session checks.
- `staging/data-safety/site/index.html`: Pages preview launcher, which loads the matching bridge locally.
- `staging/data-safety/site/staging-bridge.js`: staging browser bridge (PIN login, no shared key prompt).
- `staging-auth/d1-staging-pin-bridge.js`: editable bridge source.

## Live staging API deployment (manual step still required)
The Cloudflare Workers dashboard does **not** automatically deploy edits committed to this GitHub branch for `bpp-management-suite-staging-api`.
To activate the revised CORS/permissions code:
1. Verify Worker name **bpp-management-suite-staging-api** (never production).
2. Open Edit code in Cloudflare for the latest staging Worker version.
3. Replace only `worker.js` with the entire contents of the staging Worker file linked above.
4. Verify there are no editor syntax errors and the existing **DB** binding targets `bpp-management-suite-staging`.
5. Deploy the **staging Worker only**. Preserve existing secrets, bindings and allowed origins; do not reveal them.

The Pages preview auto-deploys from GitHub but its URL changes with commits. The revised Worker permits HTTPS preview subdomains belonging to `bpp-management-suite-staging.pages.dev`, without allowing other Pages projects.

## Required verification before any production changes
- Administrator and authorized-user PIN login; invalid and inactive login rejection; lockout.
- User cannot access administrator account-management endpoints, even through direct API requests.
- Confirm PIN salts/hashes are absent from ordinary API GET responses.
- Confirm administrator PIN reset/reactivation persists across refresh; old sessions invalidated when appropriate.
- New staging work order receives a previously unused ID; saving produces a new D1 revision; no unrelated record removed/overwritten.
- Session logout invalidates the bearer token.
- Compare *current* production data before any future production migration; never overwrite production from the older staging database.
- Prepare a separate production candidate and rollback plan; do not copy staging data into production.

## Current status
The staging website preview has been prepared; the revised staging Worker code is **committed to GitHub but not automatically deployed**. No production changes have been made in this task.
