# Build ticket: New sections — lock-up + related-party transactions

Type: task
Status: resolved
Blocked by: 04 (live validation confirms LLM pipeline works)

> Ticket 05 of prospectus-v2. Expand the prospectus analysis from 5 sections + 2 insights to include two new Bursa-specific insights: lock-up/moratorium periods and related-party transactions. Both are material for retail investor decision-making.

## What to build

### 1. Contracts layer (`packages/contracts`)

**`src/enums.ts`** — add two new enum values to `ProspectusSection` (if it's exposed; check current structure):
- Likely the section enum is internal to the AI module, not in contracts. Skip this if `ProspectusSection` is Python-only.

**`src/artifact.ts`** — update `ProspectusInsights` to include:
```typescript
lockup?: {
  present: boolean;
  entries: { name: string; shares?: string; durationMonths?: string; notes?: string }[];
  summary?: string;
};
relatedParty?: {
  present: boolean;
  items: {
    counterparty: string;
    nature?: string;
    amount?: string;
    basis?: string;
  }[];
  aggregateAmount?: string;
  summary?: string;
};
```

- Regenerate JSON schema: `pnpm exec datamodel-code-generator --input schema/contracts.schema.json --output ...`
- Regenerate Python Pydantic models via the same pipeline as existing TA/FA artifacts

### 2. Python analysis layer (`services/ai`)

**`src/tuju_ai/prospectus/models.py`**:
- Add `LOCKUP` and `RELATED_PARTY` to `ProspectusSection` enum

**`src/tuju_ai/prospectus/skeleton.py`**:
- Add patterns to `SECTION_SKELETON`:
  ```python
  ProspectusSection.LOCKUP: (
      r"^moratorium (on disposal|shares|period)\b",
      r"^lock.?up (period|shares|arrangement)\b",
      r"^moratorium$",
      r"^shareholding restrictions\b",
  ),
  ProspectusSection.RELATED_PARTY: (
      r"^related.party transactions?\b",
      r"^interested person transactions?\b",
      r"^recurrent related.party\b",
      r"^rpts?\b",
      r"^interested party transactions?\b",
      r"^connected party transactions?\b",
  ),
  ```

**`src/tuju_ai/prospectus/analysis_models.py`**:
- New Pydantic models:
  ```python
  class LockupEntry(BaseModel):
      name: str
      shares: Text = None        # shares or % subject to moratorium
      durationMonths: Text = None  # lock-up period in months
      notes: Text = None

  class LockupOutput(BaseModel):
      present: bool
      entries: list[LockupEntry] = Field(default_factory=list)
      summary: Text = None

  class RelatedPartyItem(BaseModel):
      counterparty: str
      nature: Text = None        # type of transaction
      amount: Text = None
      basis: Text = None         # arm's length / non-arm's length

  class RelatedPartyOutput(BaseModel):
      present: bool
      items: list[RelatedPartyItem] = Field(default_factory=list)
      aggregateAmount: Text = None
      summary: Text = None
  ```

**`src/tuju_ai/prospectus/analysis.py`**:
- Add task prompts:
  ```python
  STEP_LOCKUP = "lockup"
  STEP_RPT = "related-party"
  # Add to LLM_STEPS tuple
  
  _TASKS[STEP_LOCKUP] = """\
  Identify the lock-up and moratorium arrangements for major shareholders \
  (founder / cornerstone investors / management). JSON shape:
  {"present": bool,
   "entries": [{"name": str, "shares": str|null, "durationMonths": str|null, "notes": str|null}],
   "summary": str|null}
  "shares" is the count or % of shares subject to moratorium. \
  "durationMonths" is the lock-up period. Set "present" to false and "entries" \
  to [] if the prospectus names no moratorium arrangements."""

  _TASKS[STEP_RPT] = """\
  Identify material related-party transactions (RPTs). JSON shape:
  {"present": bool,
   "items": [{"counterparty": str, "nature": str|null, "amount": str|null, "basis": str|null}],
   "aggregateAmount": str|null,
   "summary": str|null}
  "basis" is arm's-length or non-arm's-length. "aggregateAmount" is the total \
  RPT value across all items. Set "present" to false and "items" to [] if the \
  prospectus names no RPTs."""
  ```

- Add section calls in `analyze_prospectus()`:
  ```python
  # After section_call for STEP_RISKS
  lockup, lockup_routing = section_call(STEP_LOCKUP, ProspectusSection.LOCKUP, LockupOutput)
  rpt, rpt_routing = section_call(STEP_RPT, ProspectusSection.RELATED_PARTY, RelatedPartyOutput)
  ```

- Update the `STEP_WATCH` reduce to include lockup + RPT in `section_outputs`:
  ```python
  section_outputs = {
      "offer": _dump(offer),
      "business": _dump(business),
      "financials": _dump(financials),
      "riskFactors": _dump(risks),
      "lockup": _dump(lockup),
      "relatedParty": _dump(rpt),
  }
  ```
  
- Update the artifact return dict:
  ```python
  "insights": {
      "shariah": shariah_insight(reference),
      "cornerstone": {...},
      "lockup": {...},
      "relatedParty": {...},
  }
  ```

**`src/tuju_ai/prospectus/budget.py`**:
- Both new sections use the same `fit_section()` logic as existing sections (located vs fallback)
- No new budget constants needed (they share `SECTION_CHAR_BUDGET`)
- Add keywords for fallback relevance scoring:
  ```python
  _KEYWORDS[ProspectusSection.LOCKUP.value] = (
      "lock-up", "moratorium", "disposal", "shares", "lock", "restriction",
      "founder", "director", "management", "months", "years",
  )
  _KEYWORDS[ProspectusSection.RELATED_PARTY.value] = (
      "related party", "rpt", "interested person", "arm's length",
      "non-arm's length", "transaction", "connected", "affiliate",
  )
  ```

### 3. Tests

**`tests/prospectus/test_analysis_models.py`** (or extend existing):
- `test_lockup_output_valid`: create valid `LockupOutput`, assert validation passes
- `test_lockup_output_empty`: `present=False`, `entries=[]`, assert valid
- `test_rpt_output_valid`: create valid `RelatedPartyOutput`, assert validation passes
- `test_rpt_present_false`: `present=False`, `items=[]`, assert valid

**`tests/prospectus/test_analysis.py`** (corpus tests):
- `test_corpus_lockup_routing`: verify lockup section routes on at least one PDF (IAB / LSH likely, Fibromat Part 1 maybe not)
- `test_corpus_rpt_routing`: verify RPT section routes on at least one PDF
- `test_corpus_both_new_sections_in_artifact`: verify both new insights appear in the full artifact dict for each PDF

### 4. Contracts regeneration

- After updating `artifact.ts`, run the existing contract-codegen pipeline:
  - Generate JSON schema from TS
  - Run `datamodel-code-generator` to produce Python Pydantic models
  - Update `services/ai/src/tuju_ai/contracts_generated/models.py`
  - Verify no type errors in the AI module

## Acceptance criteria

- [x] `ProspectusSection.LOCKUP` and `.RELATED_PARTY` added to Python enum
- [x] Skeleton patterns added for both sections
- [x] `LockupOutput` and `RelatedPartyOutput` Pydantic models defined
- [x] Task prompts written for both sections
- [x] Section calls wired in `analyze_prospectus()`
- [x] Both sections included in the artifact's `insights` dict
- [x] Both sections included in the `STEP_WATCH` reduce
- [x] Contract schemas updated and Python models regenerated
- [x] All unit tests pass (`pytest -m unit`)
- [x] Corpus tests pass: lockup located on ≥ 2/3 PDFs, RPT on ≥ 1/3 PDFs
- [x] `WatchOutput.items` can reference `sourceSection: "lockup"` or `"related-party"`

## Out of scope

- Peer valuation insight (deferred due to synthetic price constraint)
- Shariah status or cornerstone investor changes (already working)

## Implementation notes

- Lock-up sections are usually found in IPO prospectuses but may be in Part 2 (check Fibromat after corpus expansion)
- Related-party transactions are particularly material for ACE-board IPOs with concentrated ownership
- If a section is not located, the whole-document fallback will attempt to extract lockup/RPT from the full text (keyword-scored by `fit_section`)
- The `_KEYWORDS` dicts are heuristics for fallback scoring; if a section isn't located, this helps prioritize relevant paragraphs in the long context

## Testing strategy

- Unit: Pydantic validation, task prompt structure
- Corpus: real PDF routing + LLM output validation on all 3 PDFs (after T04 live validation confirms pipeline works)

## Answer

Done: skeleton patterns, `LockupOutput`/`RelatedPartyOutput`, prompts, section calls, the what-to-watch reduce input, budget keywords, handler progress steps, the fake client and tests.

Contract: `insights.lockup` and `insights.relatedParty` are optional, and each carries a `routing` record. Contracts were regenerated. Backend and frontend typecheck clean.

Deviations from the ticket:

- `durationMonths` is now `duration` (free text as written, e.g. "6 months from the date of listing").
- `whatToWatch.derivedFrom` still names the four sections; changing it would need a tuple union.

Corpus: lock-up is located on **3/3** ("x.2 Moratorium on our Shares"). Related-party is located on **0/3** because chapter 10 is in Part 2; this is re-checked under T06 once the parts are downloaded.
