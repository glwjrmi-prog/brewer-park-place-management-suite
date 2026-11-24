# BPP production API source review — 2026-11-24

**STATUS: REVIEW ONLY — DO NOT DEPLOY**

Reviewed attachment: `BPP-Production-Worker-Review.js.txt` (1030 lines). JavaScript syntax checks pass, but the first 10 lines expressly identify the file as a **research prototype not approved for production**, and `API_VERSION` is `bpp-v9-peppered-pin-experiment-not-for-production`. Therefore this is **not verified current deployed production source**. Do not replace the production Worker with it.

## Relevant confirmed implementation details (candidate only)
- Lines 56–65: PIN auth and legacy rollback branch; `/api/auth/me` exposes role.
- Lines 89–95: `GET /api/state` and `POST /api/state`; no dedicated work-order import endpoint.
- Lines 273–290: top-level state array shapes and duplicate Work Order IDs validation.
- Lines 354–392: server stamps authenticated actor and audit events into new/changed records.
- Lines 407–433: authoritative state held as JSON in D1 `current_state` row.
- Lines 466–564: state update checks `baseRevision`, preserves top-level modules and record IDs, stamps state and audit, uses `env.DB.batch` with a revision-qualified update and returns a 409 on conflicts.
- Lines 674–824: PIN session and credential migration details — explicitly prototype-only.
- Lines 917–982: access profile protection.
- No verified secure server-to-server proof for imported resident staging requests; no atomic imported-source uniqueness index.

## Required import contract
1. Board must explicitly approve real-work-order creation; never automatically import resident submissions.
2. Only a verified Association responsibility decision may import; shared/disputed remains held for further Board resolution.
3. Live API must authenticate an actual non-legacy administrator session; must fetch verified staging request/draft details through a scoped server-side trust channel, not trust client-supplied `responsibility` or `description`.
4. Server-side atomic uniqueness by originating request ID, plus unique allocation of `WO-YYYY-NNN`. Do not rely only on an in-memory source marker.
5. Use current revision checking and append-only audit, without losing other state modules.
6. All untrusted descriptions should be rendered as plain text. No vendor assignment or costs; no vendor notification.
7. Fake `TEST-UNIT-002` is never imported into the live Suite.
8. Do not add a privileged endpoint based solely on a static browser token, open CORS, or a private-origin variable.
9. Use a non-production D1 clone and representative anonymized maintenance data to test double-submit, concurrency, stale revisions, role refusal, id collisions, and rollback.

## Next required evidence
Obtain an exact current deployed `bpp-management-suite-production-api` source snapshot (not a locally named research candidate), plus its current API version and binding names (not values), before preparing a deployable production patch.

This document is a record of engineering review, not a sign-off or deployment instruction.
