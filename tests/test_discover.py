from marc.discover import find_opportunities
from marc.schema import Category, MarketQuote, Property, Relationship

PEST = Category.PEST_CONTROL
PROPERTIES = [
    Property(id="OAK-01", owner_id="OWN-1", name="Oakridge Commons", region="Austin"),
    Property(id="ELM-02", owner_id="OWN-1", name="Elm Terrace", region="Austin"),
]


def rel(property_id: str, rate: float) -> Relationship:
    return Relationship(property_id=property_id, vendor_key="v", category=PEST, unit="visit", current_rate=rate, annual_qty=12)


def test_picks_the_lower_of_portfolio_and_market_targets():
    quotes = [MarketQuote(region="Austin", category=PEST, unit="visit", rate=120.0)]
    [opp] = find_opportunities([rel("OAK-01", 100.0), rel("ELM-02", 130.0)], PROPERTIES, quotes)
    assert opp.relationship.property_id == "ELM-02"
    assert opp.kind == "portfolio_gap"
    assert opp.target_rate == 100.0
    assert opp.annual_savings == 360.0


def test_units_that_do_not_match_are_not_compared():
    quotes = [MarketQuote(region="Austin", category=PEST, unit="visit", rate=50.0)]
    odd = rel("ELM-02", 130.0).model_copy(update={"unit": "svc"})
    found = find_opportunities([rel("OAK-01", 100.0), odd], PROPERTIES, quotes)
    assert [o.relationship.property_id for o in found] == ["OAK-01"]
