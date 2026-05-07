import type { IGloveRunnable } from "glove-core";
import type { EntityMemoryAdapter } from "../entity/adapter";
import type { EpisodicMemoryAdapter } from "../episodic/adapter";
import {
  createMemoryAddNodeTool,
  createMemoryConnectTool,
  createMemoryDisconnectTool,
  createMemoryFindTool,
  createMemoryGetTool,
  createMemoryMergeNodesTool,
  createMemoryQueryTool,
  createMemoryUpdateNodeTool,
} from "./entity";
import {
  createEpisodicDeleteTool,
  createEpisodicFindTool,
  createEpisodicRecordTool,
  createEpisodicSearchTool,
  createEpisodicTimelineTool,
  createEpisodicUpdateTool,
} from "./episodic";

export * from "./descriptions";
export * from "./entity";
export * from "./episodic";

/**
 * Attach the read-only entity-memory tools to a Glove. Folds three tools:
 * `glove_memory_find`, `glove_memory_get`, `glove_memory_query`. Returns
 * the runnable so attachments can chain.
 *
 * Spec name kept verbatim (`useMemoryReader`) — implemented as a function
 * rather than a builder method to keep the package strictly additive over
 * `glove-core`. Same shape as `mountMcp` in `glove-mcp`.
 */
export function useMemoryReader(
  glove: IGloveRunnable,
  adapter: EntityMemoryAdapter,
): IGloveRunnable {
  glove.fold(createMemoryFindTool(adapter));
  glove.fold(createMemoryGetTool(adapter));
  glove.fold(createMemoryQueryTool(adapter));
  return glove;
}

/**
 * Attach the full curator entity-memory tool surface (read + write).
 * Folds the three reader tools plus `glove_memory_add_node`,
 * `glove_memory_update_node`, `glove_memory_connect`, `glove_memory_disconnect`,
 * `glove_memory_merge_nodes`.
 */
export function useMemoryCurator(
  glove: IGloveRunnable,
  adapter: EntityMemoryAdapter,
): IGloveRunnable {
  useMemoryReader(glove, adapter);
  glove.fold(createMemoryAddNodeTool(adapter));
  glove.fold(createMemoryUpdateNodeTool(adapter));
  glove.fold(createMemoryConnectTool(adapter));
  glove.fold(createMemoryDisconnectTool(adapter));
  glove.fold(createMemoryMergeNodesTool(adapter));
  return glove;
}

/**
 * Attach the read-only episodic-memory tools. Folds `glove_episodic_find`,
 * `glove_episodic_timeline`, and (only if the adapter advertises
 * `supportsSemanticSearch`) `glove_episodic_search`.
 */
export function useEpisodicReader(
  glove: IGloveRunnable,
  adapter: EpisodicMemoryAdapter,
): IGloveRunnable {
  glove.fold(createEpisodicFindTool(adapter));
  glove.fold(createEpisodicTimelineTool(adapter));
  if (adapter.supportsSemanticSearch) {
    glove.fold(createEpisodicSearchTool(adapter));
  }
  return glove;
}

/**
 * Attach the full curator episodic-memory tool surface (read + write).
 * Folds the reader tools plus `glove_episodic_record`,
 * `glove_episodic_update`, `glove_episodic_delete`.
 */
export function useEpisodicCurator(
  glove: IGloveRunnable,
  adapter: EpisodicMemoryAdapter,
): IGloveRunnable {
  useEpisodicReader(glove, adapter);
  glove.fold(createEpisodicRecordTool(adapter));
  glove.fold(createEpisodicUpdateTool(adapter));
  glove.fold(createEpisodicDeleteTool(adapter));
  return glove;
}
