/**
 * Build a hidden world: owners, properties, vendors, agreements, and how each property actually buys.
 *
 * The order of random draws is part of the contract: change it and every seed builds a
 * different world, which invalidates recorded benchmark numbers.
 */

import { addMonths, type IsoDate, pad } from "../dates.ts";
import { round } from "../numeric.ts";
import { Random } from "../random.ts";
import { CANONICAL_UNIT, CATEGORIES, type Category, type MarketQuote, type Property } from "../schema.ts";
import { type Agreement, type Arrangement, escalated, type Owner, type Vendor, type World } from "./model.ts";

export const REGIONS = ["Phoenix", "Austin", "Denver"] as const;

const MARKET_RATE: Readonly<Record<Category, number>> = {
  pest_control: 85.0,
  landscaping: 140.0,
  waste_removal: 65.0,
  janitorial: 1200.0,
};

const MONTHLY_QTY: Readonly<Record<Category, readonly [number, number]>> = {
  pest_control: [1, 2],
  landscaping: [2, 4],
  waste_removal: [4, 12],
  janitorial: [1, 1],
};

const VENDOR_WORDS: Readonly<Record<Category, readonly [readonly string[], readonly string[]]>> = {
  pest_control: [
    ["Sentinel", "Desert", "Apex", "Guardian", "Summit", "Patriot"],
    ["Pest Solutions", "Pest Control", "Exterminating"],
  ],
  landscaping: [
    ["Greenline", "Canyon", "Evergreen", "Mesa", "Cypress", "Highland"],
    ["Landscaping", "Grounds Co", "Lawn & Landscape"],
  ],
  waste_removal: [
    ["Metro", "Rapid", "Valley", "Frontier", "Ironwood", "Redrock"],
    ["Waste Services", "Disposal", "Hauling"],
  ],
  janitorial: [
    ["Spotless", "Crystal", "Prime", "BrightStar", "Clearview", "Polished"],
    ["Janitorial", "Building Services", "Cleaning"],
  ],
};

// How vendors word the line item. The last entry in each list is the long tail a keyword
// matcher misses: trade shorthand, or a description that never names the category.
const DESCRIPTIONS: Readonly<Record<Category, readonly string[]>> = {
  pest_control: ["Pest control service", "Monthly pest treatment", "PEST SVC - GENERAL", "Interior/exterior treatment"],
  landscaping: ["Landscape maintenance", "Grounds maintenance visit", "LAWN SVC", "Mow, edge & blow"],
  waste_removal: ["Dumpster pickup 4yd", "Waste removal", "Trash haul", "FEL SVC 4YD"],
  janitorial: ["Janitorial services", "Common area cleaning", "Building cleaning", "JAN SVC - MONTHLY"],
};

const UNIT_LABELS: Readonly<Record<Category, readonly string[]>> = {
  pest_control: ["visit", "svc", "ea"],
  landscaping: ["visit", "svc", "ea"],
  waste_removal: ["pickup", "lift", "ea"],
  janitorial: ["month", "mo", "ea"],
};

const ESCALATORS = [0.0, 0.03, 0.04, 0.05] as const;

const OWNER_NAMES = [
  "Halcyon Residential", "Brightwater Holdings", "Northgate Living",
  "Saguaro Partners", "Lonestar Housing", "Front Range Homes",
] as const;

const PROPERTY_NAMES = [
  "Oakridge", "Willow Creek", "Cedar Point", "Maple Court", "Sunset Ridge", "Pinehurst",
  "Harbor View", "Aspen Grove", "Juniper Flats", "Copper Hills", "Riverbend", "Stonegate",
  "Larkspur", "Mesa Verde", "Palo Verde", "Bluebonnet", "Sagebrush", "Quail Run",
  "Canyon Vista", "Driftwood", "Elm Terrace", "Foxtail", "Garnet Row", "Hollow Oak",
  "Indigo Lofts", "Kestrel Point", "Linden Place", "Tamarack",
] as const;
const PROPERTY_SUFFIXES = ["Apartments", "Commons", "Residences", "Townhomes"] as const;

export interface WorldConfig {
  readonly owners: number;
  readonly minProperties: number;
  readonly maxProperties: number;
  readonly vendorsPerMarket: number;
  readonly windowMonths: number;
  readonly asOf: IsoDate;
  /** Property-categories bought outside the owner's agreement. */
  readonly offContractRate: number;
  /** Agreements for which the customer can produce a rate sheet. */
  readonly pricingSheetRate: number;
}

export const DEFAULT_WORLD_CONFIG: WorldConfig = {
  owners: 4,
  minProperties: 4,
  maxProperties: 7,
  vendorsPerMarket: 3,
  windowMonths: 24,
  asOf: "2026-09-30",
  offContractRate: 0.25,
  pricingSheetRate: 0.5,
};

