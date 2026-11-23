# BPP live Resident Policy Advisor verification — November 23, 2026

## Independently checked (no secrets, no resident questions sent)

- Community Hub `glwjrmi-prog/brewer-park-place-condos` main `index.html` links the Resident Policy Advisor button to `https://bpp-resident-advisor-public.glwjrmi.workers.dev/` (not the retired `bpp-resident-policy-advisor` endpoint).
- The public Worker URL returned HTTP **200**, an HTML question-entry form and Cloudflare Turnstile markup, with no instruction for residents to enter an API key. GitHub Actions read-only check: **45218256526**, job **137845166980**. The test made one GET request, not a resident question POST.
- The existing private maintenance-intake Worker is a **different** Cloudflare service, `bpp-maintenance-intake-staging`, default disabled. Its new code is not an update to the live Resident Policy Advisor.
- An earlier source file uploaded November 20 (`bpp-resident-worker.js.txt`) contains the prior Rules/Policy guidance and older vector store ID `vs_6a8a42e54954819186e4e74e5bc3d2da`. This file is **historical**, not an attestation of today's deployed live Worker. Do not use it to overwrite the live version.
- Previous deployment history records that the secure public Worker had been verified with Turnstile, quota protections, and a different vector store `vs_6b01a1b2a4e48191a0da38996316e251`; the live Cloudflare deployment's full current source, version hash, and vector-store contents are **not independently readable through our connected GitHub account**.

## Governing document currency: not yet verified

- Public sale records for BPP identify a Kent County Condominium Subdivision Plan No. 714, earlier 2005 and 2014 instruments, and **Consolidating Master Deed instrument 20201215-0120440**. These legal-description references are corroborating leads, not the recorded deed text itself.
- Kent County Register of Deeds offers free *index searches* for documents recorded since 1970; copies/downloads are charged per page. Official access: https://www.kentcountymi.gov/1892/Online-Deeds-Search
- The November 2025 Rules were previously confirmed as current by the BPP user, but we have **not proved** that all recorded amendments/Exhibit A Bylaws and maintenance allocation documents are present in the public Advisor's retrieval corpus.
- The September 2020 BPP bylaws packet is marked **proposed**; do not assume adoption or use as authoritative until the recorded instruments are verified.

## Release decision

**Public website link and question form are reachable and active.**
**Do not claim the AI answers or source document library are current or legally complete.**
**No changes to live public Worker, source corpus, DNS, WordPress, or Management Suite have been made.**

Next gated checks:
1. Read the deployed live public Worker version and source references in Cloudflare *without exposing OPENAI_API_KEY, Turnstile secrets, tokens or email addresses*.
2. Confirm the exact live vector store's **file list**, effective rules date, full recorded 2020 deed, Exhibit A Bylaws, maintenance matrix and all later amendments; compare to authoritative recorded documents.
3. Run a small set of controlled source-cited questions after source validity is confirmed, including parking, garage doors/opener, storm doors, pets and antennas. Confirm the answers distinguish Board determinations and direct governing language from practical suggestions.
4. Change production only after a protected backup and explicit approval, then repeat the acceptance tests.
