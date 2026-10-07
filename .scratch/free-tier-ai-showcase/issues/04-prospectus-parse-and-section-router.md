# Build ticket: Prospectus parse + section router

Type: task
Status: resolved
Blocked by: — (none; can run in parallel with tickets 01–03)

> Ticket 04 of the spec-06 execution effort. Fixed inputs: research ticket 08
> and decision ticket 09 (`.scratch/free-tier/issues/08-long-document-
> ingestion.md`, `09-prospectus-at-a-glance.md`) — Docling parse-to-sections,
> no vector store/reranker/chunker, deferred until the corpus outgrows one
> context window. ADR-0004 (S3 claim-check, stateless worker). The 3 real
> demo PDFs are already downloaded to `.scratch/free-tier/demo-corpus/
> prospectuses/`; `IpoListing.prospectusS3Key` already exists on the entity
> (spec 01, ticket 10) — this ticket populates it, it doesn't invent it.

## What to build

The ingestion half of the flagship artifact: turning a real prospectus PDF
into a located, reusable set of sections. No LLM call in this ticket — pure
structural/layout parsing, verifiable standalone against the 3 real corpus
PDFs.

- Add Docling to `services/ai` (`pyproject.toml`).
- Seed the 3 real demo prospectuses as `IpoListing` rows (company name,
  board, listing date per the public filing) with `prospectusS3Key` set, and
  upload the PDFs to the artifacts bucket (LocalStack locally).
- Parse each PDF once with Docling into a structured document (headings,
  reading order, table structure), then route to the 4 regulated sections —
  offer (shares/price range/use of proceeds), business, financials, risk
  factors — using the regulated Bursa/SC prospectus section skeleton. Fall
  back to whole-document content for any section the router can't
  confidently locate (the baseline/fallback path research 08 recommends).
- Persist the Docling parse as an S3 claim-check artifact (ADR-0004), keyed
  by prospectus, reused across re-runs (idempotent — a re-run against the
  same PDF does not re-parse).

## Acceptance criteria

- [x] Running the parser against each of the 3 real corpus PDFs locates (or
      explicitly falls back for) all 4 regulated sections.
- [x] The parse result is persisted as an S3 claim-check artifact and reused
      on re-run (second run for the same PDF is near-free, no re-parse).
