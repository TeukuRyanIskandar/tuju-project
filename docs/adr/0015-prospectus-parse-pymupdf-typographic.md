# ADR-0015: Prospectus parse on PyMuPDF with typographic heading recovery (Docling demoted; no table extractor; one worker image; `openrouter/free`)

- Status: Accepted (live free-model validation pending: see Validation)
- Date: 2026-10-12
- Deciders: prospectus-v2 effort (map: `.scratch/prospectus-v2/map.md`)
- Context tickets: `.scratch/prospectus-v2/issues/01`–`07`
- Builds on: [ADR-0004](0004-data-layer-postgres-typeorm-hybrid-ingestion-s3-claimcheck.md) (S3 claim-check; the parse is persisted and reused), [ADR-0006](0006-deployment-single-ec2-compose-aws-rds-s3.md) (single-EC2 compose deployment), [ADR-0007](0007-job-result-progress-contract-bullmq.md) / [ADR-0013](0013-system-triggered-ai-jobs-additive-adr-0007-amendment.md) (`analyze-prospectus` job contract, unchanged here), [ADR-0014](0014-contracts-owns-http-schemas-and-prospectus-artifact.md) (`ProspectusArtifact` in contracts; additive fields here)

## Context

Spec 06 shipped the prospectus at-a-glance artifact on a Docling parse: full-document layout ML plus TableFormer table recovery.

- It worked, but cost **4–12 min of CPU per PDF** on the first run.
- It needed **torch** in the worker image (~2.5 GB).
- Docling reported every heading of the real Bursa prospectuses at level 1. The router already had to recover the hierarchy from section numbering (`effective_levels()`).

The prospectus-v2 plan proposed two phases:

1. PyMuPDF for structure, using the PDF's native TOC levels.
2. Camelot on the financials pages for tables.

It also proposed splitting the worker into a lean image and a parse image. Building it against the real demo corpus disproved several of the plan's assumptions:

1. **None of the three corpus PDFs has a native TOC** (`doc.get_toc()` is empty). The TOC path never runs on real Bursa prospectuses, so heading recovery has to work without it.
2. **Bursa headings are typographic.** Headings use the body font size (10 pt) set in bold. The section number is a separate span on the same baseline ("2.5" | "RISK FACTORS"). Running page headers repeat the chapter title with a non-bold "(Cont'd)".
3. **Camelot produced junk.** The financial tables are borderless:
   - `lattice` found nothing.
   - `stream` turned prose paragraphs into "tables" ("T" | "he gross proceeds …").
   - The planned page-level splice then discarded the real text on those pages, including offer-section prose.
   - PyMuPDF's own `find_tables()` also found nothing.
4. **PyMuPDF's plain text is already LLM-readable** for these tables, row by row: "Revenue 45,787 47,953 68,300 75,463", plus the bold column-header row once that is kept as content.
5. **The planned image split could not work on our queue.** All jobs share the BullMQ `analysis` queue. A worker that pulls a job outside its `WORKER_JOB_FILTER` fails it permanently. BullMQ does not hand it to the other worker.

## Decision

### 1. Default parse: `parse_prospectus_fast` (PyMuPDF)

- **TOC present:** headings and levels come straight from the TOC (`headingsFromToc=True`). The router trusts those levels.
- **No TOC (every real prospectus so far):** headings are recovered from typography (`_typographic_parse`):
  - A visual row whose title, after an optional enumeration span ("2.5", "(b)"), is entirely bold is a heading. Consecutive bold rows form one wrapped heading.
  - The heading text **keeps its numbering** and is stored at level 1. The router's `effective_levels()` then recovers depth exactly as it did for Docling.
  - **Running headers ("… (Cont'd)") are kept as headings**, including wrapped ones whose tail is not bold. The router treats them as transparent inside a subsection, and they still close a sibling chapter whose own opening heading was missed.
  - Page numbers, registration lines and the table-of-contents pages are dropped as furniture.
  - Each heading's text is also emitted as a `kind="heading"` content block, so sub-headings and bold table column headers reach the prompts. The router does not count such a block as making a section "located".
- Every block carries its 0-indexed `pageNumber`.
- Router fix: a running header no longer resets `effective_levels()`'s depth context, so it cannot promote the unnumbered children of the subsection it interrupts.

### 2. No table extractor

Camelot is not adopted, and Phase B is removed. Tables reach the LLM as PyMuPDF's row-wise text. Docling stays as the optional `parse-ml` extra (renamed from `parse`) for comparison or a future GPU path. The worker image does not install it.

### 3. One worker image

`pymupdf` is a base dependency, so the single worker image serves every job, `analyze-prospectus` included. There is no torch and no job filter. The Dockerfile is now two-stage, so the runtime image carries no `uv` binary.

### 4. Multi-part prospectuses are merged before parsing

