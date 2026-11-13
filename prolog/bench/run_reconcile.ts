/**
 * Scenario 2 ("Ensure credits and replacements reconcile") on real advertising orders. Nothing is planted.
 *
 *   npx tsx prolog/bench/run_reconcile.ts --input prolog/out/dev-reconcile-input.json --run dev-reconcile \
 *       [--arms proposed-cold,proposed-warm,haiku-only,trivial] [--warm-from prolog/out/dev-proposed-store.pl]
 *
 * The question, per client of an agency at a station: across all the client's current orders, what was
 * credited, what was supplied in replacement, and is the client under-delivered (replacements worth
 * more than 10% less than credits)?
 *
 * proposed-cold  reconcile.pl decides; Claude Haiku 5.5 reads the facts it requests, starting from nothing.
 * proposed-warm  The same, starting from the facts scenario 1 already stored (--warm-from).
 * haiku-only     Claude Haiku 5.5 (low effort) gets every order an agency placed at a station, for all its
 *                clients, with the rule in plain English. It must group the orders by client itself.
 * trivial        The same with Claude Opus 5.5 (high effort).
 *
 * Scored against a reference read by a strict pattern, with no model. No answer counts as wrong.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, copyFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Random } from "./random.ts";
import { askJson, type Call, HAIKU, ledger, OPUS, pool } from "./claude.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
process.loadEnvFile(path.join(here, "..", "..", ".env"));
const outDir = path.join(here, "..", "out");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const arms = arg("arms", "proposed-cold,proposed-warm,haiku-only,trivial").split(",");
const run = arg("run", "dev-reconcile");
const warmFrom = path.resolve(arg("warm-from", path.join(outDir, "dev-proposed-store.pl")));
const SEED = 20261112;

interface Doc { id: string; station: string; owner: string; account: string; superseded_by: string | null; text: string }
interface Ref { station: string; owner: string; account: string; docs: number; credited: number; replaced: number; under_delivered: boolean }
const input: { docs: Doc[]; reference: Ref[] } = JSON.parse(readFileSync(path.resolve(arg("input", path.join(outDir, "dev-reconcile-input.json"))), "utf8"));
const docs = new Map(input.docs.map((d) => [d.id, d]));
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const str = { type: "string" };
const int = { type: "integer" };
const numT = { type: "number" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items: unknown) => ({ type: "array", items });
const keyOf = (station: string, owner: string, account: string) => `${station}|${owner}|${account}`;

/** What an arm concluded for one client: station|owner|account -> values. */
interface Answer { credited: number; replaced: number; underDelivered: boolean }
type Answers = Map<string, Answer>;

// ---------------------------------------------------------------------------------------------
// proposed: Prolog asks, Haiku reads, the host stores

const READ = `You are reading one TV station advertising order. Report only what the order prints; do not compute or infer. Line numbers are the "Ln" numbers at the start of each order line.`;
// The header read is word for word the one scenario 1 uses, so its stored answer is the same fact.
const HEADER = `Return the advertiser's name exactly as printed after "Advertiser Name:", and the list of every order line number.`;
const ADJUSTMENTS = `Some order lines are followed by a "Spot" table listing individual spots; those rows show a date range written with a hyphen, like 09/01/14-09/07/14, and belong to the order line printed above them. Return one entry for every such row in the whole order: line (the "Ln" number of the order line it sits under), amount in dollars as a positive number, and kind:
- "credited" when the amount is printed in brackets, like ($800.00): a spot that did not run and was taken off the bill
- "replacement" when the note under the row says "MG for": a make-good spot supplied in its place
- "other" for any other row
A row reprinted after a page break counts once. Return an empty list when the order has no such rows.`;
const ADJ_SCHEMA = obj({ adjustments: list(obj({ line: int, kind: { type: "string", enum: ["credited", "replacement", "other"] }, amount: numT })) });

