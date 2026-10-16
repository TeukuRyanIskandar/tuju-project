"""OpenRouter client against an httpx MockTransport — never the network."""

from __future__ import annotations

import json
import logging

import httpx
import pytest

from tuju_ai.llm import (
    LLMConfigError,
    LLMPermanentError,
    LLMTransientError,
    Message,
    OpenRouterClient,
)

pytestmark = pytest.mark.unit

OK_BODY = {
    "model": "google/gemini-2.5-flash",
    "choices": [{"message": {"content": '{"ok": true}'}, "finish_reason": "stop"}],
    "usage": {
        "prompt_tokens": 100,
        "completion_tokens": 20,
        "prompt_tokens_details": {"cached_tokens": 60},
    },
}


def _client(handler, **kw) -> OpenRouterClient:
    return OpenRouterClient(
        api_key="test-key-not-real",
        model="google/gemini-2.5-flash",
        transport=httpx.MockTransport(handler),
        **kw,
    )


def test_request_shape_and_usage_parsing() -> None:
    seen: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url)
        seen["auth"] = request.headers["authorization"]
        seen["body"] = json.loads(request.content)
        return httpx.Response(200, json=OK_BODY)

    resp = _client(handler).complete(
        [Message("system", "sys"), Message("user", "hi")], max_tokens=50
    )
    assert seen["url"] == "https://openrouter.ai/api/v1/chat/completions"
    assert seen["auth"] == "Bearer test-key-not-real"
    assert seen["body"]["response_format"] == {"type": "json_object"}
    assert seen["body"]["max_tokens"] == 50
    assert seen["body"]["messages"][0] == {"role": "system", "content": "sys"}
    assert resp.text == '{"ok": true}'
    assert (resp.usage.prompt_tokens, resp.usage.completion_tokens, resp.usage.cached_tokens) == (100, 20, 60)
    assert resp.response_metadata.finish_reason == "stop"
    assert resp.response_metadata.content_empty is False


@pytest.mark.parametrize(
    ("choice", "expected"),
    [
        ({"finish_reason": "length", "message": {"content": None}}, ("length", True, False, 0)),
        ({"finish_reason": "stop", "message": {"content": "", "reasoning": "secret reasoning"}}, ("stop", True, True, 16)),
        (None, (None, True, False, 0)),
    ],
)
def test_response_diagnostics_are_metadata_only(caplog, choice, expected) -> None:
    body = {"choices": [] if choice is None else [choice], "usage": {"completion_tokens": 0}}
    caplog.set_level(logging.INFO, logger="tuju_ai.llm.openrouter")

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=body)

    if choice is None:
        with pytest.raises(LLMTransientError) as error:
            _client(handler).complete([Message("user", "secret prompt")])
        assert "secret" not in str(error.value)
        return

    response = _client(handler).complete([Message("user", "secret prompt")])
    metadata = response.response_metadata
    assert (metadata.finish_reason, metadata.content_empty, metadata.reasoning_present, metadata.reasoning_length) == expected
    output = " ".join(record.getMessage() for record in caplog.records)
    assert "secret" not in output
    assert "response metadata" in output


@pytest.mark.parametrize("status", [429, 500, 503, 408, 400, 401, 402, 403, 404])
def test_http_error_body_is_not_propagated(status: int) -> None:
    error_body = "secret provider response and pointer"
    with pytest.raises((LLMTransientError, LLMPermanentError)) as error:
        _client(lambda r: httpx.Response(status, text=error_body)).complete([Message("user", "secret prompt")])
    assert error_body not in str(error.value)


def test_unrecognized_finish_reason_is_normalized_before_logging(caplog) -> None:
    caplog.set_level(logging.INFO, logger="tuju_ai.llm.openrouter")
    response = _client(
        lambda request: httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "finish_reason": "secret provider pointer",
                        "message": {"content": "ok"},
                    }
                ]
            },
        )
    ).complete([Message("user", "secret prompt")])

    assert response.response_metadata.finish_reason == "unknown"
    rendered_logs = " ".join(record.getMessage() for record in caplog.records)
    assert "secret" not in rendered_logs
    assert "pointer" not in rendered_logs


def test_malformed_usage_metadata_does_not_leak_provider_value() -> None:
    with pytest.raises(LLMTransientError) as error:
        _client(
            lambda request: httpx.Response(
                200,
                json={
                    "choices": [{"message": {"content": "ok"}}],
                    "usage": {"completion_tokens": "secret provider value"},
                },
            )
        ).complete([Message("user", "secret prompt")])

    assert "secret" not in str(error.value)
    assert "provider value" not in str(error.value)


def test_cache_control_is_optional() -> None:
    bodies: list[dict] = []

    def handler(request: httpx.Request) -> httpx.Response:
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=OK_BODY)

    msgs = [Message("system", "sys", cache=True), Message("user", "task")]
    _client(handler).complete(msgs)
    assert bodies[-1]["messages"][0]["content"] == "sys"  # off by default

    _client(handler, prompt_cache=True).complete(msgs)
    part = bodies[-1]["messages"][0]["content"][0]
    assert part["cache_control"] == {"type": "ephemeral"}
    assert bodies[-1]["messages"][1]["content"] == "task"  # unflagged untouched


def test_custom_base_url() -> None:
    urls: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        return httpx.Response(200, json=OK_BODY)

    _client(handler, base_url="http://localhost:9999/v1/").complete([Message("user", "x")])
    assert urls == ["http://localhost:9999/v1/chat/completions"]


@pytest.mark.parametrize("status", [429, 500, 503, 408])
def test_retryable_statuses_are_transient(status: int) -> None:
    with pytest.raises(LLMTransientError):
        _client(lambda r: httpx.Response(status, text="busy")).complete([Message("user", "x")])


@pytest.mark.parametrize("status", [400, 401, 402, 403, 404])
def test_rejections_are_permanent(status: int) -> None:
    with pytest.raises(LLMPermanentError):
        _client(lambda r: httpx.Response(status, text="no")).complete([Message("user", "x")])


def test_timeout_is_transient() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("slow", request=request)

    with pytest.raises(LLMTransientError):
        _client(handler).complete([Message("user", "x")])


def test_empty_choices_is_transient() -> None:
    with pytest.raises(LLMTransientError):
        _client(lambda r: httpx.Response(200, json={"choices": []})).complete([Message("user", "x")])


def test_missing_key_is_a_config_error_and_key_never_in_repr() -> None:
    with pytest.raises(LLMConfigError):
        OpenRouterClient(api_key="", model="m")
    client = _client(lambda r: httpx.Response(200, json=OK_BODY))
    assert "test-key-not-real" not in repr(client)
