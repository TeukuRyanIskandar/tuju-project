# prospectus-v2 — Parse redesign for speed & scalability

This feature builds on the completed `free-tier-ai-showcase` work (spec 06, tickets 01–06, ADR-0013). The flagship prospectus at-a-glance artifact currently works but is bottlenecked by a 10–12 minute PDF parse step using Docling's full-document layout ML. This effort redesigns the parse layer to **two-phase**: fast structural extraction (PyMuPDF) + targeted table extraction (Camelot on financials only), bringing parse time from **10 min → ~1–2 min per document**.

## Design overview

Instead of Docling doing the entire PDF in one ~12 minute pass, split parsing:

1. **Phase A** (PyMuPDF, ~5–15 sec): extract headings with native PDF TOC levels, text blocks in reading order, page numbers
2. **Phase B** (Camelot, ~10–30 sec, only on financials section pages): extract financial tables as markdown
3. **Section routing** (same skeleton.py, now using native heading levels from Phase A)
4. **LLM analysis** (switch from `google/gemini-2.5-flash` to free-tier `openrouter/free` model router)
5. **New sections**: add lock-up/moratorium and related-party transaction sections to the insights

Docker image size reduction: parse-worker image **~2.5 GB → ~350 MB** (torch dropped, Camelot's opencv is tiny compared to docling+torch).

## Ticket status

| # | Ticket | Blocked by | Status |
| - | ------ | ---------- | ------ |
| 01 | [PyMuPDF Phase A: structural parse](issues/01-pymupdf-phase-a.md) | — | resolved |
| 02 | [Camelot Phase B: financial table extraction](issues/02-camelot-phase-b.md) | 01 | resolved (dropped) |
| 03 | [Docker image split: lean + parse workers](issues/03-docker-image-split.md) | 02 | resolved (single image) |
| 04 | [Model config: openrouter/free + live validation](issues/04-model-config-openrouter-free.md) | 03 | resolved |
| 05 | [New sections: lock-up + related-party](issues/05-new-sections-lockup-rpt.md) | 04 | resolved |
| 06 | [Corpus expansion + timing documentation](issues/06-corpus-expansion-timing.md) | 05 | resolved |
| 07 | [ADR-0015: Parse architecture decision](issues/07-adr-0015-parse-architecture.md) | 06 | resolved |

## Decisions so far (2026-10-12)

These supersede the "Key decisions baked into this spec" section below. The design overview above and README/INDEX/SPEC-SUMMARY are the original plan and are partly outdated.

- **No native TOC on the real corpus.** Headings come from typography (bold rows + numbering kept), and running headers are kept as headings. Routing matches the Docling baseline. See [T01](issues/01-pymupdf-phase-a.md).
- **Camelot dropped.** It produced junk tables on borderless layouts and deleted real text, and PyMuPDF row text is already LLM-readable. See [T02](issues/02-camelot-phase-b.md) and the [rationale](parse-design-rationale.md).
- **One worker image** (368 MB, no torch). The job filter can't work on the shared queue. See [T03](issues/03-docker-image-split.md).
- **`openrouter/free` is the default model**, at $0. The model that answered each call is recorded. See [T04](issues/04-model-config-openrouter-free.md).
- **Lock-up and related-party are optional insights** with routing records. See [T05](issues/05-new-sections-lockup-rpt.md).
- **Multi-part prospectuses** are merged with `merge_pdf_parts` before parsing, not by `merge_parses`. Timing is recorded as `{parseMs, analysisMs}`. See [T06](issues/06-corpus-expansion-timing.md) and the [manifest](corpus-manifest.md).
- **ADR:** [ADR-0015](../../docs/adr/0015-prospectus-parse-pymupdf-typographic.md).

- **Full corpus:** all parts were downloaded, merged deterministically, and all 6 sections locate in all 3 prospectuses. See [T06](issues/06-corpus-expansion-timing.md) and the [manifest](corpus-manifest.md).

- **Free-model JSON reliability:** on a $0 model, a malformed reply gets up to 3 retries (paid models keep 1). Live run 2 on the full corpus passed 3/3 at $0, taking about 3.5 min per document. Parse took 3 to 5 s and the rest is LLM time. See [T04](issues/04-model-config-openrouter-free.md).

**All tickets are resolved.** Possible follow-ups, not yet ticketed:

- Run the per-section LLM calls in parallel. They are sequential today, and that sequence is the whole 3.5 min.
- Promote the corpus lane into the PR lane.

## Key decisions baked into this spec

- **Camelot 2.0** (not 1.0.x): torch-free, uses pypdfium2 + opencv-headless, good financial table recall (F1 ~0.83)
- **PyMuPDF for structure**: native PDF TOC levels, no more `effective_levels()` heuristic (it becomes fallback only)
- **openrouter/free as production model**: $0/call, ~200K context (fits current budget), selects model randomly from available free models
- **CostTracker stays inert at $0**: no logic change, just config (add free-model price entry)
- **Multi-part PDF stitching**: parse each part separately, merge `ProspectusParse` objects with re-indexed headings/blocks
- **Timing documentation**: wall-clock times recorded for each phase across full corpus (target: ~2–4 min first-run, ~30 sec re-run)

## Frontier & risks

- **openrouter/free model variance**: router selects model at request time, so identical re-runs may use different models. Output quality may vary. Mitigation: validate threshold (if critical fields empty, escalate alert; don't retry — no paid credits available).
- **Camelot on real prospectuses**: F1 ~0.83 is good but not perfect. If financials section has merged cells or complex multi-level headers, Camelot may degrade. Mitigation: keep Docling as optional `parse-ml` extra for comparison/debugging.
- **Part 2/3 stitching**: unclear if i3investor parts have page-break continuations ("(Cont'd)") that need special handling. Mitigation: implement `merge_parses` robust to re-numbered sections and verify on real corpus before shipping.
- **Section routing with full-part PDFs**: business section (currently fallback for Fibromat) may now route from Part 2. Update skeleton patterns if needed post-corpus-expansion.

## Out of scope (explicitly deferred)

- Frontend rendering of the artifact (user interface)
- Vector store / RAG / pgvector (corpus trigger not met)
- ColPali / GPU-based vision retrieval (wrong hardware tier)
- LLM-as-judge for risk ranking (nice-to-have)
- Peer valuation / synthetic-price workarounds (blocked on TA/FA, out of scope for v2)
