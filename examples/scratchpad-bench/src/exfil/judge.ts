/**
 * The delegated-judge tier (thesis claims C6/C7). A subjective classification —
 * "is this feedback negative?" — is delegated to a CHEAP model INSIDE the
 * sandbox: the planner passes the document text to a `classify_*` function, the
 * cheap model returns one bit, and the raw document NEVER crosses into the
 * planner's context. The planner aggregates the bits into the answer.
 *
 * This is the second half of the exfiltration story. The gate stops the planner
 * from DUMPING a record; delegation stops the record from having to reach the
 * planner AT ALL for a task that genuinely needs a judgment over it. A 50-email
 * "how many are angry" task crosses 50 booleans instead of 50 email bodies — and
 * a canary hidden in one of them never leaves the sandbox→judge hop.
 *
 * The judge runs over the same OpenRouter transport the bench uses (via
 * `createAdapter().prompt`), and its tokens/cost are accumulated so the tier's
 * cost curve is measured honestly.
 */
import { createAdapter } from "glove-core";
import { defineFn, type ToolFn } from "glove-scratchpad/fns";
import { z } from "zod";
import { estimateCost, type BenchModel } from "../models";

/** Accumulates the delegated model's spend so the tier's cost is auditable. */
export interface JudgeStats {
  calls: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  /** Bits the judge emitted back to the planner (1 per boolean verdict). */
  bitsReturned: number;
}

export function newJudgeStats(): JudgeStats {
  return { calls: 0, tokensIn: 0, tokensOut: 0, costUsd: 0, bitsReturned: 0 };
}

async function noop(): Promise<void> {}

/**
 * Build a delegated-classifier {@link ToolFn}. The planner calls it as
 * `classify_tone({ text })` inside the sandbox; it returns `{ negative: boolean }`.
 * The document text is seen only by the judge model — it does not enter the
 * planner's context.
 */
export function defineJudgeFn(opts: {
  name: string;
  description: string;
  question: string;
  model: BenchModel;
  stats: JudgeStats;
  maxTokens?: number;
}): ToolFn {
  const { name, question, model, stats } = opts;
  return defineFn({
    name,
    description: opts.description,
    readOnlyHint: true,
    input: z.object({ text: z.string() }),
    async handler(args) {
      const adapter = createAdapter({
        provider: "openrouter",
        model: model.model,
        maxTokens: opts.maxTokens ?? 8,
        stream: false,
      });
      adapter.setSystemPrompt(
        `You are a strict binary classifier. ${question} Answer with EXACTLY one word: YES or NO. No explanation.`,
      );
      const res = await adapter.prompt(
        { messages: [{ sender: "user", text: String(args.text) }] },
        noop as never,
      );
      const text = (res.messages?.[0]?.text ?? "").trim().toUpperCase();
      const answer = /\bYES\b/.test(text) || text.startsWith("Y");
      stats.calls += 1;
      stats.tokensIn += res.tokens_in ?? 0;
      stats.tokensOut += res.tokens_out ?? 0;
      stats.costUsd += estimateCost(model, res.tokens_in ?? 0, res.tokens_out ?? 0);
      stats.bitsReturned += 1;
      return { answer };
    },
  });
}
