/** Render the hidden world into the documents MARC would actually receive. */

import { eachMonth, type IsoDate, longDate, pad, usDate, withDayOfMonth } from "../dates.ts";
import { compareTuples } from "../order.ts";
import { fixed, percent, round } from "../numeric.ts";
import { Random } from "../random.ts";
import type { Category, Corpus, Document, Property } from "../schema.ts";
import { type Arrangement, type Owner, rateOn, type TruthKey, type Vendor, type World } from "./model.ts";

const GL_ACCOUNT: Readonly<Record<Category, string>> = {
  pest_control: "6410 Pest Control",
  landscaping: "6420 Landscaping",
  waste_removal: "6430 Trash Removal",
  janitorial: "6440 Janitorial",
};
const MISCODED_ACCOUNT = "6500 Repairs & Maintenance";

export interface RenderConfig {
  /** Invoices that print a variant of the vendor's name. */
  readonly aliasRate: number;
  /** Months billed for one visit fewer than contracted. */
  readonly missedVisitRate: number;
  /** Bills that exist only as a GL line. */
  readonly missingInvoiceRate: number;
  /** GL lines booked to the wrong account. */
  readonly miscodedGlRate: number;
}

export const DEFAULT_RENDER_CONFIG: RenderConfig = {
  aliasRate: 0.3,
  missedVisitRate: 0.08,
  missingInvoiceRate: 0.08,
  miscodedGlRate: 0.05,
};

export interface Rendered {
  /** What an engine sees. */
  readonly corpus: Corpus;
  /**
   * Where each source location really came from, keyed by `docId` for invoices and
   * `docId:line` for GL rows. Only the benchmark reads it.
   */
  readonly truth: ReadonlyMap<string, TruthKey>;
}

interface Bill {
  readonly day: IsoDate;
  readonly arrangement: Arrangement;
  readonly vendorName: string;
  readonly qty: number;
  readonly rate: number;
  readonly hasInvoice: boolean;
  readonly account: string;
}

export function render(world: World, seed: number, overrides: Partial<RenderConfig> = {}): Rendered {
  const cfg: RenderConfig = { ...DEFAULT_RENDER_CONFIG, ...overrides };
  const rng = new Random(seed + 1_000_003);
  const vendors = new Map(world.vendors.map((v) => [v.id, v]));
  const properties = new Map(world.properties.map((p) => [p.id, p]));

  const bills: Bill[] = [];
  for (const arrangement of world.arrangements) {
    const vendor = vendors.get(arrangement.vendorId) as Vendor;
    for (const month of eachMonth(world.windowStart, world.asOf)) {
      const day = withDayOfMonth(month, vendor.billingDay);
      const missed = arrangement.monthlyQty > 1 && rng.random() < cfg.missedVisitRate;
      const vendorName = rng.random() < cfg.aliasRate ? rng.choice(vendor.aliases.slice(1)) : vendor.legalName;
      bills.push({
        day,
        arrangement,
        vendorName,
        qty: arrangement.monthlyQty - (missed ? 1 : 0),
        rate: rateOn(arrangement, day),
        hasInvoice: rng.random() >= cfg.missingInvoiceRate,
        account: rng.random() < cfg.miscodedGlRate ? MISCODED_ACCOUNT : GL_ACCOUNT[arrangement.category],
      });
    }
  }
  const order = (b: Bill) => [b.day, b.arrangement.vendorId, b.arrangement.propertyId];
  bills.sort((a, b) => compareTuples(order(a), order(b)));

  const documents: Document[] = [];
  const truth = new Map<string, TruthKey>();
  const sequence = new Map<string, number>();
  const gl = ["date,property_id,gl_account,vendor,memo,amount"];
  for (const bill of bills) {
    const { arrangement } = bill;
    const vendor = vendors.get(arrangement.vendorId) as Vendor;
    const prop = properties.get(arrangement.propertyId) as Property;
    const key: TruthKey = { propertyId: arrangement.propertyId, vendorId: arrangement.vendorId, category: arrangement.category };
    const count = (sequence.get(vendor.id) ?? 0) + 1;
    sequence.set(vendor.id, count);
    const number = `${vendor.invoicePrefix}-${pad(count, 4)}`;
    const amount = round(bill.qty * bill.rate, 2);
    if (bill.hasInvoice) {
      const docId = `inv-${pad(documents.length + 1, 5)}`;
      const layout = vendor.layout === "table" ? tableInvoice : inlineInvoice;
      documents.push({ id: docId, kind: "invoice", lines: layout(bill, vendor, number, prop, amount) });
      truth.set(docId, key);
    }
    gl.push([
      bill.day, prop.id, bill.account,
      bill.vendorName.toUpperCase().slice(0, 20).trimEnd(), number, fixed(amount, 2),
    ].join(","));
    truth.set(`gl-export:${gl.length}`, key);
  }

  documents.push({ id: "gl-export", kind: "gl_export", lines: gl });
  documents.push(...pricingSheets(world, vendors));
  const corpus: Corpus = { asOf: world.asOf, properties: world.properties, quotes: world.quotes, documents };
  return { corpus, truth };
}

function tableInvoice(bill: Bill, vendor: Vendor, number: string, prop: Property, amount: number): string[] {
  return [
    "INVOICE",
    bill.vendorName,
    `Invoice No: ${number}`,
    `Invoice Date: ${bill.day}`,
    `Bill To: ${prop.name} (${prop.id})`,
    "",
    "Description".padEnd(34) + "Qty".padStart(5) + "  " + "Unit".padEnd(7) + "Rate".padStart(10) + "Amount".padStart(12),
    vendor.description.padEnd(34) + String(bill.qty).padStart(5) + "  " + vendor.unitLabel.padEnd(7)
      + fixed(bill.rate, 2).padStart(10) + fixed(amount, 2).padStart(12),
    "",
    "TOTAL DUE".padEnd(58) + fixed(amount, 2).padStart(12),
  ];
}

function inlineInvoice(bill: Bill, vendor: Vendor, number: string, prop: Property, amount: number): string[] {
  return [
    `${bill.vendorName} | Inv ${number} | ${usDate(bill.day)}`,
    `Service location: ${prop.id} ${prop.name}`,
    `${bill.qty} x ${vendor.description} @ ${fixed(bill.rate, 2)}/${vendor.unitLabel} = ${fixed(amount, 2)}`,
    `Amount due: ${fixed(amount, 2)}`,
  ];
}

function pricingSheets(world: World, vendors: ReadonlyMap<string, Vendor>): Document[] {
  const owners = new Map(world.owners.map((o) => [o.id, o]));
  const sheets: Document[] = [];
  for (const agreement of world.agreements) {
    if (!agreement.hasPricingSheet) continue;
    const vendor = vendors.get(agreement.vendorId) as Vendor;
    sheets.push({
      id: `ps-${pad(sheets.length + 1, 3)}`,
      kind: "pricing_sheet",
      lines: [
        vendor.legalName,
        "RATE SCHEDULE",
        `Prepared for: ${(owners.get(agreement.ownerId) as Owner).name}`,
        `Effective: ${longDate(agreement.start)}`,
        `Service: ${vendor.description}`,
        `Rate: $${fixed(agreement.baseRate, 2)} per ${vendor.unitLabel}`,
        `Annual adjustment: ${percent(agreement.escalatorPct)} on each anniversary`,
        `Locations: ${agreement.propertyIds.join(", ")}`,
      ],
    });
  }
  return sheets;
}
