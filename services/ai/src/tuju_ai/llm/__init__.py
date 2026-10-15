"""LLM seam (spec 06 ticket 05; architecture-deepening ticket 03).

* :class:`LLMRuntime` — built once per worker; opens a metered
  :class:`LLMSession` per job run.
* :func:`ask` — the one structured call (JSON + schema + validators +
  bounded corrective retry + cost guard).
"""

from .base import (
    LLMClient,
    LLMConfigError,
    LLMError,
    LLMPermanentError,
    LLMResponse,
    LLMTransientError,
    Message,
    Usage,
)
from .cost import CostCeilingExceeded, CostTracker, load_price_table
from .fake import FakeLLMClient
from .openrouter import OpenRouterClient
from .runtime import LLMRuntime, LLMSession
from .structured import (
    MalformedModelOutput,
    OutputRejected,
    StructuredCallFailed,
    ask,
    extract_json,
)

__all__ = [
    "CostCeilingExceeded",
    "CostTracker",
    "FakeLLMClient",
    "LLMClient",
    "LLMConfigError",
    "LLMError",
    "LLMPermanentError",
    "LLMResponse",
    "LLMRuntime",
    "LLMSession",
    "LLMTransientError",
    "MalformedModelOutput",
    "Message",
    "OpenRouterClient",
    "OutputRejected",
    "StructuredCallFailed",
    "Usage",
    "ask",
    "extract_json",
    "load_price_table",
]
