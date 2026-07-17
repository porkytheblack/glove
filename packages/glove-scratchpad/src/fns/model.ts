/**
 * Model-backed functions — delegate a scoped sub-task to another model, as a
 * plain callable in the catalog.
 *
 * The scratchpad/REPL surfaces let a planner compute over its capabilities in a
 * sandbox. Often the cheapest step is not a data operation but a *judgement* —
 * classify this text, draft this reply, extract these fields — and the planner
 * does not need to be the one that makes it. {@link defineModelFn} wraps any
 * {@link ModelAdapter} as a {@link ToolFn} the planner calls inside its program:
 * the sub-model sees the input, returns a value, and (crucially) the input never
 * has to enter the planner's own context. That makes delegation both an economy
 * (a cheap model does the per-item work) and a context/privacy boundary (the
 * documents stay with the delegate).
 *
 * This is a general ergonomics primitive, not a security feature: a classifier
 * is a model fn with a YES/NO parse, a drafter returns text, an extractor parses
 * JSON. Pair it with an optional {@link ModelFnUsage} accumulator to measure the
 * delegated cost.
 */
import type { ModelAdapter } from "glove-core";
import { z } from "zod";
import { defineFn, type ToolFn, type ToolFnContext } from "./catalog";

/** A Zod object schema, duck-typed so we accept any Zod v4 instance. */
type AnyZodObject = z.ZodObject<any, any>;

/** Rolling token/call tally for the delegated model, for cost accounting. */
export interface ModelFnUsage {
  calls: number;
  tokensIn: number;
  tokensOut: number;
}

export function newModelFnUsage(): ModelFnUsage {
  return { calls: 0, tokensIn: 0, tokensOut: 0 };
}

export interface DefineModelFnSpec<S extends AnyZodObject = AnyZodObject> {
  /** Callable name — `[A-Za-z_][A-Za-z0-9_]*`. */
  name: string;
  description?: string;
  /** The model that answers each call. Its own `maxTokens` governs the reply length. */
  model: ModelAdapter;
  /** Instruction sent as the delegate's system prompt (set before each call). */
  system?: string;
  /** Input schema (Zod or raw JSON Schema). Default: `{ text: string }`. */
  input?: Record<string, unknown> | S;
  /** Build the delegate's user message from the args. Default: `args.text`, else JSON. */
  prompt?: (args: Record<string, unknown>) => string;
  /** Parse the delegate's reply text into the return value. Default: trimmed text. */
  parse?: (text: string, args: Record<string, unknown>) => unknown;
  /** Informational effect hint. A pure judgement is read-only (the default). */
  readOnlyHint?: boolean;
  /** Optional accumulator — each call adds its tokens here for cost measurement. */
  usage?: ModelFnUsage;
}

const noNotify = (async () => {}) as unknown as Parameters<ModelAdapter["prompt"]>[1];

/**
 * Wrap a {@link ModelAdapter} as a delegated-judgement {@link ToolFn}. The
 * planner calls it inside its program — `classify({ text })` — and only the
 * parsed return value crosses back; the input stays with the delegate.
 *
 * NOTE the adapter is stateful (`setSystemPrompt`), so a single model fn should
 * be driven sequentially (the REPL surfaces fire calls one at a time within a
 * program, so this holds); give concurrent delegates distinct adapters.
 */
export function defineModelFn(spec: DefineModelFnSpec): ToolFn {
  const buildPrompt =
    spec.prompt ?? ((a: Record<string, unknown>) => (typeof a.text === "string" ? a.text : JSON.stringify(a)));
  const parse = spec.parse ?? ((t: string) => t.trim());
  const input = spec.input ?? z.object({ text: z.string() });
  return defineFn({
    name: spec.name,
    description: spec.description,
    readOnlyHint: spec.readOnlyHint ?? true,
    input,
    async handler(args: Record<string, unknown>, ctx: ToolFnContext) {
      if (spec.system !== undefined) spec.model.setSystemPrompt(spec.system);
      const res = await spec.model.prompt(
        { messages: [{ sender: "user", text: buildPrompt(args) }] },
        noNotify,
        ctx?.signal,
      );
      const text = res.messages?.[0]?.text ?? "";
      if (spec.usage) {
        spec.usage.calls += 1;
        spec.usage.tokensIn += res.tokens_in ?? 0;
        spec.usage.tokensOut += res.tokens_out ?? 0;
      }
      return parse(text, args);
    },
  });
}
