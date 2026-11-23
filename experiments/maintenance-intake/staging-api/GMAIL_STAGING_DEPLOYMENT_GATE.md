# Gmail staging deployment gate — 2026-11-23

This preparation lives in a separate branch and **does not deploy** or connect Gmail.
The current Cloudflare Worker is a private maintenance gateway; do not paste the
source entry file directly over its 416-line bundled editor code.

## Current observed state
- Worker: `bpp-maintenance-intake-staging` (Cloudflare Worker, not Suite production).
- D1 binding `INTAKE_DB`: `bpp-maintenance-intake-isolated-staging`.
- `STAGING_INTAKE_ENABLED=false`.
- D1 console confirmed creation of `gmail_oauth_handshakes`,
  `gmail_setup_sessions`, and `gmail_sender_vault`.
- OAuth indexes from the schema files have not yet been confirmed.
- Screenshot shows no Gmail OAuth client, token-vault key, or enabled flag.
- `gmail-setup-worker.mjs` is a SOURCE entrypoint, not the current deployment.

## Before any deployment
1. Verify exact Google Cloud OAuth client setup: owned by BPP, Web application,
   callback `https://bpp-maintenance-intake-staging.glwjrmi.workers.dev/oauth/gmail/callback`,
   consent screen configured for the actual Board Google account, and Gmail
   send-only permission plus OIDC identity scopes.
2. Generate a high-entropy random 32-byte key in a trusted environment and store
   **only as Worker secret** `GMAIL_VAULT_KEY` (base64url). Never paste it in chat.
3. Store `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET` as Worker secrets.
4. Confirm the correct isolated D1, all three tables, and both expiry indexes.
5. Review `gmail-setup-worker.mjs`, authorization tests and the Suite admin
   launcher; confirm exact per-admin PIN session integration and login.
6. Bundle and locally test `gmail-setup-worker.mjs` using Wrangler on a trusted
   development environment. Verify all resident paths return HTTP 503 when
   `STAGING_INTAKE_ENABLED=false`. Confirm OAuth paths return HTTP 503 while
   `STAGING_GMAIL_OAUTH_ENABLED=false`.
7. Deploy ONLY the named isolated staging Worker using
   `wrangler.gmail-staging.toml`, with the Gmail flag still false.
8. Verify private intake still disabled. Only then explicitly authorize and
   set `STAGING_GMAIL_OAUTH_ENABLED=true`; conduct user-initiated admin setup
   from protected Suite, and verify the intended sender is exactly
   `board@bppcondos.org`.
9. Never send a real test email until the Board approves a safe recipient and
   the connection is successfully verified.

## Do not do
- Never enable `STAGING_INTAKE_ENABLED` to make OAuth work.
- Never change the production Suite Worker or its authoritative D1.
- Never copy OAuth secrets, session bearers, or refresh tokens into GitHub,
  screenshots, logs, SQL, URLs, or chat.
- Do not merge this into `main` as a production release.
