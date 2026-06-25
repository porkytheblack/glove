/**
 * The graph surface (§5): a schema-validated definition object describing
 * subagents + their prompts + the topology between them, and the adapter that
 * constructs a wired, runnable graph from it.
 */
export {
  subagentSchema,
  edgeSchema,
  graphSchema,
  parseGraphDef,
  type SubagentDef,
  type GraphEdge,
  type GraphDef,
} from "./types";

export {
  buildScratchpadGraph,
  type BuildScratchpadGraphOptions,
  type GraphNode,
  type ScratchpadGraph,
} from "./build";

export {
  runScratchpadGraph,
  buildAndRunScratchpadGraph,
  type RunScratchpadGraphOptions,
  type BuildAndRunOptions,
  type WorkflowRunResult,
  type WorkflowStep,
} from "./run";

export {
  workflowTool,
  mountWorkflow,
  type WorkflowToolOptions,
} from "./tools";
