# Decide: PoC JobResult summary policy for TA/FA

Type: grilling
Status: resolved
Blocked by: (none)

## Question

`JobResult.summary` is already `Summary | SystemSummary`. Stub TA/FA handlers
still emit verdict-bearing `Summary`. Parent policy: PoC jobs emit
**`SystemSummary` only** (`headline` + `asOf`); Verdict enums stay in the package
unused.

Decide what the **contracts handoff** requires:

1. Documentation-only policy vs additive Zod tightening (e.g. per-`jobName`
   summary variant)?
2. What must `headline` / `asOf` mean for TA vs FA?
3. Does `artifactPath` / claim-check on `JobResult` change for PoC TA/FA?
4. Any fixture additions (`job-result-technical-system.json`, …)?

Fixed inputs: parent ticket 03; ADR-0007; existing `SystemSummary` in
`packages/contracts/src/result.ts`.

## Notes

- Prefer the smallest additive change that stops PoC from shipping verdicts.
- Paid path may still use `Summary` later — do not delete Verdict enums.

## Answer

**Documentation + fixture policy only for PoC. No per-`jobName` Zod discriminant
on `JobResult` unless a concrete consumer later forces it. Claim-check /
`ArtifactPointer` unchanged from ADR-0007 / ADR-0014.**

### Policy (handoff must state)

- PoC `analyze-technical` and `analyze-fundamental` workers **must** return
  `summary: SystemSummary` (`{ headline, asOf }`) — never `Summary` with
  `verdict`.
- Existing `Verdict` / `TechnicalVerdict` / `FundamentalVerdict` enums remain in
  `@tuju/contracts` for the paid / future path; PoC does not delete or deprecate
  them on the wire.
- `JobResult` Zod stays `summary: z.union([Summary, SystemSummary])`. Do **not**
  add a per-`jobName` discriminant in this map. Revisit only if a typed consumer
  cannot enforce the policy in application code / tests.

### `headline` / `asOf` meaning

- **`headline`**: one English descriptive sentence derived from code facts /
  metrics (not advice). Examples: MA cross / RSI band for TA; notable ratio or
  growth gap for FA. May mirror the narrative’s first claim but is owned by the
  worker summary path, not copied from the rich artifact root (artifacts have
  **no** root headline — tickets 01–02).
- **`asOf`**: ISO-8601 datetime with offset for the market/fundamentals snapshot
  the facts were computed from (same clock domain as artifact `asOf` /
  provenance `generatedAt` where applicable). Stale detection on HTTP reads
  (ticket 05) compares this (or artifact `asOf`) to last EOD ingest.

### Claim-check / pointer

- Unchanged: `JobResult.pointer` is `ArtifactPointer` (`bucket`, `key`, `sha256`,
  `bytes`, `contentType`). Rich body is the registered TA/FA artifact at that
  key. HTTP analysis reads (ticket 05) expose Nest-proxied `artifactPath` +
  claim-check separately from this bus returnvalue.

### Fixtures (execution pass; named here)

Add golden samples alongside existing `job-result-system.json`:

- `job-result-technical-system.json` — `analyze-technical` shaped returnvalue
  with `SystemSummary` (no `verdict`).
- `job-result-fundamental-system.json` — same for `analyze-fundamental`.

Do not replace `job-result.json` (verdict-bearing `Summary` fixture) — paid /
legacy path still needs it.

### Unblocks

- Ticket 05 analysis HTTP can assume thin `headline`/`asOf` without verdict
- Ticket 06 handoff can cite this as the JobBus policy without Zod surgery
