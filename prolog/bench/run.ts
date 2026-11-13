/**
 * Scenario 1 ("Ensure uniform spend") on real advertising orders. Nothing is planted.
 *
 *   npx tsx prolog/bench/run.ts --input prolog/out/test-input.json --run test [--arms pattern,proposed,haiku-only,trivial]
 *
 * pattern     uniform_spend.pl decides over line rows read by a strict pattern. No model.
 * proposed    uniform_spend.pl decides. It records the facts it needs; this host answers each request
 *             by having Claude Haiku 5.5 read that fact from the order, stores it, and reruns the
 *             query until nothing is outstanding.
 * haiku-only  Claude Haiku 5.5 (low effort) gets every order of one agency at one station and the rule
 *             in plain English, and returns the lines it flags.
 * trivial     The same with Claude Opus 5.5 (high effort).
 *
 * Results go to prolog/out/<run>-<arm>.json. Work is saved as it completes, so a rerun resumes.
 * A call that fails after every retry, or is cut off, yields no answer and is scored as such.
 * Stops before any call once PILOT_BUDGET_USD (default 25) is spent.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Random } from "../../src/random.ts";
import { askJson, type Call, HAIKU, ledger, OPUS, pool, rateLimited } from "./claude.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..", "..");
process.loadEnvFile(path.join(root, ".env"));
const outDir = path.join(here, "..", "out");
const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const arms = arg("arms", "pattern,proposed,haiku-only,trivial").split(",");
const run = arg("run", "pilot");
// --rule v2 runs uniform_spend_v2.pl with lib/slot.pl: slot and week are derived in Prolog from typed dates and times.
const V2 = arg("rule", "v1") === "v2";
const SEED = 20261112;

interface RefLine { n: number; service: string; period: string; units: number; rate: number; cls: string }
interface Doc { id: string; station: string; owner: string; account: string; order: string; text: string; superseded_by: string | null; ref_lines: RefLine[] }
interface Scope { station: string; owner: string }
const input: { scopes: Scope[]; docs: Doc[]; extraDocs?: Doc[] } = JSON.parse(readFileSync(path.resolve(arg("input", path.join(outDir, "pilot-input.json"))), "utf8"));
// extraDocs can be read (a later version of an order may sit outside the scopes run) but are not candidates.
const docs = new Map([...(input.extraDocs ?? []), ...input.docs].map((d) => [d.id, d]));
const q = (s: string) => `'${s.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const monday = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
const candidates = () => input.docs.map((d) => `candidate(${q(d.owner)}, ${q(d.station)}, spot, ${q(d.id)}).`);
const rule = path.join(here, "..", "rules", V2 ? "uniform_spend_v2.pl" : "uniform_spend.pl");
const slotLib = path.join(here, "..", "lib", "slot.pl");

/** Runs the rule over a facts file; returns findings and the facts it still needs. */
function prolog(facts: Iterable<string>, name: string) {
  const file = path.join(outDir, `${run}-${name}-facts.pl`);
  writeFileSync(file, [...facts].join("\n") + "\n");
  const goal = `consult(${q(rule)}), ${V2 ? `consult(${q(slotLib)}), ` : ""}setup_call_cleanup(open(${q(file)}, read, S), (repeat, read_term(S, T, []), (T == end_of_file -> ! ; assertz(T), fail)), close(S)), main`;
  const t0 = performance.now();
  const p = spawnSync("swipl", ["-q", "-g", goal, "-t", "halt"], { encoding: "utf8", maxBuffer: 1 << 29 });
  if (p.status !== 0) throw new Error(`swipl failed: ${p.stderr.slice(0, 2000)}`);
  const rows = p.stdout.split("\n").filter(Boolean).map((r) => r.split("\t"));
  const flagged: Record<string, string> = {};
  for (const r of rows.filter((x) => x[0] === "finding")) flagged[(r[1] as string).replace(/'/g, "")] = (r[2] as string).replace(/'/g, "");
  const missing = rows.filter((r) => r[0] === "missing").map((r) => ({ doc: (r[1] as string).replace(/^'|'$/g, ""), attr: r[2] as string }));
  return { flagged, missing, ms: performance.now() - t0 };
}

// ---------------------------------------------------------------------------------------------
// pattern: the rule over pattern-read lines, no model

function pattern() {
  const t0 = performance.now();
  const facts = candidates();
  for (const d of input.docs) {
    const D = q(d.id);
    facts.push(`fact(${D}, superseded_by, ${d.superseded_by ? q(d.superseded_by) : "not_stated"}).`, `fact(${D}, account, ${q(d.account)}).`);
    facts.push(`fact(${D}, lines, [${[...new Set(d.ref_lines.map((l) => l.n))].join(",")}]).`);
    const seen = new Set<number>();
    for (const l of d.ref_lines) {
      if (seen.has(l.n)) continue; // a line number printed twice: keep the first row
      seen.add(l.n);
      const L = (a: string) => `line(${l.n}, ${a})`;
      facts.push(
        `fact(${D}, ${L("service")}, ${q(l.service)}).`, `fact(${D}, ${L("period")}, ${q(l.period)}).`, `fact(${D}, ${L("class")}, ${q(l.cls)}).`,
        `fact(${D}, ${L("rate")}, ${l.rate > 0 ? l.rate : "not_stated"}).`, `fact(${D}, ${L("units")}, ${l.units > 0 ? l.units : "not_stated"}).`,
        `fact(${D}, ${L("explanation")}, not_stated).`,
      );
    }
  }
  const p = prolog(facts, "pattern");
  return { arm: "pattern", flagged: p.flagged, wallMs: performance.now() - t0, prologMs: p.ms, failures: [] as string[], calls: [] as Call[] };
}

// ---------------------------------------------------------------------------------------------
// proposed: Prolog asks, Haiku reads, the host stores

const READ = `You are reading one TV station advertising order. Report only what the order prints; do not compute or infer. Line numbers are the "Ln" numbers at the start of each order line.`;
const str = { type: "string" };
const int = { type: "integer" };
const obj = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const list = (items: unknown) => ({ type: "array", items });

type Kind = "header" | "keys" | "typed" | "prices" | "explanation";
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const KINDS: Record<Kind, { ask: (ns: number[]) => string; schema: Record<string, unknown> }> = {
  header: {
    ask: () => `Return the advertiser's name exactly as printed after "Advertiser Name:", and the list of every order line number.${V2 ? ` Also return order_number, the number printed after "Order / Rev:", as digits only: remove any spaces a scan has put inside it (for example "12 345 6" is 123456) and return "" if it cannot be read.` : ""}`,
    schema: V2 ? obj({ order_number: str, account: str, lines: list(int) }) : obj({ account: str, lines: list(int) }),
  },
  keys: {
    ask: (ns) => `For order lines ${ns.join(", ")}, return: days, the weekday pattern printed in the Days column, character for character (for example "MT-----" or "-1111--"); time, the start/end time printed for the line, character for character (for example "5am-6am"); length_seconds, the spot length in seconds (":30" is 30, "1:00" is 60); start_date, the line's start date as YYYY-MM-DD (two-digit years are 20xx). Use "" or 0 when the order does not print the value.`,
    schema: obj({ lines: list(obj({ n: int, days: str, time: str, length_seconds: int, start_date: str })) }),
  },
  typed: {
    ask: (ns) => `For order lines ${ns.join(", ")}, return what the order means, correcting obvious scanning errors in the printed characters (a letter O for a zero, a lowercase l for a one): start_date and end_date, the line's first and last date as YYYY-MM-DD (two-digit years are 20xx); weekdays, the days of the week the line runs on as shown in the Days column, as a list of mon, tue, wed, thu, fri, sat, sun (a seven-position pattern such as "MTWTF--" or "-1111--" marks Monday to Sunday in order; a bare letter or abbreviation names a day); return an empty list if the column cannot be read; start_time and end_time, the line's start and end time on a 24-hour clock as HH:MM (for example "10p-11p" is 22:00 and 23:00); length_seconds, the spot length in seconds (":30" is 30, "1:00" is 60). Use "" or 0 for a value the order does not print.`,
    schema: obj({ lines: list(obj({ n: int, start_date: str, end_date: str, weekdays: list({ type: "string", enum: DAYS }), start_time: str, end_time: str, length_seconds: int })) }),
  },
  prices: {
    ask: (ns) => `For order lines ${ns.join(", ")}, return: priority, the code printed in the Pri column (for example "P-2"), or "" if none; rate, the rate per spot in dollars; spots, the number of spots ordered on the line (the Spots figure printed just before the rate). Use 0 when the order does not print a rate or a spot count.`,
    schema: obj({ lines: list(obj({ n: int, priority: str, rate: { type: "number" }, spots: int })) }),
  },
  explanation: {
    ask: (ns) => `For order lines ${ns.join(", ")}, return any reason the order itself states for why that line's rate is special or differs from the station's usual rate for that time: a note, a package or bonus term, a contract reference, a stated discount or premium. The priority code, the program name and make-good notes are not reasons. For each line set states_reason to true only if the order prints such a reason, and put the order's exact words in quote; otherwise set states_reason to false and quote to "".`,
    schema: obj({ lines: list(obj({ n: int, states_reason: { type: "boolean" }, quote: str })) }),
  },
};

async function proposed() {
  // Stored facts survive a stopped run: a rerun starts from them and asks only for what is still missing.
  const store = path.join(outDir, `${run}-proposed-store.pl`);
  const facts = new Set<string>(existsSync(store) ? readFileSync(store, "utf8").split("\n").filter(Boolean) : []);
  const add = (fact: string) => {
    if (facts.has(fact)) return;
    facts.add(fact);
    appendFileSync(store, fact + "\n");
  };
  const before = ledger.length;
  const t0 = performance.now();
  let flagged: Record<string, string> = {};
  let prologMs = 0;
  const failures: string[] = [];
  const rounds: { round: number; requests: number; reads: number }[] = [];
  for (let round = 1; round <= 12; round++) {
    const p = prolog([...candidates(), ...facts], "proposed");
    prologMs += p.ms;
    flagged = p.flagged;
    if (p.missing.length === 0) break;

    // One read per document and kind of fact.
    const jobs = new Map<string, { doc: string; kind: Kind; lines: Set<number> }>();
    for (const m of p.missing) {
      if (m.attr === "superseded_by") {
        // Version order is metadata (same order number, later file), not something one document states.
        const later = docs.get(m.doc)?.superseded_by;
        add(`fact(${q(m.doc)}, superseded_by, ${later ? q(later) : "not_stated"}).`);
        continue;
      }
      if (m.attr === "filed") {
        // Filing order is metadata: the number in the document id is the time the station filed it.
        add(`fact(${q(m.doc)}, filed, ${Number(m.doc.replace(/^.*_/, "")) || 0}).`);
        continue;
      }
      const line = /^line\((\d+),(\w+)\)$/.exec(m.attr);
      const TYPED = ["start_date", "end_date", "weekdays", "start_minute", "end_minute", "length_seconds"];
      const kind: Kind = !line ? "header" : line[2] === "service" || line[2] === "period" ? "keys" : TYPED.includes(line[2] as string) ? "typed" : line[2] === "explanation" ? "explanation" : "prices";
      const job = jobs.get(`${m.doc}|${kind}`) ?? { doc: m.doc, kind, lines: new Set<number>() };
      if (line) job.lines.add(Number(line[1]));
      jobs.set(`${m.doc}|${kind}`, job);
    }
    const order = [...jobs.values()];
    new Random(SEED + round).shuffle(order);
    await pool(order, Number(process.env.PILOT_CONCURRENCY ?? 12), async (job) => {
      const ns = [...job.lines].sort((a, b) => a - b);
      const k = KINDS[job.kind];
      const r = await askJson<Record<string, unknown>>({
        arm: "proposed", trap: "uniform_spend", scope: `${job.doc}/${job.kind}`, model: HAIKU, effort: "low", maxTokens: 20000, schema: k.schema,
        prompt: `${READ}\n\n${k.ask(ns)}\n\n${(docs.get(job.doc) as Doc).text.slice(0, 80000)}`,
      });
      // No answer: the facts are stored as not stated, so the rule makes no finding from them.
      if (!r.data) failures.push(`${job.doc}/${job.kind}`);
      const D = q(job.doc);
      const put = (attr: string, value: string | null) => add(`fact(${D}, ${attr}, ${value ?? "not_stated"}).`);
      if (job.kind === "header") {
        const d = r.data as { order_number?: string; account: string; lines: number[] } | null;
        if (V2) put("version_of", d && /^\d+$/.test(String(d.order_number ?? "").trim()) ? q(String(d.order_number).trim()) : null);
        put("account", d && norm(d.account) ? q(norm(d.account)) : null);
        put("lines", d ? `[${[...new Set(d.lines)].sort((a, b) => a - b).join(",")}]` : null);
        return;
      }
      const got = new Map(((r.data as { lines: Record<string, unknown>[] } | null)?.lines ?? []).map((l) => [l.n as number, l]));
      for (const n of ns) {
        const l = got.get(n);
        if (job.kind === "keys") {
          const days = String(l?.days ?? "").trim();
          const time = String(l?.time ?? "").replace(/\s+/g, "").toLowerCase();
          const secs = Number(l?.length_seconds ?? 0);
          const week = monday(String(l?.start_date ?? ""));
          put(`line(${n}, service)`, days && time && secs > 0 ? q(`${days} ${time} ${secs}s`) : null);
          put(`line(${n}, period)`, week ? q(week) : null);
        } else if (job.kind === "typed") {
          const date = (v: unknown) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? ""));
            return m ? `date(${Number(m[1])}, ${Number(m[2])}, ${Number(m[3])})` : null;
          };
          const minute = (v: unknown) => {
            const m = /^(\d{1,2}):(\d{2})$/.exec(String(v ?? ""));
            return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? String(Number(m[1]) * 60 + Number(m[2])) : null;
          };
          const days = Array.isArray(l?.weekdays) ? (l.weekdays as string[]).filter((d) => DAYS.includes(d)) : [];
          put(`line(${n}, start_date)`, date(l?.start_date));
          put(`line(${n}, end_date)`, date(l?.end_date));
          put(`line(${n}, weekdays)`, l ? `[${[...new Set(days)].join(", ")}]` : null);
          put(`line(${n}, start_minute)`, minute(l?.start_time));
          put(`line(${n}, end_minute)`, minute(l?.end_time));
          put(`line(${n}, length_seconds)`, l && Number(l.length_seconds) > 0 ? String(Number(l.length_seconds)) : null);
        } else if (job.kind === "prices") {
          put(`line(${n}, class)`, l && String(l.priority).trim() ? q(String(l.priority).trim()) : null);
          put(`line(${n}, rate)`, l && Number(l.rate) > 0 ? String(Number(l.rate)) : null);
          put(`line(${n}, units)`, l && Number(l.spots) > 0 ? String(Number(l.spots)) : null);
        } else {
          // A yes/no plus a quote: a free-text field invites "the order states no reason", which is not a reason.
          const e = l?.states_reason === true ? String(l.quote ?? "").trim() : "";
          put(`line(${n}, explanation)`, e ? q(e) : null);
        }
      }
    });
    rounds.push({ round, requests: p.missing.length, reads: order.length });
    console.log(`  round ${round}: ${p.missing.length} facts requested, ${order.length} Haiku reads, $${ledger.slice(before).reduce((a, c) => a + c.costUsd, 0).toFixed(2)} so far`);
  }
  return {
    arm: "proposed", flagged, wallMs: performance.now() - t0, prologMs, rounds, failures, factsStored: facts.size, calls: ledger.slice(before),
    explanations: [...facts].filter((f) => f.includes("explanation)") && !f.endsWith("not_stated).")),
  };
}

