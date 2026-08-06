import type { ContentPart, GloveFoldArgs, Message, ModelPromptResult } from "glove-core";
import type { ContextAdapter } from "../../context/adapter";
import { selectFoldArgs, type MemoryToolOptions } from "../selection";
import { buildContextGetTool } from "./get";
import { buildContextSetTool } from "./set";
import { buildContextUpdateTool } from "./update";
import { buildContextUnsetTool } from "./unset";

export {
  buildContextGetTool,
  buildContextSetTool,
  buildContextUpdateTool,
  buildContextUnsetTool,
};

/**
 * Tool surface for context — a single registration, no reader/curator split.
 * The conversational agent gets read AND write tools because users naturally
 * instruct the agent to update their own context ("remember that I prefer X").
 */
export function buildContextTools(adapter: ContextAdapter): Array<GloveFoldArgs<any>> {
  return [
    buildContextGetTool(adapter),
    buildContextSetTool(adapter),
    buildContextUpdateTool(adapter),
    buildContextUnsetTool(adapter),
  ];
}

/**
 * Minimal interface the `useContext` helper relies on — `fold` for tool
 * registration plus the system-prompt accessors so we can wrap
 * `processRequest` to inject the rendered context block on every turn.
 */
export interface ContextEnableTarget {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message>;
}

/**
 * Attach the context tool surface to a Glove and wire system-prompt injection.
 *
 * 1. Folds `glove_context_get`, `glove_context_set`, `glove_context_update`,
 *    `glove_context_unset` so the agent can read and modify context on user
 *    instruction.
 *
 * 2. Wraps `processRequest` so each turn:
 *    - calls `adapter.render()` to materialise pinned entries as a markdown
 *      block,
 *    - composes `<base systemPrompt>` + `\n\n` + `<rendered context>`,
 *    - calls `setSystemPrompt(...)` with the composed string before the
 *      agent loop runs,
 *    - then delegates to the original `processRequest`.
 *
 *    The injection ordering matters: pinned context goes **after** the
 *    developer's system prompt — developer prompt sets agent character and
 *    guardrails; user context modifies engagement for this specific user.
 *    Putting user context first would let user preferences shadow developer
 *    guardrails — wrong precedence.
 *
 *    Re-rendering happens every turn, so external updates the user made
 *    between turns are reflected immediately.
 *
 * Multiple `useContext` calls on the same Glove will stack — each call
 * captures the current base prompt, so calling it twice with different
 * adapters will inject both blocks. Most consumers call it once.
 *
 * `options.tools` narrows the folded surface without touching the injection
 * wrapper — `{ tools: { deny: ["unset"] } }` gives an agent that can add to
 * and revise context but never clear it; `{ tools: { allow: ["get"] } }`
 * makes context read-only while the user's own UI does the writing.
 */
export function useContext<G extends ContextEnableTarget>(
  glove: G,
  adapter: ContextAdapter,
  options?: MemoryToolOptions,
): G {
  for (const tool of selectFoldArgs(buildContextTools(adapter), options?.tools)) {
    glove.fold(tool);
  }

  // Snapshot the developer-supplied system prompt at registration time. The
  // agent's `setSystemPrompt` overwrites the live prompt, so we re-derive
  // the base on each turn from this snapshot rather than reading the
  // current prompt (which would include the previous turn's injection).
  const basePrompt = glove.getSystemPrompt();
  const originalProcessRequest = glove.processRequest.bind(glove);

  glove.processRequest = async function wrappedProcessRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message> {
    const rendered = await adapter.render();
    const composed =
      rendered && rendered.length > 0
        ? `${basePrompt}\n\n${rendered}`
        : basePrompt;
    glove.setSystemPrompt(composed);
    return originalProcessRequest(request, signal);
  };

  return glove;
}
