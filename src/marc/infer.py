"""Line items -> relationships: what each property pays each vendor now, and how much it buys."""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable, Iterable

from marc.ingest import LineItem
from marc.schema import Category, Relationship


def infer_relationships(
    items: Iterable[LineItem],
    *,
    category_of: Callable[[str], Category | None],
    vendor_key: Callable[[str], str],
    unit_of: Callable[[str, Category], str],
) -> list[Relationship]:
    """Group line items into relationships. Items whose category can't be resolved are dropped.

    Current rate is the most recent unit price seen. Annual quantity is what was billed over
    the observed window, scaled to twelve months.
    """
    items = list(items)
    window_months = len({(i.invoiced_on.year, i.invoiced_on.month) for i in items}) or 1

    groups: dict[tuple[str, str, Category, str], list[LineItem]] = defaultdict(list)
    for item in items:
        category = category_of(item.description)
        if category is None:
            continue
        groups[(item.property_id, vendor_key(item.vendor_raw), category, unit_of(item.unit, category))].append(item)

    relationships = []
    for (property_id, vendor, category, unit), group in sorted(groups.items()):
        group.sort(key=lambda i: (i.invoiced_on, i.span.doc_id))
        relationships.append(Relationship(
            property_id=property_id,
            vendor_key=vendor,
            category=category,
            unit=unit,
            current_rate=group[-1].rate,
            annual_qty=round(sum(i.qty for i in group) * 12 / window_months, 2),
            evidence=tuple(i.span for i in group),
        ))
    return relationships
