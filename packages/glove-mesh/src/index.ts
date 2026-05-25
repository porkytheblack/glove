// Top-level barrel — most consumers import from the subpath exports
// (`glove-mesh/core`, `glove-mesh/tools`, `glove-mesh/in-memory`) for
// tighter dependencies, but this barrel keeps the simple
// `import { ... } from "glove-mesh"` form working too.

export * from "./core";
export {
  mountMesh,
  buildMeshSendTool,
  buildMeshBroadcastTool,
  buildMeshListAgentsTool,
  buildMeshAcknowledgeTool,
  type MeshMountTarget,
  type MountMeshConfig,
} from "./tools";
export { MeshNetwork, InMemoryMeshAdapter } from "./in-memory";
