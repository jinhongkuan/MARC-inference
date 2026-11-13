/** An engine turns a corpus into relationships. Engines differ in which stages they use and what those cost. */

import type { Ledger } from "./cost.ts";
import { inferRelationships } from "./infer.ts";
import { parseTableInvoice } from "./ingest.ts";
import { categoryByKeyword, unitAsWritten, vendorKeyExact } from "./resolve.ts";
import type { Corpus, Relationship } from "./schema.ts";

export interface Engine {
  readonly name: string;
  run(corpus: Corpus, ledger: Ledger): Relationship[];
}

/**
 * Free and naive: one known invoice layout, exact vendor names, keyword categories, units as written.
 *
 * Ignores GL lines and pricing sheets entirely.
 */
export const baseline: Engine = {
  name: "baseline",
  run(corpus) {
    const items = corpus.documents.flatMap(parseTableInvoice);
    return inferRelationships(items, {
      categoryOf: categoryByKeyword,
      vendorKey: vendorKeyExact,
      unitOf: unitAsWritten,
    });
  },
};

export const ENGINES: Readonly<Record<string, Engine>> = { baseline };
