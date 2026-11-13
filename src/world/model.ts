/** The hidden ground truth. An engine never sees anything defined here. */

import { type IsoDate, parseIsoDate } from "../dates.ts";
import { round } from "../numeric.ts";
import { CANONICAL_UNIT, type Category, type MarketQuote, type Property, type Relationship } from "../schema.ts";

/** Rate on `day` for a rate that steps up by `escalatorPct` on each anniversary of `start`. */
export function escalated(baseRate: number, escalatorPct: number, start: IsoDate, day: IsoDate): number {
  const from = parseIsoDate(start);
  const to = parseIsoDate(day);
  const beforeAnniversary = to.month < from.month || (to.month === from.month && to.day < from.day);
  const years = to.year - from.year - (beforeAnniversary ? 1 : 0);
  return round(baseRate * (1 + escalatorPct) ** Math.max(years, 0), 2);
}

export interface Owner {
  readonly id: string;
  readonly name: string;
  readonly region: string;
}

export interface Vendor {
  readonly id: string;
  readonly legalName: string;
  /** Legal name first, then the variants it shows up under. */
  readonly aliases: readonly string[];
  readonly region: string;
  readonly category: Category;
  // Habits that shape this vendor's paperwork.
  readonly layout: "table" | "inline";
  readonly description: string;
  readonly unitLabel: string;
  readonly billingDay: number;
  readonly invoicePrefix: string;
}

/** A negotiated rate. No single document states all of it. */
export interface Agreement {
  readonly id: string;
  readonly ownerId: string;
  readonly vendorId: string;
  readonly category: Category;
  readonly baseRate: number;
  readonly escalatorPct: number;
  readonly start: IsoDate;
  readonly propertyIds: readonly string[];
  readonly hasPricingSheet: boolean;
}

/** How one property actually buys one category: under an agreement, or off it. */
export interface Arrangement {
  readonly propertyId: string;
  readonly vendorId: string;
  readonly category: Category;
  readonly agreementId: string | null;
  readonly baseRate: number;
  readonly escalatorPct: number;
  readonly start: IsoDate;
  readonly monthlyQty: number;
}

export function rateOn(arrangement: Arrangement, day: IsoDate): number {
  return escalated(arrangement.baseRate, arrangement.escalatorPct, arrangement.start, day);
}

export interface World {
  readonly seed: number;
  readonly windowStart: IsoDate;
  readonly asOf: IsoDate;
  readonly owners: readonly Owner[];
  readonly properties: readonly Property[];
  readonly vendors: readonly Vendor[];
  readonly agreements: readonly Agreement[];
  readonly arrangements: readonly Arrangement[];
  readonly quotes: readonly MarketQuote[];
}

/** Where a document or GL row really came from: one arrangement. */
export interface TruthKey {
  readonly propertyId: string;
  readonly vendorId: string;
  readonly category: Category;
}

/** A TruthKey as a string, for use in sets and as a map key. */
export function truthId(key: TruthKey): string {
  return `${key.propertyId}|${key.vendorId}|${key.category}`;
}

/** The relationships a perfect engine would report, keyed by the real vendor id. */
export function trueRelationships(world: World): Relationship[] {
  return world.arrangements.map((a) => ({
    propertyId: a.propertyId,
    vendorKey: a.vendorId,
    category: a.category,
    unit: CANONICAL_UNIT[a.category],
    currentRate: rateOn(a, world.asOf),
    annualQty: a.monthlyQty * 12,
    evidence: [],
  }));
}
