/**
 * The delegated-judge tier (thesis claims C6/C7). A subjective classification —
 * "is this feedback negative?" — is delegated to a CHEAP model INSIDE the
 * sandbox: the planner passes the document text to a `classify_*` function, the
 * cheap model returns one bit, and the raw document NEVER crosses into the
 * planner's context. The planner aggregates the bits into the answer.
 *
 * This is the second half of the exfiltration story. The gate stops the planner
 * from DUMPING a record; delegation stops the record from having to reach the
 * planner AT ALL for a task that genuinely needs a judgment over it.
 *
 * It is a thin skin over the shipped {@link defineModelFn} primitive
 * (`glove-scratchpad/fns`): a YES/NO parse plus per-call cost accounting from the
 * primitive's usage accumulator.
 */
import { createAdapter } from "glove-core";
import { defineModelFn, newModelFnUsage, type ToolFn, type ModelFnUsage } from "glove-scratchpad/fns";
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

function sync(stats: JudgeStats, usage: ModelFnUsage, model: BenchModel): void {
  stats.calls = usage.calls;
  stats.tokensIn = usage.tokensIn;
  stats.tokensOut = usage.tokensOut;
  stats.costUsd = estimateCost(model, usage.tokensIn, usage.tokensOut);
  stats.bitsReturned = usage.calls;
}

/**
 * Build a delegated binary-classifier {@link ToolFn}. The planner calls it as
 * `classify_tone({ text })` inside the sandbox; it returns `{ answer: boolean }`.
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
  const usage = newModelFnUsage();
  const fn = defineModelFn({
    name: opts.name,
    description: opts.description,
    model: createAdapter({ provider: "openrouter", model: opts.model.model, maxTokens: opts.maxTokens ?? 8, stream: false }),
    system: `You are a strict binary classifier. ${opts.question} Answer with EXACTLY one word: YES or NO. No explanation.`,
    parse: (text) => {
      const t = text.trim().toUpperCase();
      return { answer: /\bYES\b/.test(t) || t.startsWith("Y") };
    },
    usage,
  });
  // Keep the JudgeStats view in sync with the primitive's usage after each call.
  const orig = fn.call.bind(fn);
  return {
    ...fn,
    async call(args, ctx) {
      const r = await orig(args, ctx);
      sync(opts.stats, usage, opts.model);
      return r;
    },
  };
}
