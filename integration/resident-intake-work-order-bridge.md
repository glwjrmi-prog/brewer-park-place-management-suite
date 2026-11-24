# BPP resident intake → Management Suite work order: safe integration contract

Status: **DESIGN / NOT DEPLOYED** (2026-11-24). No production mutations are authorized by this document.

## Verified existing systems

- Isolated staging intake accepts authenticated resident submissions and stores `intake_requests` and `intake_events`.
- Board review requires current version; accepted responsibility values include `association`, `owner`, `shared_or_disputed`, `requires_more_information`.
- A staged draft is created only for Board-reviewed `association` or `shared_or_disputed` requests; its unique `intake_request_id` is recorded in `staged_work_order_drafts`.
- Staging draft creation explicitly says **not a Suite work order**.
- The Management Suite's Work Orders are held in `state.maintenance` and its production bridge commits state using `POST /api/state` with `baseRevision`, `data`, `actor`, `reason`.
- The production bridge already treats a revision conflict as a failed save, rather than overwriting newer data.
- Existing suite work-order IDs use `WO-YYYY-NNN` style. A prep candidate contains a safer highest-existing-suffix allocator, but that candidate is labeled NOT DEPLOYABLE; don't assume it is live.

## Required design decisions and invariants

1. No direct staging-to-production write. A board-authenticated Management Suite UI action must explicitly review and approve each import; only the **production** API accepts the final commit.
2. A new server-authenticated endpoint or scoped production API operation should perform the mutation atomically. Avoid a client-side read-modify-write of the entire state unless the existing revision-protection mechanism and all data validation are retained.
3. Externally sourced request text is untrusted. Sanitize display and validate length; never render descriptions as HTML.
4. Preserve provenance in the work order: source intake ID, staging draft ID, Board reviewer/time and responsibility, plus a linkable audit event.
5. Guarantee idempotence: unique source intake request ID and draft ID across imported work orders, checked server-side in the same transaction as the write. Two Board members pressing import concurrently must create at most one work order.
6. Restrict imports to `reviewed` + `association`/`shared_or_disputed` with a staged draft. Reject owner-only/unreviewed requests.
7. No vendor dispatch, expense authorization, or automatic HOA responsibility determination from the integration.
8. If production state revision changes, reject and require fresh review. Do not silently replay against a new state or delete anything.
9. Create an `imported` audit event with production work-order ID and actor; resident-facing details remain separately scoped.
10. Preserve existing resident privacy boundaries; do not send all-unit details in notification emails.

## Proposed contract (not yet implemented)

- **Read-only preview**: authorized Board user selects a staged draft; system fetches a sanitized summary and proposes a new Work Order without committing.
- **Explicit approval**: displays destination fields, source ID, responsibility, status and validation errors.
- **Commit**: server checks current Board session and CSRF, source version, existing external ID, and production revision, allocates unique WO ID, saves atomically, returns canonical work-order ID.
- **Retry**: same source ID returns existing work-order reference, never duplicates it.

## Pending evidence before writing deployment code

- Actual *live* Management Suite maintenance-record schema (required fields, valid statuses and numbering) from the authoritative production UI/API.
- Available production API authorization model for a scoped import operation; no direct Cloudflare production write tool is connected here.
- Safe cross-system trust mechanism from production to isolated staging (service binding or short-lived signed handoff) without transmitting resident/Board tokens through browser links.
- Explicit Board choice about whether a shared/disputed request can become a real work order or should stay as a draft pending additional approval.

## End-to-end acceptance checks

A. One Association-approved staged request produces a preview, then precisely one live WO after Board confirmation.
B. Same request submitted twice to import yields one WO (no duplicate).
C. Simultaneous import attempts create at most one WO.
D. Owner-only/unreviewed/deferred request cannot import.
E. Stale production revision produces a conflict, preserves all other work orders and leaves source unmarked imported.
F. The resulting WO appears in Board's Management Suite and carries source/audit linkage.
G. Resident A cannot read Resident B's request; emails exclude other residents' personal details.
H. Vendor dispatch and public resident submissions remain off until independently approved.

## Current known staging fixture (fictional)

`BPP-STG-c60da294-9883-4a12-b462-938027b87db5` / `TEST-UNIT-002` / Roof-gutters / reviewed version 2 / `association`; staging draft `BPP-DRAFT-785ff524-e441-43f3-b8be-f28e031611c6`. Do NOT import this fictional test into live production.

## Deployment boundary

