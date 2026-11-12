"""Turn raw strings into things that can be compared: categories, vendors, units.

These are the baseline resolvers: what a competent engineer writes in ten minutes. Better
resolvers (fuzzy vendor matching, a small model run once per distinct description) slot in
behind the same signatures.
"""

from __future__ import annotations

from marc.schema import Category

_KEYWORDS: tuple[tuple[str, Category], ...] = (
    ("pest", Category.PEST_CONTROL),
    ("landscap", Category.LANDSCAPING),
    ("lawn", Category.LANDSCAPING),
    ("grounds", Category.LANDSCAPING),
    ("waste", Category.WASTE_REMOVAL),
    ("trash", Category.WASTE_REMOVAL),
    ("dumpster", Category.WASTE_REMOVAL),
    ("janitor", Category.JANITORIAL),
    ("clean", Category.JANITORIAL),
)


def category_by_keyword(description: str) -> Category | None:
    text = description.lower()
    return next((category for word, category in _KEYWORDS if word in text), None)


def vendor_key_exact(raw: str) -> str:
    """Treat every distinct spelling as a distinct vendor."""
    return " ".join(raw.split())


def unit_as_written(unit: str, category: Category) -> str:
    return unit
