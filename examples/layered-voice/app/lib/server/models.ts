// Per-role model adapters. Mirrors the paper's split: the front agent and the
// addressing-monitor run a small/fast tier; the worker runs the heavy tier.
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

export type Role = "front" | "monitor" | "worker";

// Default: affordable open models on OpenRouter (single OPENROUTER_API_KEY).
export const PROVIDER: Provider = (process.env.VOICE_PROVIDER as Provider) || "openrouter";

// Role → model, per provider. Front is the conversational/spoken persona;
// the monitor makes a single addressing judgment; the worker does the heavy,
// tool-driven database work.
const DEFAULTS: Partial<Record<Provider, Record<Role, string>>> = {
  openrouter: {
    front: "openai/gpt-oss-120b", // fast, streams token-by-token into TTS
    monitor: "openai/gpt-oss-120b", // quick addressing judgment
    worker: "minimax/minimax-m2.5", // heavy lifting + a ton of tool calls
  },
  anthropic: {
    front: "claude-haiku-4-5-20251001",
    monitor: "claude-haiku-4-5-20251001",
    worker: "claude-sonnet-4-20250514",
  },
};

// Only the worker runs reasoning: it's a reasoning-capable model that does a lot
// of tool calling (and wants its trace echoed on tool turns). The front and
// monitor stay reasoning-off so the front streams to TTS with minimal latency
// and the monitor returns a verdict fast.
const REASONING: Record<Role, boolean> = { front: false, monitor: false, worker: true };

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
