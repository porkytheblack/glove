import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { s2sDrivenModel } from "glove-voice-s2s";
import { DemoModel, type DemoRole } from "./demo-model.js";

// Each layer gets the model its job needs. The interactor answers a person,
// so it has to be quick. Workers carry the heavy work and can take longer.
// Without ANTHROPIC_API_KEY every layer runs a scripted model, so the project
// works offline and `pnpm verify` needs no keys.

function scripted(): boolean {
  return process.env.LAYERED_DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
}

/** Layer 1: fast replies. */
export function interactorModel(): ModelAdapter {
  if (scripted()) return new DemoModel("interactor");
  return createAdapter({
    provider: "anthropic",
    model: process.env.INTERACTOR_MODEL ?? "claude-haiku-5-5",
    stream: true,
  });
}

/** Layer 2: careful work. */
export function workerModel(role: Exclude<DemoRole, "interactor">): ModelAdapter {
  if (scripted()) return new DemoModel(role);
  return createAdapter({
    provider: "anthropic",
    model: process.env.WORKER_MODEL ?? "claude-sonnet-5-5",
    stream: true,
  });
}

/** Layer 1 on a call: a speech-to-speech session drives the turns. */
export function callModel(): ModelAdapter {
  return s2sDrivenModel({ label: "assistant-call", provider: "openai", voice: "marin" });
}