// ---------------------------------------------------------------------------------------------
// haiku-only and trivial: one model reads everything for an agency at a station

const TASK = `You are auditing one media-buying agency's advertising orders at one TV station. Each order below is for one of the agency's clients (the advertiser) and lists order lines. The agency's clients should pay the same rate for the same thing.

Definitions:
- Only the current version of an order counts. If two documents print the same order number ("Order / Rev"), ignore the one with the smaller document id.
- An order line's service is its weekday pattern as printed in the Days column, its start/end time as printed, and its spot length. Its period is the Monday-to-Sunday week containing the line's start date. Its class is the priority code in the Pri column. Its rate is the rate per spot. Ignore lines with no rate or no spots ordered.
- A comparison group is all lines, across the agency's clients, with the same service, period and class.
- Within a group, each client's rate is its lowest-rate line. The group's best rate is the lowest across clients.
- A client is overpaying in a group when its rate is more than 10% above the best rate (exactly 10% does not count). Flag that client's lowest-rate line in the group, and name the best-rate line it is compared against.
- If the order itself states a reason for a line's special rate (a note, a package term, a contract reference), that line is neither flagged nor used as the best rate. The priority code, program name and make-good notes are not reasons.

Check every line of every order. Return every flagged line, identified by document id and line number ("Ln"), with the best-rate line it was compared against.`;
const TRIVIAL_SCHEMA = obj({ findings: list(obj({ flagged_doc: str, flagged_line: int, best_doc: str, best_line: int, reason: str })) });
interface Answer { scope: string; ok: boolean; findings: { flagged_doc: string; flagged_line: number; best_doc: string; best_line: number }[]; call: Call }

