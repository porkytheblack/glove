// Per-role model adapters. Mirrors the paper's split: the front agent runs a
// small/fast tier; the worker runs the heavy tier.
// Provider + per-role model are overridable via env (see .env.example).

import { createAdapter, type ModelAdapter } from "glove-core";

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

// Only the worker runs reasoning: it's a reasoning-capable model that does a lot
// of tool calling (and wants its trace echoed on tool turns). The front stays
// reasoning-off so its speech streams to TTS with minimal latency.
const REASONING: Record<Role, boolean> = { front: false, worker: true };

function modelFor(role: Role): string | undefined {
  const override = process.env[`${role.toUpperCase()}_MODEL`];
  if (override) return override;
  return DEFAULTS[PROVIDER]?.[role]; // undefined → createAdapter uses provider default
}

/** Each agent gets its own adapter instance (adapters carry a system prompt). */
export function buildModel(role: Role, stream: boolean): ModelAdapter {
  return createAdapter({
    provider: PROVIDER,
    model: modelFor(role),
    stream,
    ...(REASONING[role] ? { reasoning: true } : {}),
  });
}
