"""Deterministic opportunity rules: the frozen core.

The same rules run on the hidden ground truth and on whatever an engine infers. Any gap
between the two is therefore an inference error, never a disagreement about the rules.
"""

from __future__ import annotations

from collections.abc import Iterable

from marc.schema import MarketQuote, Opportunity, Property, Relationship

PORTFOLIO_GAP = 0.10  # more than 10% above the owner's best rate for the same thing
ABOVE_MARKET = 0.05  # more than 5% above the best external quote


def find_opportunities(
    relationships: Iterable[Relationship],
    properties: Iterable[Property],
    quotes: Iterable[MarketQuote],
) -> list[Opportunity]:
    relationships = list(relationships)
    by_id = {p.id: p for p in properties}
    quote = {(q.region, q.category, q.unit): q.rate for q in quotes}

    best: dict[tuple[str, str, str], float] = {}
    for rel in relationships:
        if prop := by_id.get(rel.property_id):
            key = (prop.owner_id, rel.category, rel.unit)
            best[key] = min(best.get(key, rel.current_rate), rel.current_rate)

    found = []
    for rel in relationships:
        prop = by_id.get(rel.property_id)
        if prop is None:
            continue
        candidates = []
        portfolio = best[(prop.owner_id, rel.category, rel.unit)]
        if rel.current_rate > portfolio * (1 + PORTFOLIO_GAP):
            candidates.append(("portfolio_gap", portfolio))
        market = quote.get((prop.region, rel.category, rel.unit))
        if market is not None and rel.current_rate > market * (1 + ABOVE_MARKET):
            candidates.append(("above_market", market))
        if not candidates:
            continue
        kind, target = min(candidates, key=lambda c: c[1])
        found.append(Opportunity(
            relationship=rel,
            kind=kind,
            target_rate=target,
            annual_savings=round((rel.current_rate - target) * rel.annual_qty, 2),
        ))
    return found