async function alone(arm: string, model: string, effort: "low" | "high") {
  const log = path.join(outDir, `${run}-${arm}-answers.jsonl`);
  const done = new Map<string, Answer>(
    existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Answer).map((a) => [a.scope, a]) : [],
  );
  const t0 = performance.now();
  const todo = input.scopes.filter((s) => !done.has(`${s.station}|${s.owner}`));
  new Random(SEED).shuffle(todo);
  await pool(todo, Number(process.env.PILOT_CONCURRENCY_ALONE ?? 3), async (s) => {
    const scope = `${s.station}|${s.owner}`;
    const mine = input.docs.filter((d) => d.station === s.station && d.owner === s.owner);
    const r = await askJson<{ findings: Answer["findings"] }>({
      arm, trap: "uniform_spend", scope, model, effort, maxTokens: 64000, schema: TRIVIAL_SCHEMA,
      prompt: `${TASK}\n\nAgency: ${s.owner}\n\n${mine.map((d) => `===== Document id: ${d.id} =====\n${d.text}`).join("\n\n")}`,
    });
    const answer: Answer = { scope, ok: r.data !== null, findings: r.data?.findings ?? [], call: r.call };
    done.set(scope, answer);
    appendFileSync(log, JSON.stringify(answer) + "\n");
    console.log(`  ${arm} ${done.size}/${input.scopes.length} ${scope}: ${answer.ok ? `${answer.findings.length} flagged` : `no answer (${r.call.stopReason})`}`);
  });
  const flagged: Record<string, string> = {};
  for (const a of done.values()) for (const f of a.findings) flagged[`${f.flagged_doc}-${f.flagged_line}`] = `${f.best_doc}-${f.best_line}`;
  const answers = [...done.values()];
  return { arm, flagged, wallMs: performance.now() - t0, failures: answers.filter((a) => !a.ok).map((a) => a.scope), calls: answers.map((a) => a.call) };
}

// ---------------------------------------------------------------------------------------------

console.log(`${input.docs.length} orders in ${input.scopes.length} agency-station scopes`);
for (const arm of arms) {
  console.log(`running ${arm} ...`);
  const result =
    arm === "pattern" ? pattern()
    : arm === "proposed" ? await proposed()
    : arm === "haiku-only" ? await alone(arm, HAIKU, "low")
    : await alone(arm, OPUS, "high");
  writeFileSync(path.join(outDir, `${run}-${arm}.json`), JSON.stringify({ ...result, rateLimited }, null, 1));
  const cost = result.calls.reduce((a, c) => a + c.costUsd, 0);
  console.log(`  ${arm}: flagged ${Object.keys(result.flagged).length} | no answer ${result.failures.length} | cost $${cost.toFixed(2)} | wall ${(result.wallMs / 1000).toFixed(0)}s | ${result.calls.length} model calls | 429s so far ${rateLimited}`);
}
