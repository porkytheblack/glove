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

export * from "./entity";
export * from "./episodic";
export * from "./resources";
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
): G {
  for (const tool of tools) {
    glove.fold(tool);
  }
  return glove;
}

// ─── Entity ──────────────────────────────────────────────────────────────

export function useMemoryReader<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
): G {
  return foldAll(glove, buildEntityReaderTools(adapter));
}

export function useMemoryCurator<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
): G {
  return foldAll(glove, buildEntityCuratorTools(adapter));
}

// ─── Episodic ────────────────────────────────────────────────────────────

export function useEpisodicReader<G extends FoldTarget>(
  glove: G,
  adapter: EpisodicMemoryAdapter,
): G {
  return foldAll(glove, buildEpisodicReaderTools(adapter));
}

export function useEpisodicCurator<G extends FoldTarget>(
  glove: G,
  adapter: EpisodicMemoryAdapter,
): G {
  return foldAll(glove, buildEpisodicCuratorTools(adapter));
}

// ─── Resources ───────────────────────────────────────────────────────────

export function useResourcesReader<G extends FoldTarget>(
  glove: G,
  adapter: ResourceFsAdapter,
): G {
  return foldAll(glove, buildResourcesReaderTools(adapter));
}

export function useResourcesCurator<G extends FoldTarget>(
  glove: G,
  adapter: ResourceFsAdapter,
): G {
  return foldAll(glove, buildResourcesCuratorTools(adapter));
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
