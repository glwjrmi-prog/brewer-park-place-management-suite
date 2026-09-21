# Brewer Park Place Management Suite — Data Safety Staging (v9)

This staging area is intentionally isolated from the live Management Suite. Nothing in this folder is deployed to production.

## Goal

Make the cloud copy the single authoritative database so every authorized board member opens the same current data automatically, while preserving recoverable history for every save.

## Phase 1 architecture

The first safe upgrade keeps the existing Management Suite user interface but changes how the data is stored and synchronized:

1. **Authoritative server state** — the browser no longer decides which copy is newest.
2. **Monotonic revision number** — every successful save increments the server revision.
3. **Optimistic concurrency** — every save must include the revision the browser originally loaded. If the server has moved forward, the stale save is rejected with HTTP 409 rather than overwriting newer work.
4. **Full revision history** — the prior state is copied into a revision-history table before every successful save.
5. **Integrity validation** — saves are rejected if they contain duplicate work-order IDs or if protected record collections unexpectedly shrink.
6. **Read-only offline behavior** — if the cloud cannot be reached, the last-known data may be displayed but editing should be disabled.
7. **Automatic refresh** — clients poll for a newer server revision and reload automatically when there are no unsaved local edits.
8. **Server-owned sync metadata** — revision, saved time, and saved-by fields are written by the server, not trusted from the browser.

## Why this solves the rollback problem

The previous architecture could end with a browser holding an older complete JSON object and later replacing the cloud copy. Under v9, a browser that loaded revision 148 cannot overwrite revision 149. The server rejects the request and instructs that browser to reload.

A record-count reduction is also treated as destructive. Normal edits may change records, but they may not silently make entire work orders or violations disappear.

## Phase 2

After Phase 1 is stable, records can be normalized into separate server rows so work orders, violations, projects, inspections, vendors, and attachments have independent permanent IDs and per-record revision history. Phase 1 does not require that larger migration and gives us strong protection sooner.

## Production rule

Do not merge or deploy this staging branch until the test plan passes with a copy of the recovered Management Suite data. Never commit real resident/board data or access keys to this public repository.
