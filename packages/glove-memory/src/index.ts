// Top-level barrel — re-exports the headline surfaces. Most consumers will
// import directly from the subpath exports (`glove-memory/core`,
// `glove-memory/entity`, ...) for tighter dependencies, but this barrel keeps
// the simple `import { ... } from "glove-memory"` form working too.

export * from "./core";
export * from "./entity";
export {
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
} from "./tools";
export type { FoldTarget } from "./tools";
export { InMemoryEntityAdapter } from "./in-memory";
