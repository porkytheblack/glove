/**
 * The model roster — tool-capable OpenRouter slugs spanning current OSS frontier
 * down to cheap/weak models, to test how far the scratchpad+parity work lets a
 * dumb model punch above its weight. Prices are USD per 1M tokens (prompt /
 * completion) from the live catalogue, used only for a rough cost estimate.
 */
export interface BenchModel {
  key: string;
  model: string;
  label: string;
  /** frontier = current OSS SOTA · mid = cheap-but-capable · weak = cheapest */
  tier: "frontier" | "mid" | "weak";
  priceIn: number;
  priceOut: number;
}

export const MODELS: BenchModel[] = [
  // ── current OSS frontier (the newest of each family) ──
  { key: "kimi27", model: "moonshotai/kimi-k2.7-code", label: "Kimi K2.7 Code", tier: "frontier", priceIn: 0.74, priceOut: 3.5 },
  { key: "glm5", model: "z-ai/glm-5", label: "GLM-5", tier: "frontier", priceIn: 0.6, priceOut: 1.92 },
  { key: "minimax3", model: "minimax/minimax-m3", label: "MiniMax M3", tier: "frontier", priceIn: 0.3, priceOut: 1.2 },
  { key: "deepseek", model: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", tier: "frontier", priceIn: 0.229, priceOut: 0.343 },
  // ── mid: cheap but capable (previous-gen / flash) ──
  { key: "kimi", model: "moonshotai/kimi-k2.5", label: "Kimi K2.5", tier: "mid", priceIn: 0.375, priceOut: 2.025 },
  { key: "minimax", model: "minimax/minimax-m2.5", label: "MiniMax M2.5", tier: "mid", priceIn: 0.12, priceOut: 0.48 },
  { key: "xiaomi", model: "xiaomi/mimo-v2.5", label: "Xiaomi MiMo v2.5", tier: "mid", priceIn: 0.105, priceOut: 0.28 },
  { key: "glm", model: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash", tier: "mid", priceIn: 0.06, priceOut: 0.4 },
  // ── weak: the cheapest tool-capable models — the real stress test ──
  { key: "dsflash", model: "deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "weak", priceIn: 0.09, priceOut: 0.18 },
  { key: "qwen30b", model: "qwen/qwen3-30b-a3b-instruct-2507", label: "Qwen3 30B A3B", tier: "weak", priceIn: 0.05, priceOut: 0.19 },
  { key: "qwen8b", model: "qwen/qwen3-8b", label: "Qwen3 8B", tier: "weak", priceIn: 0.12, priceOut: 0.45 },
];

export function modelByKey(key: string): BenchModel | undefined {
  return MODELS.find((m) => m.key === key);
}

export function estimateCost(m: BenchModel, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * m.priceIn + (tokensOut / 1e6) * m.priceOut;
}
