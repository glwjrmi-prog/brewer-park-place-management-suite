# Maintenance Intake — isolated design prototype (19 Nov 2026)

**NOT PRODUCTION.** The files in this folder are an experimental resident intake / board review UI only. Do not merge or deploy them as-is. `index.html` works as a standalone static page, keeps fictitious requests in memory only, and makes **no** network requests.

## Scope implemented
- Resident request intake: unit/location, area, issue type, description, escalation flag.
- Simulated request ID and pending-board-review queue.
- Board reviewer can select a responsibility classification and priority, enter notes, and approve a *demo-only* decision.
- Resident receives an acknowledgement only, **never** an unreviewed AI ruling.
- Emergency warning and explicit production-disconnect banner.

## Deliberately not implemented
- No Cloudflare endpoints, Policy Advisor calls, real AI assessment, resident authentication, uploads, notifications, durable persistence, live website, or Management Suite work-order writes.
- This prototype's board tab is **not access-controlled**. It is a presentation mockup, never a real board view.
- Demonstration IDs are not valid work-order IDs. Placeholder categories are not legal advice.
- No real Maintenance Matrix, Master Deed, or Bylaws content was verified in this branch.

## Required implementation gates before any live integration
1. Identify the canonical Maintenance Matrix / deed / bylaws / rules versions. AI must quote or reference exact provisions and signal ambiguity; separate *responsibility for work* from *responsibility for cost*. Default to human review.
2. Resident authentication / per-unit authorization, CSRF protection, rate limiting and anti-abuse, safe attachment handling, validation, and redaction of private resident information in AI context.
3. Server-owned intake ID plus idempotency key and duplicate detection. Do not let browsers write authoritative work orders or forge priority/status/board approval.
4. Integrate only via a dedicated authenticated Cloudflare endpoint with explicit role checks and strict staging D1 binding. Never use production token, cookie, Worker binding, or production D1.
5. Preserve Management Suite v9 authoritative revision protections (stale-save rejection, destructive-change blocking, backup/history/restore, audit provenance). Ensure append-only request intake cannot overwrite the current state.
6. Separate board-only AI memo from resident-visible acknowledgement. Reviewer identity, document references, and decision timestamps must be audited. Do not make acceptance of AI recommendation mandatory.
7. Test duplicate submission, invalid request, conflicting documents, urgency escalation, rejected request, multiple users at once, stale revisions, no network, failed AI, upload abuse, unauthorized board access, audit and rollback.
8. Obtain explicit owner approval **after** staging acceptance tests. Then and only then plan a separately authorized production release.

## Safe demo
Open `index.html` from this branch as a static page and use invented unit details. Refresh clears all data. Do not enter resident personal information.
