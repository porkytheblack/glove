import type { GloveFoldArgs } from "glove-core";
import type { EntityMemoryAdapter } from "../../entity/adapter";
import { buildFindNodesTool } from "./find";
import { buildGetNodeTool } from "./get";
import { buildQueryTool } from "./query";
import { buildAddNodeTool } from "./add-node";
import { buildUpdateNodeTool } from "./update-node";
import { buildConnectTool } from "./connect";
import { buildDisconnectTool } from "./disconnect";
import { buildMergeNodesTool } from "./merge-nodes";

export {
  buildFindNodesTool,
  buildGetNodeTool,
  buildQueryTool,
  buildAddNodeTool,
  buildUpdateNodeTool,
  buildConnectTool,
  buildDisconnectTool,
  buildMergeNodesTool,
};
export { renderEntitySchemaSection } from "./render";

/**
 * The reader tool surface — read-only lookups over the entity graph.
 * Attached to the conversational reader Glove via `useMemoryReader`.
 */
export function buildEntityReaderTools(adapter: EntityMemoryAdapter): Array<GloveFoldArgs<any>> {
  return [
    buildFindNodesTool(adapter),
    buildGetNodeTool(adapter),
    buildQueryTool(adapter),
  ];
}

/**
 * The curator tool surface — reader tools plus write/merge operations.
 * Attached to the curator Glove via `useMemoryCurator`.
 */
export function buildEntityCuratorTools(adapter: EntityMemoryAdapter): Array<GloveFoldArgs<any>> {
  return [
    ...buildEntityReaderTools(adapter),
    buildAddNodeTool(adapter),
    buildUpdateNodeTool(adapter),
    buildConnectTool(adapter),
    buildDisconnectTool(adapter),
    buildMergeNodesTool(adapter),
  ];
}
