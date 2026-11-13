import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

import { formatTable, score } from "../src/bench.ts";
import { baseline, type Engine } from "../src/engines.ts";
import { parseTableInvoice } from "../src/ingest.ts";
import type { SourceSpan } from "../src/schema.ts";
import { buildWorld, rateOn, render, trueRelationships, truthId } from "../src/world/index.ts";

/** Reports the hidden relationships, citing every invoice behind each. Tests the harness, not an engine. */
function oracle(seed: number): Engine {
  return {
    name: "oracle",
    run() {
      const world = buildWorld(seed);
      const { truth } = render(world, seed);
      const evidence = new Map<string, SourceSpan[]>();
      for (const [location, key] of truth) {
        if (location.includes(":")) continue;
        const spans = evidence.get(truthId(key)) ?? [];
        spans.push({ docId: location, line: 1 });
        evidence.set(truthId(key), spans);
      }
      return trueRelationships(world).map((r) => ({
        ...r,
        evidence: evidence.get(truthId({ propertyId: r.propertyId, vendorId: r.vendorKey, category: r.category })) ?? [],
      }));
    },
  };
}

test("harness gives a perfect engine a perfect score", () => {
  const s = score(oracle(3), 3);
  expect(s.oppTrue).toBeGreaterThan(0);
  expect(s.relMatched).toBe(s.relTrue);
  expect(s.relPred).toBe(s.relTrue);
  expect(s.rateOk).toBe(s.relTrue);
  expect(s.oppMatched).toBe(s.oppTrue);
  expect(s.oppPred).toBe(s.oppTrue);
  expect(s.savingsFound).toBe(s.savingsAvailable);
});

test("table parser reads back the hidden rate", () => {
  const world = buildWorld(2);
  const { corpus, truth } = render(world, 2);
  const arrangements = new Map(world.arrangements.map((a) => [truthId(a), a]));
  const invoices = corpus.documents.filter((d) => d.kind === "invoice");
  const tables = invoices.filter((d) => d.lines[0] === "INVOICE");
  expect(tables.length).toBeGreaterThan(0);
  for (const doc of tables) {
    const items = parseTableInvoice(doc);
    expect(items).toHaveLength(1);
    const [item] = items;
    const key = truth.get(doc.id);
    const arrangement = key && arrangements.get(truthId(key));
    if (!item || !key || !arrangement) throw new Error(`no truth for ${doc.id}`);
    expect(item.propertyId).toBe(key.propertyId);
    expect(item.rate).toBe(rateOn(arrangement, item.invoicedOn));
  }
  expect(invoices.filter((d) => d.lines[0] !== "INVOICE").flatMap(parseTableInvoice)).toEqual([]);
});

test("baseline only reports rates it can point to", () => {
  const s = score(baseline, 1);
  expect(s.relMatched).toBeGreaterThan(0);
  expect(s.unsourced).toBe(0);
  expect(s.modelUsd).toBe(0);
});

test("the README's baseline table is what the code produces", () => {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const section = (readme.split("### Baseline")[1] ?? "").split(/\n#{1,3} /)[0] ?? "";
  const published = section.split("\n").filter((line) => line.startsWith("|")).join("\n");
  const seeds = /--seeds ((?:\d+ ?)+)/.exec(section)?.[1]?.trim().split(" ").map(Number) ?? [];
  expect(seeds.length).toBeGreaterThan(0);
  // Compare cell by cell, so a Markdown formatter padding the columns doesn't fail the test.
  const cells = (table: string) =>
    table.split("\n").map((row) => row.split("|").slice(1, -1).map((cell) => cell.trim().replace(/^-+$/, "---")));
  expect(cells(published)).toEqual(cells(formatTable(seeds.map((seed) => score(baseline, seed)))));
});
