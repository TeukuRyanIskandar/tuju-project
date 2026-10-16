"""Structured LLM calls: one guarded, validated, bounded-retry ``ask`` (ticket 03).

Every LLM step in the worker (TA/FA narration, the prospectus sections and
reduce) goes through :func:`ask`. It owns:

* JSON extraction — tolerant of code fences and stray prose around the object;
* schema validation — the reply must validate against a pydantic model;
* a validator chain — callables run on the validated output, each returning a
  rejection reason or ``None`` (e.g. TA/FA grounding and no-advice);
* the corrective retry — the bad reply (≤ :data:`MAX_RAW_ECHO_CHARS`) is
  echoed back with the reason, after the ORIGINAL messages, so the shared
  cacheable prefix is resent unchanged;
* the retry bound — :data:`MAX_RETRIES` on a paid model, :data:`MAX_RETRIES_FREE`
  on a $0 model (a retry costs nothing there, and ``openrouter/free`` may
  route it to a different model);
* cost — every call is metered and guarded by the session's
  :class:`~tuju_ai.llm.cost.CostTracker`; :class:`CostCeilingExceeded`
  propagates unchanged for the caller to classify.

Exhaustion raises :class:`MalformedModelOutput` when the last reply was empty,
could not be parsed, or did not validate against the requested schema; it
includes only allowlisted provider metadata for diagnosis. :class:`OutputRejected`
means the reply parsed but a validator rejected it. What either means for the
job (terminal, or a facts-only degrade) is the caller's decision.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Sequence, TypeVar

from pydantic import BaseModel, ValidationError

from .base import LLMResponse, Message
from .runtime import LLMSession

MAX_RAW_ECHO_CHARS = 2000  # how much of a bad reply is echoed back on retry
MAX_RETRIES = 1  # corrective retries on a paid model (ADR-0007)
MAX_RETRIES_FREE = 3  # ... and on a $0 model (prospectus-v2 T04 live run)

T = TypeVar("T", bound=BaseModel)
# Runs on a schema-valid output; returns why it is unusable, or None.
Validator = Callable[[T], "str | None"]


class StructuredCallFailed(Exception):
    """The model's reply stayed unusable after the bounded retries."""


class MalformedModelOutput(StructuredCallFailed):
    """The last reply was not valid JSON in the requested shape."""


class OutputRejected(StructuredCallFailed):
    """The last reply parsed, but a validator rejected it."""


def extract_json(text: str) -> Any:
    """Parse a JSON object out of an LLM reply (tolerates fences / stray prose)."""
    stripped = text.strip()
    if stripped.startswith("```"):
        stripped = stripped.strip("`")
        if stripped.lower().startswith("json"):
            stripped = stripped[4:]
        stripped = stripped.strip()
    try:
        return json.loads(stripped)
    except json.JSONDecodeError:
        start, end = stripped.find("{"), stripped.rfind("}")
        if start == -1 or end <= start:
            raise
        return json.loads(stripped[start : end + 1])


def _response_facts(response: LLMResponse) -> str:
    """Return the allowlisted provider facts that make an unusable reply legible."""
    metadata = response.response_metadata
    finish_reason = metadata.finish_reason or "unknown"
    return (
        f"finish_reason={finish_reason}, "
        f"completion_tokens={metadata.completion_tokens}, "
        f"content_empty={str(metadata.content_empty).lower()}, "
        f"reasoning_present={str(metadata.reasoning_present).lower()}"
    )


def ask(
    session: LLMSession,
    step: str,
    messages: list[Message],
    schema: type[T],
    *,
    max_tokens: int,
    validators: Sequence[Validator[T]] = (),
) -> T:
    """One structured step: call, parse, validate, retry within the bound.

    ``step`` names the call in the cost report and in the corrective
    ``[step:<id>]`` marker. Raises :class:`MalformedModelOutput`,
    :class:`OutputRejected` or :class:`CostCeilingExceeded`; LLM transport
    errors propagate unchanged.
    """
    tracker = session.tracker
    retries = MAX_RETRIES_FREE if tracker.free else MAX_RETRIES
    convo = list(messages)
    failure: StructuredCallFailed | None = None
    for attempt in range(retries + 1):
        response = tracker.call(session.client, step, convo, max_tokens=max_tokens)
        if not response.text.strip():
            failure = MalformedModelOutput(
                f"the model returned an empty reply ({_response_facts(response)})"
            )
        else:
            try:
                parsed = extract_json(response.text)
            except ValueError:  # JSONDecodeError ⊂ ValueError
                failure = MalformedModelOutput(
                    f"the model returned an unparseable reply ({_response_facts(response)})"
                )
            else:
                try:
                    output = schema.model_validate(parsed)
                except ValidationError:
                    failure = MalformedModelOutput(
                        "the model returned a schema-invalid reply "
                        f"({_response_facts(response)})"
                    )
                else:
                    reason = next((r for v in validators if (r := v(output))), None)
                    if reason is None:
                        return output
                    failure = OutputRejected(reason)
        if attempt == retries:
            break
        convo = list(messages) + [
            Message("assistant", response.text[:MAX_RAW_ECHO_CHARS]),
            Message(
                "user",
                f"[step:{step}] Your previous reply could not be used "
                f"({failure}). Reply again with ONLY the JSON object in "
                "the requested shape.",
            ),
        ]
    assert failure is not None
    raise type(failure)(
        f"step {step!r}: the model's reply was still unusable after "
        f"{retries} retr{'y' if retries == 1 else 'ies'} ({failure})"
    )
