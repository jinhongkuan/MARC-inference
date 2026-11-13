/** Contracts an engine is allowed to see, and the outputs it must produce. */

import type { IsoDate } from "./dates.ts";

export const CATEGORIES = ["pest_control", "landscaping", "waste_removal", "janitorial"] as const;
export type Category = (typeof CATEGORIES)[number];

export const CANONICAL_UNIT: Readonly<Record<Category, string>> = {
  pest_control: "visit",
  landscaping: "visit",
  waste_removal: "pickup",
  janitorial: "month",
};

/** Master data the customer already has: which properties exist, who owns them, where they are. */
export interface Property {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly region: string;
}

/** The best external offer for a category in a region, e.g. from a round of vendor bidding. */
export interface MarketQuote {
  readonly region: string;
  readonly category: Category;
  readonly unit: string;
  readonly rate: number;
}

export type DocumentKind = "invoice" | "gl_export" | "pricing_sheet";

export interface Document {
  readonly id: string;
  readonly kind: DocumentKind;
  readonly lines: readonly string[];
}

/** Everything an engine gets to see. Nothing in here names the hidden agreements. */
export interface Corpus {
  readonly asOf: IsoDate;
  readonly properties: readonly Property[];
  readonly quotes: readonly MarketQuote[];
  readonly documents: readonly Document[];
}

/** The exact line a value was read from. Lines are 1-indexed. */
export interface SourceSpan {
  readonly docId: string;
  readonly line: number;
}

/** What one property currently pays one vendor for one category, and the lines that show it. */
export interface Relationship {
  readonly propertyId: string;
  readonly vendorKey: string;
  readonly category: Category;
  readonly unit: string;
  readonly currentRate: number;
  readonly annualQty: number;
  readonly evidence: readonly SourceSpan[];
}

export type OpportunityKind = "portfolio_gap" | "above_market";

export interface Opportunity {
  readonly relationship: Relationship;
  readonly kind: OpportunityKind;
  readonly targetRate: number;
  readonly annualSavings: number;
}
