import type { GloveFoldArgs } from "glove-core";
import type { ResourceFsAdapter } from "../../resources/adapter";
import { buildResourcesLsTool } from "./ls";
import { buildResourcesReadTool } from "./read";
import { buildResourcesStatTool } from "./stat";
import { buildResourcesGrepTool } from "./grep";
import { buildResourcesGlobTool } from "./glob";
import { buildResourcesSearchTool } from "./search";
import { buildResourcesLinksForTool } from "./links-for";
import { buildResourcesWriteTool } from "./write";
import { buildResourcesEditTool } from "./edit";
import { buildResourcesMkdirTool } from "./mkdir";
import { buildResourcesMoveTool } from "./move";
import { buildResourcesRemoveTool } from "./remove";
import { buildResourcesSetMetadataTool } from "./set-metadata";

export {
  buildResourcesLsTool,
  buildResourcesReadTool,
  buildResourcesStatTool,
  buildResourcesGrepTool,
  buildResourcesGlobTool,
  buildResourcesSearchTool,
  buildResourcesLinksForTool,
  buildResourcesWriteTool,
  buildResourcesEditTool,
  buildResourcesMkdirTool,
  buildResourcesMoveTool,
  buildResourcesRemoveTool,
  buildResourcesSetMetadataTool,
};
export { renderResourceRootsSection } from "./shared";

/**
 * Reader tools for resources. Semantic search is only registered when the
 * adapter advertises `supportsSemanticSearch`.
 */
export function buildResourcesReaderTools(
  adapter: ResourceFsAdapter,
): Array<GloveFoldArgs<any>> {
  const tools: Array<GloveFoldArgs<any>> = [
    buildResourcesLsTool(adapter),
    buildResourcesReadTool(adapter),
    buildResourcesStatTool(adapter),
    buildResourcesGrepTool(adapter),
    buildResourcesGlobTool(adapter),
    buildResourcesLinksForTool(adapter),
  ];
  if (adapter.supportsSemanticSearch) {
    tools.push(buildResourcesSearchTool(adapter));
  }
  return tools;
}

export function buildResourcesCuratorTools(
  adapter: ResourceFsAdapter,
): Array<GloveFoldArgs<any>> {
  return [
    ...buildResourcesReaderTools(adapter),
    buildResourcesWriteTool(adapter),
    buildResourcesEditTool(adapter),
    buildResourcesMkdirTool(adapter),
    buildResourcesMoveTool(adapter),
    buildResourcesRemoveTool(adapter),
    buildResourcesSetMetadataTool(adapter),
  ];
}
