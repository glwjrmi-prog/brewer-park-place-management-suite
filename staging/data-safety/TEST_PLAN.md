# v9 Data Safety Acceptance Test Plan

Production must not be changed until these tests pass against a staging database containing a copy of the recovered Management Suite data.

## Baseline

- Import the recovered database into staging only.
- Confirm the staging counts match the recovery source before testing.
- Confirm no resident data or access tokens are committed to GitHub.

Current verified staging baseline: 57 work orders, 61 violations, 10 projects, 0 inspections, 40 vendors.

## Tests already passed

- [x] D1 staging database initialized from recovered master data.
- [x] Multi-user automatic update: a second signed-in tab received the newer revision automatically.
- [x] Stale-browser collision: HTTP 409 / `REVISION_CONFLICT`; newer user's data was not overwritten.
- [x] Record-loss protection: HTTP 422 / `INTEGRITY_BLOCK`; 57 work orders remained intact.
- [x] Revision history: prior revisions remained available after later saves.
- [x] Real-interface simultaneous-edit test: stale editor was refused and latest cloud data reloaded.

## Required tests

### 1. Fresh login always receives cloud authority
Open the staging Suite in two separate browser profiles. Both must load the same server revision and the same record counts before editing is enabled.

**Pass:** both clients show identical revision/counts and editing is unavailable until cloud load completes.

### 2. Normal save
Client A edits one work order and saves.

**Pass:** server revision increments by exactly one; history contains the prior revision; Client B receives the newer revision on refresh/poll.

### 3. Stale-browser collision
Load the same revision in Client A and Client B. Save a change from A. Without refreshing B, attempt to save from B.

**Pass:** B receives HTTP 409 / REVISION_CONFLICT. A's saved data remains unchanged. B cannot silently retry its stale full-state save.

### 4. Record-loss protection
Starting from the current revision, intentionally remove one work order from the outgoing JSON and attempt a normal save.

**Pass:** save receives HTTP 422 / INTEGRITY_BLOCK. Current cloud record count and record IDs remain unchanged.

Repeat for violations and inspections.

### 5. Duplicate-ID protection
Create a duplicate work-order ID in staging and attempt to save.

**Pass:** HTTP 422. Cloud data is unchanged.

### 6. Offline behavior
Load staging successfully, then make the API unavailable and attempt to edit.

**Pass:** application switches to read-only. Existing information may remain visible, but no editable transaction can be queued for an automatic later overwrite.

### 7. Revision history
Make at least five legitimate saves.

**Pass:** `/api/history` lists the previous states with revision, date/time, actor, record counts, and reason.

### 8. Restore test
Using administrator authorization, restore a prior revision.

**Pass:** restore creates a NEW revision; it never rewinds or deletes history. The pre-restore current revision remains available in history.

### 9. Imported-old-backup test
Load current staging data, then try to submit an older backup that omits newer IDs.

**Pass:** integrity protection blocks it unless an administrator explicitly performs a controlled restore.

### 10. Simultaneous rapid saves
Use two clients to issue near-simultaneous saves from the same base revision.

**Pass:** exactly one succeeds. The other receives a conflict. No partial or merged-corrupt state appears.

## Full Management Suite integration tests

The full v8.32 interface must be tested with the D1 bridge before production cutover. Staging route: `/full/` on the staging Pages project.

- [ ] Dashboard loads the authoritative D1 counts and never renders an editable local/seed copy before cloud verification.
- [ ] Work Orders: create, edit, close, vendor assignment, costs, notes, attachments, and explicit deletion all create protected revisions.
- [ ] Violations: create/edit workflow, policy fields, communications/case-manager data, and fines remain functional.
- [ ] Projects: create/edit, linked work orders, milestones, costs, and attachments remain functional.
- [ ] Vendors: profiles, contacts, service history, and edits remain functional.
- [ ] Property Records: indexing and linked-record views remain functional.
- [ ] Knowledge Base remains functional.
- [ ] Board Report reads the authoritative state and report notes remain intact.
- [ ] Google Drive picker/attachments work from the staging origin or the required OAuth origin is added before production.
- [ ] Authorized-user PIN login and audit stamps use the D1-authoritative `_access` data.
- [ ] Backup export remains available as secondary insurance but is not required for normal multi-user operation.
- [ ] Force Upload is disabled; no browser can blindly replace the authoritative database.
- [ ] When D1 cannot be verified, save operations are blocked/read-only.

## Production cutover requirements

All core data-safety tests and all full-suite regression tests must pass. Then:

1. Export a final production backup.
2. Bootstrap the new production database from the verified current state.
3. Verify record counts and several known attachments/work orders.
4. Switch the production client to the authoritative API.
5. Keep the old cloud endpoint read-only for a rollback window.
6. Monitor revision history and audit events during the first board-user rollout.

## User experience requirement

Normal board users should only need to sign in. They should not be asked to choose upload/download direction, select which copy is newer, or manually reconcile browser storage. Those are administrative recovery functions only.
