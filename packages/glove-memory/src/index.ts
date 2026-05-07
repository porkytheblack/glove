// Top-level barrel — re-exports the headline surfaces. Most consumers will
// import directly from the subpath exports (`glove-memory/core`,
// `glove-memory/entity`, `glove-memory/episodic`, `glove-memory/resources`,
// `glove-memory/context`, ...) for tighter dependencies, but this barrel
// keeps the simple `import { ... } from "glove-memory"` form working too.

export * from "./core";
export * from "./entity";
export * from "./episodic";
export * from "./resources";
export * from "./context";

// Tool factories and builder helpers
export {
  // Entity
  buildEntityReaderTools,
  buildEntityCuratorTools,
  buildFindNodesTool,
  buildGetNodeTool,
  buildQueryTool,
  buildAddNodeTool,
  buildUpdateNodeTool,
  buildConnectTool,
  buildDisconnectTool,
  buildMergeNodesTool,
  renderEntitySchemaSection,
  useMemoryReader,
  useMemoryCurator,
  // Episodic
  buildEpisodicReaderTools,
  buildEpisodicCuratorTools,
  buildEpisodicFindTool,
  buildEpisodicTimelineTool,
  buildEpisodicSearchTool,
  buildEpisodicRecordTool,
  buildEpisodicUpdateTool,
  buildEpisodicDeleteTool,
  renderEpisodeKindsSection,
  useEpisodicReader,
  useEpisodicCurator,
  // Resources
  buildResourcesReaderTools,
  buildResourcesCuratorTools,
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
  renderResourceRootsSection,
  useResourcesReader,
  useResourcesCurator,
  // Context
  buildContextGetTool,
  buildContextSetTool,
  buildContextUnsetTool,
  buildContextTools,
  useContext,
} from "./tools";
export type { FoldTarget, ContextEnableTarget } from "./tools";

// Reference in-memory adapters
export {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
} from "./in-memory";
