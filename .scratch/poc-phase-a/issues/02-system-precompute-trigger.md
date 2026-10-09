# Decide: system-precompute trigger for TA/FA

Type: grilling
Status: resolved
Blocked by: 01

## Question

User lock: demo trigger = **system-precompute** (Shape B), not stub pro login.
Contracts already define `analyze-technical` and `analyze-fundamental` as the paid
user-enqueue jobs (ADR-0005 / ADR-0007).

Decide:

1. New job names vs reuse existing TA/FA names with `trigger: 'system'`?
2. When do jobs run? Cadence and fan-out for 30 names × 2 jobs.
3. How does the UI get results? (read path)
4. Does ADR-0005 need amendment?

## Notes

- Free-tier AI showcase used Shape B with **different** job names
  (`generate-market-brief`, etc.) because paid TA/FA did not exist yet as content.
- ADR-0005 already allows trusted system / price-move callers to bypass tier.
- ADR-0013 covers system-triggered showcase jobs additively.

## Answer

**Reuse `analyze-technical` + `analyze-fundamental` with `trigger: 'system'`.
ADR-0005 unchanged.**

### 1. Job names

- **Reuse** existing job names. PoC is proving Phase A auto TA/FA — new showcase
  names would duplicate the contract and muddy the “yes we can do what we pitch”
  story.
- Envelope: `trigger: 'system'`, payload still `TechnicalPayload` /
  `FundamentalPayload` (`symbol`, `timeframe` / `period`).
- Default PoC anchors: timeframe `1D`, period `quarterly` (annual available later).

### 2. Cadence

- **Primary:** nightly after yfinance EOD + indicator materialisation succeeds
  (ordered: prices → indicators/fundamentals snapshots → enqueue TA/FA for each
  of the 30).
- **Secondary:** ops/CLI “recompute one|all” for pitch dry-runs (BE spec owns the
  command name).
- Fan-out: 60 jobs/night (30×2). Dedup via existing BullMQ job-id derivation
  (symbol + job name + asOf day) so re-runs replace cleanly.
- Failures are per-symbol; one bad ticker must not block the other 29.

### 3. Read path

- Worker writes S3 claim-check artifact + thin summary (see ticket 03); NestJS
  persists pointer/summary for read (same pattern as prospectus / brief stores).
- Anonymous (or unauthenticated demo) **read** endpoints return latest successful
  result per `(symbol, jobName)`. No enqueue from the browser in PoC.
- Cache: ADR-0004 **class 1** (AI results) for the summary/artifact reads.

### 4. Auth / ADR-0005

- **No amendment.** System caller bypasses `can()`; free users never enqueue.
- User-click paid enqueue remains specified by ADR-0005 for later — **out of PoC**.

### Unblocks

- [03 — descriptive artifact contract](03-descriptive-artifact-contract.md)
