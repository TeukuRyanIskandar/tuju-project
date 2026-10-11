# Decide: grounding post-check + the facts-only artifact shape

Type: grilling
Status: resolved
Blocked by: 03

## Question

Parent lock: "narrative may only use numbers/events present in the fact
payload; fail closed (no narrative card) if facts empty"; pipeline "build
facts → prompt with facts only → narrate → number post-check → strip
narrative on violation".

Pin the post-check and the stripped ("facts-only") run's wire output under
the **locked shapes** (`JobResult.pointer` required; `AnalysisNarrative.text`
`min(1)`):

1. Number check algorithm: extract every numeral (including percentages and
   currency forms like "RM1.23b") from the narrative; each must match a
   number in the fact payload (or an event value) within formatting
   tolerance — how strict for the PoC (raw string containment of formatted
   numbers vs parsed-numeric equality within rounding tolerance)?
2. Violation ⇒ strip: what does the run emit? The pointer is required and
   `narrative.text` cannot be empty, so the leading option is a
   **code-generated deterministic placeholder narrative** (e.g. `"Narrative
   withheld: failed the number check."`) in the artifact with all facts —
   vs other conventions (sentinel `language`? rejected shapes?).
3. Retry-once-then-strip (after ticket 03's corrective retry still violates)
   vs strip on first violation?
4. Does the post-check also enforce the hard bans lexically (buy/sell/hold,
   target, advice-shaped phrases) — a ban word/phrase list, strip on hit?
5. Where the check lives: in the handler, before pre-write artifact
   validation (prior-art seam) — confirmed?

Fixed inputs: parent grounding pipeline; locked contracts (artifact requires
non-empty narrative; JobResult requires a pointer).

## Answer

### 1. Number check algorithm: raw string containment

Extract every numeral from the narrative (including percentages `70%`, currency
forms `RM1.23b`, and decimal numbers `0.85`). Each extracted number must appear
**verbatim as a formatted string** in:

- The fact payload (e.g., `sma.p20 = 123.45` → look for "123.45" or "123")
- An event's `values` dict (e.g., event `values: {"rsi_level": 72}` → "72")

**Algorithm:**

1. Extract all numbers from the narrative using a regex:
   `r'(?:RM)?[\d,]+\.?\d*\s*%?|[\d.]+%|[\d,]+(?:\.\d+)?'`
2. For each extracted number, format it as a canonical string (strip spaces,
   commas, trailing `.0`, normalize decimals to 2 places if present)
3. Check for an exact match in: all fact field values (as `str()`) or any event
   value (same normalization)
4. If any extracted number has no match, raise `GroundingViolation`

**Rationale:** Simple, deterministic, catches hallucinated numbers. Parsed
numeric equality would add complexity (rounding tolerance definition, mixed-unit
comparisons); raw containment is sufficient for PoC.

### 2. Violation ⇒ strip to deterministic placeholder

The job **completes successfully** with an artifact containing:

- **All facts intact** (unchanged)
- **Events intact** (unchanged)
- **narrative.text = `"Narrative withheld: failed the grounding check."`**
- **provenance unchanged** (model, generatedAt, etc.)
- **cost block unchanged** (real usage tracking, even on strip)

The artifact is claim-checked to S3 and returned as a valid `JobResult`. The
BE hook detects the sentinel narrative and upserts `status = facts_only`.

**Rationale:** Facts are good and verified; the narrative was rejected. Surface
the facts to the user (FE shows the table) but withhold the text summary. No
new artifact is written; the same claim-check pointer is used.

### 3. Retry-before-strip: sequence

1. **First LLM call** → narration generated
2. **First post-check** (numbers + bans) → violation detected
3. **Corrective retry** (ticket 03 pattern):
   - Echo the violation (e.g., "Your narrative included '42', which is not in
     the data")
   - Ask the LLM to regenerate with only the provided numbers
   - Second LLM call → new narration generated
4. **Second post-check** → if still violates → strip (deterministic placeholder)

**No third attempt.** After the corrective retry, a second violation → strip.

### 4. Ban-word check: yes, same post-check step

In the same post-check function, after the number validation passes, check for
ban words/phrases:

**Ban list** (case-insensitive prefix match or exact):

- "buy" / "sell" / "hold" (standalone)
- "target" + ("price" | "level") — e.g., "price target", "target 5.50"
- "undervalued" / "overvalued" / "underweight" / "overweight"
- "recommendation" / "recommend" / "advise" / "should invest" / "should buy"

**Matching:** search the narrative for these terms. If found, raise
`GroundingViolation`.

**Action:** strip (same as number violation) — deterministic placeholder + facts.

### 5. Handler placement: before pre-write validation

The check lives in the `_handle_analysis_job` flow **AFTER** the LLM call +
corrective retry, **BEFORE** the Pydantic pre-write validation:

```python
# After LLM narration + corrective retry
artifact = build_artifact(facts, events, narrative, provenance, cost)

# POST-CHECK (before Pydantic validation)
narrative_text = artifact["narrative"]["text"]
try:
    check_grounding(narrative_text, facts, events)
except GroundingViolation as exc:
    log.warning("Grounding violation; stripping narrative", extra={"error": str(exc)})
    artifact["narrative"]["text"] = "Narrative withheld: failed the grounding check."

# PRE-WRITE VALIDATION
try:
    TechnicalAnalysisArtifact.model_validate(artifact)
except ValidationError as exc:
    raise TerminalJobError(f"Artifact validation failed: {exc}")

# Claim-check
pointer = artifact_store.put_artifact(key_suffix, artifact)
```

This ensures:
- The stripped artifact still validates (placeholder text is non-empty ✓)
- The pointer is always written (if facts + placeholder passes validation)
- The sentinel is available to the BE hook (headline prefix from ticket 05)
