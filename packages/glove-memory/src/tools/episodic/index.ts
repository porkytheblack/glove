import type { GloveFoldArgs } from "glove-core";
import type { EpisodicMemoryAdapter } from "../../episodic/adapter";
import { buildEpisodicFindTool } from "./find";
import { buildEpisodicTimelineTool } from "./timeline";
import { buildEpisodicSearchTool } from "./search";
import { buildEpisodicRecordTool } from "./record";
import { buildEpisodicUpdateTool } from "./update";
import { buildEpisodicDeleteTool } from "./delete";

export {
  buildEpisodicFindTool,
  buildEpisodicTimelineTool,
  buildEpisodicSearchTool,
  buildEpisodicRecordTool,
  buildEpisodicUpdateTool,
  buildEpisodicDeleteTool,
};
export { renderEpisodeKindsSection } from "./shared";

/**
 * Reader tools for episodic memory. The semantic-search tool is only
 * registered when the adapter advertises `supportsSemanticSearch`.
 */
export function buildEpisodicReaderTools(
  adapter: EpisodicMemoryAdapter,
): Array<GloveFoldArgs<any>> {
  const tools: Array<GloveFoldArgs<any>> = [
    buildEpisodicFindTool(adapter),
    buildEpisodicTimelineTool(adapter),
  ];
  if (adapter.supportsSemanticSearch) {
    tools.push(buildEpisodicSearchTool(adapter));
  }
  return tools;
}

/** Curator tools — all reader tools plus record/update/delete. */
export function buildEpisodicCuratorTools(
  adapter: EpisodicMemoryAdapter,
): Array<GloveFoldArgs<any>> {
  return [
    ...buildEpisodicReaderTools(adapter),
    buildEpisodicRecordTool(adapter),
    buildEpisodicUpdateTool(adapter),
    buildEpisodicDeleteTool(adapter),
  ];
}