function prolog(facts: Iterable<string>, name: string) {
  const file = path.join(outDir, `${run}-${name}-facts.pl`);
  writeFileSync(file, [...facts].join("\n") + "\n");
  const rule = path.join(here, "..", "rules", "reconcile.pl");
  const goal = `consult(${q(rule)}), setup_call_cleanup(open(${q(file)}, read, S), (repeat, read_term(S, T, []), (T == end_of_file -> ! ; assertz(T), fail)), close(S)), main`;
  const p = spawnSync("swipl", ["-q", "-g", goal, "-t", "halt"], { encoding: "utf8", maxBuffer: 1 << 29 });
  if (p.status !== 0) throw new Error(`swipl failed: ${p.stderr.slice(0, 2000)}`);
  return p.stdout.split("\n").filter(Boolean).map((r) => r.split("\t").map((c) => c.replace(/^'|'$/g, "").replace(/\\'/g, "'")));
}

async function proposed(arm: "proposed-cold" | "proposed-warm") {
  const store = path.join(outDir, `${run}-${arm}-store.pl`);
  rmSync(store, { force: true });
  if (arm === "proposed-warm") {
    if (!existsSync(warmFrom)) throw new Error(`no scenario 1 store at ${warmFrom}`);
    copyFileSync(warmFrom, store);
  }
  const facts = new Set<string>(existsSync(store) ? readFileSync(store, "utf8").split("\n").filter(Boolean) : []);
  const inherited = facts.size;
  const add = (fact: string) => {
    if (!facts.has(fact)) {
      facts.add(fact);
      appendFileSync(store, fact + "\n");
    }
  };
  const candidates = input.docs.map((d) => `candidate(${q(d.owner)}, ${q(d.station)}, spot, ${q(d.id)}).`);
  const before = ledger.length;
  const t0 = performance.now();
  const failures: string[] = [];
  let rows: string[][] = [];
  let requested = 0;
  for (let round = 1; round <= 8; round++) {
    rows = prolog([...candidates, ...facts], arm);
    const missing = rows.filter((r) => r[0] === "missing").map((r) => ({ doc: r[1] as string, attr: r[2] as string }));
    if (missing.length === 0) break;
    requested += missing.length;
    const jobs: { doc: string; kind: "header" | "adjustments" }[] = [];
    for (const m of missing) {
      if (m.attr === "superseded_by") {
        const later = docs.get(m.doc)?.superseded_by;
        add(`fact(${q(m.doc)}, superseded_by, ${later ? q(later) : "not_stated"}).`);
      } else if (m.attr === "account") jobs.push({ doc: m.doc, kind: "header" });
      else if (m.attr === "adjustments") jobs.push({ doc: m.doc, kind: "adjustments" });
    }
    new Random(SEED + round).shuffle(jobs);
    await pool(jobs, Number(process.env.PILOT_CONCURRENCY ?? 12), async (job) => {
      const D = q(job.doc);
      const text = (docs.get(job.doc) as Doc).text.slice(0, 80000);
      if (job.kind === "header") {
        const r = await askJson<{ account: string; lines: number[] }>({
          arm, trap: "reconcile", scope: `${job.doc}/header`, model: HAIKU, effort: "low", maxTokens: 20000, schema: obj({ account: str, lines: list(int) }),
          prompt: `${READ}\n\n${HEADER}\n\n${text}`,
        });
        if (!r.data) failures.push(`${job.doc}/header`);
        add(`fact(${D}, account, ${r.data && norm(r.data.account) ? q(norm(r.data.account)) : "not_stated"}).`);
        add(`fact(${D}, lines, ${r.data ? `[${[...new Set(r.data.lines)].sort((a, b) => a - b).join(",")}]` : "not_stated"}).`);
        return;
      }
      const r = await askJson<{ adjustments: { line: number; kind: string; amount: number }[] }>({
        arm, trap: "reconcile", scope: `${job.doc}/adjustments`, model: HAIKU, effort: "low", maxTokens: 30000, schema: ADJ_SCHEMA,
        prompt: `${READ}\n\n${ADJUSTMENTS}\n\n${text}`,
      });
      if (!r.data) failures.push(`${job.doc}/adjustments`);
      add(`fact(${D}, adjustments, ${r.data ? `[${r.data.adjustments.filter((a) => a.amount >= 0).map((a) => `adjustment(${a.line}, ${a.kind}, ${a.amount})`).join(", ")}]` : "not_stated"}).`);
    });
    console.log(`  round ${round}: ${missing.length} facts requested, ${jobs.length} Haiku reads`);
  }
  const station = new Map(input.docs.map((d) => [d.owner, d.station])); // one station per run scope is enough to key on vendor below
  const answers: Answers = new Map();
  for (const r of rows.filter((x) => x[0] === "account")) answers.set(keyOf(r[2] as string, r[1] as string, r[3] as string), { credited: Number(r[4]), replaced: Number(r[5]), underDelivered: false });
  for (const r of rows.filter((x) => x[0] === "under_delivered")) {
    const a = answers.get(keyOf(r[2] as string, r[1] as string, r[3] as string));
    if (a) a.underDelivered = true;
  }
  void station;
  const calls = ledger.slice(before);
  return { arm, answers, wallMs: performance.now() - t0, failures, calls, factsInherited: inherited, factsRequested: requested, modelReads: calls.length };
}

// ---------------------------------------------------------------------------------------------
// haiku-only and trivial: one model reads every order an agency placed at a station, for all its clients.
// It has to work out which orders belong to which client itself, as the rule does.

const TASK = `Below are all the advertising orders one media-buying agency placed at one TV station, for all of its clients. For each client (the advertiser named on each order), work out how much of what was ordered did not run, and how much was supplied to make up for it.

- Only the current version of an order counts. If two documents print the same order number ("Order / Rev"), ignore the one with the smaller document id.
- Some order lines are followed by a "Spot" table listing individual spots; those rows show a date range written with a hyphen. A row whose amount is printed in brackets, like ($800.00), is a credited spot: it did not run and was taken off the bill. A row whose note says "MG for" is a make-good: a replacement spot, billed at the amount shown, which may be $0. Ignore any other row. A row reprinted after a page break counts once.
- For each client, credited_total is the sum of the bracketed amounts across all of that client's current orders, and replacement_total is the sum of the make-good amounts across them.
- A client is under-delivered when its credited_total is above zero and its replacement_total is more than 10% below it. A credited spot with no make-good still counts toward credited_total.

Return one entry for every client that has at least one current order, with the client's name exactly as printed after "Advertiser Name:", its credited_total, its replacement_total and under_delivered.`;
const TASK_SCHEMA = obj({ clients: list(obj({ client: str, credited_total: numT, replacement_total: numT, under_delivered: { type: "boolean" } })) });

async function alone(arm: string, model: string, effort: "low" | "high") {
  const log = path.join(outDir, `${run}-${arm}-answers.jsonl`);
  type Saved = { scope: string; ok: boolean; clients: { client: string; credited_total: number; replacement_total: number; under_delivered: boolean }[]; call: Call };
  const done = new Map<string, Saved>(existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Saved).map((s) => [s.scope, s]) : []);
  const t0 = performance.now();
  const scopes = [...new Set(input.docs.map((d) => `${d.station}|${d.owner}`))];
  const todo = scopes.filter((s) => !done.has(s));
  new Random(SEED).shuffle(todo);
  await pool(todo, Number(process.env.PILOT_CONCURRENCY_ALONE ?? 3), async (scope) => {
    const [station, owner] = scope.split("|");
    const mine = input.docs.filter((d) => d.station === station && d.owner === owner);
    const a = await askJson<{ clients: Saved["clients"] }>({
      arm, trap: "reconcile", scope, model, effort, maxTokens: 64000, schema: TASK_SCHEMA,
      prompt: `${TASK}\n\nAgency: ${owner}\n\n${mine.map((d) => `===== Document id: ${d.id} =====\n${d.text}`).join("\n\n")}`,
    });
    const saved: Saved = { scope, ok: a.data !== null, clients: a.data?.clients ?? [], call: a.call };
    done.set(scope, saved);
    appendFileSync(log, JSON.stringify(saved) + "\n");
  });
  const all = [...done.values()];
  const answers: Answers = new Map();
  for (const s of all) {
    const [station, owner] = s.scope.split("|") as [string, string];
    for (const c of s.clients) answers.set(keyOf(station, owner, norm(c.client)), { credited: c.credited_total, replaced: c.replacement_total, underDelivered: c.under_delivered });
  }
  return { arm, answers, wallMs: performance.now() - t0, failures: all.filter((s) => !s.ok).map((s) => s.scope), calls: all.map((s) => s.call) };
}

// ---------------------------------------------------------------------------------------------

function score(answers: Answers) {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.01 * Math.abs(b), 0.5);
  let credited = 0, replaced = 0, verdict = 0, tp = 0, fp = 0, fn = 0;
  const wrong: string[] = [];
  for (const r of input.reference) {
    const a = answers.get(keyOf(r.station, r.owner, r.account));
    const c = a !== undefined && close(a.credited, r.credited);
    const m = a !== undefined && close(a.replaced, r.replaced);
    const v = a !== undefined && a.underDelivered === r.under_delivered;
    if (c) credited++;
    if (m) replaced++;
    if (v) verdict++;
    if (r.under_delivered && a?.underDelivered) tp++;
    else if (r.under_delivered) fn++;
    else if (a?.underDelivered) fp++;
    if (!c || !m || !v) wrong.push(`${r.owner} / ${r.account} (${r.docs} orders): reference credited ${r.credited}, replaced ${r.replaced}, under-delivered ${r.under_delivered}; got ${a ? `${a.credited}, ${a.replaced}, ${a.underDelivered}` : "no answer"}`);
  }
  return { clients: input.reference.length, credited, replaced, verdict, findings: { tp, fp, fn }, wrong };
}

console.log(`${input.docs.length} orders, ${input.reference.length} clients, ${input.reference.filter((r) => r.under_delivered).length} under-delivered in the reference`);
for (const arm of arms) {
  console.log(`running ${arm} ...`);
  const r = arm === "proposed-cold" || arm === "proposed-warm" ? await proposed(arm) : arm === "haiku-only" ? await alone(arm, HAIKU, "low") : await alone(arm, OPUS, "high");
  const s = score(r.answers);
  const cost = r.calls.reduce((a, c) => a + c.costUsd, 0);
  writeFileSync(path.join(outDir, `${run}-${arm}.json`), JSON.stringify({ ...r, answers: Object.fromEntries(r.answers), score: s }, null, 1));
  console.log(
    `  ${arm}: verdict right ${s.verdict}/${s.clients} | findings ${s.findings.tp} found, ${s.findings.fp} false, ${s.findings.fn} missed | credited right ${s.credited}/${s.clients} | replaced right ${s.replaced}/${s.clients}` +
      ` | no answer ${r.failures.length} | cost $${cost.toFixed(3)} | wall ${(r.wallMs / 1000).toFixed(0)}s | summed call time ${(r.calls.reduce((a, c) => a + c.latencyMs, 0) / 1000).toFixed(0)}s | ${r.calls.length} model calls`,
  );
}
