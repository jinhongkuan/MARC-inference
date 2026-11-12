"""Contracts the engine is allowed to see, and the outputs it must produce."""

from __future__ import annotations

from datetime import date
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict


class Frozen(BaseModel):
    model_config = ConfigDict(frozen=True)


class Category(StrEnum):
    PEST_CONTROL = "pest_control"
    LANDSCAPING = "landscaping"
    WASTE_REMOVAL = "waste_removal"
    JANITORIAL = "janitorial"


CANONICAL_UNIT: dict[Category, str] = {
    Category.PEST_CONTROL: "visit",
    Category.LANDSCAPING: "visit",
    Category.WASTE_REMOVAL: "pickup",
    Category.JANITORIAL: "month",
}


class Property(Frozen):
    """Master data the customer already has: which properties exist, who owns them, where they are."""

    id: str
    owner_id: str
    name: str
    region: str


class MarketQuote(Frozen):
    """The best external offer for a category in a region, e.g. from a round of vendor bidding."""

    region: str
    category: Category
    unit: str
    rate: float


class Document(Frozen):
    id: str
    kind: Literal["invoice", "gl_export", "pricing_sheet"]
    lines: tuple[str, ...]


class Corpus(Frozen):
    """Everything an engine gets to see. Nothing in here names the hidden agreements."""

    as_of: date
    properties: tuple[Property, ...]
    quotes: tuple[MarketQuote, ...]
    documents: tuple[Document, ...]


class SourceSpan(Frozen):
    """The exact line a value was read from. Lines are 1-indexed."""

    doc_id: str
    line: int


class Relationship(Frozen):
    """What one property currently pays one vendor for one category, and the lines that show it."""

    property_id: str
    vendor_key: str
    category: Category
    unit: str
    current_rate: float
    annual_qty: float
    evidence: tuple[SourceSpan, ...] = ()


class Opportunity(Frozen):
    relationship: Relationship
    kind: Literal["portfolio_gap", "above_market"]
    target_rate: float
    annual_savings: float
