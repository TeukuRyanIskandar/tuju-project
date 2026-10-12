"""Pydantic models for the LLM's structured outputs (spec 06, ticket 05).

Owned by the AI module and opaque to the wire contract (ADR-0004/0007). They
are deliberately LENIENT about scalars (LLMs return ``0.5`` where a string is
asked for; a missing figure is ``null``, never a failure) and STRICT about the
structural essentials (a headline exists, at least one risk theme exists) —
a reply violating those is "malformed" and goes through the one bounded retry.
"""

from __future__ import annotations

from typing import Annotated, Any, Literal

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, field_validator


def _to_text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str):
        return value.strip() or None
    raise ValueError("expected a string or number")


# A scalar the model may report as text, a number, or null.
Text = Annotated[str | None, BeforeValidator(_to_text)]


class _Out(BaseModel):
    model_config = ConfigDict(extra="ignore")


class UseOfProceedsItem(_Out):
    purpose: str
    amount: Text = None
    percentOfProceeds: Text = None


class OfferOutput(_Out):
    summary: Text = None
    totalShares: Text = None
    publicIssueShares: Text = None
    offerForSaleShares: Text = None
    priceRange: Text = None
    marketCapAtIpo: Text = None
    grossProceeds: Text = None
    useOfProceeds: list[UseOfProceedsItem] = Field(default_factory=list)


class BusinessOutput(_Out):
    lines: list[str] = Field(min_length=1)

    @field_validator("lines")
    @classmethod
    def _at_most_three(cls, v: list[str]) -> list[str]:
        return [line.strip() for line in v if line.strip()][:3] or v[:1]


class FinancialPeriod(_Out):
    period: str
    revenue: Text = None
    grossProfit: Text = None
    profitAfterTax: Text = None
    netMargin: Text = None


class FinancialsOutput(_Out):
    currency: Text = None
    periods: list[FinancialPeriod] = Field(default_factory=list)
    trend: str = Field(min_length=1)
    highlights: list[str] = Field(default_factory=list)


class RiskTheme(_Out):
    rank: int
    theme: str
    severity: Literal["low", "medium", "high"] = "medium"
    summary: Text = None

    @field_validator("severity", mode="before")
    @classmethod
    def _norm_severity(cls, v: Any) -> Any:
        return v.strip().lower() if isinstance(v, str) else v


class RiskOutput(_Out):
    summary: Text = None
    themes: list[RiskTheme] = Field(min_length=1)

    @field_validator("themes")
    @classmethod
    def _ranked(cls, v: list[RiskTheme]) -> list[RiskTheme]:
        return sorted(v, key=lambda t: t.rank)


class CornerstoneInvestor(_Out):
    name: str
    allocation: Text = None
    notes: Text = None


class CornerstoneOutput(_Out):
    present: bool
    investors: list[CornerstoneInvestor] = Field(default_factory=list)
    summary: Text = None


class LockupEntry(_Out):
    name: str
    shares: Text = None  # count or % of shares under moratorium
    duration: Text = None  # e.g. "6 months from listing", as written
    notes: Text = None


class LockupOutput(_Out):
    present: bool
    entries: list[LockupEntry] = Field(default_factory=list)
    summary: Text = None


class RelatedPartyItem(_Out):
    counterparty: str
    nature: Text = None  # what the transaction is
    amount: Text = None
    basis: Text = None  # arm's length or not, as stated


class RelatedPartyOutput(_Out):
    present: bool
    items: list[RelatedPartyItem] = Field(default_factory=list)
    aggregateAmount: Text = None
    summary: Text = None


class WatchItem(_Out):
    point: str
    why: Text = None
    sourceSection: Text = None


class WatchOutput(_Out):
    headline: str = Field(min_length=1)
    items: list[WatchItem] = Field(min_length=1)


class IpoReference(BaseModel):
    """``GET {backend}/ipo/{prospectusId}/reference`` response (NestJS).

    The IPO reference row the worker needs, and nothing more (ADR-0004: the
    worker never touches Postgres). Extra keys from the backend are ignored.
    """

    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1)
    companyName: str = Field(min_length=1)
    board: str | None = None
    listingDate: str | None = None
    prospectusS3Key: str = Field(min_length=1)
    shariahStatus: Literal["compliant", "non-compliant", "unknown"] | None = None