export function buildWorld(seed: number, overrides: Partial<WorldConfig> = {}): World {
  const cfg: WorldConfig = { ...DEFAULT_WORLD_CONFIG, ...overrides };
  if (cfg.owners > OWNER_NAMES.length || cfg.owners * cfg.maxProperties > PROPERTY_NAMES.length) {
    throw new RangeError("config asks for more owners or properties than there are names");
  }
  const rng = new Random(seed);
  const windowStart = addMonths(cfg.asOf, -(cfg.windowMonths - 1));

  const vendors = makeVendors(rng, cfg);
  const { owners, properties } = makeOwnersAndProperties(rng, cfg);
  const market = new Map<string, number>();
  for (const region of REGIONS) {
    for (const category of CATEGORIES) {
      market.set(marketKey(region, category), round(MARKET_RATE[category] * rng.uniform(0.9, 1.1), 2));
    }
  }
  const marketRate = (region: string, category: Category): number => market.get(marketKey(region, category)) as number;
  const quotes: MarketQuote[] = REGIONS.flatMap((region) =>
    CATEGORIES.map((category) => ({
      region,
      category,
      unit: CANONICAL_UNIT[category],
      rate: round(marketRate(region, category) * rng.uniform(0.88, 1.0), 2),
    })),
  );

  const agreements: Agreement[] = [];
  const arrangements: Arrangement[] = [];
  for (const owner of owners) {
    const portfolio = properties.filter((p) => p.ownerId === owner.id);
    for (const category of CATEGORIES) {
      const local = vendors.filter((v) => v.region === owner.region && v.category === category);
      const incumbent = rng.choice(local);
      const agreementId = `AG-${pad(agreements.length + 1, 3)}`;
      const base = round(marketRate(owner.region, category) * rng.uniform(0.82, 1.02), 2);
      const escalatorPct = rng.choice(ESCALATORS);
      const start = addMonths(windowStart, -rng.randint(0, 30));
      const covered: string[] = [];
      for (const prop of portfolio) {
        const monthlyQty = rng.randint(...MONTHLY_QTY[category]);
        if (rng.random() < cfg.offContractRate) {
          // Bought outside the agreement, at a premium, from the incumbent or a competitor.
          const rivals = local.filter((v) => v.id !== incumbent.id);
          const vendor = rng.random() < 0.5 ? incumbent : rng.choice(rivals);
          const rate = round(escalated(base, escalatorPct, start, cfg.asOf) * rng.uniform(1.12, 1.4), 2);
          arrangements.push({
            propertyId: prop.id, vendorId: vendor.id, category, agreementId: null,
            baseRate: rate, escalatorPct: 0, start: windowStart, monthlyQty,
          });
        } else {
          covered.push(prop.id);
          arrangements.push({
            propertyId: prop.id, vendorId: incumbent.id, category, agreementId,
            baseRate: base, escalatorPct, start, monthlyQty,
          });
        }
      }
      if (covered.length > 0) {
        agreements.push({
          id: agreementId, ownerId: owner.id, vendorId: incumbent.id, category,
          baseRate: base, escalatorPct, start, propertyIds: covered,
          hasPricingSheet: rng.random() < cfg.pricingSheetRate,
        });
      }
    }
  }

  return { seed, windowStart, asOf: cfg.asOf, owners, properties, vendors, agreements, arrangements, quotes };
}

function makeVendors(rng: Random, cfg: WorldConfig): Vendor[] {
  const vendors: Vendor[] = [];
  for (const category of CATEGORIES) {
    const [firsts, seconds] = VENDOR_WORDS[category];
    const combos = firsts.flatMap((first) => seconds.map((second) => [first, second] as const));
    rng.shuffle(combos);
    let next = 0;
    for (const region of REGIONS) {
      for (let n = 0; n < cfg.vendorsPerMarket; n++) {
        const combo = combos[next++];
        if (combo === undefined) throw new RangeError(`not enough ${category} vendor names for the config`);
        const [first, second] = combo;
        const suffix = rng.choice(second.endsWith("Co") ? ["LLC", "Inc."] : ["LLC", "Inc.", "Co."]);
        const base = `${first} ${second}`;
        const initials = base.replaceAll("&", " ").split(/\s+/).filter(Boolean).map((w) => w[0]).join("").toUpperCase();
        vendors.push({
          id: `V${pad(vendors.length + 1, 3)}`,
          legalName: `${base} ${suffix}`,
          aliases: [...new Set([`${base} ${suffix}`, base.toUpperCase(), base, `${first} ${second.split(" ")[0]}`])],
          region,
          category,
          // Object literals evaluate in source order, so these draws happen top to bottom.
          layout: rng.weightedChoice(["table", "inline"] as const, [0.6, 0.4]),
          description: rng.choice(DESCRIPTIONS[category]),
          unitLabel: rng.choice(UNIT_LABELS[category]),
          billingDay: rng.randint(1, 28),
          invoicePrefix: `${initials}${rng.randint(10, 99)}`,
        });
      }
    }
  }
  return vendors;
}

function makeOwnersAndProperties(rng: Random, cfg: WorldConfig): { owners: Owner[]; properties: Property[] } {
  const owners: Owner[] = [];
  const properties: Property[] = [];
  const pool: string[] = [...PROPERTY_NAMES];
  rng.shuffle(pool);
  rng.sample(OWNER_NAMES, cfg.owners).forEach((name, i) => {
    const owner: Owner = { id: `OWN-${i + 1}`, name, region: rng.choice(REGIONS) };
    owners.push(owner);
    const count = rng.randint(cfg.minProperties, cfg.maxProperties);
    for (let n = 0; n < count; n++) {
      const place = pool.pop() as string;
      properties.push({
        id: `${place.slice(0, 3).toUpperCase()}-${pad(properties.length + 1, 2)}`,
        ownerId: owner.id,
        name: `${place} ${rng.choice(PROPERTY_SUFFIXES)}`,
        region: owner.region,
      });
    }
  });
  return { owners, properties };
}

function marketKey(region: string, category: Category): string {
  return `${region}|${category}`;
}
