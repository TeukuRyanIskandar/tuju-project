"""Thin HTTP client for the worker's NestJS data-API reads (ADR-0004).

The Python worker is a stateless reader of the already-ingested Postgres
model: it never queries Postgres directly, only via NestJS's own anonymous
read endpoints. Used by system-triggered showcase jobs and TA/FA analysis.
"""

from __future__ import annotations

from typing import Any, Protocol

import httpx


class BackendClient(Protocol):
    """The NestJS reads the showcase jobs need (fake-able in unit tests)."""

    def get_market_indices(self) -> dict[str, Any]: ...

    def get_announcement(self, announcement_id: str) -> dict[str, Any]: ...

    def get_ipo_reference(self, prospectus_id: str) -> dict[str, Any]: ...

    def get_analysis_reference(self, symbol: str) -> dict[str, Any]: ...


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

    def get_analysis_reference(self, symbol: str) -> dict[str, Any]:
        """``GET /stocks/{symbol}/analysis/reference`` (spec 06, ticket 10).

        The reference data for TA/FA analysis jobs (technical indicators,
        events, fundamental metrics, and identity fields). The worker fetches
        code-verified facts (computed server-side on-read) and narrates them
        via LLM. A 404 means the symbol is unknown or not in the KLCI-30 gate.
        EXPECTED response shape (NestJS must implement)::

            {
              "code": "<stock code>",
              "shortName": "<company name>",
              "latestCloseDay": "<ISO date string>",
              "asOfDatetime": "<ISO datetime string>",
              "technical": {
                "sma": {"p20": float, "p50": float, "p200": float},
                "rsi": {"period": 14, "value": float | null},
                "macd": {"line": float | null, "signal": float | null, "histogram": float | null},
                "week52": {"high": float | null, "low": float | null},
                "latestClose": float
              },
              "technicalEvents": [
                {
                  "id": "<TechnicalEventId>",
                  "label": "<string>",
                  "fired": bool,
                  "values": {<dict of floats/strings>},
                  "at": "<ISO date string>"
                }, ...
              ],
              "fundamental": {
                "metrics": [
                  {
                    "id": "<FundamentalMetricId>",
                    "label": "<string>",
                    "value": float | null,
                    "unit": "<string>",
                    "scale": "<fraction|percentage_point|absolute>",
                    "asOf": "<ISO date string>"
                  }, ...
                ]
              }
            }
        """
        return self._get(f"/stocks/{symbol}/analysis/reference")
