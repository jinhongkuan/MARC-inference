/** Documents -> line items, each tied to the exact line it was read from. */

import { type IsoDate, parseIsoDate } from "./dates.ts";
import type { Document, SourceSpan } from "./schema.ts";

export interface LineItem {
  readonly span: SourceSpan;
  readonly vendorRaw: string;
  readonly propertyId: string;
  readonly invoicedOn: IsoDate;
  readonly description: string;
  readonly qty: number;
  readonly unit: string;
  readonly rate: number;
}

const DATE = /^Invoice Date: (\d{4}-\d{2}-\d{2})$/;
const BILL_TO = /^Bill To: .*\(([A-Z]{3}-\d{2})\)$/;
const ITEM =
  /^(?<desc>\S.*?)\s{2,}(?<qty>\d+)\s{2,}(?<unit>\S+)\s+(?<rate>\d+\.\d{2})\s+(?<amount>\d+\.\d{2})$/;

/** Parse the one invoice layout the baseline knows. Any other layout yields nothing. */
export function parseTableInvoice(doc: Document): LineItem[] {
  if (doc.kind !== "invoice" || doc.lines.length < 2 || doc.lines[0] !== "INVOICE") return [];
  let invoicedOn: IsoDate | undefined;
  let propertyId: string | undefined;
  for (const text of doc.lines) {
    const date = DATE.exec(text);
    if (date) {
      const day = date[1] as string;
      parseIsoDate(day); // rejects dates that don't exist
      invoicedOn = day;
      continue;
    }
    const billTo = BILL_TO.exec(text);
    if (billTo) propertyId = billTo[1];
  }
  if (invoicedOn === undefined || propertyId === undefined) return [];
  const vendorRaw = (doc.lines[1] as string).trim();
  return doc.lines.flatMap((text, index): LineItem[] => {
    const item = ITEM.exec(text)?.groups;
    if (!item) return [];
    return [{
      span: { docId: doc.id, line: index + 1 },
      vendorRaw,
      propertyId,
      invoicedOn,
      description: (item.desc as string).trim(),
      qty: Number(item.qty),
      unit: item.unit as string,
      rate: Number(item.rate),
    }];
  });
}
