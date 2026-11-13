/**
 * Score an engine against the hidden world it never saw.
 *
 * Predicted relationships are matched to hidden arrangements through their evidence: a
 * relationship counts only if most of the lines it cites really came from the arrangement it
 * claims. A relationship with no evidence can't score.
 */

import { Ledger } from "./cost.ts";
import { findOpportunities } from "./discover.ts";
import type { Engine } from "./engines.ts";
import { fixed, grouped, percent, round, sum } from "./numeric.ts";
import type { Document, Opportunity, Relationship, SourceSpan } from "./schema.ts";
import { buildWorld, render, trueRelationships, type TruthKey, truthId } from "./world/index.ts";

export const RATE_TOLERANCE = 0.02;

export interface Score {
  readonly seed: number;
  readonly engine: string;
  readonly invoices: number;
  readonly invoicesUsed: number;
  readonly relTrue: number;
  readonly relPred: number;
  readonly relMatched: number;
  readonly relDuplicates: number;
  readonly relUnread: number;
  readonly rateOk: number;
  readonly unsourced: number;
  readonly oppTrue: number;
  readonly oppPred: number;
  readonly oppMatched: number;
  readonly savingsAvailable: number;
  readonly savingsFound: number;
  readonly savingsClaimed: number;
  readonly modelUsd: number;
  readonly modelCalls: number;
}

export function score(engine: Engine, seed: number): Score {
  const world = buildWorld(seed);
  const { corpus, truth } = render(world, seed);
  const ledger = new Ledger();
  const predicted = engine.run(corpus, ledger);

  const docs = new Map(corpus.documents.map((d) => [d.id, d]));
  const actual = new Map(trueRelationships(world).map((r) => [relationshipId(r), r]));
  const { matched, duplicates } = matchRelationships(predicted, truth);
  const cited = new Set(
    predicted.flatMap((r) => r.evidence.flatMap((span) => truthOf(span, truth) ?? [])).map(truthId),
  );

  const trueOpps = new Map(findOpportunities(actual.values(), corpus.properties, corpus.quotes).map((o) => [opportunityId(o), o]));
  const predictedOpps = findOpportunities(predicted, corpus.properties, corpus.quotes);
  const claimed = new Set(predictedOpps.map(opportunityId).filter((id) => trueOpps.has(id)));

  const invoiceIds = (r: Relationship) => r.evidence.map((s) => s.docId).filter((id) => docs.get(id)?.kind === "invoice");
  const trueRate = (key: TruthKey) => (actual.get(truthId(key)) as Relationship).currentRate;

  return {
    seed,
    engine: engine.name,
    invoices: corpus.documents.filter((d) => d.kind === "invoice").length,
    invoicesUsed: new Set(predicted.flatMap(invoiceIds)).size,
    relTrue: actual.size,
    relPred: predicted.length,
    relMatched: matched.size,
    relDuplicates: duplicates,
    relUnread: [...actual.keys()].filter((id) => !cited.has(id)).length,
    rateOk: [...matched].filter(([index, key]) => {
      const rate = trueRate(key);
      return Math.abs((predicted[index] as Relationship).currentRate - rate) <= RATE_TOLERANCE * rate;
    }).length,
    unsourced: predicted.filter((r) => !isSourced(r, docs)).length,
    oppTrue: trueOpps.size,
    oppPred: predictedOpps.length,
    oppMatched: claimed.size,
    savingsAvailable: round(sum([...trueOpps.values()].map((o) => o.annualSavings)), 2),
    savingsFound: round(sum([...claimed].map((id) => (trueOpps.get(id) as Opportunity).annualSavings)), 2),
    savingsClaimed: round(sum(predictedOpps.map((o) => o.annualSavings)), 2),
    modelUsd: ledger.usd,
    modelCalls: ledger.calls,
  };
}

export function truthOf(span: SourceSpan, truth: ReadonlyMap<string, TruthKey>): TruthKey | undefined {
  return truth.get(`${span.docId}:${span.line}`) ?? truth.get(span.docId);
}