Do not change `bpp-management-suite-production-api`, `STAGING_INTAKE_ENABLED`, or `STAGING_BOARD_NOTIFICATIONS_ENABLED` as a side-effect of this specification. Preserve current live work orders.


## Verified live Work Order form field mapping (screenshots, 2026-11-24)

| Live field | Proposed mapping / import behavior |
|---|---|
| Work Order ID | Allocated by live Suite using existing numbering policy; observed next suggested `WO-2026-086` at review time; NEVER hardcode it |
| Location | Approved intake unit + optional precise area |
| Priority | Board-reviewed priority (`routine` etc.), validated against the actual Suite dropdown |
| Status | `Open` only after Board confirms a production import |
| Date Opened | Import creation date in Suite's date format |
| Date Closed | Empty |
| Category | Intake category (`Roof / gutters` etc.), subject to production schema |
| Vendor | Blank; no automatic dispatch |
| Issue Description | Sanitized resident-provided description, plus intake request/draft references and explicit Board review provenance |
| Estimate / Actual Cost | Empty; never infer or approve expenditure |
| Variance | Suite-derived default, not explicitly imported |
| Resolution / Completion Notes | Empty on creation; any provenance goes in issue description or dedicated metadata, not a false completion note |
| Google Drive Folder Link | Blank unless a vetted authorized folder already exists for this request |
| Document Index | Empty; use current Suite Drive picker or attach validated links after import, not arbitrary untrusted resident URLs |

Visible UI form has sections: initial ID/location/priority/status; Schedule & Assignment; Issue; Cost; Resolution & Completion Notes; Documents & Photos. All sections are now accounted for; no further screenshot required.

**Pre-launch caveats:** The form proves UI labels/defaults but not its internal JSON property names or production API field validation. The imported record must be built using the exact production schema before deployment. No fake resident fixture (`TEST-UNIT-002`) may be copied to production. The Board should confirm whether shared/disputed responsibility is eligible for a real work order or held until explicitly resolved.

**Recommended rollout:** Implement a Board-side *preview and approve* import workflow rather than automatically generating live work orders at resident submission. Preserve existing revision checks and add server-side source-id idempotency. Preview must show all mapped fields and allow cancellation. Roll back with existing revision history if ever needed, not blind replacement of the full state.


## Historical source-code schema confirmation (2026-11-24)

A July 2026 v6.3.4 Work Order Detail HTML file in the user's file library defines `maintenance` records with exact keys:
`id`, `status`, `dateOpened`, `dateClosed`, `location`, `priority`, `vendor`, `estimate`, `actual`, `category`, `documentFolderUrl`, `issue`, `notes`.
Historical status values are `Open`, `Pending`, `In Progress`, `Waiting on Vendor`, `Waiting on Board`, `Closed`, `Cancelled`.
Historical priority values are `Routine`, `High`, `Emergency`.

The November 24 live UI screenshots visibly match all these labels and sections. However the historical source is **not authoritative evidence of the current production schema**; compare it with the current deployed UI source before a production write. The user uploaded a staging test with no real occupant data. A local read-only preview module and seven tests were prepared in `BPP-work-order-readonly-preview.zip` (conversation artifact); they never call APIs or mutate production.

**Safety note:** Do not reuse the staged fictional `TEST-UNIT-002` as a live work order. The preview builder requires Board review, Association responsibility and a corresponding draft, and tags the source ID in the issue text for duplicate detection. This is an extra preview check, not the atomic server-side uniqueness protection required for production.

## Current integration engineering checkpoint (2026-11-24)

Prepared in GitHub:
- `integration/work-order-import-core.js`: offline mapping, explicit Board-approval preview, strict intake/draft association, unique ID allocation, duplicate-source guard, in-memory revision checks. **No API, no database writes, no production mutation**.
- `integration/work-order-import-core.test.js`: automated coverage of approved preview, duplicate import, owner-only rejection, stale revision, missing approval, source mismatch, and invalid fields.
- `.github/workflows/work-order-import-offline-check.yml`: a scoped offline-only CI workflow; it has no deployment or production credentials.

**Important:** The test workflow has been committed, but a successful run has not yet been independently confirmed in this conversation. The offline module is NOT a deployable production endpoint. Duplicate-source guards must be atomic server-side, and the deployed production API must be inspected before adapting the module.

**Current staging configuration:** private intake and Board notifications were enabled for gated tests; the tested fixture remains fictional and must not be imported into production. Do not describe the private staging as a public resident launch.
