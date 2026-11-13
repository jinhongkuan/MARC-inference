/** Calls to the Anthropic API, each recorded with its tokens, cost and latency. */

import Anthropic from "@anthropic-ai/sdk";

export const OPUS = "claude-opus-5-5";
export const HAIKU = "claude-haiku-5-5";
export const FABLE = "claude-fable-5-2";

/** $ per million tokens: Anthropic first-party prices for prompts under 100K tokens (Haiku's tier break). */
const PRICE: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  [OPUS]: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  [HAIKU]: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  [FABLE]: { input: 8, output: 40, cacheRead: 0.2, cacheWrite: 10 },
};

export interface Call {
  readonly arm: string;
  readonly trap: string;
  readonly scope: string;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly thinkingTokens: number;
  readonly costUsd: number;
  readonly latencyMs: number;
  readonly stopReason: string | null;
}

export const ledger: Call[] = [];
export const spent = () => ledger.reduce((s, c) => s + c.costUsd, 0);

let client: Anthropic | undefined;
/** HTTP 429 responses seen, including ones the SDK retried successfully. */
export let rateLimited = 0;
const countingFetch: typeof fetch = async (url, init) => {
  const r = await fetch(url, init);
  if (r.status === 429) rateLimited++;
  return r;
};
const budget = Number(process.env.PILOT_BUDGET_USD ?? 25);

export interface Ask {
  readonly arm: string;
  readonly trap: string;
  readonly scope: string;
  readonly model: string;
  readonly effort: "low" | "medium" | "high" | "xhigh" | "max";
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
  readonly maxTokens: number;
}

/** One request with a JSON-schema answer. Returns null data when the model stopped early or refused. */
export async function askJson<T>(ask: Ask): Promise<{ data: T | null; text: string; call: Call }> {
  if (spent() > budget) throw new Error(`budget of $${budget} spent; stopping`);
  client ??= new Anthropic({ maxRetries: Number(process.env.PILOT_RETRIES ?? 8), fetch: countingFetch });
  const t0 = performance.now();
  let msg: Anthropic.Message;
  try {
    msg = await client.messages
      .stream({
        model: ask.model,
        max_tokens: ask.maxTokens,
        output_config: { effort: ask.effort, format: { type: "json_schema", schema: ask.schema } },
        messages: [{ role: "user", content: ask.prompt }],
      })
      .finalMessage();
  } catch (error) {
    // A call that still fails after every retry is recorded and scored as no answer; the run goes on.
    const call: Call = {
      arm: ask.arm, trap: ask.trap, scope: ask.scope, model: ask.model, inputTokens: 0, outputTokens: 0, thinkingTokens: 0,
      costUsd: 0, latencyMs: performance.now() - t0, stopReason: `error: ${error instanceof Anthropic.APIError ? error.status : "network"}`,
    };
    ledger.push(call);
    return { data: null, text: "", call };
  }
  const latencyMs = performance.now() - t0;
  const u = msg.usage;
  let p = PRICE[ask.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  // Haiku 5.5 bills prompts over 100K tokens at $0.50 / $2.50 per million.
  if (ask.model === HAIKU && u.input_tokens > 100_000) p = { ...p, input: 0.5, output: 2.5 };
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  const call: Call = {
    arm: ask.arm,
    trap: ask.trap,
    scope: ask.scope,
    model: ask.model,
    inputTokens: u.input_tokens + cacheRead + cacheWrite,
    outputTokens: u.output_tokens,
    thinkingTokens: u.output_tokens_details?.thinking_tokens ?? 0,
    costUsd:
      (u.input_tokens * p.input + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite + u.output_tokens * p.output) / 1e6,
    latencyMs,
    stopReason: msg.stop_reason,
  };
  ledger.push(call);
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  let data: T | null = null;
  if (msg.stop_reason === "end_turn") {
    try {
      data = JSON.parse(text) as T;
    } catch {
      data = null;
    }
  }
  return { data, text, call };
}

/** Runs `f` over `items` with at most `n` in flight, keeping input order. */
export async function pool<T, R>(items: readonly T[], n: number, f: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await f(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}
