/**
 * The graph definition — a plain, schema-validated object (§5 "topology").
 *
 * A multi-subagent workflow is described as **data**: a JS object listing
 * subagents (each with a prompt and the slice of tools it may see) and the edges
 * between them. The object is the contract; {@link "glove-scratchpad/graph".buildScratchpadGraph}
 * is the adapter that constructs a wired, runnable topology from it — mounting
 * the scratchpad on each subagent, partitioning tools (interface disclosure),
 * and stamping provenance.
 *
 * The Zod schema is the source of truth; the TypeScript types are inferred from
 * it, so a definition that type-checks is exactly one that validates at runtime.
 */
import { z } from "zod";

/** One node of the graph: a subagent, its prompt, and the tools it may see. */
export const subagentSchema = z.strictObject({
  /** Unique, readable name. Used as the provenance `actor` and the edge id. */
  name: z.string().min(1),
  /** The subagent's system prompt (the restraint preamble is prepended on mount). */
  prompt: z.string(),
  /** Human-facing description of the node's job. */
  description: z.string().optional(),
  /**
   * Names of tools (keys in the adapter's `tools` registry) this subagent is
   * given — its capability slice. Omit for none. This is **interface
   * disclosure**: each node sees only the tools its job needs.
   */
  tools: z.array(z.string()).optional(),
  /** Mount the scratchpad surface tools on this subagent. Default true. */
  scratchpad: z.boolean().optional(),
  /** Prepend the restraint-priming preamble to the prompt. Default true. */
  prime: z.boolean().optional(),
  /** Default row cap for this subagent's scratchpad query/materialize. */
  defaultLimit: z.number().int().positive().optional(),
  /** Optional model id, passed through to the `createAgent` factory. */
  model: z.string().optional(),
  /** Free-form metadata carried onto the node, untouched by the adapter. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/** A directed handoff from one subagent to another. */
export const edgeSchema = z.strictObject({
  /** Source subagent name. */
  from: z.string().min(1),
  /** Target subagent name. */
  to: z.string().min(1),
  /** Optional human/condition label describing when this edge is taken. */
  when: z.string().optional(),
});

/** The whole graph: subagents + the topology between them. */
export const graphSchema = z.strictObject({
  /** Optional name for the graph (diagnostics / logging). */
  name: z.string().optional(),
  /** The subagent the workflow starts at. Must be one of `subagents`. */
  entry: z.string().min(1),
  /** The nodes. At least one. */
  subagents: z.array(subagentSchema).min(1),
  /** Directed edges. Endpoints must reference declared subagents. */
  edges: z.array(edgeSchema).optional(),
});

export type SubagentDef = z.infer<typeof subagentSchema>;
export type GraphEdge = z.infer<typeof edgeSchema>;
export type GraphDef = z.infer<typeof graphSchema>;

/**
 * Validate a plain object against {@link graphSchema}, returning the typed
 * definition or throwing a readable error. Also enforces the cross-field
 * invariants Zod can't express alone: unique names, and that `entry` and every
 * edge endpoint reference a declared subagent.
 */
export function parseGraphDef(def: unknown): GraphDef {
  const parsed = graphSchema.safeParse(def);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid graph definition:\n${issues}`);
  }
  const g = parsed.data;

  const names = new Set<string>();
  for (const s of g.subagents) {
    if (names.has(s.name)) throw new Error(`Invalid graph definition: duplicate subagent name "${s.name}".`);
    names.add(s.name);
  }
  if (!names.has(g.entry)) {
    throw new Error(`Invalid graph definition: entry "${g.entry}" is not a declared subagent.`);
  }
  for (const e of g.edges ?? []) {
    if (!names.has(e.from)) throw new Error(`Invalid graph definition: edge.from "${e.from}" is not a declared subagent.`);
    if (!names.has(e.to)) throw new Error(`Invalid graph definition: edge.to "${e.to}" is not a declared subagent.`);
  }
  return g;
}
