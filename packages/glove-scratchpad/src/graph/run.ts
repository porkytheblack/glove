/**
 * The workflow runner — execute a {@link ScratchpadGraph} to resolution (§5).
 *
 * The graph adapter wires the topology; this runs it. Starting at the entry
 * subagent, it walks the edges in dependency order, threading each node's output
 * to its downstream neighbours and letting every node work the **shared
 * scratchpad** (narrow in SQL, store references) along the way. The data never
 * rides in the handoff — only the objective, short upstream notes, and the list
 * of references that exist. The terminal subagent reads what it needs and
 * produces the resolved answer.
 *
 * Routing is dependency-ordered (a DAG): each reachable node runs once, after
 * its predecessors. Cycles are tolerated but bounded by `maxSteps`. Conditional
 * routing (acting on an edge's `when`) is a deliberate non-goal here — edges are
 * unconditional handoffs in this version.
 */
import type { Message, ModelPromptResult } from "glove-core/core";
import {
  buildScratchpadGraph,
  type BuildScratchpadGraphOptions,
  type GraphNode,
  type ScratchpadGraph,
} from "./build";
import type { GraphDef } from "./types";

export interface WorkflowStep {
  /** The subagent that ran. */
  subagent: string;
  /** The prompt it was handed (objective + upstream notes + ref list). */
  prompt: string;
  /** Its final text output. */
  output: string;
}

export interface WorkflowRunResult {
  /** The resolved answer — the terminal subagent's output (joined if several). */
  answer: string;
  /** True when the walk reached its terminal node(s) within `maxSteps`. */
  resolved: boolean;
  /** Every step, in execution order. */
  steps: WorkflowStep[];
  /** Scratchpad references present when the run finished. */
  refs: string[];
}

export interface RunScratchpadGraphOptions {
  /** The task the workflow exists to answer. */
  objective: string;
  /** Hard cap on node executions (cycle / runaway guard). Default: node count. */
  maxSteps?: number;
  /** Abort signal, forwarded into each subagent run. */
  signal?: AbortSignal;
  /** Progress hook, called after each step completes. */
  onStep?: (step: WorkflowStep) => void;
  /** Cap upstream-note length spliced into a downstream prompt. Default 600. */
  handoffChars?: number;
}

/** Pull the final assistant text out of whatever `processRequest` returned. */
function extractFinalText(res: ModelPromptResult | Message): string {
  if (res && typeof res === "object" && "messages" in res) {
    const msgs = (res as ModelPromptResult).messages ?? [];
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m && m.sender === "agent" && typeof m.text === "string" && m.text.length) return m.text;
    }
    const last = msgs[msgs.length - 1];
    return last?.text ?? "";
  }
  const m = res as Message;
  return typeof m?.text === "string" ? m.text : "";
}

/** Nodes reachable from the entry by following edges. */
function reachableFrom(graph: ScratchpadGraph): Set<string> {
  const seen = new Set<string>();
  const stack = [graph.entry.spec.name];
  while (stack.length) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    for (const succ of graph.next(name)) stack.push(succ.spec.name);
  }
  return seen;
}

/** Predecessors of each node, restricted to the reachable subgraph. */
function predecessorsMap(graph: ScratchpadGraph, reachable: Set<string>): Map<string, string[]> {
  const preds = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!reachable.has(e.from) || !reachable.has(e.to)) continue;
    const list = preds.get(e.to) ?? [];
    if (!list.includes(e.from)) list.push(e.from);
    preds.set(e.to, list);
  }
  return preds;
}

/** Kahn topological sort of the reachable subgraph; falls back on a cycle. */
function topoOrder(graph: ScratchpadGraph, reachable: Set<string>): { order: string[]; hasCycle: boolean } {
  const indeg = new Map<string, number>();
  for (const n of reachable) indeg.set(n, 0);
  for (const e of graph.edges) {
    if (!reachable.has(e.from) || !reachable.has(e.to)) continue;
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  }
  // Seed with the entry first, then any other zero-indegree nodes, for a stable
  // order that always starts at the entry.
  const queue: string[] = [];
  if ((indeg.get(graph.entry.spec.name) ?? 0) === 0) queue.push(graph.entry.spec.name);
  for (const n of reachable) if (n !== graph.entry.spec.name && (indeg.get(n) ?? 0) === 0) queue.push(n);

  const order: string[] = [];
  const seen = new Set<string>();
  while (queue.length) {
    const name = queue.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    order.push(name);
    for (const succ of graph.next(name)) {
      const to = succ.spec.name;
      if (!reachable.has(to)) continue;
      indeg.set(to, (indeg.get(to) ?? 0) - 1);
      if ((indeg.get(to) ?? 0) <= 0 && !seen.has(to)) queue.push(to);
    }
  }
  if (order.length < reachable.size) {
    // Cycle: append the rest in a stable BFS-from-entry order.
    for (const n of reachable) if (!seen.has(n)) order.push(n);
    return { order, hasCycle: true };
  }
  return { order, hasCycle: false };
}

