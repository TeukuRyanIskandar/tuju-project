# Spec: frontend-showcase blocker fixes

**Status:** ready-for-agent
**Date:** 2026-10-16
**Parent effort:** [`../spec.md`](../spec.md) — frontend showcase
**Evidence input:** [`audit.md`](audit.md)
**Navigation:** [`map.md`](map.md)

## Why this effort exists

Tickets 02-05 of the parent effort have implementation sitting uncommitted in
the working tree, and ticket 01 cannot be satisfied. Two independent problems
have to be separated because they have completely different risk profiles:

1. **There is no demoable data.** Zero complete stocks, zero prospectuses. The
   causes are a contract-serialization defect and unusable model narration, both
   in the AI worker, both of which need diagnosis before any further generation.
2. **The tracker misstates what exists,** and nine code defects sit in the
   frontend work — several of which undermine the honesty commitments the parent
   spec is built on.

Fixing (2) first would produce a polished frontend over an empty backend.
Fixing (1) first requires the contract work in (2) first anyway, because the
narration fix needs trustworthy metric provenance. The ticket graph in
[`map.md`](map.md) interleaves them rather than forcing a false ordering.

## Objective

Remove the two technical blockers between the showcase and a demoable stock, and
leave the frontend work honest and its record accurate.

## Explicit non-goals

- **This effort does not complete parent ticket 01.** It removes blockers; it
  does not run generation or select showcase examples.
- No worker redesign. The changes are instrumentation and a serialization
  regression, not an architecture change.
- No new dependencies in any workspace.
- No relaxation of ISO datetime contracts to accommodate stored bad data.
- No forced retry of the 9 failed jobs; no blind worker restart. Both remain
  explicitly gated behind [09](issues/09-bounded-rerun-readiness-reaudit.md).
- No model or provider change, and no invented narrative fallback. `wontfix` is
  an acceptable outcome for [08](issues/08-narration-empty-content-remedy.md) if
  the evidence shows the behaviour is provider-side under free-only routing.
- No navigation changes. Parent `spec.md:58-60` asks for them; they are ticket
  07's scope.
- No shared chart-primitive extraction. [13](issues/13-chart-design-conformance.md)
  records the deferral rather than performing it.
- No commits until the verification suite in this spec has been run and its
  results recorded.

## Sequencing rationale

**Contract first, because it is the leaf.** `packages/contracts` is the one
workspace with no runtime dependency on any other workspace member. A required
field on `FundamentalMetric` breaks the backend producer, the Python worker and
the frontend at once, so it lands alone and first
([01](issues/01-contract-percent-scale.md)).

**Producer before consumer.** [02](issues/02-backend-fa-scale-producer.md) makes
the backend emit honest scale; [03](issues/03-ai-worker-scale-passthrough.md)
passes it through; only then can
[04](issues/04-frontend-scale-presentation.md) verify against a real artifact
rather than a fixture.

**Diagnostics before remedy.** The narration failure has a strong but unproven
hypothesis ([`audit.md`](audit.md) §1a). Adding the evidence
([06](issues/06-openrouter-response-diagnostics.md)) and making the terminal
reason honest ([07](issues/07-empty-vs-malformed-reply.md)) are worth doing on
their own merits even if the remedy in
[08](issues/08-narration-empty-content-remedy.md) turns out to be `wontfix`.

**Frontend cleanup is fully parallel.** Tickets 10-15 have no blockers and touch
files no other ticket edits, so they can be claimed by separate sessions
concurrently with the contract track.

**Reconciliation last.** [16](issues/16-showcase-tracker-reconciliation.md)
cannot be written honestly until the work it describes is done.

## The contract decision this effort makes

`FundamentalMetric.unit` (`packages/contracts/src/artifact.ts:472`) is a bare
`z.string()` carrying no scale, and the backend uses `'%'` for both a fraction
and a percentage point. A required `scale` enum makes each metric self-describing
and lets the frontend stop guessing by id. This is a wire-affecting change to a
registered, codegen-backed model, so it carries a schema-version bump — see
[01](issues/01-contract-percent-scale.md) for the open question about whether
that bump is safe in every environment.

Metric **values are not rescaled.** The contract records the scale that is
already true; it does not silently rewrite numbers.

## Verification

Per ticket, plus this suite before any commit:

```bash
pnpm --filter contracts check        # ADR-0008 drift gate
pnpm --filter contracts test
pnpm --filter frontend typecheck
pnpm --filter frontend test
pnpm --filter frontend build
pnpm --filter frontend test:e2e
pnpm --filter backend test
# AI worker, via services/ai pytest config
```

Record failures and skips honestly. A ticket is not complete because its own
tests pass while the suite above is red for an unexplained reason.

## Definition of done for this effort

- Parent ticket 14's two technical acceptance criteria are met: artifact
  timestamps pass the real contracts under regression, and the narration failure
  is explained with sanitized evidence. Both may legitimately resolve to a
  documented `wontfix` for the remedy.
- The metric scale is self-describing on the wire, with the frontend carrying no
  per-id scaling table.
- The nine frontend defects are resolved or explicitly deferred with a reason.
- Parent tickets 01-05 state what is actually true, including the parts that are
  still blocked.
- [`audit.md`](audit.md) limits section remains accurate for anything a later
  reader might otherwise mistake for verified.

## Known limits of this plan

- Even with every ticket complete, **the showcase is still not demonstrable**
  until [09](issues/09-bounded-rerun-readiness-reaudit.md) runs and tickets 11,
  13 and the data-rights review are resolved by a human. Those are not agent
  work.
- The prospectus inputs are Part-1-only PDFs. Even after successful generation,
  absent sections must not be described as absent in the issuer's complete
  prospectus.
- No live-backend, session, CORS or deployment rehearsal is in scope here.
- No human screen-reader or assistive-technology audit. Automated Chromium
  keyboard checks do not replace it.

## 2026-10-16 outcome note

The original zero-data premise was superseded by separately approved blocker-fix
09 execution: a fresh 1155 TA/FA and Insights Analytics canary met the minimum
one-complete-stock/one-prospectus milestone. This does not authorize further
generation, make the free route reliable, or complete the showcase. The remaining
limits refer to parent tickets 11 and 13, not blocker-fix tickets with those
numbers; rights review, broader coverage and Part-1-only prospectus limitations
remain open.
