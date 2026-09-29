"""Structured JSON logging to stdout (ADR-0010).

The app owns log *content* (structured JSON); the runtime owns *transport* (the
Docker `json-file` driver). App code never decides where output goes — it only
writes JSON lines to stdout.

Every line for a job MUST carry the ADR-0007 ``correlationId`` (the cross-service
stitch key). :func:`get_logger` binds it once so callers cannot forget it.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class _JsonFormatter(logging.Formatter):
    """Render each record as a single-line JSON object on stdout.

    Reserved fields (``correlationId``, ``service``) are lifted to the top level;
    any structured ``extra`` a caller attaches is merged in verbatim.
    """

    _RESERVED = set(logging.makeLogRecord({}).__dict__.keys()) | {
        "message",
        "asctime",
    }

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "at": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            # correlationId is mandatory (ADR-0010 §3); may be None only for
            # pre-job boot lines that belong to no envelope yet.
            "correlationId": getattr(record, "correlationId", None),
            "service": getattr(record, "service", "tuju-ai"),
        }
        for key, value in record.__dict__.items():
            if key not in self._RESERVED and key not in payload:
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging(level: int = logging.INFO) -> None:
    """Install the JSON formatter on the root logger's single stdout handler.

    Idempotent: repeated calls replace handlers rather than stacking them.
    """
    root = logging.getLogger()
    root.setLevel(level)
    handler = logging.StreamHandler(stream=sys.stdout)
    handler.setFormatter(_JsonFormatter())
    root.handlers = [handler]


class _CorrelationAdapter(logging.LoggerAdapter):
    """Stamps ``correlationId`` (and ``service``) onto every emitted line."""

    def process(self, msg: str, kwargs: dict[str, Any]) -> tuple[str, dict[str, Any]]:
        extra = dict(self.extra)
        extra.update(kwargs.get("extra", {}))
        kwargs["extra"] = extra
        return msg, kwargs


def get_logger(
    name: str, *, correlation_id: str | None = None
) -> _CorrelationAdapter:
    """Return a logger that stamps ``correlationId`` on every line it emits."""
    return _CorrelationAdapter(
        logging.getLogger(name),
        {"correlationId": correlation_id, "service": "tuju-ai"},
    )
