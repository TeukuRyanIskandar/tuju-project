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
    """The NestJS reads the showcase jobs need (fake-able in unit tests)."""

    def get_market_indices(self) -> dict[str, Any]: ...

    def get_announcement(self, announcement_id: str) -> dict[str, Any]: ...

    def get_ipo_reference(self, prospectus_id: str) -> dict[str, Any]: ...


class HttpBackendClient:
    """``BackendClient`` over real HTTP, against the NestJS API's anonymous reads."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        # Injectable so unit tests use ``httpx.MockTransport`` (no network).
        self._transport = transport

    def _get(self, path: str) -> dict[str, Any]:
        with httpx.Client(transport=self._transport, timeout=self._timeout) as http:
            resp = http.get(f"{self._base_url}{path}")
        resp.raise_for_status()
        return resp.json()

    def get_market_indices(self) -> dict[str, Any]:
        """``GET /market/indices`` (spec 05) — the headline + sector index panel."""
        return self._get("/market/indices")

    def get_announcement(self, announcement_id: str) -> dict[str, Any]:
        """``GET /announcements/{id}`` (spec 04/06) — one announcement's own fields."""
        return self._get(f"/announcements/{announcement_id}")

    def get_ipo_reference(self, prospectus_id: str) -> dict[str, Any]:
        """``GET /ipo/{prospectusId}/reference`` (spec 06, ticket 05).

        The IPO reference row for the prospectus at-a-glance job. The worker
        never reads Postgres (ADR-0004); NestJS serves this anonymously.
        ``prospectusId`` is the ``IpoListing.id``. EXPECTED response (the
        NestJS side must implement exactly this; extra keys are ignored)::

            {
              "id": "<IpoListing.id>",
              "companyName": "<string>",
              "board": "<string> | null",
              "listingDate": "<ISO date string> | null",
              "prospectusS3Key": "prospectus/<fileName>",
              "shariahStatus": "compliant" | "non-compliant" | "unknown" | null
            }

        ``shariahStatus`` is the company's current ``ShariahStatus`` row
        (``null``/``"unknown"`` when absent). A 404 means the id is unknown
        (the job then fails terminally).
        """
        return self._get(f"/ipo/{prospectus_id}/reference")
