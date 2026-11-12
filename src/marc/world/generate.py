"""Build a hidden world: owners, properties, vendors, agreements, and how each property actually buys."""

from __future__ import annotations

import random
from dataclasses import dataclass
from datetime import date

from marc.schema import CANONICAL_UNIT, Category, MarketQuote, Property
from marc.world.model import Agreement, Arrangement, Owner, Vendor, World, escalated

REGIONS = ("Phoenix", "Austin", "Denver")

MARKET_RATE = {
    Category.PEST_CONTROL: 85.0,
    Category.LANDSCAPING: 140.0,
    Category.WASTE_REMOVAL: 65.0,
    Category.JANITORIAL: 1200.0,
}

MONTHLY_QTY = {
    Category.PEST_CONTROL: (1, 2),
    Category.LANDSCAPING: (2, 4),
    Category.WASTE_REMOVAL: (4, 12),
    Category.JANITORIAL: (1, 1),
}

VENDOR_WORDS = {
    Category.PEST_CONTROL: (
        ("Sentinel", "Desert", "Apex", "Guardian", "Summit", "Patriot"),
        ("Pest Solutions", "Pest Control", "Exterminating"),
    ),
    Category.LANDSCAPING: (
        ("Greenline", "Canyon", "Evergreen", "Mesa", "Cypress", "Highland"),
        ("Landscaping", "Grounds Co", "Lawn & Landscape"),
    ),
    Category.WASTE_REMOVAL: (
        ("Metro", "Rapid", "Valley", "Frontier", "Ironwood", "Redrock"),
        ("Waste Services", "Disposal", "Hauling"),
    ),
    Category.JANITORIAL: (
        ("Spotless", "Crystal", "Prime", "BrightStar", "Clearview", "Polished"),
        ("Janitorial", "Building Services", "Cleaning"),
    ),
}

# How vendors word the line item. The last entry in each list is the long tail a keyword
# matcher misses: trade shorthand, or a description that never names the category.
DESCRIPTIONS = {
    Category.PEST_CONTROL: ("Pest control service", "Monthly pest treatment", "PEST SVC - GENERAL", "Interior/exterior treatment"),
    Category.LANDSCAPING: ("Landscape maintenance", "Grounds maintenance visit", "LAWN SVC", "Mow, edge & blow"),
    Category.WASTE_REMOVAL: ("Dumpster pickup 4yd", "Waste removal", "Trash haul", "FEL SVC 4YD"),
    Category.JANITORIAL: ("Janitorial services", "Common area cleaning", "Building cleaning", "JAN SVC - MONTHLY"),
}

UNIT_LABELS = {
    Category.PEST_CONTROL: ("visit", "svc", "ea"),
    Category.LANDSCAPING: ("visit", "svc", "ea"),
    Category.WASTE_REMOVAL: ("pickup", "lift", "ea"),
    Category.JANITORIAL: ("month", "mo", "ea"),
}

OWNER_NAMES = (
    "Halcyon Residential", "Brightwater Holdings", "Northgate Living",
    "Saguaro Partners", "Lonestar Housing", "Front Range Homes",
)

PROPERTY_NAMES = (
    "Oakridge", "Willow Creek", "Cedar Point", "Maple Court", "Sunset Ridge", "Pinehurst",
    "Harbor View", "Aspen Grove", "Juniper Flats", "Copper Hills", "Riverbend", "Stonegate",
    "Larkspur", "Mesa Verde", "Palo Verde", "Bluebonnet", "Sagebrush", "Quail Run",
    "Canyon Vista", "Driftwood", "Elm Terrace", "Foxtail", "Garnet Row", "Hollow Oak",
    "Indigo Lofts", "Kestrel Point", "Linden Place", "Tamarack",
)
PROPERTY_SUFFIXES = ("Apartments", "Commons", "Residences", "Townhomes")


@dataclass(frozen=True)
class WorldConfig:
    owners: int = 4
    min_properties: int = 4
    max_properties: int = 7
    vendors_per_market: int = 3
    window_months: int = 24
    as_of: date = date(2026, 9, 30)
    off_contract_rate: float = 0.25  # property-categories bought outside the owner's agreement
    pricing_sheet_rate: float = 0.5  # agreements for which the customer can produce a rate sheet


