/**
 * Turn raw strings into things that can be compared: categories, vendors, units.
 *
 * These are the baseline resolvers: what a competent engineer writes in ten minutes. Better
 * resolvers (fuzzy vendor matching, a small model run once per distinct description) slot in
 * behind the same signatures.
 */

import type { Category } from "./schema.ts";

const KEYWORDS: readonly (readonly [string, Category])[] = [
  ["pest", "pest_control"],
  ["landscap", "landscaping"],
  ["lawn", "landscaping"],
  ["grounds", "landscaping"],
  ["waste", "waste_removal"],
  ["trash", "waste_removal"],
  ["dumpster", "waste_removal"],
  ["janitor", "janitorial"],
  ["clean", "janitorial"],
];

export function categoryByKeyword(description: string): Category | null {
  const text = description.toLowerCase();
  return KEYWORDS.find(([word]) => text.includes(word))?.[1] ?? null;
}

/** Treat every distinct spelling as a distinct vendor. */
export function vendorKeyExact(raw: string): string {
  return raw.split(/\s+/).filter(Boolean).join(" ");
}

export function unitAsWritten(unit: string, _category: Category): string {
  return unit;
}
