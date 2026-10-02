# Build ticket: Prospectus parse + section router

Type: task
Status: ready-for-agent
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

- [ ] Running the parser against each of the 3 real corpus PDFs locates (or
      explicitly falls back for) all 4 regulated sections.
- [ ] The parse result is persisted as an S3 claim-check artifact and reused
      on re-run (second run for the same PDF is near-free, no re-parse).
- [ ] No LLM call is made anywhere in this ticket.
- [ ] Tests cover: section-located case, fallback case (a section the
      router can't find), and idempotent re-run.

## Out of scope (later ticket under this effort)

- The LLM analysis, the `analyze-prospectus` BullMQ job, the Bursa-specific
  insights, and the read endpoint — all ticket 05, which consumes this
  ticket's section router as its input.
- Sourcing the remaining parts of each prospectus (the demo corpus is
  currently Part-1-only per i3investor's split) — the spec notes Part 1
  suffices to validate parse + section routing; grabbing the rest is a
  stretch, not a blocker.
