"""The worker's one LLM runtime (architecture-deepening ticket 03).

Built ONCE from :class:`~tuju_ai.config.Settings` in ``worker.run()`` and
injected into every job, so no job reads the environment, hardcodes a ceiling
or picks its own client. It holds:

* the client (``None`` when ``OPENROUTER_API_KEY`` is unset — the worker still
  boots, and an LLM job fails terminally the moment it asks for a session);
* the price table the cost guard prices usage with;
* the per-job-kind spend ceilings (``$0.10`` per TA/FA narration, ``~$2`` per
  prospectus by default).

A job opens one :class:`LLMSession` per run: the client plus a fresh
:class:`~tuju_ai.llm.cost.CostTracker` at that job's ceiling. Every call goes
through :func:`tuju_ai.llm.structured.ask` with the session.

Tests build ``LLMRuntime(client=FakeLLMClient(...))``: no env, no network.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Mapping

from ..config import (
    DEFAULT_COST_CEILING_USD,
    DEFAULT_NARRATION_COST_CEILING_USD,
    JOB_ANALYZE_FUNDAMENTAL,
    JOB_ANALYZE_PROSPECTUS,
    JOB_ANALYZE_TECHNICAL,
    Settings,
)
from .base import LLMClient, LLMConfigError
from .cost import DEFAULT_PRICE_TABLE, CostTracker, ModelPrice, load_price_table
from .openrouter import OpenRouterClient


def default_ceilings(
    *,
    narration_usd: float = DEFAULT_NARRATION_COST_CEILING_USD,
    prospectus_usd: float = DEFAULT_COST_CEILING_USD,
) -> dict[str, float]:
    """Per-job-kind spend ceilings (USD). Jobs without an LLM step have none."""
    return {
        JOB_ANALYZE_TECHNICAL: narration_usd,
        JOB_ANALYZE_FUNDAMENTAL: narration_usd,
        JOB_ANALYZE_PROSPECTUS: prospectus_usd,
    }


def missing_key_message(job_name: str) -> str:
    return (
        "OPENROUTER_API_KEY is not configured on the AI worker, so the "
        f"{job_name} job cannot run. Set it (and optionally LLM_MODEL / "
        "LLM_BASE_URL) and re-enqueue."
    )


@dataclass(frozen=True)
class LLMSession:
    """One job run's metered view of the runtime: client + its cost tracker."""

    client: LLMClient
    tracker: CostTracker

    @property
    def model(self) -> str:
        """The model that was requested (a router id may serve others)."""
        return self.client.model


@dataclass(frozen=True)
class LLMRuntime:
    client: LLMClient | None
    ceilings_usd: Mapping[str, float] = field(default_factory=default_ceilings)
    price_table: Mapping[str, ModelPrice] = field(
        default_factory=lambda: dict(DEFAULT_PRICE_TABLE)
    )

    @classmethod
    def from_settings(cls, settings: Settings) -> LLMRuntime:
        """Build the runtime from env settings; never raises on a missing key."""
        client: LLMClient | None = None
        if settings.openrouter_api_key:
            client = OpenRouterClient(
                api_key=settings.openrouter_api_key,
                model=settings.llm_model,
                base_url=settings.llm_base_url,
                prompt_cache=settings.llm_prompt_cache,
            )
        return cls(
            client=client,
            ceilings_usd=default_ceilings(
                narration_usd=settings.narration_cost_ceiling_usd,
                prospectus_usd=settings.cost_ceiling_usd,
            ),
            price_table=load_price_table(settings.llm_price_table_json),
        )

    @property
    def configured(self) -> bool:
        return self.client is not None

    def session(self, job_name: str) -> LLMSession:
        """A fresh metered session at ``job_name``'s ceiling.

        Raises :class:`LLMConfigError` (terminal) when no client is configured.
        """
        if self.client is None:
            raise LLMConfigError(missing_key_message(job_name))
        tracker = CostTracker(
            model=self.client.model,
            ceiling_usd=self.ceilings_usd[job_name],
            price_table=dict(self.price_table),
        )
        return LLMSession(client=self.client, tracker=tracker)
