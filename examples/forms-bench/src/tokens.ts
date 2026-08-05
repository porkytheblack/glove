/**
 * Context accounting.
 *
 * Two different instruments, deliberately kept apart:
 *
 * - **Ground truth for totals** is whatever OpenRouter reports as
 *   `prompt_tokens`. Every model tokenises differently and only the provider
 *   knows what it actually charged for.
 * - **Attribution** — how much of that prompt the *forms surface* accounts for,
 *   split into tool schemas, the tier-0 line, and tool results — is measured
 *   with one fixed tokenizer (`o200k_base`) applied to the exact strings we
 *   injected. A single consistent ruler is what makes the split comparable
 *   across models; it is not a claim about any one model's billing.
 *
 * The number the design actually stands or falls on is the eager baseline:
 * what the same conversation would have cost if the whole form were inlined in
 * the system prompt instead of being pulled a tier at a time.
 */
import { encode } from "gpt-tokenizer/model/gpt-4o";
import type { CompiledForm } from "glove-memory/forms";
import { projectView } from "glove-memory/forms";
import type { FormInstance } from "glove-memory/forms";

export function countTokens(text: string): number {
  if (!text) return 0;
  return encode(text).length;
}

export interface ContextLedger {
  /** Model-reported, summed over every completion in the run. */
  promptTokens: number;
  completionTokens: number;
  /** Real spend, as reported by OpenRouter per call. Not an estimate. */
  cost: number;
  /** Completions issued — the multiplier on everything re-sent each call. */
  calls: number;

  /** Form tool schemas, counted once per completion call (they're re-sent). */
  toolSchemaTokens: number;
  /** The tier-0 standing line, counted once per completion call. */
  tier0Tokens: number;
  /**
   * Results from the tiered *read* verbs (`status`, `inspect`, `list`) —
   * cumulative, because they stay in the history and are re-sent. This is the
   * number the eager baseline is the alternative to.
   */
  readResultTokens: number;
  /** Results from the write verbs. Needed whether or not the surface is tiered. */
  writeResultTokens: number;

  /**
   * What an eager surface would have cost: the full form — every step, every
   * field, type and description — rendered once and re-sent on every call,
   * which is what putting it in the system prompt means.
   */
  eagerBaselineTokens: number;
}

export function emptyLedger(): ContextLedger {
  return {
    promptTokens: 0,
    completionTokens: 0,
    cost: 0,
    calls: 0,
    toolSchemaTokens: 0,
    tier0Tokens: 0,
    readResultTokens: 0,
    writeResultTokens: 0,
    eagerBaselineTokens: 0,
  };
}

/** Everything the forms subsystem put in front of the model. */
export function formSurfaceTokens(l: ContextLedger): number {
  return l.toolSchemaTokens + l.tier0Tokens + l.readResultTokens + l.writeResultTokens;
}

/**
 * What the model spent to *learn what to ask* under the tiered surface: the
 * standing line plus whatever it chose to pull. The eager baseline is the
 * like-for-like alternative — both are re-sent on every call, and the write
 * verbs and their results are common to either design, so they're excluded
 * from both sides.
 */
export function discoveryTokens(l: ContextLedger): number {
  return l.tier0Tokens + l.readResultTokens;
}

/**
 * Render the whole form the way a consumer would have to if there were no
 * tiers: one static block naming every field, its type, whether it's required,
 * and what a good answer looks like.
 *
 * This is the honest counterfactual. It is generated from the same compiled
 * form and the same projection the tiers use, so it can't be accused of being
 * a strawman padded to flatter the result.
 */
export function renderEagerForm(
  compiled: CompiledForm<any>,
  instance: FormInstance,
): string {
  const view = projectView(compiled, instance, { scope: "outline" });
  const lines: string[] = [
    `[form: ${compiled.id}] ${compiled.name} — ${compiled.description}`,
  ];
  if (compiled.conduct) lines.push(compiled.conduct);
  lines.push("");

  for (const step of view.steps ?? []) {
    lines.push(`## Step ${step.index}: ${step.title}${step.preview ? ` — ${step.preview}` : ""}`);
    const fields = view.fields.filter(
      (f) => compiled.fieldById.get(f.id)?.stepId === step.id,
    );
    for (const f of fields) {
      const bits = [
        `- ${f.id} (${f.label})`,
        `type: ${f.type}`,
        f.required ? "required" : "optional",
      ];
      if (f.description) bits.push(f.description);
      lines.push(bits.join(" · "));
    }
    lines.push("");
  }
  return lines.join("\n");
}
