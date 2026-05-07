import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../entity/adapter";
import {
  buildEntityReaderTools,
  buildEntityCuratorTools,
} from "./entity";

export * from "./entity";

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

/**
 * Attach the entity-memory **reader** tool surface to a Glove.
 * Tools registered: `glove_memory_find`, `glove_memory_get`, `glove_memory_query`.
 *
 * The function takes the Glove as the first argument and returns it for
 * fluent chaining:
 *
 * ```ts
 * const reader = useMemoryReader(new Glove({...}), entityAdapter).build();
 * ```
 */
export function useMemoryReader<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
): G {
  return foldAll(glove, buildEntityReaderTools(adapter));
}

/**
 * Attach the entity-memory **curator** tool surface to a Glove.
 * Tools registered: all reader tools, plus `glove_memory_add_node`,
 * `glove_memory_update_node`, `glove_memory_connect`,
 * `glove_memory_disconnect`, `glove_memory_merge_nodes`.
 */
export function useMemoryCurator<G extends FoldTarget>(
  glove: G,
  adapter: EntityMemoryAdapter,
): G {
  return foldAll(glove, buildEntityCuratorTools(adapter));
}
