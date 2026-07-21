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

export const PROVIDER: Provider = (process.env.VOICE_PROVIDER as Provider) || "anthropic";

// Sensible defaults only for Anthropic (small/fast front + monitor, heavy
// worker). For other providers we fall back to the provider's own default
// model unless a per-role env override is set.
const ANTHROPIC_DEFAULTS: Record<Role, string> = {
  front: "claude-haiku-4-5-20251001",
  monitor: "claude-haiku-4-5-20251001",
  worker: "claude-sonnet-4-20250514",
};

function modelFor(role: Role): string | undefined {
  const envKey = `${role.toUpperCase()}_MODEL`;
  const override = process.env[envKey];
  if (override) return override;
  if (PROVIDER === "anthropic") return ANTHROPIC_DEFAULTS[role];
  return undefined; // let createAdapter use the provider default
}

/** Front + worker are long-lived agents; each gets its own adapter instance. */
export function buildModel(role: Role, stream: boolean): ModelAdapter {
  return createAdapter({ provider: PROVIDER, model: modelFor(role), stream });
}
