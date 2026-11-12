import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { DemoBarista } from "./demo-model.js";

// A voice agent wants a fast model. Set COFFEE_MODEL_PROVIDER and
// COFFEE_MODEL to choose one, or just set a key and take the default for it.
// With no key (or COFFEE_DEMO=1) a scripted barista answers, so the project
// runs and `pnpm verify` passes offline.

const DEFAULTS: ReadonlyArray<{ provider: string; envVar: string; model: string }> = [
  { provider: "anthropic", envVar: "ANTHROPIC_API_KEY", model: "claude-haiku-5-5" },
  { provider: "openai", envVar: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
  { provider: "openrouter", envVar: "OPENROUTER_API_KEY", model: "openai/gpt-4.1-mini" },
  { provider: "gemini", envVar: "GEMINI_API_KEY", model: "gemini-3.6-flash" },
];

export interface ModelChoice {
  readonly provider: string;
  readonly model: string;
  readonly demo: boolean;
}

export function modelChoice(env: NodeJS.ProcessEnv = process.env): ModelChoice {
  const demo = { provider: "demo", model: "scripted barista", demo: true };
  if (env.COFFEE_DEMO === "1") return demo;
  if (env.COFFEE_MODEL_PROVIDER) {
    const preset = DEFAULTS.find((d) => d.provider === env.COFFEE_MODEL_PROVIDER);
    return { provider: env.COFFEE_MODEL_PROVIDER, model: env.COFFEE_MODEL ?? preset?.model ?? "", demo: false };
  }
  const found = DEFAULTS.find((d) => env[d.envVar]);
  return found ? { provider: found.provider, model: env.COFFEE_MODEL ?? found.model, demo: false } : demo;
}

export function baristaModel(): ModelAdapter {
  const choice = modelChoice();
  if (choice.demo) return new DemoBarista();
  return createAdapter({
    provider: choice.provider,
    ...(choice.model ? { model: choice.model } : {}),
    stream: true,
    maxTokens: 1024,
  });
}