`merge_pdf_parts` merges the parts with PyMuPDF `insert_pdf`; raw byte concatenation is not a valid PDF merge. Pages, headings and the `pdfSha256` idempotency key stay continuous. The parse model and router need no multi-part logic. This replaces the planned `merge_parses()` re-indexing.

### 5. Default model `openrouter/free`

- It is priced at $0 in the cost table, as is any `…:free` model. The cost guard stays wired but cannot trip.
- The router picks the serving model per request. Each cost-report call records the model that actually answered (`ProspectusCostCall.model`, optional). `provenance.model` lists the distinct answering models, falling back to the requested id.

### 6. Two new insights and timing (additive contract changes)

- `insights.lockup` and `insights.relatedParty` are routed like the four sections, with their own skeleton patterns ("Moratorium on our Shares", "Related Party Transactions") and a routing record. They also feed the what-to-watch reduce.
- `timing` is `{parseMs, analysisMs}`.
- All three fields are optional, so artifacts written earlier still validate.

## Consequences

- **Parse time per PDF:** about 1–1.5 s locally and 0.3–0.6 s in the container, down from 4–12 min. The S3 parse claim-check (ADR-0004) is now a convenience rather than a necessity.
- **Routing quality:** on the Part-1-only corpus, routing matched the Docling baseline, with Fibromat business and all related-party sections falling back because those chapters live in later parts. With every part merged (10 PDFs, 3 prospectuses), all six sections are located in all three. Pinned in `tests/test_prospectus_corpus.py`.
- **Multi-part merge is deterministic** (`no_new_id=True`). Otherwise PyMuPDF's random trailer `/ID` would change `pdfSha256` on every run and defeat parse reuse.
- **Worker image:** 368 MB uncompressed and 113 MB compressed, with no torch (previously ~2.5 GB). It builds in about 20 s cold.
- **The corpus lane needs no extra** and runs in seconds. It could join the PR lane; it has not yet.
- **Heading recovery is a heuristic tuned on Bursa typography.** A prospectus that sets headings without bold, or in another layout, would degrade to whole-document fallbacks: explicit `located=False`, never silent. Mitigation: the corpus lane pins routing per document, and the Docling `parse-ml` path remains available.
- **Bold non-heading rows become unnumbered child headings.** Examples are table header cells and bolded risk-item titles. They sit below the numbered heading they appear under, so they never end a numbered slice.
- **No structured tables.** Merged cells and multi-level column headers reach the LLM as flattened rows. This has been adequate for the financial highlights in all three PDFs; revisit if `FinancialsOutput.periods` quality drops.
- **Free-model variance.** Re-runs may be served by different models, and the per-call model makes this auditable. There is no paid fallback. In the first live run, 2 of 3 documents failed on malformed JSON after one retry. So on a $0 model the malformed-reply retry bound is 3 (`MAX_RETRIES_FREE`). Paid models keep the single in-call retry. In both cases the error is still terminal at the job level once the bound is exhausted, as ADR-0007 requires (no BullMQ retry).
- **Watch the cost headroom on paid models.** With 7 section-sized calls, the worst-case Sonnet budget is about $1.99, just under the $2/doc ceiling. `test_every_builtin_model_fits_the_ceiling_at_worst_case_budget`.

## Alternatives considered

- **Keep Docling.** Correct, but minutes per PDF and a 2.5 GB torch image. Kept as the `parse-ml` extra only.
- **Camelot Phase B (the plan).** Rejected on evidence: junk tables on borderless layouts, and lost text (Context 3).
- **Gated Camelot** (accept only numeric-dense tables; replace only bbox-overlapping text). More code for a component that would reject nearly every table on this corpus.
- **Two images with a job filter (the plan).** Broken on a shared queue (Context 5). A per-image queue would work, but it touches NestJS enqueue code and contracts, and there is no heavy dependency left to isolate.
- **Native TOC only.** It does not exist on the real corpus.

## Validation

- **Unit lane** (`pytest -m "not integration and not corpus"`) covers:
  - the TOC path;
  - the typographic path (bold detection, numbering kept, wrapped headings, wrapped running headers, furniture);
  - running-header transparency end to end;
  - the multi-part merge;
  - $0 free pricing and the per-call served model;
  - the lock-up and related-party insights.
- **Corpus lane** (`pytest -m corpus`): routing is pinned per real PDF, and the full pipeline runs with the fake LLM.
- **Integration lane:** the JobBus round-trip, unchanged.
- **Container check:** the 368 MB image parses and routes all three PDFs.
- **Live run:** `services/ai/scripts/live_corpus_run.py` writes `.scratch/prospectus-v2/live-run-results.md`. The first run (Part 1 only, single retry) passed 1 of 3 documents. A re-run on the full merged corpus with free-model retries is recorded there.

Measurements and the rejected-Camelot evidence: `.scratch/prospectus-v2/parse-design-rationale.md`.
