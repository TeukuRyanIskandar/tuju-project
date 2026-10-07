# Build ticket: ADR-0007 amendment (docs)

Type: task
Status: resolved
Blocked by: 01, 02, 03, 05 (needs the real, shipped shapes from all four)

> Ticket 06 of the spec-06 execution effort — documentation only, deliberately
> last. Spec 06's Further Notes flags this amendment as a deliverable of
> executing the spec. ADR-0012 is the precedent for how an amendment to an
> existing ADR lands in this repo: a new, separately numbered file, not an
> in-place edit to the original ADR.

## What to build

Write the additive ADR-0007 amendment, as **ADR-0013**, now that the real
shapes from tickets 01/02/03/05 are landed (not guessed ahead of time):

- The `trigger: 'system'` enum value and why it exists (the ADR-0005
  trusted system-caller path, extended to cover scheduled/curated AI content
  rather than just price-move-triggered TA/FA).
- The three new job names + payloads, using whatever names tickets 02/03/05
  actually shipped with (expected: `generate-market-brief`,
  `summarize-announcement`, `analyze-prospectus` / `ProspectusPayload`, but
  confirm against the merged code rather than assuming).
- The verdict-less `Summary` variant and why the prospectus artifact needed
  it (no bullish/bearish/over/under-valued axis for a prospectus).
- An explicit statement that all of the above is additive: the existing
  `analyze-technical` / `analyze-fundamental` job types, their payloads, and
  the existing verdict-bearing `Summary` are untouched.

## Acceptance criteria

- [ ] New file `docs/adr/0013-<slug>.md`, following the existing ADR format
      (Status/Date/Deciders/Context ticket/Builds-on header, Context/
      Decision/Consequences/Out-of-scope/Alternatives sections — see
      ADR-0012 for the most recent precedent).
- [ ] Documents the real, shipped job names/payloads/trigger/summary shapes
      — not placeholders.
- [ ] States explicitly that existing TA/FA job types and their contract
      usage are unchanged.
- [ ] Linked from `packages/contracts`' ADR trail if that's the repo's
      existing convention (check how ADR-0007 itself is referenced from the
      contracts source comments).

## Out of scope

- Any further code changes — this ticket is documentation only. If writing
  the amendment surfaces a real gap in what 01/02/03/05 shipped, flag it
  rather than silently reopening one of those tickets.

## Answer

Written as `docs/adr/0013-system-triggered-ai-jobs-additive-adr-0007-amendment.md`
from the shipped code; range mentions bumped to 0001-0013; pointer added in
`packages/contracts/src/index.ts`.
