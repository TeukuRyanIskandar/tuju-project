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

from typing import Any

import httpx

from .base import (
    LLMConfigError,
    LLMPermanentError,
    LLMResponse,
    LLMTransientError,
    Message,
    Usage,
)

DEFAULT_TIMEOUT_SECONDS = 180.0  # long-context calls take a while


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
        except httpx.TransportError as exc:  # timeouts, connect errors
            raise LLMTransientError(f"OpenRouter request failed: {exc!r}") from exc

        if resp.status_code in (408, 429) or resp.status_code >= 500:
            raise LLMTransientError(
                f"OpenRouter transient HTTP {resp.status_code}: {resp.text[:200]}"
            )
        if resp.status_code >= 400:
            # 400/401/402/403/404: bad request, bad key, no credits, unknown model.
            raise LLMPermanentError(
                f"OpenRouter rejected the request (HTTP {resp.status_code}): "
                f"{resp.text[:200]}"
            )

        try:
            data = resp.json()
            choice = data["choices"][0]
            text = choice["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError) as exc:
            # 200 with an error body / empty choices: usually a provider blip.
            raise LLMTransientError(
                f"OpenRouter returned an unusable body: {resp.text[:200]}"
            ) from exc

        u = data.get("usage") or {}
        details = u.get("prompt_tokens_details") or {}
        usage = Usage(
            prompt_tokens=int(u.get("prompt_tokens") or 0),
            completion_tokens=int(u.get("completion_tokens") or 0),
            cached_tokens=int(details.get("cached_tokens") or 0),
        )
        return LLMResponse(text=text, usage=usage, model=str(data.get("model") or self.model))
