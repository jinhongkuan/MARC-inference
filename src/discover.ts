/**
 * Deterministic opportunity rules: the frozen core.
 *
 * The same rules run on the hidden ground truth and on whatever an engine infers. Any gap
 * between the two is therefore an inference error, never a disagreement about the rules.
 */

import { round } from "./numeric.ts";
import type { MarketQuote, Opportunity, OpportunityKind, Property, Relationship } from "./schema.ts";

/** More than 10% above the owner's best rate for the same thing. */
export const PORTFOLIO_GAP = 0.1;
/** More than 5% above the best external quote. */
export const ABOVE_MARKET = 0.05;

export function findOpportunities(
  relationships: Iterable<Relationship>,
  properties: Iterable<Property>,
  quotes: Iterable<MarketQuote>,
): Opportunity[] {
  const rels = [...relationships];
  const byId = new Map([...properties].map((p) => [p.id, p]));
  const quote = new Map([...quotes].map((q) => [key(q.region, q.category, q.unit), q.rate]));

  const best = new Map<string, number>();
  for (const rel of rels) {
    const prop = byId.get(rel.propertyId);
    if (!prop) continue;
    const k = key(prop.ownerId, rel.category, rel.unit);
    best.set(k, Math.min(best.get(k) ?? rel.currentRate, rel.currentRate));
  }

  const found: Opportunity[] = [];
  for (const rel of rels) {
    const prop = byId.get(rel.propertyId);
    if (!prop) continue;
    const candidates: [OpportunityKind, number][] = [];
    const portfolio = best.get(key(prop.ownerId, rel.category, rel.unit)) as number;
    if (rel.currentRate > portfolio * (1 + PORTFOLIO_GAP)) candidates.push(["portfolio_gap", portfolio]);
    const market = quote.get(key(prop.region, rel.category, rel.unit));
    if (market !== undefined && rel.currentRate > market * (1 + ABOVE_MARKET)) candidates.push(["above_market", market]);
    if (candidates.length === 0) continue;
    // The lower target wins; on a tie, the first candidate.
    const [kind, target] = candidates.reduce((low, c) => (c[1] < low[1] ? c : low));
    found.push({
      relationship: rel,
      kind,
      targetRate: target,
      annualSavings: round((rel.currentRate - target) * rel.annualQty, 2),
    });
  }
  return found;
}

function key(...parts: string[]): string {
  return parts.join("|");
}