def build_world(seed: int, cfg: WorldConfig = WorldConfig()) -> World:
    if cfg.owners > len(OWNER_NAMES) or cfg.owners * cfg.max_properties > len(PROPERTY_NAMES):
        raise ValueError("config asks for more owners or properties than there are names")
    rng = random.Random(seed)
    window_start = _add_months(cfg.as_of, -(cfg.window_months - 1))

    vendors = _vendors(rng, cfg)
    owners, properties = _owners_and_properties(rng, cfg)
    market = {(r, c): round(MARKET_RATE[c] * rng.uniform(0.9, 1.1), 2) for r in REGIONS for c in Category}
    quotes = tuple(
        MarketQuote(region=r, category=c, unit=CANONICAL_UNIT[c], rate=round(rate * rng.uniform(0.88, 1.0), 2))
        for (r, c), rate in market.items()
    )

    agreements: list[Agreement] = []
    arrangements: list[Arrangement] = []
    for owner in owners:
        portfolio = [p for p in properties if p.owner_id == owner.id]
        for category in Category:
            local = [v for v in vendors if v.region == owner.region and v.category == category]
            incumbent = rng.choice(local)
            agreement_id = f"AG-{len(agreements) + 1:03d}"
            base = round(market[(owner.region, category)] * rng.uniform(0.82, 1.02), 2)
            escalator = rng.choice((0.0, 0.03, 0.04, 0.05))
            start = _add_months(window_start, -rng.randint(0, 30))
            covered: list[str] = []
            for prop in portfolio:
                qty = rng.randint(*MONTHLY_QTY[category])
                if rng.random() < cfg.off_contract_rate:
                    # Bought outside the agreement, at a premium, from the incumbent or a competitor.
                    rivals = [v for v in local if v.id != incumbent.id]
                    vendor = incumbent if rng.random() < 0.5 else rng.choice(rivals)
                    rate = round(escalated(base, escalator, start, cfg.as_of) * rng.uniform(1.12, 1.40), 2)
                    arrangements.append(Arrangement(
                        property_id=prop.id, vendor_id=vendor.id, category=category, agreement_id=None,
                        base_rate=rate, escalator_pct=0.0, start=window_start, monthly_qty=qty,
                    ))
                else:
                    covered.append(prop.id)
                    arrangements.append(Arrangement(
                        property_id=prop.id, vendor_id=incumbent.id, category=category, agreement_id=agreement_id,
                        base_rate=base, escalator_pct=escalator, start=start, monthly_qty=qty,
                    ))
            if covered:
                agreements.append(Agreement(
                    id=agreement_id, owner_id=owner.id, vendor_id=incumbent.id, category=category,
                    base_rate=base, escalator_pct=escalator, start=start, property_ids=tuple(covered),
                    has_pricing_sheet=rng.random() < cfg.pricing_sheet_rate,
                ))

    return World(
        seed=seed, window_start=window_start, as_of=cfg.as_of,
        owners=tuple(owners), properties=tuple(properties), vendors=tuple(vendors),
        agreements=tuple(agreements), arrangements=tuple(arrangements), quotes=quotes,
    )


def _vendors(rng: random.Random, cfg: WorldConfig) -> list[Vendor]:
    vendors: list[Vendor] = []
    for category in Category:
        firsts, seconds = VENDOR_WORDS[category]
        combos = [(f, s) for f in firsts for s in seconds]
        rng.shuffle(combos)
        names = iter(combos)
        for region in REGIONS:
            for _ in range(cfg.vendors_per_market):
                first, second = next(names)
                suffix = rng.choice(("LLC", "Inc.") if second.endswith("Co") else ("LLC", "Inc.", "Co."))
                base = f"{first} {second}"
                initials = "".join(w[0] for w in base.replace("&", " ").split()).upper()
                vendors.append(Vendor(
                    id=f"V{len(vendors) + 1:03d}",
                    legal_name=f"{base} {suffix}",
                    aliases=tuple(dict.fromkeys((f"{base} {suffix}", base.upper(), base, f"{first} {second.split()[0]}"))),
                    region=region,
                    category=category,
                    layout=rng.choices(("table", "inline"), weights=(0.6, 0.4))[0],
                    description=rng.choice(DESCRIPTIONS[category]),
                    unit_label=rng.choice(UNIT_LABELS[category]),
                    billing_day=rng.randint(1, 28),
                    invoice_prefix=f"{initials}{rng.randint(10, 99)}",
                ))
    return vendors


def _owners_and_properties(rng: random.Random, cfg: WorldConfig) -> tuple[list[Owner], list[Property]]:
    owners: list[Owner] = []
    properties: list[Property] = []
    pool = list(PROPERTY_NAMES)
    rng.shuffle(pool)
    for i, name in enumerate(rng.sample(OWNER_NAMES, cfg.owners)):
        owner = Owner(id=f"OWN-{i + 1}", name=name, region=rng.choice(REGIONS))
        owners.append(owner)
        for _ in range(rng.randint(cfg.min_properties, cfg.max_properties)):
            place = pool.pop()
            properties.append(Property(
                id=f"{place[:3].upper()}-{len(properties) + 1:02d}",
                owner_id=owner.id,
                name=f"{place} {rng.choice(PROPERTY_SUFFIXES)}",
                region=owner.region,
            ))
    return owners, properties


def _add_months(day: date, months: int) -> date:
    """First day of the month `months` away from `day`'s month."""
    index = day.year * 12 + day.month - 1 + months
    return date(index // 12, index % 12 + 1, 1)
