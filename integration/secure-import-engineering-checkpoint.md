# BPP secure live work-order import — implementation checkpoint (2026-11-24)

**Status: offline engineering candidate; NOT DEPLOYED**

A staging-safe candidate was created and tested locally against the production Worker source supplied from the Cloudflare `bpp-management-suite-production-api` code editor (deployment label `dc43dd9c`). The source starts with a research-prototype / not-approved-for-production warning; this must be reviewed as a real release caveat, not presumed outdated.

Candidate files in the conversation artifact `BPP-secure-import-engineering-candidate.zip`:
- `import-d1-transaction-candidate.mjs`: strict admin/source/revision guard, unique source-request/import-link D1 schema, and preparation of four D1 statements (source-link, history snapshot, revision CAS, audit event). It does not execute queries, expose an endpoint, or change production.
- `import-d1-transaction-candidate.test.mjs`: offline assertions for role refusal, legacy refusal, owner/unreviewed refusal, wrong draft, revision conflict, unique index syntax and batch-result classification.
- `README.md`: blocked dependencies and release gates.

Local Node syntax check and static assertions passed. This does **not** establish correctness on Cloudflare D1 nor eliminate the need to test actual transaction rollback and concurrency on a nonproduction D1 clone.

**Blocking dependencies before any deployment:** implement an authenticated service-binding read from staging (a Board-approved request must never be asserted solely by browser JSON); verify PIN hardening and legacy rollback posture in the actual deployed environment; choose distinct production import authorization (nonlegacy administrator + explicit preview confirmation); test atomic uniqueness, id generation, revision conflicts, state-module preservation, audit and retry outcomes. The fictional TEST-UNIT-002 draft must not be imported into live work orders.

No production API files, Cloudflare bindings, staging flags, or work-order records were changed during this checkpoint.
