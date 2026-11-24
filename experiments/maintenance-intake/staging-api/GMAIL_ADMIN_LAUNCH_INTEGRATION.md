# Gmail PIN administrator launcher — staging integration plan

This is a **review-only change**. Do not publish on the live Suite until the
real PIN authentication response and code loading order are verified.

## Existing pieces verified in repository
- `production-prep/PIN_BRIDGE_CANDIDATE.js` stores the PIN bearer in
  `sessionStorage['BPPMS_V9_PRODUCTION_PIN_USER_SESSION']` and verifies the
  bearer against `/api/auth/me`.
- `gmail-suite-launcher.js` opens the isolated setup page from a user click,
  checks the current PIN bearer at the production authentication endpoint,
  and transfers it using exact-origin `postMessage`. No token in URL.
- `gmail-suite-admin-control.js` is a small optional control that calls
  `bppLaunchGmailSetup`; it exposes no PIN or secret.
- The staging Worker must remain `STAGING_INTAKE_ENABLED=false`.

## Integration after code review
1. Load `gmail-suite-launcher.js` and
   `gmail-suite-admin-control.js` in the **authenticated Management Suite**
   page only, after approval; do not insert into public resident website.
2. In the existing `v9Boot` flow, **after** `verifySession` returns
   `currentUser` and authoritative access verification succeeds, call
   `window.bppInstallGmailAdminSetupControl?.(currentUser.role==='admin' &&
      currentUser.active!==false)`. Do not call from unauthenticated UI.
3. Confirm actual `/api/auth/me` response includes exactly the role and
   id fields required by `suite-admin-verifier.mjs`. Confirm whether
   `board@bppcondos.org` is a genuine Workspace mailbox (not only a
   forwarding group or alias).
4. Verify a non-admin never sees the button; administrator click opens the
   setup popup; session transfer is origin-restricted and no token is logged.
5. Verify the Google consent screen is genuinely signed into the
   `board@bppcondos.org` account. Consent must be user-initiated.
6. Confirm `STAGING_INTAKE_ENABLED=false` both before and after consent.
7. Keep the entire production Management Suite unchanged until approved.

No Gmail emails are sent by this UI control, and no Google OAuth credentials
are stored in client-side code.
