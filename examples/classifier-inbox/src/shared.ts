import { createAdapter } from "glove-core/models/providers";
import type { ModelAdapter } from "glove-core";

/** Model used for the agent and the LLM classifier. Override with BENCH_MODEL. */
export const AGENT_MODEL = process.env.BENCH_MODEL ?? "openai/gpt-4.1-mini";

/** Jev charges per input token only: $0.042 per million. */
export const JEV_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

export function openrouter(maxTokens = 2048): ModelAdapter {
  return createAdapter({ provider: "openrouter", model: AGENT_MODEL, stream: false, maxTokens });
}

/** Per-token prices for AGENT_MODEL from OpenRouter's public model list. */
export async function openrouterPricing(): Promise<{ prompt: number; completion: number }> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  const body = (await res.json()) as { data: Array<{ id: string; pricing: { prompt: string; completion: string } }> };
  const m = body.data.find((d) => d.id === AGENT_MODEL);
  if (!m) throw new Error(`no OpenRouter pricing for ${AGENT_MODEL}`);
  return { prompt: Number(m.pricing.prompt), completion: Number(m.pricing.completion) };
}

/** Hard stop for the bench: every paid call adds to this, and crossing the cap throws. */
export class SpendGuard {
  total = 0;
  constructor(readonly capUsd: number) {}
  add(usd: number, what: string) {
    this.total += usd;
    if (this.total > this.capUsd) throw new Error(`spend cap $${this.capUsd} exceeded at ${what} ($${this.total.toFixed(4)})`);
  }
}
