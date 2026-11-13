/** Line items -> relationships: what each property pays each vendor now, and how much it buys. */

import type { LineItem } from "./ingest.ts";
import { round, sum } from "./numeric.ts";
import { compareTuples } from "./order.ts";
import type { Category, Relationship } from "./schema.ts";

export interface Resolvers {
  readonly categoryOf: (description: string) => Category | null;
  readonly vendorKey: (raw: string) => string;
  readonly unitOf: (unit: string, category: Category) => string;
}

type GroupKey = readonly [propertyId: string, vendorKey: string, category: Category, unit: string];

/**
 * Group line items into relationships. Items whose category can't be resolved are dropped.
 *
 * Current rate is the most recent unit price seen. Annual quantity is what was billed over
 * the observed window, scaled to twelve months.
 */
export function inferRelationships(items: Iterable<LineItem>, resolvers: Resolvers): Relationship[] {
  const all = [...items];
  const windowMonths = new Set(all.map((i) => i.invoicedOn.slice(0, 7))).size || 1;

  const groups = new Map<string, { key: GroupKey; items: LineItem[] }>();
  for (const item of all) {
    const category = resolvers.categoryOf(item.description);
    if (category === null) continue;
    const key: GroupKey = [item.propertyId, resolvers.vendorKey(item.vendorRaw), category, resolvers.unitOf(item.unit, category)];
    const id = JSON.stringify(key);
    const group = groups.get(id) ?? { key, items: [] };
    group.items.push(item);
    groups.set(id, group);
  }

  return [...groups.values()]
    .sort((a, b) => compareTuples(a.key, b.key))
    .map(({ key: [propertyId, vendorKey, category, unit], items: group }) => {
      group.sort((a, b) => compareTuples([a.invoicedOn, a.span.docId], [b.invoicedOn, b.span.docId]));
      return {
        propertyId,
        vendorKey,
        category,
        unit,
        currentRate: (group.at(-1) as LineItem).rate,
        annualQty: round((sum(group.map((i) => i.qty)) * 12) / windowMonths, 2),
        evidence: group.map((i) => i.span),
      };
    });
}
