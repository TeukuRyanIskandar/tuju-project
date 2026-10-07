"""The LLM seam (ticket 05): a small protocol + value types + error classes.

Synchronous on purpose: the worker's handler is sync and runs in a thread
(see ``worker.py``), so a sync client needs no event-loop plumbing and is
trivial to fake. The protocol returns text + token usage; everything
provider-specific (OpenRouter's HTTP shape, cache_control) lives behind it.

Error classes map onto ADR-0007's two failure classes:

* :class:`LLMTransientError` — timeout / rate limit / 5xx: let BullMQ retry.
* :class:`LLMConfigError` / :class:`LLMPermanentError` — no key, auth or
  request rejected: retrying can never succeed ⇒ terminal (handler maps to
  ``TerminalJobError``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol


class LLMError(Exception):
    """Base class for LLM seam failures."""


class LLMConfigError(LLMError):
    """Misconfiguration (e.g. ``OPENROUTER_API_KEY`` unset). Non-retryable."""


class LLMTransientError(LLMError):
    """Timeout / network / 429 / 5xx. Retryable (BullMQ backoff)."""


class LLMPermanentError(LLMError):
    """Auth failure / rejected request / exhausted credits. Non-retryable."""


@dataclass(frozen=True)
class Message:
    """One chat message.

    ``cache=True`` marks the END of a cacheable prefix (an OpenRouter
    ``cache_control`` breakpoint when prompt caching is enabled; ignored
    otherwise). Messages are ordered shared-prefix-first so provider-side
    implicit caching (e.g. Gemini) benefits even with breakpoints off.
    """

    role: Literal["system", "user", "assistant"]
    content: str
    cache: bool = False


@dataclass(frozen=True)
class Usage:
    """Token usage of one call. ``cached_tokens`` ⊆ ``prompt_tokens``."""

    prompt_tokens: int = 0
    completion_tokens: int = 0
    cached_tokens: int = 0


@dataclass(frozen=True)
class LLMResponse:
    text: str
    usage: Usage
    model: str


class LLMClient(Protocol):
    """What the analysis needs from an LLM provider."""

    model: str

    def complete(
        self,
        messages: list[Message],
        *,
        json_mode: bool = True,
        max_tokens: int | None = None,
    ) -> LLMResponse: ...
