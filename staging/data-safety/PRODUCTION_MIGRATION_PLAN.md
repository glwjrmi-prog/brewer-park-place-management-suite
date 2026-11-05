# Brewer Park Place Management Suite v9
## Production Migration Plan

Status: **STAGING ONLY — DO NOT CUT OVER YET**

The authoritative D1 architecture has passed these safety tests:

1. Stale-client save is rejected with `409 REVISION_CONFLICT`.
2. Destructive record loss is rejected with `422 INTEGRITY_BLOCK`.
3. Revision history is retained.
4. Multi-user polling updates a second user automatically.
5. Concurrent editing of the same work order protects the newer save.

## Critical cutover rule

Production must not be switched to v9 until the **full existing Management Suite**, not only the work-order staging shell, uses the authoritative D1 save/load path.

The current production interface contains functionality beyond the staging work-order shell, including:

- Dashboard and system check
- Property records
- Inspections
- Work orders
- Violations
- Projects
- Vendors and vendor contacts
- Knowledge base
- Board report generation
- Google Drive picker / attachments
- Document-folder links
- Backup/export tools
- Audit/user metadata

All of these must continue to work after the persistence layer changes.

## Implementation approach

Do **not** replace the mature production UI with the simplified staging shell.

Instead:

1. Copy the current production `index.html` into an isolated v9 staging build.
2. Replace the legacy browser/KV persistence path with the tested D1 authoritative-state client adapter.
3. On page load, fetch the latest server revision before enabling editing.
4. On save, send `baseRevision` with the complete state and accept the save only when the server confirms the next revision.
5. If the server returns `REVISION_CONFLICT`, discard the stale attempted upload, fetch the latest server state, and notify the user.
6. If the server returns `INTEGRITY_BLOCK`, preserve the server state and explain exactly what was blocked.
7. If the server cannot be reached, show cached data read-only; do not permit quiet offline edits that can later overwrite cloud data.
8. Keep revision history and audit metadata available to administrators.

## Staging acceptance checklist before production

### Data parity
- [ ] Work orders: 57 recovered records present
- [ ] Violations: 61 records present
- [ ] Projects: 10 records present
- [ ] Vendors: 40 records present
- [ ] Inspections: expected current count present
- [ ] Knowledge base data present
- [ ] Property records present
- [ ] No unexpected count regression after repeated reloads

### Work orders
- [ ] Create
- [ ] Edit
- [ ] Close/reopen
- [ ] Vendor assignment
- [ ] Cost fields
- [ ] Notes
- [ ] Existing attachments remain visible
- [ ] New Google Drive attachment can be added
- [ ] Next ID is generated from highest ID, not record count

### Violations
- [ ] Create/edit/close
- [ ] Status transitions
- [ ] Resident/property linkage
- [ ] Attachments and notices
- [ ] No duplicate case IDs

### Projects
- [ ] Create/edit/complete
- [ ] Vendor/cost fields
- [ ] Attachments
- [ ] Completed-project reporting

### Inspections
- [ ] Create/edit/complete
- [ ] IDs remain unique
- [ ] Results persist across users

### Vendors
- [ ] Create/edit vendor
- [ ] Vendor contacts preserved
- [ ] Existing work-order vendor references remain intact

### Knowledge base / property records
- [ ] Existing entries display correctly
- [ ] Edits persist through D1 revisions

### Board report
- [ ] Board report totals match live data
- [ ] Open/closed work orders correct
- [ ] Completed projects included
- [ ] Closed work orders included per current report rules
- [ ] Report remains printable/readable

### Digital office / Google Drive
- [ ] Picker opens
- [ ] Existing attachment URLs remain valid
- [ ] New attachment URLs persist through server revisions
- [ ] Folder/document links remain intact

### Multi-user safety
- [x] Two users see new revision automatically
- [x] Stale save blocked
- [x] Same-record concurrent save blocked
- [x] Destructive count drop blocked
- [ ] Test concurrent changes in violations/projects/vendors

### Failure behavior
- [ ] Disconnect network: data displays read-only
- [ ] Reconnect: newest cloud revision loads
- [ ] No offline edit can later overwrite server
- [ ] Bad/expired credential fails closed

## Production cutover sequence

Only after all acceptance items pass:

1. Export a fresh production backup.
2. Freeze production edits briefly for migration.
3. Create a separate production D1 database.
4. Create a separate production Worker/API.
5. Apply the verified schema and secrets/bindings.
6. Import the latest authoritative production state as Revision 1.
7. Verify counts and several known records, including `WO-2026-059` and attachments.
8. Deploy the full v9 Management Suite UI using the production API.
9. Test from two independent browser sessions.
10. Keep the legacy KV data untouched as rollback evidence until v9 has operated successfully for at least 30 days.
11. Do not delete historical JSON backups.

## Production operating model

The user-facing expectation is simple:

- Open the Management Suite.
- Sign in.
- The newest cloud revision loads automatically.
- Edit normally.
- Saves are revision-checked by the server.
- Other users receive new revisions automatically.
- If the cloud cannot be verified, editing is disabled rather than risking divergence.

Board members should not need to understand backups, localStorage, browser versions, sync direction, or database internals.