/**
 * Map predicted relationships (by index) to hidden arrangements, and count duplicates.
 *
 * Each arrangement matches once. A duplicate, such as one vendor split across two spellings
 * of its name, is a correct-looking relationship whose arrangement was already taken; it
 * counts against precision.
 */
export function matchRelationships(
  predicted: readonly Relationship[],
  truth: ReadonlyMap<string, TruthKey>,
): { matched: Map<number, TruthKey>; duplicates: number } {
  const claims: { count: number; index: number; key: TruthKey }[] = [];
  predicted.forEach((rel, index) => {
    const votes = new Map<string, { key: TruthKey; count: number }>();
    for (const span of rel.evidence) {
      const key = truthOf(span, truth);
      if (!key) continue;
      const vote = votes.get(truthId(key));
      if (vote) vote.count += 1;
      else votes.set(truthId(key), { key, count: 1 });
    }
    // Most votes wins; on a tie, the arrangement cited first.
    let top: { key: TruthKey; count: number } | undefined;
    for (const vote of votes.values()) if (!top || vote.count > top.count) top = vote;
    if (top && top.key.propertyId === rel.propertyId && top.key.category === rel.category) {
      claims.push({ count: top.count, index, key: top.key });
    }
  });

  // Strongest claim first; between equals, the earlier relationship.
  claims.sort((a, b) => b.count - a.count || a.index - b.index);
  const matched = new Map<number, TruthKey>();
  const taken = new Set<string>();
  for (const { index, key } of claims) {
    if (taken.has(truthId(key))) continue;
    taken.add(truthId(key));
    matched.set(index, key);
  }
  return { matched, duplicates: claims.length - matched.size };
}

/** True if the reported rate appears on at least one line the relationship cites. */
export function isSourced(rel: Relationship, docs: ReadonlyMap<string, Document>): boolean {
  const needle = fixed(rel.currentRate, 2);
  return rel.evidence.some((span) => {
    const doc = docs.get(span.docId);
    return doc !== undefined && span.line > 0 && span.line <= doc.lines.length && (doc.lines[span.line - 1] as string).includes(needle);
  });
}

export function formatTable(scores: readonly Score[]): string {
  const header =
    "| seed | invoices used | relationships P / R | duplicates | never read | rate within 2% | unsourced "
    + "| opportunities P / R | savings found / available | savings claimed | model spend |";
  const rows = [header, "|" + "---|".repeat(11), ...scores.map((s) => row(String(s.seed), s))];
  const [first] = scores;
  if (first && scores.length > 1) {
    const totals = Object.fromEntries(
      (Object.keys(first) as (keyof Score)[])
        .filter((field) => field !== "seed" && field !== "engine")
        .map((field) => [field, sum(scores.map((s) => s[field] as number))]),
    );
    rows.push(row("all", { ...(totals as Omit<Score, "seed" | "engine">), seed: 0, engine: first.engine }));
  }
  return rows.join("\n");
}

function row(label: string, s: Score): string {
  return (
    `| ${label} | ${s.invoicesUsed}/${s.invoices} `
    + `| ${pct(s.relMatched, s.relPred)} / ${pct(s.relMatched, s.relTrue)} `
    + `| ${s.relDuplicates} | ${s.relUnread} | ${pct(s.rateOk, s.relMatched)} | ${s.unsourced} `
    + `| ${pct(s.oppMatched, s.oppPred)} / ${pct(s.oppMatched, s.oppTrue)} `
    + `| ${usd(s.savingsFound)} / ${usd(s.savingsAvailable)} | ${usd(s.savingsClaimed)} `
    + `| $${fixed(s.modelUsd, 2)} |`
  );
}

function relationshipId(r: Relationship): string {
  return truthId({ propertyId: r.propertyId, vendorId: r.vendorKey, category: r.category });
}

function opportunityId(o: Opportunity): string {
  return `${o.relationship.propertyId}|${o.relationship.category}`;
}

function pct(n: number, d: number): string {
  return d ? percent(n / d) : "n/a";
}

function usd(x: number): string {
  return `$${grouped(fixed(x / 1000, 1))}k`;
}
