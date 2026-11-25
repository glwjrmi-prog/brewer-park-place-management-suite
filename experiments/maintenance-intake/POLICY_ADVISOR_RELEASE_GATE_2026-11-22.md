# BPP Resident Policy Advisor — staging release gate (2026-11-22)

**No production deployment authorized.** This file is a planning/review artifact on an unmerged draft development branch, not a public website change. Keep the existing production Advisor, Management Suite and bppcondos.org unchanged.

## Verified staging checkpoint (user's Cloudflare screenshots/log)
- Separate staging Worker: `bpp-resident-advisor-staging`; active version `2b3329de-5e1f-499c-af08-abc21728b547`.
- Public `workers.dev` and preview URLs returned to **OFF** after one browser acceptance test.
- No-login resident page rendered with question field, Ask button and source-based answer; guest parking answer matched relevant November 2025 Rules. The worker identified recorded Master Deed and Exhibit A Bylaws in prior garage-door citation test.
- Plain POST without Turnstile token returned **HTTP 403** in a refreshed active-version Cloudflare editor. An earlier editor request returned 200 from an unexplained context; do not infer that every route or prior preview was protected.
- Valid browser question returned HTTP **200**, outcome `ok`; 2026-11-22 11:18:02.216 EST Cloudflare Worker event `wallTimeMs=18785`, `cpuTimeMs=8`. Internal quota `rate` and `reserve` requests appear at 11:17:43 EST; Durable Object dashboard showed 2 requests and 0 errors. This confirms counter invocation, **not** limit-exhaustion behavior.
- 41 local quota checks passed on user's Chromebook; live quota exhaustion is not verified. The configured limit restricts the number of calls, not total spending.
- Responding safely at ~19s is observed once; sample size inadequate for availability or latency guarantees.

## Public website integration — READ-ONLY source review
The current `glwjrmi-prog/brewer-park-place-condos/index.html` has `askResidentPolicyAdvisor()` which:
1. Sends `POST {question}` with JSON to `https://bpp-resident-policy-advisor.glwjrmi.workers.dev/`, **without any Turnstile token**.
2. Displays a basic `Searching Brewer Park Place governing documents...` message; no explicit client request deadline.
3. Renders `data.answer` as plain text, and ignores any `sourceDocuments` array.
4. Handles failures with a generic temporary-unavailable message.
**Do not just replace the endpoint URL with the secured staging URL.** The staging Worker rejects requests lacking verified Turnstile tokens (expected HTTP 403). Deploy a compatible form and backend as a unit after isolated end-to-end testing.

## Proposed production-compatible design (not installed)
- Keep the resident-facing Advisor **public without a login**; existing Suite board/management access remains separate.
- Integrate a Turnstile widget registered for the actual page hostname. The server must validate the token with Cloudflare Siteverify AND verify the returned hostname expected for that page. The current staging widget expects the staging workers.dev hostname; moving the form to `bppcondos.org` requires an appropriate new widget/hostname configuration and verified server check rather than reusing the old expectation.
- Prefer same-origin endpoint/proxy or a carefully configured restricted CORS policy if the actual origin differs. CORS alone is not authentication; maintain bot verification and shared rate/quota checks at the server.
- Preserve non-sensitive `{answer,sourceDocuments}` response; show readable referenced document names, clear loading state, disabled submit while waiting, a bounded timeout and understandable retry/cost-limit messages. Do not render model text as unsanitized HTML.
- Ensure per-question privacy and accessibility (text contrast, keyboard use, easily legible large text); do not ask residents to log in.
- Do not mix a resident maintenance request submission with this Policy Advisor response route; that separate project is protected in draft PR #3.

## Governing-source status
- The staging corpus contains November 2025 Rules & Regulations (user-confirmed current), recorded 2020 Consolidating Master Deed, and recorded 2020 Exhibit A Bylaws. Verify original images in disputed provisions.
- Official Kent County instrument: `202012150120440`, recorded Dec 15, 2020. Contemporary listings still reference this instrument, but that does not rule out later amendments.
- **Unresolved:** complete Kent County grantor/grantee/condominium-document search from 2020-12-16 through 2026-11-22, considering name variants and all amendments. County self-service index is a guide; check any actual recorded instruments with the Board / legal counsel.
- The Association must confirm no later changes to the operative Master Deed/Bylaws and that the Rules uploaded are the adopted current version before production approval.

## Release gates / tests
- [x] No-login staging browser form delivers one source-based answer
- [x] Refreshed staging POST without Turnstile token denied 403
- [x] Quota Durable Object receives rate/reserve requests
- [x] One true request wall time measured at 18.785s
- [ ] Verify Turnstile for actual production-page hostname with valid, invalid, expired and reused tokens
- [ ] Verify global shared minute/day limits **without paying for quota-exhaustion prompts**; use isolated test quota configuration/abuse-test path that never calls OpenAI
- [ ] Verify fallback on exhausted quota, invalid provider response, failed OpenAI call and recovery the following day
- [ ] Add long-running message and safe timeout to resident website; check keyboard and mobile accessibility
- [ ] Perform statistically useful latency / reliability checks with limited permitted test calls; no unbounded repeat tests
- [ ] Validate current recorded amendments/operative source set
- [ ] Prepare and review **separate website staging integration** with no modification to live WordPress/site deployment
- [ ] Board/user gives explicit production authorization after a final review

## Safety
Never copy or commit `OPENAI_API_KEY`, `TURNSTILE_SECRET_KEY`, Wrangler OAuth credentials, resident data or Cloudflare config tokens. Do not merge draft PR #3 or deploy production as part of this gate.
