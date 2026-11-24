# BPP resident intake integration — verified release gate status

**Status: NOT READY TO DEPLOY. No staging or production modifications made in this checkpoint.**

## Source snapshots reviewed

| Artifact | SHA-256 | Status |
|---|---|---|
| `BPP-Verified-Review-Staging-Worker-CANDIDATE-v6.js` | `131856c439ddc5bbf3072a2c5de29f5929dab7c65deb611deafa1df20315ac02` | Locally syntax checked, not proven identical to deployed staging Worker |
| `BPP-Production-Worker-Review.js.txt` | `463ebb430f14aefb807195ae57a65a2f9e30662fed291a969fed97925971c291` | Copied by administrator from production Cloudflare editor, source carries RESEARCH PROTOTYPE warning |

## Regression suite actually executed (local, Nov 24, 2026)

- v2 behavioral: PASS, 9 cases
- v3 behavioral and CORS: PASS, 14 cases
- v4 behavioral and CORS: PASS, 14 cases
- v5 Board read-access gateway: PASS, 5 cases
- v6 scoped Board permissions: PASS, 6 cases
- SQLite review and migration replay: PASS
- Secure work-order import v2 Node guards/SQL: PASS
- SQLite import atomic rollback, duplicate source/draft/WO IDs, audit and unrelated-module preservation: PASS
- Staging Worker v6 JavaScript syntax: PASS

All tests used **mock Worker bindings or local SQLite**, NOT actual Cloudflare D1 or the live endpoints. Older suite tests do not necessarily exercise all v6 code. The v6 staging Worker and production Worker remain separate, unapplied source files.

## Remaining external checks — hard blockers

1. Obtain current deployed staging Worker version, compare to candidate. Preserve later Gmail OAuth/outbox and resident privacy fixes.
2. Isolate a D1 clone; confirm schema and safely apply additive verified reviewer migration there.
3. Run actual Cloudflare service-binding PIN-auth and concurrent review/draft tests against that clone.
4. Verify Board members have specific permission without becoming production administrators; ensure resident requests don't expose other residents' data.
5. Define trusted staging-to-production read endpoint and atomic production import procedure; test under D1 concurrency. Never import fictional `TEST-UNIT-002`.
6. Examine deployment warning and legacy rollback settings on production Worker before release.
7. Human approval of controlled rollout, safe rollback plan, and end-to-end notification tests.

## Operator action policy
Do not ask user for keys. Do not claim live integration based on offline tests. Avoid instructing user to deploy candidate Workers. A GitHub repository connector can edit design and test files but **does not grant Cloudflare Worker/D1 control**. The next actual functional milestone requires connected Cloudflare access (such as a user-operated Cloudflare console or Work Cloud Browser) with an isolated test environment.

## QA runner
A one-shot local runner was prepared as `run-offline-qa.sh` in the conversation's verified QA package; it assumes the package root contains the exact corresponding candidate and test files. **Do not use it as a production deployment command.**
