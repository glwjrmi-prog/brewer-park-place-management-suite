# Urgent maintenance notification design (board decision recorded November 19, 2026)

## Confirmed board direction
For potential urgent property maintenance, alert **every active board member simultaneously**. No single permanent emergency contact or phone number currently exists.

## Safety rules
- Fire, gas leak, medical emergency, immediate threat: call 911. The online form is not a monitored emergency dispatch service.
- For property issues, immediately show resident instructions to contact an available board representative by the association's separately verified contact method. **Do not invent a BPP emergency telephone number.**
- Submission receipt must NOT say that anyone has responded or that a contractor is on the way.
- Urgency classification is a triage signal, not an authorization to spend money or proof of HOA responsibility.
- A notification delivery attempt does not mean a board member has read it; require explicit acknowledgement.
- Avoid alarming all board members for routine cosmetic maintenance.

## Proposed server flow (NOT YET DEPLOYED)
1. Authenticated resident submits urgent concern, supplying description/location and optional securely stored photos.
2. Server creates unique intake ID and persists an immutable event.
3. Server snapshots **currently active board recipients** from authoritative account roles (not hard-coded email list).
4. Notification outbox records one event per recipient, with status queued/sent/failed and provider message ID. Do not disclose all recipient addresses to residents; use separate deliveries.
5. Send promptly through a provider chosen later, with idempotency on incident/recipient/channel to prevent duplicate alerts.
6. Board queue shows **Unacknowledged**, until an authorized board member claims coordination; compare-and-swap protects concurrent claims.
7. Claim records who acknowledged, when, and contact/action taken. Notify remaining board members of the claim.
8. If acknowledgement does not occur in the board's approved time window, use a **board-approved** escalation plan. Do not promise automatic phone calls or dispatch unless those services are configured and tested.
9. Resident sees acknowledgement/status only when appropriate, without board-only information. Resident may add new information without duplicating the incident.
10. Every transition is audit-logged. Failed email or queue processing must remain visible to board; do not silently discard.

## Items to decide before real notifications
- Primary verified email address for each active board member, plus consent to use it for urgent alerts.
- Who is authorized to engage emergency contractors, and emergency spending authority under BPP governing documents.
- A reachable, tested emergency contact method for residents if the website is unmonitored.
- Escalation/backup timeline and who follows up if nobody acknowledges.
- Verify email service, delivery tracking, abuse/rate limiting, and data minimization (avoid sensitive resident details in unsecured notification content).

## Release controls
Development documentation only. No actual alerts are sent. No contact data, real residents, active Management Suite records, or production service has been changed. Explicit owner approval required before rollout.
