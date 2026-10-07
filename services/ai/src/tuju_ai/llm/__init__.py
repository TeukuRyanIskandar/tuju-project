"""LLM seam for the prospectus analysis (spec 06, ticket 05)."""

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

__all__ = [
    "CostCeilingExceeded",
    "CostTracker",
    "FakeLLMClient",
    "LLMClient",
    "LLMConfigError",
    "LLMError",
    "LLMPermanentError",
    "LLMResponse",
    "LLMTransientError",
    "Message",
    "OpenRouterClient",
    "Usage",
    "load_price_table",
]
