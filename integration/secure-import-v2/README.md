# Secure work-order import v2 — offline transaction tests

**NO DEPLOYMENT.** There is no production import route here. No Cloudflare credentials or resident data are in the repository.

This package improves the import transaction contract by requiring verified Board reviewer provenance, explicit production administrator confirmation, and revision-safe D1 statement construction.

- `secure-import-v2.mjs` — guards and SQL statement construction; never calls a database or network itself.
- `secure-import-v2.test.mjs` — exercises invalid roles, unverified review, owner/shared status, no approval, stale revision and SQL generation.
- `sqlite-import-atomicity.test.py` — executes the SQL contract against **SQLite in memory**, checking rollback on stale revision and duplicate source/draft/WO IDs, audit append and preservation of unrelated modules.

This does NOT prove Cloudflare D1 concurrency behavior. Actual D1 clone tests and code-to-deployed-source comparison remain release blockers. The fictional TEST-UNIT-002 source must not be imported.

**Additional finding:** ChatGPT has GitHub repository write access but no connected Cloudflare D1/Workers deployment tool. It cannot independently apply a database migration or run tests against the isolated Cloudflare D1. No new secrets or Terminal steps are currently needed from the user.

See `integration/verified-board-identity/` for the isolated staging identity migration and reviewer checks. Work-order import remains disabled by default.
