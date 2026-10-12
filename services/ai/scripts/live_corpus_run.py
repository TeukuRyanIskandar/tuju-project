"""Live corpus run against OpenRouter (prospectus-v2 T04; not part of the suite).

Runs the full analyze-prospectus pipeline (PyMuPDF parse → route → LLM
analysis) on every demo-corpus PDF with the REAL OpenRouter client and the
configured model (default ``openrouter/free``), then writes:

* ``.scratch/prospectus-v2/live-run-results.md`` — per-PDF timing, the models
  that actually answered, cost, and the quality spot-checks;
* ``.scratch/prospectus-v2/artifacts/<prospectus>.json`` — each full artifact.

Multi-part prospectuses (``<name>_part1of3.pdf``, ``<name>_part2of3.pdf``, …)
are merged into one document before parsing (``merge_pdf_parts``). A failed
prospectus is recorded in the table and the run continues.

Usage (needs a real key; LLM_MODEL optional):
    OPENROUTER_API_KEY=... uv run --project services/ai python scripts/live_corpus_run.py
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
CORPUS = REPO / ".scratch" / "free-tier" / "demo-corpus" / "prospectuses"
OUT_DIR = REPO / ".scratch" / "prospectus-v2"

from tuju_ai.config import Settings
from tuju_ai.llm import CostTracker
from tuju_ai.prospectus.analysis import analyze_prospectus
from tuju_ai.prospectus.analysis_models import IpoReference
from tuju_ai.prospectus.job import build_prospectus_runtime
from tuju_ai.prospectus.models import ProspectusSection
from tuju_ai.prospectus.parsing import (
    group_pdf_parts,
    merge_pdf_parts,
    parse_prospectus_fast,
)
from tuju_ai.prospectus.router import route_sections


def _run_one(name: str, parts: list[Path], settings: Settings) -> dict:
    runtime = build_prospectus_runtime(settings)
    client = runtime.llm_client
    t0 = time.perf_counter()
    parse = parse_prospectus_fast(merge_pdf_parts([p.read_bytes() for p in parts]))
    t_parse = time.perf_counter() - t0
    routed = route_sections(parse)
    tracker = CostTracker(
        model=client.model,
        ceiling_usd=runtime.cost_ceiling_usd,
        price_table=runtime.price_table,
    )
    t1 = time.perf_counter()
    artifact = analyze_prospectus(
        prospectus_id=name,
        reference=IpoReference(
            id=name, companyName=name, prospectusS3Key=f"prospectus/{name}.pdf"
        ),
        parse=parse,
        routed=routed,
        client=client,
        tracker=tracker,
        on_step=lambda step: print(f"    step {step} ...", flush=True),
    )
    t_llm = time.perf_counter() - t1

    (OUT_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "artifacts" / f"{name}.json").write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    sections = artifact["sections"]
    return {
        "parts": len(parts),
        "parseS": t_parse,
        "llmS": t_llm,
        "totalS": time.perf_counter() - t0,
        "models": artifact["provenance"]["model"],
        "costUsd": artifact["cost"]["estimatedCostUsd"],
        "calls": artifact["cost"]["calls"],
        "periods": len(sections["financials"]["data"].get("periods") or []),
        "themes": len(sections["riskFactors"]["data"].get("themes") or []),
        "headline": bool(sections["whatToWatch"]["data"].get("headline")),
        "located": "".join(
            "L" if r.located else "F" for r in routed.values()
        ),
    }


def main() -> int:
    settings = Settings.from_env()
    if not settings.openrouter_api_key:
        print("OPENROUTER_API_KEY is not set", file=sys.stderr)
        return 1
    pdfs = sorted(CORPUS.glob("*.pdf"))
    if not pdfs:
        print(f"no PDFs found under {CORPUS}", file=sys.stderr)
        return 1

    rows: list[str] = []
    ok = True
    for name, parts in group_pdf_parts(pdfs).items():
        print(f"--- {name} ({len(parts)} part(s), {settings.llm_model})", flush=True)
        try:
            r = _run_one(name, parts, settings)
        except Exception as exc:  # record and keep going
            ok = False
            print(f"    FAILED: {exc!r}", flush=True)
            rows.append(f"| {name} | FAILED: {type(exc).__name__}: {str(exc)[:120]} ||||||||||")
            continue
        quality = r["periods"] > 0 and r["themes"] > 0 and r["headline"]
        ok = ok and quality
        rows.append(
            f"| {name} | {r['parts']} | {r['parseS']:.1f} | {r['llmS']:.0f} | {r['totalS']:.0f} "
            f"| {r['models']} | {r['calls']} | ${r['costUsd']:.4f} | {r['periods']} "
            f"| {r['themes']} | {'yes' if r['headline'] else 'NO'} | {r['located']} |"
        )
        print(f"    done: {rows[-1]}", flush=True)

    sections = "/".join(s.value for s in ProspectusSection)
    md = (
        "# prospectus-v2 live corpus run\n\n"
        f"Run {datetime.now(timezone.utc).isoformat(timespec='seconds')} · "
        f"requested model `{settings.llm_model}` · "
        "`scripts/live_corpus_run.py`. Full artifacts in `artifacts/`.\n\n"
        "| Prospectus | Parts | Parse (s) | LLM (s) | Total (s) | Models that answered "
        f"| Calls | Cost | Fin. periods | Risk themes | Headline | Routing ({sections}) |\n"
        "|---|---|---|---|---|---|---|---|---|---|---|---|\n" + "\n".join(rows) + "\n"
    )
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "live-run-results.md").write_text(md, encoding="utf-8")
    print(f"\nwrote {OUT_DIR / 'live-run-results.md'}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
