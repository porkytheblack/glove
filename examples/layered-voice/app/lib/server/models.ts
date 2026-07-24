// Per-role model adapters. Mirrors the paper's split: the front agent runs a
// small/fast tier; the worker runs the heavy tier.
// Provider + per-role model are overridable via env (see .env.example).

import { createAdapter, type ModelAdapter, type OpenAICompatReasoningOptions } from "glove-core";

type Provider =
  | "anthropic"
  | "openai"
  | "openrouter"
  | "gemini"
  | "minimax"
  | "kimi"
  | "glm"
  | "mimo"
  | "ollama"
  | "lmstudio"
  | "bedrock";

export type Role = "front" | "worker";

// Default: affordable open models on OpenRouter (single OPENROUTER_API_KEY).
export const PROVIDER: Provider = (process.env.VOICE_PROVIDER as Provider) || "openrouter";

// Role → model, per provider. Front is the spoken persona (it also decides for
// itself whether a line was addressed to it); the worker does the heavy,
// tool-driven database work.
const DEFAULTS: Partial<Record<Provider, Record<Role, string>>> = {
  openrouter: {
    front: "openai/gpt-oss-120b", // fast; its <speech> spans stream into TTS
    worker: "minimax/minimax-m2.5", // heavy lifting + a ton of tool calls
  },
  anthropic: {
    front: "claude-haiku-4-5-20251001",
    worker: "claude-sonnet-4-20250514",
  },
};

// Reasoning per role. The worker is a reasoning model doing heavy tool work
// (capture + echo its trace). The front should reason as little as possible:
// thinking models (gpt-oss default-medium, qwen3-*-thinking) burn seconds of
// silent reasoning before the first visible token — pure dead air for a voice
// agent. FRONT_REASONING picks the strategy:
//   "low"  (default) — reasoning: { effort: "low" }; widely supported, keeps
//                      the thinking phase to a few hundred ms.
//   "budget:<n>"     — reasoning: { max_tokens: n }; a HARD thinking cap.
//                      More reliable than effort for models whose upstream
//                      ignores it (e.g. qwen3 thinking variants — OpenRouter
//                      maps max_tokens to the provider's thinking budget).
//                      Try FRONT_REASONING=budget:256 for a snappy front.
//   "off"            — reasoning: { enabled: false }; full disable where the
//                      provider allows it, but some REJECT it for reasoning
//                      models (the request fails outright).
//   "none"           — send no reasoning param at all (provider default).
// Anthropic ignores the field entirely.
//
// FRONT_PROVIDER_SORT ("throughput" | "latency" | "price" | "off") sets
// OpenRouter provider routing — WHO serves the model matters more for latency
// than the model itself. Measured on gpt-oss-120b with an identical prompt:
// default routing 979ms TTFT (Google/Mancer); sort:"throughput" 160ms
// (Cerebras) — a 6x difference on the exact same weights. Tool calls verified
// streaming correctly through the throughput route. Default: "throughput" on
// OpenRouter; "off" disables.
export function frontProviderSort(): string | undefined {
  const v = process.env.FRONT_PROVIDER_SORT;
  if (v === "off") return undefined;
  if (v) return v;
  return PROVIDER === "openrouter" ? "throughput" : undefined;
}

function frontReasoning(): boolean | OpenAICompatReasoningOptions {
  const mode = process.env.FRONT_REASONING ?? "low";
  const sort = frontProviderSort();
  const extra = sort ? { extraBody: { provider: { sort } } } : {};
  if (mode === "none") {
    // No reasoning fields at all — but still carry provider routing if set
    // (an options object with neither effort nor reasoningObject sends no
    // reasoning params on the wire).
    return sort ? { echo: false, ...extra } : false;
  }
  if (mode === "off") return { reasoningObject: { enabled: false }, echo: false, ...extra };
  const budget = /^budget:(\d+)$/.exec(mode);
  if (budget) {
    return { reasoningObject: { max_tokens: Number(budget[1]) }, echo: false, ...extra };
  }
  return { reasoningObject: { effort: "low" }, echo: false, ...extra };
}

const REASONING: Record<Role, boolean | OpenAICompatReasoningOptions> = {
  front: frontReasoning(),
  worker: true,
};

export function modelFor(role: Role): string | undefined {
  const override = process.env[`${role.toUpperCase()}_MODEL`];
  if (override) return override;
  return DEFAULTS[PROVIDER]?.[role]; // undefined → createAdapter uses provider default
}

/**
 * Each agent gets its own adapter instance (adapters carry a system prompt).
 * `modelOverride` beats env + defaults — used by per-session model selection
 * (the eval runner A/B-tests front models without a server restart).
 */
export function buildModel(role: Role, stream: boolean, modelOverride?: string): ModelAdapter {
  return createAdapter({
    provider: PROVIDER,
    model: modelOverride || modelFor(role),
    stream,
    ...(REASONING[role] ? { reasoning: REASONING[role] } : {}),
  });
}
