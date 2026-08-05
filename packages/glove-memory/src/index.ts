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
export * from "./forms";

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
  buildContextUpdateTool,
  buildContextUnsetTool,
  buildContextTools,
  useContext,
  // Forms
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
} from "./tools";
export type {
  FoldTarget,
  ContextEnableTarget,
  FormEnableTarget,
  UseFormRunnerConfig,
  FormReaderOptions,
} from "./tools";

// Reference in-memory adapters
export {
  InMemoryEntityAdapter,
  InMemoryEpisodicAdapter,
  InMemoryResourcesAdapter,
  InMemoryContextAdapter,
  InMemoryFormAdapter,
} from "./in-memory";
