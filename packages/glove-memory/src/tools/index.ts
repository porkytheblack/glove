import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../entity/adapter";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import type { ResourceFsAdapter } from "../resources/adapter";
import {
  buildEntityReaderTools,
  buildEntityCuratorTools,
} from "./entity";
import {
  buildEpisodicReaderTools,
  buildEpisodicCuratorTools,
} from "./episodic";
import {
  buildResourcesReaderTools,
  buildResourcesCuratorTools,
} from "./resources";
import { useContext, type ContextEnableTarget } from "./context";
import { useFormReader, type FormEnableTarget } from "./forms";
import { selectFoldArgs, type MemoryToolOptions } from "./selection";

export * from "./entity";
export * from "./episodic";
export * from "./resources";
export {
  selectTools,
  selectFoldArgs,
  type ToolSelection,
  type MemoryToolOptions,
} from "./selection";
export {
  buildFormListTool,
  buildFormStartTool,
  buildFormStatusTool,
  buildFormInspectTool,
  buildFormFillTool,
  buildFormReviseTool,
  buildFormAbandonTool,
  buildFormHistoryTool,
  buildFormRunnerTools,
  buildFormReaderTools,
  useFormRunner,
  useFormReader,
  type FormEnableTarget,
  type UseFormRunnerConfig,
  type FormReaderOptions,
} from "./forms";
export {
  buildContextGetTool,
  buildContextSetTool,
  buildContextUpdateTool,
  buildContextUnsetTool,
  buildContextTools,
  useContext,
  type ContextEnableTarget,
} from "./context";

/**
 * Anything that exposes `glove-core`'s `fold` is sufficient for tool
 * registration. Typing this loosely lets callers pass either a still-building
 * Glove (`IGloveBuilder`) or a runnable Glove (`IGloveRunnable`) — both
 * support `fold` and both return themselves from it, which preserves the
 * caller's chain.
 *
 * The generic `G` is preserved through the function so callers don't lose
 * the concrete `Glove` type and its builder methods (`build`, `defineSubAgent`,
 * etc).
 */
export type FoldTarget = {
  fold: <I>(args: GloveFoldArgs<I>) => unknown;
};

function foldAll<G extends FoldTarget>(
  glove: G,
  tools: Array<GloveFoldArgs<any>>,
  options?: MemoryToolOptions,
): G {
  for (const tool of selectFoldArgs(tools, options?.tools)) {
    glove.fold(tool);
  }
  return glove;
}

// ─── Entity ──────────────────────────────────────────────────────────────

export function useMemoryReader<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildEntityReaderTools(adapter), options);
}

export function useMemoryCurator<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildEntityCuratorTools(adapter), options);
}

// ─── Episodic ────────────────────────────────────────────────────────────

export function useEpisodicReader<G extends FoldTarget>(
  glove: G,
  adapter: EpisodicMemoryAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildEpisodicReaderTools(adapter), options);
}

export function useEpisodicCurator<G extends FoldTarget>(
  glove: G,
  adapter: EpisodicMemoryAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildEpisodicCuratorTools(adapter), options);
}

// ─── Resources ───────────────────────────────────────────────────────────

export function useResourcesReader<G extends FoldTarget>(
  glove: G,
  adapter: ResourceFsAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildResourcesReaderTools(adapter), options);
}

/**
 * Full resource surface — reader tools plus write / edit / mkdir / move /
 * remove / set_metadata.
 *
 * Two independent ways to hold it back, meant to be used together:
 *
 * - `options.tools` picks which tools are folded, so the affordance never
 *   reaches the model.
 * - `withResourceAccess(adapter, policy)` gates the adapter by path, so a
 *   write into a read-only folder is refused no matter which tool asks.
 */
export function useResourcesCurator<G extends FoldTarget>(
  glove: G,
  adapter: ResourceFsAdapter,
  options?: MemoryToolOptions,
): G {
  return foldAll(glove, buildResourcesCuratorTools(adapter), options);
}

// ─── Context ─────────────────────────────────────────────────────────────

// `useContext` is exported above (re-exported from ./context) — it lives in
// the context-specific module because it also wraps `processRequest` for
// system-prompt injection, so it needs the richer `ContextEnableTarget`
// rather than the bare `FoldTarget`.

void useContext;
void ({} as ContextEnableTarget);

// ─── Forms ───────────────────────────────────────────────────────────────

// `useFormRunner` is exported above (re-exported from ./forms) — like
// `useContext` it wraps `processRequest` for system-prompt injection, so it
// needs the richer `FormEnableTarget` rather than the bare `FoldTarget`. It
// also returns the runner, because hosts start instances and resolve
// checkpoints without going through the model.

void useFormReader;
void ({} as FormEnableTarget);
