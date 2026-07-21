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
// (capture + echo its trace). The front must NOT reason: gpt-oss-120b runs
// medium reasoning BY DEFAULT on OpenRouter — several seconds of silent
// thinking before the first visible token, which is pure dead air for a voice
// agent. Sending an explicit `reasoning: { enabled: false }` turns it off
// (OpenRouter maps it to the lowest effort where full disable isn't
// supported). Anthropic ignores the field entirely.
const REASONING: Record<Role, boolean | OpenAICompatReasoningOptions> = {
  front: { reasoningObject: { enabled: false }, echo: false },
  worker: true,
};

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
    ...(REASONING[role] ? { reasoning: REASONING[role] } : {}),
  });
}
