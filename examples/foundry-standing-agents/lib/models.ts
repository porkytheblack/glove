import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { s2sDrivenModel } from "glove-voice-s2s";
import { DemoModel } from "./demo-model.js";
import { builderScript, dotScript } from "./demo-scripts.js";

// Without ANTHROPIC_API_KEY or MODELS_API_KEY (or with DOTS_DEMO=1) the dot and
// the builder run scripted models, so `pnpm verify` and `pnpm dev` work offline.
// On Kuiper, ANTHROPIC_BASE_URL points the same adapter at the model gateway; a
// model name with a slash (oprouter/anthropic/claude-sonnet-5.5) is the
// gateway's name for another provider key, called at MODELS_BASE_URL.

function scripted(): boolean {
  return process.env.DOTS_DEMO === "1" || !(process.env.ANTHROPIC_API_KEY || process.env.MODELS_API_KEY);
}

/** `person` is the dot's workspace; its connected mailbox is `${person}-gmail`. */
export function dotModel(person: string): ModelAdapter {
  if (scripted()) return new DemoModel("dot", (turn) => dotScript(person, turn));
  return model(process.env.DOT_MODEL ?? "claude-sonnet-5-5");
}

export function builderModel(): ModelAdapter {
  if (scripted()) return new DemoModel("builder", builderScript);
  return model(process.env.BUILDER_MODEL ?? "claude-sonnet-5-5");
}

/** On a call, a speech-to-speech session drives the turns (OPENAI_API_KEY). */
export function callModel(): ModelAdapter {
  return s2sDrivenModel({ label: "dot-call", provider: "openai", voice: "marin" });
}

function model(name: string): ModelAdapter {
  const gateway = process.env.MODELS_BASE_URL;
  if (gateway && name.includes("/")) {
    // Cache the prompt and tools, which repeat on every turn.
    return createAdapter({ provider: "openrouter", model: name, stream: true, cache: true, baseURL: gateway, apiKey: process.env.MODELS_API_KEY });
  }
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  return createAdapter({ provider: "anthropic", model: name, stream: true, ...(baseURL ? { baseURL } : {}) });
}
