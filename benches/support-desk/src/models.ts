/**
 * The model roster — split by ROLE, because the bench's whole question is whether
 * an expensive planner can hand its per-item judgements to a cheap one at par.
 *
 *   PLANNERS  — current state-of-the-art OPEN-WEIGHT models, cost-per-1M-output
 *               strictly under $5 (the study's ceiling). These author the
 *               triage workflow and orchestrate.
 *   DELEGATES — cheap, DIRECT (non-reasoning) models that answer a scoped
 *               classification in a couple of tokens. Reasoning models are a
 *               trap here: under a tiny output budget they spend it all on hidden
 *               thinking and return empty text (observed with glm-4.7-flash /
 *               minimax), so the delegate tier is instruct-tuned models only.
 *
 * Prices are USD per 1M tokens (prompt / completion) from the live OpenRouter
 * catalogue (July 2026), used for the cost estimate that is the point of the bench.
 */
export interface DeskModel {
  key: string;
  model: string;
  label: string;
  role: "planner" | "delegate" | "reference";
  priceIn: number;
  priceOut: number;
}

/** SOTA open-weight planners, all ≤ $5/M output. */
export const PLANNERS: DeskModel[] = [
  { key: "glm5", model: "z-ai/glm-5.2", label: "GLM-5.2", role: "planner", priceIn: 0.913, priceOut: 2.869 },
  { key: "kimi27", model: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code", role: "planner", priceIn: 0.75, priceOut: 3.5 },
  { key: "deepseek", model: "deepseek/deepseek-v4-pro", label: "DeepSeek V4 Pro", role: "planner", priceIn: 0.435, priceOut: 0.87 },
  { key: "minimax", model: "minimax/minimax-m3", label: "MiniMax M3", role: "planner", priceIn: 0.3, priceOut: 1.2 },
];

/** Cheap, direct delegates for the per-item judgements. */
export const DELEGATES: DeskModel[] = [
  { key: "dsflash", model: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", role: "delegate", priceIn: 0.098, priceOut: 0.196 },
  { key: "qwen30b", model: "qwen/qwen3-30b-a3b-instruct-2507", label: "Qwen3 30B A3B Instruct", role: "delegate", priceIn: 0.1, priceOut: 0.3 },
  { key: "qwencoder", model: "qwen/qwen3-coder-30b-a3b-instruct", label: "Qwen3 Coder 30B", role: "delegate", priceIn: 0.07, priceOut: 0.27 },
];

/** Over-budget frontier reference (the "aside from Kimi K3" carve-out). NOT a
 *  default; $15/M output blows past the ceiling and weights open only 2026-07-27. */
export const REFERENCE: DeskModel[] = [
  { key: "kimi3", model: "moonshotai/kimi-k3", label: "Kimi K3", role: "reference", priceIn: 3.0, priceOut: 15.0 },
];

export const ALL_MODELS: DeskModel[] = [...PLANNERS, ...DELEGATES, ...REFERENCE];

export function modelByKey(key: string): DeskModel | undefined {
  return ALL_MODELS.find((m) => m.key === key);
}

export function estimateCost(m: DeskModel, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * m.priceIn + (tokensOut / 1e6) * m.priceOut;
}
