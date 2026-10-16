"""OpenRouter chat-completions client (ticket 05).

OpenRouter exposes an OpenAI-compatible API at
``https://openrouter.ai/api/v1/chat/completions`` (Bearer key). Nothing here
runs at import time or in tests against the network: the HTTP transport is
injectable (``httpx.MockTransport`` in unit tests).

* ``json_mode`` ⇒ ``response_format: {"type": "json_object"}`` (OpenRouter
  forwards it to providers that support it and ignores it otherwise; the
  analysis still validates the JSON itself).
* Prompt caching: when ``prompt_cache`` is on, messages flagged ``cache=True``
  are sent as content parts carrying ``cache_control: {"type": "ephemeral"}``
  (OpenRouter forwards breakpoints to Anthropic/Gemini). Off by default;
  providers with implicit prefix caching still benefit because the stable
  prefix is always first.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import (
    LLMConfigError,
    LLMPermanentError,
    LLMResponse,
    LLMTransientError,
    Message,
    ResponseMetadata,
    Usage,
)

DEFAULT_TIMEOUT_SECONDS = 180.0  # long-context calls take a while
logger = logging.getLogger(__name__)
_KNOWN_FINISH_REASONS = frozenset({"stop", "length", "content_filter", "tool_calls", "function_call"})


class OpenRouterClient:
    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        base_url: str = "https://openrouter.ai/api/v1",
        prompt_cache: bool = False,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        if not api_key:
            raise LLMConfigError("OPENROUTER_API_KEY is not set")
        self._api_key = api_key
        self.model = model
        self._url = base_url.rstrip("/") + "/chat/completions"
        self._prompt_cache = prompt_cache
        self._timeout = timeout
        self._transport = transport

    def __repr__(self) -> str:  # never leak the key
        return f"OpenRouterClient(model={self.model!r})"

    def _wire_messages(self, messages: list[Message]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for m in messages:
            if m.cache and self._prompt_cache:
                out.append(
                    {
                        "role": m.role,
                        "content": [
                            {
                                "type": "text",
                                "text": m.content,
                                "cache_control": {"type": "ephemeral"},
                            }
                        ],
                    }
                )
            else:
                out.append({"role": m.role, "content": m.content})
        return out

    def complete(
        self,
        messages: list[Message],
        *,
        json_mode: bool = True,
        max_tokens: int | None = None,
    ) -> LLMResponse:
        body: dict[str, Any] = {
            "model": self.model,
            "messages": self._wire_messages(messages),
            "temperature": 0,
            "usage": {"include": True},
        }
        if json_mode:
            body["response_format"] = {"type": "json_object"}
        if max_tokens is not None:
            body["max_tokens"] = max_tokens

        try:
            with httpx.Client(transport=self._transport, timeout=self._timeout) as http:
                resp = http.post(
                    self._url,
                    json=body,
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
        except httpx.TransportError:  # timeouts, connect errors
            raise LLMTransientError("OpenRouter transport request failed") from None

        if resp.status_code in (408, 429) or resp.status_code >= 500:
            raise LLMTransientError(f"OpenRouter transient HTTP {resp.status_code}")
        if resp.status_code >= 400:
            # 400/401/402/403/404: bad request, bad key, no credits, unknown model.
            raise LLMPermanentError(
                f"OpenRouter rejected the request (HTTP {resp.status_code})"
            )

        try:
            data = resp.json()
            choice = data["choices"][0]
            message = choice["message"]
            content = message.get("content")
            text = content or ""
            reasoning = message.get("reasoning") or message.get("reasoning_content") or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            raise LLMTransientError("OpenRouter returned an unusable response shape") from None

        try:
            u = data.get("usage") or {}
            details = u.get("prompt_tokens_details") or {}
            usage = Usage(
                prompt_tokens=int(u.get("prompt_tokens") or 0),
                completion_tokens=int(u.get("completion_tokens") or 0),
                cached_tokens=int(details.get("cached_tokens") or 0),
            )
        except (AttributeError, TypeError, ValueError, OverflowError):
            raise LLMTransientError("OpenRouter returned unusable usage metadata") from None
        raw_finish_reason = choice.get("finish_reason")
        finish_reason = (
            raw_finish_reason
            if isinstance(raw_finish_reason, str) and raw_finish_reason in _KNOWN_FINISH_REASONS
            else "unknown"
        )
        metadata = ResponseMetadata(
            finish_reason=finish_reason,
            content_empty=not bool(text),
            completion_tokens=usage.completion_tokens,
            reasoning_present=bool(reasoning),
            reasoning_length=len(reasoning) if isinstance(reasoning, str) else 0,
        )
        logger.info("OpenRouter response metadata: %s", metadata)
        return LLMResponse(
            text=text,
            usage=usage,
            model=str(data.get("model") or self.model),
            response_metadata=metadata,
        )
