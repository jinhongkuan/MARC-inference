/** `marc bench` scores an engine; `marc dump` writes a sample corpus to disk for inspection. */

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { formatTable, score } from "./bench.ts";
import { ENGINES } from "./engines.ts";
import type { DocumentKind } from "./schema.ts";
import { buildWorld, render } from "./world/index.ts";

const USAGE = `usage: marc <command> [options]

commands:
  bench [--engine NAME] [--seeds N [N ...]]   score an engine against hidden worlds (defaults: baseline; seeds 1 2 3)
  dump [--seed N] [--out DIR]                  write one world's documents (and its hidden truth) to disk (defaults: 1; sample)`;

const EXTENSION: Readonly<Record<DocumentKind, string>> = { invoice: "txt", pricing_sheet: "txt", gl_export: "csv" };

class UsageError extends Error {}

export function main(argv: readonly string[]): void {
  const [command, ...rest] = argv;
  if (command === "-h" || command === "--help") {
    console.log(USAGE);
    return;
  }
  if (command === undefined) throw new UsageError("a command is required");
  const options = parseOptions(rest);
  if (command === "bench") {
    allowOnly(options, ["engine", "seeds"]);
    const name = single(options, "engine") ?? "baseline";
    const engine = ENGINES[name];
    if (!engine) throw new UsageError(`unknown engine '${name}' (choose from ${Object.keys(ENGINES).sort().join(", ")})`);
    const seeds = (options.get("seeds") ?? ["1", "2", "3"]).map(integer);
    if (seeds.length === 0) throw new UsageError("--seeds needs at least one value");
    console.log(`engine: ${engine.name}\n`);
    console.log(formatTable(seeds.map((seed) => score(engine, seed))));
  } else if (command === "dump") {
    allowOnly(options, ["seed", "out"]);
    dump(integer(single(options, "seed") ?? "1"), single(options, "out") ?? "sample");
  } else {
    throw new UsageError(`unknown command '${command}'`);
  }
}

function dump(seed: number, out: string): void {
  const world = buildWorld(seed);
  const { corpus } = render(world, seed);
  const made = new Set<string>();
  for (const doc of corpus.documents) {
    const dir = join(out, doc.kind);
    if (!made.has(dir)) mkdirSync(dir, { recursive: true });
    made.add(dir);
    writeFileSync(join(dir, `${doc.id}.${EXTENSION[doc.kind]}`), doc.lines.join("\n") + "\n");
  }
  const hidden = join(out, "_hidden");
  mkdirSync(hidden, { recursive: true });
  writeFileSync(join(hidden, "world.json"), JSON.stringify(world, null, 2) + "\n");
  const root = join(out).replace(/(?<=.)\/+$/, "");
  console.log(`wrote ${corpus.documents.length} documents to ${root}/ (hidden truth in ${hidden}/world.json)`);
}

/** `--flag v1 v2 --other v3` -> {flag: [v1, v2], other: [v3]} */
function parseOptions(args: readonly string[]): Map<string, string[]> {
  const options = new Map<string, string[]>();
  let current: string[] | undefined;
  for (const arg of args) {
    if (arg.startsWith("--")) {
      current = [];
      options.set(arg.slice(2), current);
    } else if (current) {
      current.push(arg);
    } else {
      throw new UsageError(`unexpected argument '${arg}'`);
    }
  }
  return options;
}

function allowOnly(options: ReadonlyMap<string, string[]>, allowed: readonly string[]): void {
  for (const name of options.keys()) {
    if (!allowed.includes(name)) throw new UsageError(`unknown option --${name}`);
  }
}

function single(options: ReadonlyMap<string, string[]>, name: string): string | undefined {
  const values = options.get(name);
  if (values === undefined) return undefined;
  if (values.length !== 1) throw new UsageError(`--${name} takes exactly one value`);
  return values[0];
}

function integer(text: string): number {
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(Number(text))) throw new UsageError(`not an integer: '${text}'`);
  return Number(text);
}

function isEntryPoint(): boolean {
  const script = process.argv[1];
  if (script === undefined) return false;
  try {
    return realpathSync(script) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    console.error(`${USAGE}\n\nmarc: error: ${error.message}`);
    process.exitCode = 2;
  }
}
