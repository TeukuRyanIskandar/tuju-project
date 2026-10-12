"""Per-document cost tracking + the $2/doc guard (ticket 05, spec 06).

Token usage from every LLM call is priced against a per-model table
(USD per million tokens) and summed. The ceiling is enforced twice:

* BEFORE a call: ``spent + worst-case cost of this call`` must fit under the
  ceiling, so an obviously-too-big call is never paid for;
* AFTER a call: actual usage is recorded and the running total re-checked.

Crossing it raises :class:`CostCeilingExceeded`, which the handler maps to a
terminal (non-retryable) failure — a retry would just spend the money again.

Prices are APPROXIMATE list prices (OpenRouter passes provider prices
through) and will drift. Override at deploy time with ``LLM_PRICE_TABLE_JSON``;
an unknown model is priced at the most expensive built-in rate so the guard
errs on the side of over-estimating.

Free models (``openrouter/free`` and any ``…:free`` variant) cost $0: the guard
stays wired for consistency but can never trip on them.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from .base import LLMClient, LLMResponse, Message, Usage

# Conservative chars-per-token for ESTIMATING input size before a call
# (English prose is ~4; tables and numbers tokenize worse).
CHARS_PER_TOKEN_ESTIMATE = 3


class CostCeilingExceeded(Exception):
    """The per-document spend ceiling was (or would be) crossed."""


@dataclass(frozen=True)
class ModelPrice:
    """USD per million tokens."""

    input: float
    output: float
    cached_input: float | None = None  # None ⇒ cached tokens billed as input


# APPROXIMATE list prices — see module docstring.
FREE = ModelPrice(input=0.0, output=0.0, cached_input=0.0)

DEFAULT_PRICE_TABLE: dict[str, ModelPrice] = {
    "openrouter/free": FREE,
    "google/gemini-2.5-flash": ModelPrice(input=0.30, output=2.50, cached_input=0.075),
    "google/gemini-2.5-pro": ModelPrice(input=1.25, output=10.00, cached_input=0.31),
    "anthropic/claude-sonnet-4.5": ModelPrice(
        input=3.00, output=15.00, cached_input=0.30
    ),
}


def load_price_table(override_json: str | None = None) -> dict[str, ModelPrice]:
    """Built-in table, merged with an optional JSON override.

    Override shape: ``{"vendor/model": {"input": 0.3, "output": 2.5,
    "cachedInput": 0.075}}`` (USD per million tokens).
    """
    table = dict(DEFAULT_PRICE_TABLE)
    if not override_json:
        return table
    try:
        raw: dict[str, Any] = json.loads(override_json)
        for model, p in raw.items():
            table[model] = ModelPrice(
                input=float(p["input"]),
                output=float(p["output"]),
                cached_input=(
                    float(p["cachedInput"]) if p.get("cachedInput") is not None else None
                ),
            )
    except (ValueError, KeyError, TypeError, AttributeError) as exc:
        raise ValueError(f"LLM_PRICE_TABLE_JSON is malformed: {exc}") from exc
    return table


def price_for(model: str, table: dict[str, ModelPrice]) -> ModelPrice:
    """Price for ``model``; unknown models get the most expensive known rate."""
    if model in table:
        return table[model]
    if model.endswith(":free"):
        return FREE
    return max(table.values(), key=lambda p: (p.input, p.output))


def usage_cost_usd(usage: Usage, price: ModelPrice) -> float:
    cached = min(usage.cached_tokens, usage.prompt_tokens)
    fresh = usage.prompt_tokens - cached
    cached_rate = price.cached_input if price.cached_input is not None else price.input
    return (
        fresh * price.input
        + cached * cached_rate
        + usage.completion_tokens * price.output
    ) / 1_000_000


def estimate_tokens(messages: list[Message]) -> int:
    return sum(len(m.content) for m in messages) // CHARS_PER_TOKEN_ESTIMATE + 1


class CostTracker:
    """Accumulates usage/cost across one document's LLM calls and guards the ceiling."""

    def __init__(
        self,
        *,
        model: str,
        ceiling_usd: float,
        price_table: dict[str, ModelPrice] | None = None,
    ) -> None:
        self.model = model
        self.ceiling_usd = ceiling_usd
        self._price = price_for(model, price_table or DEFAULT_PRICE_TABLE)
        self.prompt_tokens = 0
        self.completion_tokens = 0
        self.cached_tokens = 0
        self.spent_usd = 0.0
        self.calls: list[dict[str, Any]] = []

    @property
    def free(self) -> bool:
        """True when every token is priced at $0 (``openrouter/free``, ``…:free``)."""
        p = self._price
        return p.input == 0 and p.output == 0 and not p.cached_input

    def worst_case_call_usd(self, prompt_tokens: int, max_tokens: int) -> float:
        """Upper bound for a call: no cache discount, full max output."""
        return (
            prompt_tokens * self._price.input + max_tokens * self._price.output
        ) / 1_000_000

    def call(
        self,
        client: LLMClient,
        step: str,
        messages: list[Message],
        *,
        max_tokens: int,
        json_mode: bool = True,
    ) -> LLMResponse:
        """Guarded, metered ``client.complete``."""
        projected = self.spent_usd + self.worst_case_call_usd(
            estimate_tokens(messages), max_tokens
        )
        if projected > self.ceiling_usd:
            raise CostCeilingExceeded(
                f"step {step!r}: projected spend ${projected:.2f} would exceed the "
                f"${self.ceiling_usd:.2f}/doc ceiling (spent ${self.spent_usd:.2f})"
            )
        response = client.complete(messages, json_mode=json_mode, max_tokens=max_tokens)
        self.record(step, response.usage, served_by=response.model)
        return response

    def served_models(self) -> list[str]:
        """Distinct models that actually answered, in first-use order."""
        return list(dict.fromkeys(c["model"] for c in self.calls if "model" in c))

    def record(self, step: str, usage: Usage, served_by: str | None = None) -> None:
        cost = usage_cost_usd(usage, self._price)
        self.prompt_tokens += usage.prompt_tokens
        self.completion_tokens += usage.completion_tokens
        self.cached_tokens += usage.cached_tokens
        self.spent_usd += cost
        self.calls.append(
            {
                "step": step,
                "promptTokens": usage.prompt_tokens,
                "completionTokens": usage.completion_tokens,
                "cachedTokens": usage.cached_tokens,
                "costUsd": round(cost, 6),
                **({"model": served_by} if served_by else {}),
            }
        )
        if self.spent_usd > self.ceiling_usd:
            raise CostCeilingExceeded(
                f"after step {step!r}: spend ${self.spent_usd:.2f} exceeds the "
                f"${self.ceiling_usd:.2f}/doc ceiling"
            )

    def report(self) -> dict[str, Any]:
        return {
            "model": self.model,
            "calls": len(self.calls),
            "promptTokens": self.prompt_tokens,
            "completionTokens": self.completion_tokens,
            "cachedTokens": self.cached_tokens,
            "estimatedCostUsd": round(self.spent_usd, 6),
            "ceilingUsd": self.ceiling_usd,
            "perCall": self.calls,
        }
