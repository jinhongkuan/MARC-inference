import { expect, test } from "vitest";

import { findOpportunities } from "../src/discover.ts";
import type { MarketQuote, Property, Relationship } from "../src/schema.ts";

const PROPERTIES: Property[] = [
  { id: "OAK-01", ownerId: "OWN-1", name: "Oakridge Commons", region: "Austin" },
  { id: "ELM-02", ownerId: "OWN-1", name: "Elm Terrace", region: "Austin" },
];

function rel(propertyId: string, rate: number): Relationship {
  return { propertyId, vendorKey: "v", category: "pest_control", unit: "visit", currentRate: rate, annualQty: 12, evidence: [] };
}

test("picks the lower of portfolio and market targets", () => {
  const quotes: MarketQuote[] = [{ region: "Austin", category: "pest_control", unit: "visit", rate: 120.0 }];
  const found = findOpportunities([rel("OAK-01", 100.0), rel("ELM-02", 130.0)], PROPERTIES, quotes);
  expect(found).toHaveLength(1);
  const [opp] = found;
  expect(opp?.relationship.propertyId).toBe("ELM-02");
  expect(opp?.kind).toBe("portfolio_gap");
  expect(opp?.targetRate).toBe(100.0);
  expect(opp?.annualSavings).toBe(360.0);
});

test("units that do not match are not compared", () => {
  const quotes: MarketQuote[] = [{ region: "Austin", category: "pest_control", unit: "visit", rate: 50.0 }];
  const odd = { ...rel("ELM-02", 130.0), unit: "svc" };
  const found = findOpportunities([rel("OAK-01", 100.0), odd], PROPERTIES, quotes);
  expect(found.map((o) => o.relationship.propertyId)).toEqual(["OAK-01"]);
});
