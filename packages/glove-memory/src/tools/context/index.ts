import type { ContentPart, GloveFoldArgs, Message, ModelPromptResult } from "glove-core";
import { assertRuntimeContext, attachRuntimeContext, type MemoryContextDelivery, type RuntimeContextTarget } from "../runtime-context";
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

/** Tool mounting and runtime-context support, forwarded by runnable proxies. */
export interface ContextEnableTarget extends RuntimeContextTarget {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
  getSystemPrompt(): string;
  setSystemPrompt(prompt: string): void;
  processRequest(
    request: string | ContentPart[],
    signal?: AbortSignal,
  ): Promise<ModelPromptResult | Message>;
}

/**
 * Mount context tools and resolve pinned state for the model. By default each
 * mount appends a transient user-role snapshot at the input tail before every
 * model iteration, leaving the system prompt and persisted conversation
 * unchanged; `delivery` can freeze it per request or save it to history. Multiple adapters
 * compose in registration order. Tool selection does not disable injection.
 */
export interface UseContextOptions extends MemoryToolOptions {
  /** How the pinned snapshot reaches the model: `"iteration"` (default), `"request"` or `"history"`. */
  delivery?: MemoryContextDelivery;
  /** History key; give each history-delivered mount its own. Default `glove.context`. */
  key?: string;
}

export function useContext<G extends ContextEnableTarget>(
  glove: G,
  adapter: ContextAdapter,
  options?: UseContextOptions,
): G {
  assertRuntimeContext(glove);
  for (const tool of selectFoldArgs(buildContextTools(adapter), options?.tools)) {
    glove.fold(tool);
  }

  attachRuntimeContext(glove, () => adapter.render(), { delivery: options?.delivery ?? "iteration", key: options?.key ?? "glove.context" });

  return glove;
}
