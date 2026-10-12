# prospectus-v2 Feature Specification — Complete Index

> **Status 2026-10-12:** implemented with changes: Camelot dropped, single image, typographic headings. See `map.md` § Decisions so far and ADR-0015. Figures below are the original plan.

This directory contains the complete specification for the **prospectus-v2 parse redesign** effort — an optimization to reduce prospectus PDF parse time from 10–12 minutes to ~1–2 minutes.

## 📋 Files in this feature

### Overview & Planning
- **README.md** — Start here. Executive summary, ticket matrix, success criteria
- **map.md** — Feature breakdown, ticket status tracker, design overview
- **SPEC-SUMMARY.txt** — Quick reference: problem, solution, results, tickets
- **INDEX.md** — This file

### Detailed Tickets (7 total)
Each ticket file contains full acceptance criteria, implementation notes, and testing strategy.

| # | File | Time | Description |
|---|------|------|---|
| 01 | [01-pymupdf-phase-a.md](issues/01-pymupdf-phase-a.md) | 3–4h | PyMuPDF fast structural parse (headings via PDF TOC, text blocks) |
| 02 | [02-camelot-phase-b.md](issues/02-camelot-phase-b.md) | 4–5h | Camelot targeted table extraction (financials section only) |
| 03 | [03-docker-image-split.md](issues/03-docker-image-split.md) | 2–3h | Docker image split: lean (~300 MB) + parse (~400 MB) workers |
| 04 | [04-model-config-openrouter-free.md](issues/04-model-config-openrouter-free.md) | 3–4h | Model config: openrouter/free + live validation on 3 corpus PDFs |
| 05 | [05-new-sections-lockup-rpt.md](issues/05-new-sections-lockup-rpt.md) | 3–4h | New sections: lock-up periods + related-party transactions |
| 06 | [06-corpus-expansion-timing.md](issues/06-corpus-expansion-timing.md) | 2–3h | Multi-part PDF stitching, full corpus pipeline, timing documentation |
| 07 | [07-adr-0015-parse-architecture.md](issues/07-adr-0015-parse-architecture.md) | 2–3h | ADR-0015: document architecture decision + rationale |

**Total effort:** ~20–25 hours (1 dev, 3–4 days full focus)

---

## 🎯 Quick Facts

### The Problem
- Current parse: Docling full-document ML → **10–12 min per PDF**
- Docker image: **~2.5 GB** (torch wheels)
- Corpus scale: **3 PDFs = 30 min**; 20 PDFs = **3+ hours** (unacceptable)

### The Solution
- **Phase A (PyMuPDF):** Fast structural extraction → ~5–15 sec
- **Phase B (Camelot):** Targeted table extraction on financials only → ~10–30 sec
- **Total:** ~1–2 min per PDF (**5–10x faster**)
- **Image:** ~350 MB parse worker (**7x smaller**)

### Results
- Parse time: **10 min → 1–2 min** ✅
- Docker image: **2.5 GB → 350 MB** ✅
- Model: **openrouter/free** ($0 cost) ✅
- New sections: **lock-up + RPT** ✅
- Corpus: **12/12 sections located** (after multi-part) ✅

---

## 🔄 Dependency Chain

```
T01 → T02 → T03 → {T04 ∥ T05} → T06 → T07
             (parallel after T03)
```

**Critical path:** T01 → T02 → T03 (blocks live validation)

**Can parallelize:** T04 (live validation) and T05 (new sections code) once T03 is complete

---

## 📊 Acceptance Criteria (All Tickets)

### Timing (from T06)
- [ ] Phase A (PyMuPDF) < 30 sec per PDF
- [ ] Phase B (Camelot) < 60 sec per PDF
- [ ] Total parse < 90 sec per PDF
- [ ] LLM calls < 2 min on free tier
- [ ] **Total end-to-end < 4 min (first run), < 1 min (cached)**

### Quality (from T06)
- [ ] All 3 corpus PDFs: `FinancialsOutput.periods` non-empty
- [ ] All 3 corpus PDFs: `RiskOutput.themes` non-empty + ranked
- [ ] All 3 corpus PDFs: `WatchOutput.headline` present
- [ ] 12/12 sections located (after multi-part stitching)
- [ ] Lock-up section located on ≥ 2/3 PDFs
- [ ] RPT section located on ≥ 1/3 PDFs

### Deployment (from T03)
- [ ] Lean worker image < 400 MB
- [ ] Parse worker image < 500 MB
- [ ] Both images boot cleanly in docker-compose
- [ ] Job routing works (lean/parse workers get correct job types)

### Cost (from T04)
- [ ] All 3 PDFs produce valid artifacts with openrouter/free
- [ ] `cost.estimatedCostUsd` = 0.0 for all runs
- [ ] `provenance.model` shows actual routed model (not `openrouter/free`)

---

## 🚀 Getting Started

### For approvers
1. Read **README.md** (5 min)
2. Skim **map.md** (3 min)
3. Review **SPEC-SUMMARY.txt** for quick reference (2 min)
4. **Approve** the 7 tickets

### For implementers
1. Start with **T01** — PyMuPDF Phase A
   - Add `pymupdf` to base deps
   - Implement `parse_prospectus_fast()`
   - Run unit tests
2. Continue through T02–T07 in order, following ticket dependencies

### For reviewers
- Each ticket has **acceptance criteria** section
- Run tests locally: `pytest -m unit,integration` for unit+integration, `pytest -m corpus` for real PDFs (slower)
- Verify timing: T06 will produce `timing-results.md` markdown table

---

## 🔗 Related Documentation

- **ADR-0004:** S3 claim-check pattern (parse caching)
- **ADR-0007:** Job contract (analyze-prospectus payload)
- **ADR-0013:** System-triggered AI jobs
- **spec-06:** Prospectus at-a-glance artifact (current)
- **research/08:** Long-document ingestion (research rationale)

---

## 📝 Key Design Decisions

1. **Camelot over Docling:** F1 ~0.83 vs. 0.98, but 30x faster and torch-free. Docling remains optional `parse` extra.

2. **openrouter/free model:** No paid credits; free tier ($0/call) sufficient for showcase. Non-deterministic model selection acceptable.

3. **Docker split:** Lean (~300 MB) for TA/FA/brief/ann jobs; parse (~400 MB) for prospectus only. Saves deployment size and CI time.

4. **Multi-part stitching:** Parse parts separately, merge `ProspectusParse` objects with re-indexed headings/blocks.

5. **New sections (lock-up + RPT):** Material for Bursa retail investor governance risk assessment. LLM-extracted, added to `insights` (not `sections`).

---

## ⚠️ Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Camelot table F1 0.83 vs Docling 0.98 | Acceptable for highlights; Docling available as optional extra |
| PDF TOC missing/malformed | `effective_levels()` fallback for un-numbered PDFs |
| Multi-part section spanning | `merge_parses()` robust to re-indexed headings; validated on corpus |
| Free model non-determinism | Output quality validated; no paid fallback (acceptable for showcase) |

---

## 📞 Questions?

- **Spec clarity:** See README.md § "Next steps"
- **Ticket details:** See individual ticket file
- **Technical deep dive:** See ADR-0015 (written in T07)
- **Timing validation:** See timing-results.md (produced in T06)

---

**Created:** October 12, 2026  
**Status:** Ready for implementation  
**Next:** Approve tickets and start T01
