# Resident private access — approved concept, NOT deployed

## User decision
Residents may submit requests without a password. To view “My Requests,” a resident must receive a secure expiring access link by email. Board uses existing separately authenticated Management Suite access. This design is not a real authentication implementation.

## Security requirements for implementation
1. Submission captures normalized validated email and unit. Do not expose resident data in public status APIs, guessed IDs, or responses to email lookup.
2. The “send link” endpoint must always return the same generic response regardless of account/request existence; apply IP/email abuse protection and delivery throttling.
3. Generate a cryptographically random 256-bit token server-side; store only a cryptographic hash and expiry in private database. Never store or log raw magic links.
4. Email a one-time token only to the requested address through an approved provider. Token TTL ~15 minutes; single use with atomic consumption. On use, issue a short-lived HttpOnly Secure SameSite session cookie and rotate it as needed.
5. Bind access to verified email AND permitted request ownership. Server must filter every request and update by authenticated identity. An email field or browser-side filtering alone is NOT access control. Unit number or ticket number never grants access.
6. Consider whether multiple people may legitimately submit for one unit (spouses, tenants, ownership changes); don't automatically grant the entire unit history to every person who knows the unit number.
7. Restrict request updates and photographs to owner of the specific request, or explicit verified delegated authority. Never return board-only AI evaluation, notes, phone lists or other resident data to residents.
8. Enforce rate limits, CSRF defenses, secure referrer and caching policies, email masking, expiration and logout; don't allow untrusted redirect URLs in emailed links.
9. Board accounts use existing role-secure PIN/session service, not a shared board token in a website. Verify authorization server-side.
10. Log access and security events without exposing email addresses/tokens in public application logs. Provide revocation / expired link behavior.
11. Real emails, database writes, and actual access checks must first be integration-tested in an isolated staging environment with synthetic data.

## Demonstration behavior
The static `private-access-preview.html` lets a user *simulate* requesting and clicking an email link within the same browser. It filters sample requests by email client-side. This is **not secure** and must never be offered as an actual resident account or privacy guarantee. It is an educational UX preview only. The board tab is also simulated and not access-controlled.

## Production release
No site changes, notification provider, resident identity service, database migrations, or Management Suite modifications are approved. All production changes require explicit user approval after staging security and acceptance testing.