- [x] No LLM call is made anywhere in this ticket.
- [x] Tests cover: section-located case, fallback case (a section the
      router can't find), and idempotent re-run.

## Out of scope (later ticket under this effort)

- The LLM analysis, the `analyze-prospectus` BullMQ job, the Bursa-specific
  insights, and the read endpoint — all ticket 05, which consumes this
  ticket's section router as its input.
- Sourcing the remaining parts of each prospectus (the demo corpus is
  currently Part-1-only per i3investor's split) — the spec notes Part 1
  suffices to validate parse + section routing; grabbing the rest is a
  stretch, not a blocker.

## Answer

**Shipped.** `services/ai/src/tuju_ai/prospectus/`: `parsing.py` (Docling
adapter, lazy import, `parse` extra, CPU-only torch pin), `skeleton.py`
(regulated-chapter heading patterns), `router.py` (`route_sections`),
`store.py` (`ensure_parse`, sha256-keyed S3 claim-check), `cli.py`
(`tuju-ai-prospectus-parse`), `models.py`. Backend:
`apps/backend/src/ingestion/prospectus-corpus*.ts` seeds the 3 `IpoListing`
rows (ACE board, filed listing date/offer price) with `prospectusS3Key =
prospectus/{fileName}` and uploads the PDFs. No LLM dependency or call anywhere.

**Verified.**
- `services/ai` unit lane: 45 passed (`-m "not corpus and not integration"`).
- `services/ai` `-m corpus` on the 3 real PDFs: 6 passed (~29 min, dominated by
  Docling CPU parse: 4-11 min per PDF).
- `services/ai` `-m integration` (Redis + LocalStack): 1 passed.
- Parse persisted and reused against a real LocalStack S3 (3 PDFs): first run
  `parsed_now=True`, second `parsed_now=False`, parse fn called once, reuse
  ~8-9 ms, artifact 0.5-0.7 MB at `analysis/prospectus/{id}/parse.json`.
- Backend `prospectus-corpus.int-spec.ts` (Postgres + LocalStack testcontainers):
  4 passed. Backend unit lane: 34 suites / 414 tests passed; `tsc` lint clean.

**Per-PDF routing (Part-1 PDFs).** `L` = located, `F` = explicit whole-document
fallback.

| PDF | offer | business | financials | risk-factors |
| --- | ----- | -------- | ---------- | ------------ |
| Fibromat (FIBRO) | L (63.5k ch) | F | L (6.8k) | L (4.6k) |
| Insights Analytics (IAB) | L (8.9k) | L (99.9k) | L (8.4k) | L (4.7k) |
| Lim Seong Hai (LSH) | L (117.7k) | L (2.6k) | L (3.0k) | L (1.6k) |

Fibromat's business falls back because its "Business Overview" chapter is in
Part 2, which is not in the Part-1-only corpus. This is pinned in
`EXPECTED_FALLBACKS` in the corpus test.

**Fixes made during verification** (the earlier code passed its unit tests but
routed poorly against the real PDFs; the corpus test only asserted "located or
fallback"):
- Docling reports every heading of all three PDFs at level 1, so every slice
  ended at the next heading. `router.effective_levels` now recovers hierarchy
  from the dotted section numbering (`2.` depth 1, `2.5` depth 2, unnumbered
  headings nest under the last numbered one).
- Page-break repeats of an enclosing chapter ("2. PROSPECTUS SUMMARY
  (Cont'd)") no longer end a subsection (`is_continuation`). One PDF garbles
  the apostrophe form to `&RQW¶G`, handled too.
- `normalize_heading` now strips dotted numbers without a trailing dot
  (`2.5 RISK FACTORS`).
- Skeleton: added "Details of our IPO / Public Offering" and "Financial and
  Operational Highlights"; narrowed `^our business\b` to `^our business$` (it
  matched risk-factor bullets like "Our business is concentrated on ...").
- A matched heading with an empty slice now falls back instead of returning
  an empty "located" section.
- The corpus test's `Settings(...)` was stale (missing `backend_api_url`
  from tickets 02/03), so the re-run tests errored on the old code.

**Gotchas for ticket 05.**
- Consume `route_sections(parse) -> dict[ProspectusSection, RoutedSection]`;
  each entry has `located: bool`, `matchedHeadings`, `content` (text blocks
  and tables as markdown, joined by blank lines), `contentChars`. On fallback
  `content` is the WHOLE document (450-640k chars, far beyond one LLM
  context), so ticket 05 must truncate or budget on `located=False`, and
  should surface that confidence to the UI.
- Located slices can be huge too: IAB business is ~100k chars, LSH offer
  ~118k. Budget per section.
- Store API: `ensure_parse(artifact_store, prospectus_id, pdf_bytes,
  parse_fn) -> (ProspectusParse, parsed_now)`, key suffix
  `prospectus/{prospectus_id}/parse.json` under the `s3_prefix` (`analysis`).
  The worker must fetch the PDF bytes itself (the PDF lives in the seed's
  `prospectus/{fileName}` key, which is OUTSIDE the worker's scoped read
  prefix) or via a backend data API. `ArtifactStore.get_artifact` only reads
  the scoped prefix.
- `prospectus_id` convention is not fixed: the corpus test uses the file stem;
  the ticket says IpoListing id. Ticket 05 should pick one and use it in the
  job payload.
- Docling parse cost is 4-11 min per PDF on CPU (laptop), so first-run
  parsing inside a BullMQ job needs a long lock/timeout, or pre-parse at seed
  time. Re-runs are ~ms.
- Parse is keyed by PDF sha256; a changed PDF re-parses even under the same id.
- Numbered-heading hierarchy is heuristic. Un-numbered prospectuses fall back
  to Docling's (flat) levels, where slices will be short.
- Route "offer" merges "Details of our IPO", "Offer for Sale", and "Use of
  Proceeds" headings; the prospectus summary's copies of risk/proceeds are
  deliberately not included in the slice.

