import type { ModelAdapter } from "glove-core";
import { createAdapter } from "glove-core/models/providers";
import { kuiper } from "./kuiper.js";

/** Whether a real model is configured; without one Muse runs its script. */
export function hasModelKey(): boolean {
  return Boolean(process.env.KUIPER_GATEWAY_KEY || process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
}

/**
 * A Claude model by Anthropic's name, such as claude-sonnet-5-5. With
 * OPENROUTER_API_KEY it goes through OpenRouter, which names it
 * anthropic/claude-sonnet-5.5 (a name with a slash is taken as OpenRouter's
 * own, so any model it serves works). Otherwise through Kuiper's gateway, or
 * Anthropic directly.
 */
export function claudeModel(name: string, options: { readonly stream?: boolean } = {}): ModelAdapter {
  if (process.env.OPENROUTER_API_KEY) {
    const model = name.includes("/") ? name : `anthropic/${name.replace(/-(\d+)-(\d+)$/, "-$1.$2")}`;
    return createAdapter({ provider: "openrouter", model, ...options });
  }
  const gateway = kuiper();
  // On Kuiper, a name with a slash is the gateway's name for another provider
  // key (oprouter/anthropic/claude-sonnet-5.5), served over Chat Completions.
  if (gateway && name.includes("/")) return createAdapter({ provider: "openrouter", model: name, cache: true, ...options, ...gateway.models.glove("openrouter") });
  return createAdapter({ provider: "anthropic", model: name, ...options, ...(gateway ? gateway.models.glove("anthropic") : {}) });
}
