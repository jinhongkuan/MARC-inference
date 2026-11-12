"""The hidden ground truth. An engine never sees anything defined here."""

from __future__ import annotations

from datetime import date
from typing import Literal

from marc.schema import CANONICAL_UNIT, Category, Frozen, MarketQuote, Property, Relationship


def escalated(base_rate: float, escalator_pct: float, start: date, day: date) -> float:
    """Rate on `day` for a rate that steps up by `escalator_pct` on each anniversary of `start`."""
    years = day.year - start.year - ((day.month, day.day) < (start.month, start.day))
    return round(base_rate * (1 + escalator_pct) ** max(years, 0), 2)


class Owner(Frozen):
    id: str
    name: str
    region: str


class Vendor(Frozen):
    id: str
    legal_name: str
    aliases: tuple[str, ...]  # legal name first, then the variants it shows up under
    region: str
    category: Category
    # Habits that shape this vendor's paperwork.
    layout: Literal["table", "inline"]
    description: str
    unit_label: str
    billing_day: int
    invoice_prefix: str


class Agreement(Frozen):
    """A negotiated rate. No single document states all of it."""

    id: str
    owner_id: str
    vendor_id: str
    category: Category
    base_rate: float
    escalator_pct: float
    start: date
    property_ids: tuple[str, ...]
    has_pricing_sheet: bool


class Arrangement(Frozen):
    """How one property actually buys one category: under an agreement, or off it."""

    property_id: str
    vendor_id: str
    category: Category
    agreement_id: str | None
    base_rate: float
    escalator_pct: float
    start: date
    monthly_qty: int

    def rate_on(self, day: date) -> float:
        return escalated(self.base_rate, self.escalator_pct, self.start, day)


class World(Frozen):
    seed: int
    window_start: date
    as_of: date
    owners: tuple[Owner, ...]
    properties: tuple[Property, ...]
    vendors: tuple[Vendor, ...]
    agreements: tuple[Agreement, ...]
    arrangements: tuple[Arrangement, ...]
    quotes: tuple[MarketQuote, ...]


def true_relationships(world: World) -> list[Relationship]:
    """The relationships a perfect engine would report, keyed by the real vendor id."""
    return [
        Relationship(
            property_id=a.property_id,
            vendor_key=a.vendor_id,
            category=a.category,
            unit=CANONICAL_UNIT[a.category],
            current_rate=a.rate_on(world.as_of),
            annual_qty=a.monthly_qty * 12,
        )
        for a in world.arrangements
    ]
