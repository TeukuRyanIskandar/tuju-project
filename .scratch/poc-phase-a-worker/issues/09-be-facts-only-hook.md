# Build: facts_only status hook wiring

Type: task
Status: done
Blocked by: 08-be-reference-endpoint

## Scope

Wire the `facts-only:` headline prefix (from the worker) to the `FactsOnly` status in the analysis stores, completing the facts-only signal flow (spec issue 05).

### Deliverables

1. **`technical-analysis.store.ts` + `fundamental-analysis.store.ts`** — Modify `onResult()` hook:

   Change the hardcoded `status: StockAnalysisStatus.Ready` to:
   ```ts
   status: result.summary.headline.startsWith('facts-only: ')
     ? StockAnalysisStatus.FactsOnly
     : StockAnalysisStatus.Ready,
   ```

   This detects the `facts-only:` prefix (set by the worker when grounding fails or cost ceiling hit) and upserts `FactsOnly` status instead of `Ready`.

2. **Test updates** — `stock-analysis.store.spec.ts`:

   Add two new test cases (reuse existing `fakeJobBus` / `fakeRepo` pattern):
   - `test_technical_analysis_facts_only_headline_upserts_facts_only_status()` — TechnicalAnalysisStore.onResult() with headline `"facts-only: Grounding check failed."` → status = `FactsOnly`
   - `test_fundamental_analysis_facts_only_headline_upserts_facts_only_status()` — FundamentalAnalysisStore.onResult() with headline `"facts-only: Narration stopped by cost guard."` → status = `FactsOnly`

   Build the `JobResult` inline by patching the headline of the existing fixtures; no new fixtures needed.

### Testing strategy

- Unit: Update existing spec file; no Docker needed
- Validation: existing integration tests already seed TA/FA and call the store hooks

### Acceptance criteria

✓ `facts-only:` prefix in headline → `FactsOnly` status
✓ Other headlines → `Ready` status (no regression)
✓ Test cases pass
✓ Status correctly upserted to Postgres

### Related

- Producer: Python worker (spec issue 05 — facts-only signal)
- Consumer: FE reads `status` from `StockAnalysisResponse` (stock page display logic)
- Spec: `.scratch/poc-phase-a-worker/spec.md` § "facts_only signal + headline policy"
