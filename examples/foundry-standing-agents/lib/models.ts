import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { s2sDrivenModel } from "glove-voice-s2s";
import { DemoModel } from "./demo-model.js";
import { builderScript, dotScript } from "./demo-scripts.js";

// Without ANTHROPIC_API_KEY (or with DOTS_DEMO=1) the dot and the builder run
// scripted models, so `pnpm verify` and `pnpm dev` work offline. On Kuiper,
// ANTHROPIC_BASE_URL points the same adapter at the model gateway.

function scripted(): boolean {
  return process.env.DOTS_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

export function dotModel(): ModelAdapter {
  if (scripted()) return new DemoModel("dot", dotScript);
  return anthropic(process.env.DOT_MODEL ?? "claude-sonnet-5-5");
}

export function builderModel(): ModelAdapter {
  if (scripted()) return new DemoModel("builder", builderScript);
  return anthropic(process.env.BUILDER_MODEL ?? "claude-sonnet-5-5");
}

/** On a call, a speech-to-speech session drives the turns (OPENAI_API_KEY). */
export function callModel(): ModelAdapter {
  return s2sDrivenModel({ label: "dot-call", provider: "openai", voice: "marin" });
}

function anthropic(model: string): ModelAdapter {
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model, stream: true, ...(baseURL ? { baseURL } : {}) });
}
