"""Thin HTTP client for the worker's NestJS data-API reads (ADR-0004).

The Python worker is a stateless reader of the already-ingested Postgres
model: it never queries Postgres directly, only via NestJS's own anonymous
read endpoints. Used by the spec-06 system-triggered showcase jobs (daily
market brief, announcement summaries) — the TA/FA jobs do not call out.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx


class BackendClient(Protocol):
    """The two NestJS reads the showcase jobs need (fake-able in unit tests)."""

    def get_market_indices(self) -> dict[str, Any]: ...

    def get_announcement(self, announcement_id: str) -> dict[str, Any]: ...


class HttpBackendClient:
    """``BackendClient`` over real HTTP, against the NestJS API's anonymous reads."""

    def __init__(self, base_url: str, *, timeout: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def get_market_indices(self) -> dict[str, Any]:
        """``GET /market/indices`` (spec 05) — the headline + sector index panel."""
        resp = httpx.get(f"{self._base_url}/market/indices", timeout=self._timeout)
        resp.raise_for_status()
        return resp.json()

    def get_announcement(self, announcement_id: str) -> dict[str, Any]:
        """``GET /announcements/{id}`` (spec 04/06) — one announcement's own fields."""
        resp = httpx.get(
            f"{self._base_url}/announcements/{announcement_id}",
            timeout=self._timeout,
        )
        resp.raise_for_status()
        return resp.json()