function buildNodePrompt(
  node: GraphNode,
  objective: string,
  preds: string[],
  outputs: Map<string, string>,
  refs: Array<{ ref: string; kind: string; rowCount: number }>,
  isTerminal: boolean,
  handoffChars: number,
): string {
  const lines: string[] = [objective.trim(), ""];
  lines.push(
    `[workflow] You are the subagent "${node.spec.name}" in a multi-subagent workflow over a shared scratchpad.` +
      (node.spec.description ? ` ${node.spec.description}` : ""),
  );
  const handoffs = preds.filter((p) => outputs.has(p));
  if (handoffs.length) {
    lines.push("", "Upstream handoff:");
    for (const p of handoffs) {
      const out = outputs.get(p) ?? "";
      lines.push(`- ${p}: ${out.length > handoffChars ? out.slice(0, handoffChars) + "…" : out}`);
    }
  }
  const refLine = refs.length
    ? refs.map((r) => `${r.ref} (${r.kind}, ${r.rowCount} row(s))`).join("; ")
    : "(none yet)";
  lines.push("", `Scratchpad references available: ${refLine}.`);
  lines.push(
    "",
    "Do your part over the scratchpad — reason over descriptors, narrow with SQL, and store any result you produce as a NEW reference. " +
      "Then state briefly what you produced and which reference(s) you left for the next subagent." +
      (isTerminal
        ? " You are the FINAL step: materialize what you need and give the resolved answer to the objective."
        : ""),
  );
  return lines.join("\n");
}

export async function runScratchpadGraph(
  graph: ScratchpadGraph,
  opts: RunScratchpadGraphOptions,
): Promise<WorkflowRunResult> {
  const { objective, signal, onStep } = opts;
  const handoffChars = opts.handoffChars ?? 600;

  const reachable = reachableFrom(graph);
  const { order, hasCycle } = topoOrder(graph, reachable);
  const maxSteps = opts.maxSteps ?? (hasCycle ? Math.max(8, reachable.size * 4) : reachable.size);
  const preds = predecessorsMap(graph, reachable);

  const terminals = [...reachable].filter(
    (n) => graph.next(n).filter((s) => reachable.has(s.spec.name)).length === 0,
  );

  const outputs = new Map<string, string>();
  const steps: WorkflowStep[] = [];
  let count = 0;
  for (const name of order) {
    if (count >= maxSteps || signal?.aborted) break;
    const node = graph.get(name);
    const list = await graph.scratchpad.list();
    const isTerminal = terminals.includes(name);
    const prompt = buildNodePrompt(
      node,
      objective,
      preds.get(name) ?? [],
      outputs,
      list.map((r) => ({ ref: r.ref, kind: r.kind, rowCount: r.rowCount })),
      isTerminal,
      handoffChars,
    );
    const res = await node.runnable.processRequest(prompt, signal);
    const output = extractFinalText(res);
    outputs.set(name, output);
    const step: WorkflowStep = { subagent: name, prompt, output };
    steps.push(step);
    onStep?.(step);
    count++;
  }

  const refs = (await graph.scratchpad.list()).map((r) => r.ref);
  const answerNodes = terminals.length ? terminals : order.length ? [order[order.length - 1]] : [];
  const answer = answerNodes
    .map((n) => outputs.get(n) ?? "")
    .filter(Boolean)
    .join("\n\n");
  const resolved = !signal?.aborted && count <= maxSteps && answerNodes.every((n) => outputs.has(n));

  return { answer, resolved, steps, refs };
}

export interface BuildAndRunOptions extends BuildScratchpadGraphOptions {
  /** The task the workflow exists to answer. */
  objective: string;
  /** Hard cap on node executions (cycle / runaway guard). */
  maxSteps?: number;
  signal?: AbortSignal;
  onStep?: (step: WorkflowStep) => void;
}

/**
 * Construct a graph from a definition and run it to an answer in one shot — the
 * common case ("build and run"). Returns both the wired graph (for inspection)
 * and the run result.
 */
export async function buildAndRunScratchpadGraph(
  def: GraphDef | unknown,
  opts: BuildAndRunOptions,
): Promise<{ graph: ScratchpadGraph; result: WorkflowRunResult }> {
  const graph = await buildScratchpadGraph(def, opts);
  const result = await runScratchpadGraph(graph, {
    objective: opts.objective,
    maxSteps: opts.maxSteps,
    signal: opts.signal,
    onStep: opts.onStep,
  });
  return { graph, result };
}
