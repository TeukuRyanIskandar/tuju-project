"""Runtime dependencies + error mapping for the ``analyze-prospectus`` job."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from ..config import Settings
from ..llm import LLMClient, OpenRouterClient
from ..llm.cost import ModelPrice, load_price_table
from .models import ProspectusParse

ParseFn = Callable[[bytes], ProspectusParse]

MISSING_KEY_MESSAGE = (
    "OPENROUTER_API_KEY is not configured on the AI worker, so the "
    "analyze-prospectus job cannot run. Set it (and optionally LLM_MODEL / "
    "LLM_BASE_URL) and re-enqueue."
)


@dataclass
class ProspectusRuntime:
    """Everything ``analyze-prospectus`` needs beyond artifact store + backend.

    ``llm_client=None`` ⇒ no API key: the job fails terminally up front
    (ADR-0007 "terminal", no retry, BEFORE any expensive parse).
    ``parse_fn=None`` ⇒ the real Docling adapter (lazy import).
    """

    llm_client: LLMClient | None = None
    parse_fn: ParseFn | None = None
    cost_ceiling_usd: float = 2.0
    price_table: dict[str, ModelPrice] = field(default_factory=load_price_table)
    heartbeat_seconds: float = 30.0


def build_prospectus_runtime(settings: Settings) -> ProspectusRuntime:
    """Build the runtime from env settings; never raises on a missing key."""
    client: LLMClient | None = None
    if settings.openrouter_api_key:
        client = OpenRouterClient(
            api_key=settings.openrouter_api_key,
            model=settings.llm_model,
            base_url=settings.llm_base_url,
            prompt_cache=settings.llm_prompt_cache,
        )
    return ProspectusRuntime(
        llm_client=client,
        cost_ceiling_usd=settings.cost_ceiling_usd,
        price_table=load_price_table(settings.llm_price_table_json),
    )
