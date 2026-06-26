/**
 * The workflow tool — the graph as one thing the agent drives (§5).
 *
 * A single tool the model calls to **build and run** a multi-subagent workflow
 * in one shot: hand it the workflow definition (subagents + prompts + tool
 * slices + edges) and an objective, and it constructs the subagents and runs
 * them over the shared scratchpad until the objective resolves — each narrowing
 * in SQL and handing references downstream. No separate create/run step.
 *
 * The developer supplies the seam that can't come from the model — how to build
 * a subagent runnable (`createAgent`) and which tools exist (`tools`). The model
 * supplies the design and the objective.
 */
import { z } from "zod";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { Scratchpad } from "../core/scratchpad";
import { graphSchema, type SubagentDef } from "./types";
import type { ScratchpadGraph } from "./build";
import { buildAndRunScratchpadGraph } from "./run";

export interface WorkflowToolOptions {
  /** The shared store the workflow's subagents read/write through. */
  scratchpad: Scratchpad;
  /**
   * Build a bare runnable for a subagent spec (model, store, display). The graph
   * adapter then sets the prompt, folds the tool slice, and mounts the scratchpad.
   */
  createAgent: (spec: SubagentDef) => IGloveRunnable | Promise<IGloveRunnable>;
  /** Registry the model's named tool slices are drawn from (interface disclosure). */
  tools?: Record<string, GloveFoldArgs<unknown>>;
  /** Mount the scratchpad surface on subagents lacking an explicit flag. Default true. */
  mountScratchpad?: boolean;
  /** Default execution cap when the model doesn't pass `maxSteps`. */
  defaultMaxSteps?: number;
}

function errResult(err: unknown): ToolResultData {
  return { status: "error", message: err instanceof Error ? err.message : String(err), data: null };
}

function topologySummary(graph: ScratchpadGraph) {
  return {
    entry: graph.entry.spec.name,
    subagents: [...graph.nodes.values()].map((n) => ({
      name: n.spec.name,
      tools: n.spec.tools ?? [],
      next: graph.next(n.spec.name).map((s) => s.spec.name),
    })),
  };
}

/** The build-and-run workflow input: a graph definition plus an objective. */
const workflowRunSchema = graphSchema.extend({
  objective: z.string().describe("The task the workflow should resolve."),
  maxSteps: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Optional cap on subagent executions (cycle / runaway guard)."),
});

/**
 * The single workflow tool. Builds the subagents from the definition and runs
 * them to a resolved answer in one call.
 */
export function workflowTool(opts: WorkflowToolOptions): GloveFoldArgs<z.infer<typeof workflowRunSchema>> {
  return {
    name: "workflow_run",
    description:
      "Define and run a multi-subagent workflow over the scratchpad in ONE call. Provide the `entry` subagent, the `subagents` (each with a name, a prompt, and an optional `tools` slice of tool names it may use), the `edges` (directed handoffs), and an `objective`. This builds the subagents and runs them in dependency order over the shared store — each reasoning over descriptors, narrowing in SQL, and handing references downstream — and returns the resolved answer plus a per-step trace and the references left behind. Subagents pass references, never payloads.",
    inputSchema: workflowRunSchema,
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const { objective, maxSteps, ...def } = input;
        const { graph, result } = await buildAndRunScratchpadGraph(def, {
          scratchpad: opts.scratchpad,
          createAgent: opts.createAgent,
          tools: opts.tools,
          mountScratchpad: opts.mountScratchpad,
          objective,
          maxSteps: maxSteps ?? opts.defaultMaxSteps,
          signal,
        });
        return {
          status: "success",
          data: {
            answer: result.answer,
            resolved: result.resolved,
            refs: result.refs,
            topology: topologySummary(graph),
            steps: result.steps.map((s) => ({ subagent: s.subagent, output: s.output })),
          },
        };
      } catch (err) {
        return errResult(err);
      }
    },
  };
}

/** Fold the workflow tool onto a built Glove. Returns the same runnable. */
export function mountWorkflow(glove: IGloveRunnable, opts: WorkflowToolOptions): IGloveRunnable {
  glove.fold(workflowTool(opts));
  return glove;
}
