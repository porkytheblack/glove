/**
 * The graph adapter — construct a wired topology from a {@link GraphDef} (§5).
 *
 * `buildScratchpadGraph` takes the plain definition object and a small set of
 * hooks and does the construction the definition implies:
 *
 *   1. validates the definition (shape + cross-field invariants);
 *   2. builds each subagent via the caller's `createAgent` factory;
 *   3. sets each subagent's system prompt from `spec.prompt`;
 *   4. folds the subagent's tool slice from the `tools` registry — **interface
 *      disclosure**: each node sees only the tools its job needs;
 *   5. mounts the scratchpad surface + restraint priming (unless opted out),
 *      stamping `actor = spec.name` so provenance records who produced what;
 *   6. returns a navigable {@link ScratchpadGraph} (nodes + edges + `next`).
 *
 * The factory seam keeps this decoupled from any particular agent runtime: the
 * adapter owns wiring (prompt, tools, scratchpad, provenance, topology); the
 * caller owns construction (model, store, display).
 */
import type { GloveFoldArgs, IGloveRunnable } from "glove-core/glove";
import type { Scratchpad } from "../core/scratchpad";
import { mountScratchpad } from "../tools/mount";
import { parseGraphDef, type GraphDef, type GraphEdge, type SubagentDef } from "./types";

export interface BuildScratchpadGraphOptions {
  /** The shared store every subagent reads/writes through. */
  scratchpad: Scratchpad;
  /**
   * Build a bare runnable for a subagent spec (set the model, store, display,
   * etc.). The adapter then sets the prompt, folds tools, and mounts the
   * scratchpad. `spec.model` is available here for per-node model selection.
   */
  createAgent: (spec: SubagentDef) => IGloveRunnable | Promise<IGloveRunnable>;
  /**
   * Registry the graph draws tool slices from. A subagent's `tools: [...]` names
   * are looked up here; an unknown name is an error (fail fast, not silently
   * tool-less).
   */
  tools?: Record<string, GloveFoldArgs<unknown>>;
  /**
   * Default for mounting the scratchpad surface when a subagent doesn't set
   * `scratchpad`. Default true.
   */
  mountScratchpad?: boolean;
}

/** A constructed node: its definition plus the wired runnable. */
export interface GraphNode {
  spec: SubagentDef;
  runnable: IGloveRunnable;
}

/** A constructed, navigable graph. */
export interface ScratchpadGraph {
  readonly def: GraphDef;
  readonly scratchpad: Scratchpad;
  readonly nodes: Map<string, GraphNode>;
  readonly edges: GraphEdge[];
  /** The entry node. */
  readonly entry: GraphNode;
  /** Look up a node by name (throws if absent). */
  get(name: string): GraphNode;
  /** Successor nodes reachable by an edge out of `name`, in declaration order. */
  next(name: string): GraphNode[];
}

export async function buildScratchpadGraph(
  def: GraphDef | unknown,
  opts: BuildScratchpadGraphOptions,
): Promise<ScratchpadGraph> {
  const graph = parseGraphDef(def);
  const registry = opts.tools ?? {};
  const mountDefault = opts.mountScratchpad ?? true;

  const nodes = new Map<string, GraphNode>();
  for (const spec of graph.subagents) {
    const runnable = await opts.createAgent(spec);

    // The definition owns the system prompt.
    runnable.setSystemPrompt(spec.prompt);

    // Interface disclosure: fold only this subagent's slice of tools.
    for (const toolName of spec.tools ?? []) {
      const tool = registry[toolName];
      if (!tool) {
        throw new Error(
          `Graph subagent "${spec.name}" requests unknown tool "${toolName}". ` +
            `Provide it in buildScratchpadGraph({ tools }).`,
        );
      }
      runnable.fold(tool);
    }

    // Mount the scratchpad surface + restraint priming, stamping the actor.
    const useScratchpad = spec.scratchpad ?? mountDefault;
    if (useScratchpad) {
      mountScratchpad(runnable, {
        scratchpad: opts.scratchpad,
        actor: spec.name,
        prime: spec.prime,
        defaultLimit: spec.defaultLimit,
      });
    }

    nodes.set(spec.name, { spec, runnable });
  }

  const edges = graph.edges ?? [];
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }

  const get = (name: string): GraphNode => {
    const node = nodes.get(name);
    if (!node) throw new Error(`Graph has no subagent named "${name}".`);
    return node;
  };

  return {
    def: graph,
    scratchpad: opts.scratchpad,
    nodes,
    edges,
    entry: get(graph.entry),
    get,
    next: (name: string) => (adjacency.get(name) ?? []).map(get),
  };
}
