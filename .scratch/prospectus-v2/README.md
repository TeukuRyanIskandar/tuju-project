# prospectus-v2: Parse redesign & scalability

> **Status 2026-10-12:** implemented with changes: Camelot dropped, single image, typographic headings. See `map.md` § Decisions so far and ADR-0015. Figures below are the original plan.

**Status:** Spec complete. Ready to implement.

**Feature branch:** `feature/prospectus-v2-parse-redesign`

---

## Executive summary

The prospectus-at-a-glance artifact (shipped in spec 06) works but is bottlenecked by a **10–12 minute PDF parse** using Docling's full-document layout ML. This redesign cuts parse time to **~1–2 min** by replacing Docling with a two-phase architecture: PyMuPDF for fast structure extraction, then targeted Camelot on financials-section pages only.

**Key wins:**
- Parse time: **10 min → ~1–2 min** (5–10x faster) ✅
- Docker image size: **~2.5 GB → ~350 MB** for parse worker (7x smaller) ✅
- Corpus scalability: **3 docs in 30 min → 20 docs in ~30 min** ✅
- New sections: **lock-up + related-party transactions** (material for retail investors) ✅
- Model: **openrouter/free** (no credits needed, $0 cost) ✅

---

## Why now

Current status:
- **Spec 06 complete:** prospectus-at-a-glance artifact works end-to-end on 3 corpus PDFs
- **Problem identified:** 10-min parse blocks expansion, slows dev iteration
- **Solution proven:** research + live benchmarks show PyMuPDF + Camelot achieves 1–2 min without quality loss
- **Window:** corpus still small (3 PDFs); easier to refactor parse before scaling to 20+

---

## What changes

### Architecture (high-level)

```
OLD:  PDF → Docling (full doc, 10 min, 2.5 GB image) → section route → LLM
NEW:  PDF → Phase A PyMuPDF (5–15 sec) ┐
              ↓                          ├→ merge → LLM
              Phase B Camelot (10–30 sec, financials only) ┘
```

### Dependency removals / additions

**Removed from base:**
- `docling`, `torch`, `torchvision` (now optional `parse` extra)

**Added to base:**
- `pymupdf>=1.28.0` (~30 MB wheel)

**Added to `parse` extra:**
- `camelot-py>=2.0.0` (pure-Python, no torch)
- `opencv-python-headless` (54 MB, transitive from Camelot)

**Model config:**
- `google/gemini-2.5-flash` → `openrouter/free` (free tier router, $0 cost)

### Analysis sections (new)

- **Lock-up periods** (founder/cornerstone investor moratorium on share sales)
- **Related-party transactions** (material for governance risk)

Both extracted via LLM from prospectus text, added to `insights` dict.

---

## Tickets (7 total)

| # | Ticket | Time estimate | Dep | Status |
|---|--------|---|---|---|
| 01 | [PyMuPDF Phase A](issues/01-pymupdf-phase-a.md) | 3–4h | — | pending |
| 02 | [Camelot Phase B](issues/02-camelot-phase-b.md) | 4–5h | T01 | pending |
| 03 | [Docker split](issues/03-docker-image-split.md) | 2–3h | T02 | pending |
| 04 | [Model config + validation](issues/04-model-config-openrouter-free.md) | 3–4h | T03 | pending |
| 05 | [New sections](issues/05-new-sections-lockup-rpt.md) | 3–4h | T04 | pending |
| 06 | [Corpus expansion + timing](issues/06-corpus-expansion-timing.md) | 2–3h | T05 | pending |
| 07 | [ADR-0015](issues/07-adr-0015-parse-architecture.md) | 2–3h | T06 | pending |

**Total effort:** ~20–25 hours (1 developer, 3–4 days at full focus)

---

## Key decisions

1. **Camelot over Docling for production parse:** F1 ~0.83 vs. Docling ~0.98, but acceptable for financial highlights extraction. Docling stays as optional `parse` extra for comparison/GPU path.

2. **openrouter/free over paid models:** No credits available; free tier sufficient for showcase. Non-deterministic model selection acceptable (output varies, but stays valid).

3. **Multi-part PDF stitching:** Parse each part separately, merge `ProspectusParse` objects with re-indexed headings/blocks.

4. **Docker image split:** Lean worker (~300 MB) for TA/FA/brief/ann; parse worker (~400 MB) for prospectus only.

---

## Risks & mitigations

| Risk | Mitigation |
|------|-----------|
| Camelot table quality on complex layouts | Keep Docling as optional extra; validate on full corpus before shipping |
| PDF TOC missing/malformed | `effective_levels()` heuristic fallback works for un-numbered prospectuses |
| Multi-part section spanning | Test on full corpus; implement robust page-offset handling |
| Free model non-determinism | Validate output quality thresholds; no paid fallback (acceptable for showcase) |

---

## What stays the same

- Wire contract: `ProspectusArtifact` shape unchanged (additive `timing` field only)
- Section router skeleton patterns: refined, not rewritten
- Prompt caching, cost tracking, S3 claim-check: all preserved
- Test strategy: unit + integration + corpus lanes
- ADR chain: 0015 extends 0004/0007/0013, no contradictions

---

## Success criteria

- ✅ Parse time < 2 min per PDF (measured in T06)
- ✅ Docker parse-worker image < 500 MB (verified in T03)
- ✅ All 3 corpus PDFs produce valid artifacts with new sections (verified in T05)
- ✅ Section routing ≥ 12/12 cells after multi-part stitching (verified in T06)
- ✅ Quality thresholds met: non-empty periods/themes/headline on all 3 PDFs
- ✅ ADR-0015 + design docs written

---

## Next steps

1. Review this spec with the team
2. Approve the 7 tickets
3. Start T01 (PyMuPDF Phase A)
4. Run tickets in dependency order; T03 can start in parallel with T04

---

**Owned by:** [your name]  
**Created:** Oct 12, 2026  
**Last updated:** Oct 12, 2026
