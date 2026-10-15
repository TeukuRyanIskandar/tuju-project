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

from tuju_ai.artifacts import ArtifactStore
from tuju_ai.config import JOB_ANALYZE_PROSPECTUS, Settings
from tuju_ai.llm import LLMRuntime
from tuju_ai.prospectus.analysis import AnalysisDeps, analyze
from tuju_ai.prospectus.analysis_models import IpoReference
from tuju_ai.prospectus.parsing import (
    group_pdf_parts,
    merge_pdf_parts,
    parse_prospectus_fast,
)


class _MemoryS3:
    """In-memory parse cache: this run never touches real S3."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_object(self, *, Key: str, Body: bytes, **_: object) -> dict:
        self.objects[Key] = Body
        return {}

    def get_object(self, *, Key: str, **_: object) -> dict:
        from botocore.exceptions import ClientError

        if Key not in self.objects:
            raise ClientError({"Error": {"Code": "NoSuchKey"}}, "GetObject")
        return {"Body": self.objects[Key]}


class _PrintProgress:
    def __init__(self) -> None:
        self.n = 0

    def advance(self, label: str | None = None) -> None:
        self.n += 1
        print(f"    step {self.n} ...", flush=True)

    def heartbeat(self):
        from contextlib import nullcontext

        return nullcontext()


def _run_one(name: str, parts: list[Path], settings: Settings) -> dict:
    session = LLMRuntime.from_settings(settings).session(JOB_ANALYZE_PROSPECTUS)
    t0 = time.perf_counter()
    artifact = analyze(
        name,
        IpoReference(id=name, companyName=name, prospectusS3Key=f"prospectus/{name}.pdf"),
        merge_pdf_parts([p.read_bytes() for p in parts]),
        AnalysisDeps(
            llm=session,
            parse_fn=parse_prospectus_fast,
            parse_cache=ArtifactStore(settings, s3_client=_MemoryS3()),
        ),
        _PrintProgress(),
    )

    (OUT_DIR / "artifacts").mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "artifacts" / f"{name}.json").write_text(
        json.dumps(artifact, indent=2, ensure_ascii=False), encoding="utf-8"
    )
    sections = artifact["sections"]
    return {
        "parts": len(parts),
        "parseS": artifact["timing"]["parseMs"] / 1000,
        "llmS": artifact["timing"]["analysisMs"] / 1000,
        "totalS": time.perf_counter() - t0,
        "models": artifact["provenance"]["model"],
        "costUsd": artifact["cost"]["estimatedCostUsd"],
        "calls": artifact["cost"]["calls"],
        "periods": len(sections["financials"]["data"].get("periods") or []),
        "themes": len(sections["riskFactors"]["data"].get("themes") or []),
        "headline": bool(sections["whatToWatch"]["data"].get("headline")),
        "located": "".join(
            "L" if v["routing"]["located"] else "F"
            for group in ("sections", "insights")
            for v in artifact[group].values()
            if "routing" in v
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

    sections = "offer/business/financials/riskFactors/lockup/relatedParty"
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
