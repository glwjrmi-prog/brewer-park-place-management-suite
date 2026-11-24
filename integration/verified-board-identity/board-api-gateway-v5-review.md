# Board API gateway v5 — security integration candidate (not deployed)

## Issue confirmed
The v4 staging worker protected major Board mutations with authenticated Management Suite PIN sessions but allowed **Board GET routes** (list of resident maintenance requests, work-order drafts, supplement history, and read-only policy advice) with only the shared static Board staging token. That token is not a verified human identity. The read routes may expose resident maintenance notes and personal details.

## Change
The v5 candidate adds a central `role === 'board'` permission check immediately after the existing role token gate, before ANY Board GET or POST route is dispatched. It calls `bppVerifiedBoardPrincipal(req, env)`, which verifies the PIN session via the established `BPP_SUITE_AUTH` Cloudflare service binding. Any invalid, missing, expired, or non-admin session is rejected with HTTP 403. The private staging gateway `x-bpp-staging-gate` remains required first. Resident routes are not gated by Board PIN sessions.

## Tests executed locally
- `node --check` on the complete 72KB Worker candidate: PASS.
- 5 mocked-route tests invoked the complete exported Worker fetch through its private staging gateway: missing private gate 401; Board static token without PIN 403; Board static token plus authenticated PIN 200; non-admin PIN 403; absent authentication binding 403.
- Existing v4 function-level tests and offline SQLite tests remain separately available.
- Test coverage is **mocked**; no Cloudflare D1 or live site was contacted.

## Deployment blockers
- Confirm deployed staging source matches the candidate baseline, not just an old downloaded snapshot.
- Apply and validate `verified_board_user_id` additive migration in a disposable staging D1 clone, then controlled isolated staging.
- Verify UI sends valid Board PIN session without exposing or persisting tokens in resident UI; avoid placing tokens in URLs.
- Define Board reviewer permission for role='user' instead of assuming all Board members are admins.
- Test real cloud service binding, concurrent writes, database rollback, email side effects and resident read isolation.
- Do not deploy staging or production from this candidate without controlled review. Production work-order importing remains disabled.

The v5 candidate was saved as `BPP-Verified-Review-Staging-Worker-CANDIDATE-v5.js` in the conversation artifact. There were **no deployed changes**.
