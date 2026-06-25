/**
 * Workflow tools — the graph as something the agent itself drives (§5).
 *
 * Instead of a developer hand-wiring a topology in code, these fold onto the
 * agent's tool set so the *model* can author a workflow and then run it:
 *
 *   - `workflow_create`  — define a multi-subagent workflow from a schema object
 *     (subagents + prompts + tool slices + edges). Built and stashed under an id.
 *   - `workflow_run`     — run a workflow over the shared scratchpad until the
 *     objective resolves; returns the answer.
 *   - `workflow_inspect` — read back a built workflow's topology.
 *
 * The developer supplies the seam that can't come from the model — how to build a
 * subagent runnable (`createAgent`) and which tools exist (`tools`). The model
 * supplies the design: which subagents, what each is told, who hands off to whom.
 */
import { z } from "zod";
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { ToolResultData } from "glove-core/core";
import type { Scratchpad } from "../core/scratchpad";
import { graphSchema, type SubagentDef } from "./types";
import { buildScratchpadGraph, type ScratchpadGraph } from "./build";
import { runScratchpadGraph } from "./run";

export interface WorkflowToolsOptions {
  /** The shared store every workflow's subagents read/write through. */
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
  /** Default execution cap for `workflow_run` when the model doesn't pass one. */
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
    edges: graph.edges,
  };
}

/**
 * Build the workflow tools over a shared registry of constructed graphs. All
 * returned tools close over the same registry, so a `workflow_create` in one
 * turn is runnable by `workflow_run` in a later turn.
 */
export function workflowTools(opts: WorkflowToolsOptions): GloveFoldArgs<unknown>[] {
  const graphs = new Map<string, ScratchpadGraph>();
  let counter = 0;

  const create: GloveFoldArgs<z.infer<typeof graphSchema>> = {
    name: "workflow_create",
    description:
      "Define a multi-subagent workflow over the scratchpad. Provide an entry subagent, the subagents (each with a name, a prompt, and an optional `tools` slice of tool names it may use), and directed `edges` (handoffs) between them. Subagents share the scratchpad and pass references downstream. Returns a workflow `id` to run later with workflow_run.",
    inputSchema: graphSchema,
    async do(input): Promise<ToolResultData> {
      try {
        const graph = await buildScratchpadGraph(input, {
          scratchpad: opts.scratchpad,
          createAgent: opts.createAgent,
          tools: opts.tools,
          mountScratchpad: opts.mountScratchpad,
        });
        const id =
          input.name && !graphs.has(input.name) ? input.name : `wf_${++counter}`;
        graphs.set(id, graph);
        return { status: "success", data: { id, ...topologySummary(graph) } };
      } catch (err) {
        return errResult(err);
      }
    },
  };

  const run: GloveFoldArgs<{ id: string; objective: string; maxSteps?: number }> = {
    name: "workflow_run",
    description:
      "Run a previously created workflow over the scratchpad until the objective resolves. Each subagent runs in dependency order, works the shared store, and hands references downstream; the final subagent returns the resolved answer. Returns the answer plus a per-step trace and the references left in the store.",
    inputSchema: z.object({
      id: z.string().describe("The workflow id returned by workflow_create."),
      objective: z.string().describe("The task the workflow should resolve."),
      maxSteps: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional cap on subagent executions (cycle / runaway guard)."),
    }),
    async do(input, _display, _glove, signal): Promise<ToolResultData> {
      try {
        const graph = graphs.get(input.id);
        if (!graph) {
          return errResult(
            new Error(`No workflow with id "${input.id}". Create one with workflow_create first.`),
          );
        }
        const result = await runScratchpadGraph(graph, {
          objective: input.objective,
          maxSteps: input.maxSteps ?? opts.defaultMaxSteps,
          signal,
        });
        return {
          status: "success",
          data: {
            answer: result.answer,
            resolved: result.resolved,
            refs: result.refs,
            steps: result.steps.map((s) => ({ subagent: s.subagent, output: s.output })),
          },
        };
      } catch (err) {
        return errResult(err);
      }
    },
  };

  const inspect: GloveFoldArgs<{ id: string }> = {
    name: "workflow_inspect",
    description: "Read back a created workflow's topology (entry, subagents, tool slices, edges) by id.",
    inputSchema: z.object({ id: z.string().describe("The workflow id.") }),
    async do(input): Promise<ToolResultData> {
      const graph = graphs.get(input.id);
      if (!graph) return errResult(new Error(`No workflow with id "${input.id}".`));
      return { status: "success", data: { id: input.id, ...topologySummary(graph) } };
    },
  };

  return [create, run, inspect] as GloveFoldArgs<unknown>[];
}

/** Fold the workflow tools onto a built Glove. Returns the same runnable. */
export function mountWorkflow(glove: IGloveRunnable, opts: WorkflowToolsOptions): IGloveRunnable {
  for (const tool of workflowTools(opts)) glove.fold(tool);
  return glove;
}
