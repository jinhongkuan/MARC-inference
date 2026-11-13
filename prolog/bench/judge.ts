/**
 * Judges every line any arm flagged in a scenario 1 run, using Claude Fable 5.2 in place of a person.
 *
 *   npx tsx prolog/bench/judge.ts --input prolog/out/test-input.json --run test
 *
 * For each agency-station group with flagged lines, the judge gets every order in the group and the
 * list of claims (a flagged line and the lines the arms compared it against), and rules each claim
 * true or false under the written definition. It is not told which arm made which claim.
 * Verdicts go to prolog/out/<run>-judge.json. The judge is from the same model family as the arms.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { askJson, FABLE, ledger, pool } from "./claude.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(here, "..", "..", ".env"));
const outDir = path.join(here, "..", "out");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const run = arg("run", "test");
const ARMS = arg("arms", "pattern,proposed,haiku-only,trivial").split(",");

interface Doc { id: string; station: string; owner: string; text: string; superseded_by: string | null }
const input: { docs: Doc[] } = JSON.parse(readFileSync(path.resolve(arg("input", path.join(outDir, "test-input.json"))), "utf8"));
const docs = new Map(input.docs.map((d) => [d.id, d]));
const flagged: Record<string, Record<string, string>> = Object.fromEntries(
  ARMS.map((a) => [a, (JSON.parse(readFileSync(path.join(outDir, `${run}-${a}.json`), "utf8")) as { flagged: Record<string, string> }).flagged]),
);

// One claim per flagged line, with every comparison line any arm cited for it.
const claims = new Map<string, Set<string>>();
for (const a of ARMS) for (const [line, best] of Object.entries(flagged[a] ?? {})) claims.set(line, (claims.get(line) ?? new Set<string>()).add(best));
const byScope = new Map<string, string[]>();
for (const line of claims.keys()) {
  const d = docs.get(line.slice(0, line.lastIndexOf("-")));
  const scope = d ? `${d.station}|${d.owner}` : "unknown";
  byScope.set(scope, [...(byScope.get(scope) ?? []), line]);
}

const RULE = `You are checking audit findings about one media-buying agency's advertising orders at one TV station. Each order is for one of the agency's clients (the advertiser).

The rule being audited:
- Only the current version of an order counts. If two documents print the same order number ("Order / Rev"), the one with the smaller document id is superseded and is ignored.
- An order line's service is its weekday pattern as printed in the Days column, its start/end time as printed, and its spot length. Its period is the Monday-to-Sunday week containing the line's start date. Its class is the priority code in the Pri column, read in full (for example "P-01" and "P-04" are different classes). Its rate is the rate per spot. Lines with no rate or no spots ordered are ignored.
- A comparison group is all lines, across the agency's clients, with the same service, period and class.
- Within a group, each client's rate is its lowest-rate line. The group's best rate is the lowest across clients.
- A finding is true when the flagged line is its client's lowest-rate line in its group (or tied for it), and that rate is more than 10% above the group's best rate held by a different client. Exactly 10% does not count.
- If the order itself states a reason for a line's special rate (a note, a package term, a contract reference), that line is neither a finding nor usable as the best rate. The priority code, program name and make-good notes are not reasons.

For each claim below, read the flagged line and the rest of the group in the orders, and decide whether the finding is true. Check the service, the week, the class and the rates yourself; do not trust the claim. When the same client has two lines tied at its lowest rate, flagging either one is a true finding.`;
const SCHEMA = {
  type: "object",
  properties: {
    verdicts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          flagged_line: { type: "string" }, true_finding: { type: "boolean" }, flagged_rate: { type: "number" }, best_rate: { type: "number" },
          best_line: { type: "string" }, reason: { type: "string" },
        },
        required: ["flagged_line", "true_finding", "flagged_rate", "best_rate", "best_line", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["verdicts"],
  additionalProperties: false,
};
interface Verdict { flagged_line: string; true_finding: boolean; flagged_rate: number; best_rate: number; best_line: string; reason: string }

const log = path.join(outDir, `${run}-judge.jsonl`);
const done = new Map<string, Verdict>(existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Verdict).map((v) => [v.flagged_line, v]) : []);
const failures: string[] = [];
const BUDGET_CHARS = 1_800_000; // keep a group's orders within the judge's context window

await pool([...byScope.entries()], 3, async ([scope, lines]) => {
  const todo = lines.filter((l) => !done.has(l));
  if (todo.length === 0) return;
  const [station, owner] = scope.split("|");
  let mine = input.docs.filter((d) => d.station === station && d.owner === owner);
  if (mine.reduce((a, d) => a + d.text.length, 0) > BUDGET_CHARS) {
    // Too large to read whole: keep the documents the claims name, then others until the budget is reached.
    const named = new Set(todo.flatMap((l) => [l, ...(claims.get(l) ?? [])]).map((k) => k.slice(0, k.lastIndexOf("-"))));
    const kept = mine.filter((d) => named.has(d.id));
    let size = kept.reduce((a, d) => a + d.text.length, 0);
    for (const d of mine) {
      if (named.has(d.id) || size + d.text.length > BUDGET_CHARS) continue;
      kept.push(d);
      size += d.text.length;
    }
    mine = kept;
  }
  const list = todo.map((l) => `- flagged line ${l}; compared against ${[...(claims.get(l) ?? [])].join(" or ")}`).join("\n");
  const r = await askJson<{ verdicts: Verdict[] }>({
    arm: "judge", trap: "uniform_spend", scope, model: FABLE, effort: "high", maxTokens: 64000, schema: SCHEMA,
    prompt: `${RULE}\n\nAgency: ${owner}\n\nClaims to check (a line is written as document id, a hyphen, then the line number):\n${list}\n\n${mine.map((d) => `===== Document id: ${d.id} =====\n${d.text}`).join("\n\n")}`,
  });
  const got = new Map((r.data?.verdicts ?? []).map((v) => [v.flagged_line, v]));
  for (const l of todo) {
    const v = got.get(l);
    if (!v) {
      failures.push(l);
      continue;
    }
    done.set(l, v);
    appendFileSync(log, JSON.stringify(v) + "\n");
  }
  console.log(`  ${scope}: ${todo.length} claims, ${[...got.values()].filter((v) => v.true_finding).length} judged true${r.data ? "" : ` (no answer: ${r.call.stopReason})`}`);
});

const truth = new Set([...done.values()].filter((v) => v.true_finding).map((v) => v.flagged_line));
const wilson = (k: number, n: number) => {
  if (n === 0) return "n/a";
  const z = 1.96, p = k / n, d = 1 + (z * z) / n, c = p + (z * z) / (2 * n), h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return `${Math.round(p * 100)}% [${Math.round(((c - h) / d) * 100)}, ${Math.round(((c + h) / d) * 100)}]`;
};
const summary = ARMS.map((a) => {
  const f = Object.keys(flagged[a] ?? {});
  const tp = f.filter((l) => truth.has(l)).length;
  const unjudged = f.filter((l) => !done.has(l)).length;
  return { arm: a, flagged: f.length, correct: tp, false: f.length - tp - unjudged, unjudged, missed: truth.size - tp, precision: wilson(tp, f.length - unjudged), recall: wilson(tp, truth.size) };
});
writeFileSync(path.join(outDir, `${run}-judge.json`), JSON.stringify({ claims: claims.size, judged: done.size, trueFindings: truth.size, failures, cost: ledger.reduce((a, c) => a + c.costUsd, 0), summary, verdicts: [...done.values()] }, null, 1));
console.log(`claims ${claims.size} | judged ${done.size} | true ${truth.size} | not judged ${failures.length} | judge cost $${ledger.reduce((a, c) => a + c.costUsd, 0).toFixed(2)}`);
console.table(summary);
