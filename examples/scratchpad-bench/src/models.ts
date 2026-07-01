/**
 * The model roster — cheapest tool-capable slug per family the user named,
 * taken from the live OpenRouter catalogue. Prices are USD per 1M tokens
 * (prompt / completion) at authoring time, used only for a rough cost estimate.
 */
export interface BenchModel {
  key: string;
  model: string;
  label: string;
  priceIn: number;
  priceOut: number;
}

export const MODELS: BenchModel[] = [
  { key: "deepseek", model: "deepseek/deepseek-v3.2", label: "DeepSeek V3.2", priceIn: 0.229, priceOut: 0.343 },
  { key: "glm", model: "z-ai/glm-4.7-flash", label: "GLM 4.7 Flash", priceIn: 0.06, priceOut: 0.4 },
  { key: "xiaomi", model: "xiaomi/mimo-v2.5", label: "Xiaomi MiMo v2.5", priceIn: 0.105, priceOut: 0.28 },
  { key: "minimax", model: "minimax/minimax-m2.5", label: "MiniMax M2.5", priceIn: 0.12, priceOut: 0.48 },
  { key: "kimi", model: "moonshotai/kimi-k2.5", label: "Kimi K2.5", priceIn: 0.375, priceOut: 2.025 },
];

export function modelByKey(key: string): BenchModel | undefined {
  return MODELS.find((m) => m.key === key);
}

export function estimateCost(m: BenchModel, tokensIn: number, tokensOut: number): number {
  return (tokensIn / 1e6) * m.priceIn + (tokensOut / 1e6) * m.priceOut;
}
