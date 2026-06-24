/**
 * Mounting the scratchpad onto a subdroid (§5, §8.1).
 *
 * Folds the four surface tools and (by default) primes the agent for restraint.
 * Correctness here is *behavioral*, not structural: every subdroid can read, but
 * is primed to defer materialization to the last mile. The priming and the tool
 * return shapes must agree — the descriptor must be the path of least resistance
 * (§8.1 "ergonomics beats the prompt").
 */
import type { IGloveRunnable } from "glove-core/glove";
import type { Scratchpad } from "../core/scratchpad";
import { scratchpadTools, type ScratchpadToolOptions } from "./surface";

/**
 * The restraint-priming preamble. Prepended to a subdroid's system prompt so
 * the cheap, obvious move is to reason over descriptors and pass references
 * downstream — and materializing real values feels like the deliberate detour.
 */
export const SCRATCHPAD_PREAMBLE = `You are working over a SCRATCHPAD — a durable store of records that tools have already written for you. Each record has a readable reference (a table name) and resolves to { columns+types, row count, a small preview, provenance } — its descriptor — NOT a raw blob.

Operating discipline:
- Reason over DESCRIPTORS, not payloads. scratchpad_describe and the stub a tool returns already tell you the shape; you rarely need the values to plan.
- NARROW with scratchpad_query before you read. Filter/join/aggregate in SQL (Postgres dialect: SELECT/WHERE/JOIN/GROUP BY/CTEs; reach nested depth with -> / ->> / jsonb_array_elements). Pass \`store\` to persist a narrowed result as a NEW reference and keep it as a handle.
- Pass REFERENCES downstream, not data. A reference + a query is enough for the next step; the payload stays in the store.
- MATERIALIZE only at the last mile. Call scratchpad_materialize only when you genuinely need values to answer or format — and only after narrowing, so you read a few rows, not thousands. Every materialize is a deliberate, budgeted load.

Table conventions: a record's root table is named by its reference and has a \`_rid\` primary key; nested arrays become child tables that join on \`_parent = _rid\` and preserve order via \`_idx\`. Deeper nesting stays in \`jsonb\`, reachable in place.`;

export interface MountScratchpadConfig extends ScratchpadToolOptions {
  scratchpad: Scratchpad;
  /** Prepend {@link SCRATCHPAD_PREAMBLE} to the system prompt. Default true. */
  prime?: boolean;
}

/**
 * Fold the scratchpad surface tools onto a built Glove (main agent or subdroid)
 * and prime it for the last-mile discipline. Returns the same runnable.
 */
export function mountScratchpad(
  glove: IGloveRunnable,
  config: MountScratchpadConfig,
): IGloveRunnable {
  const { scratchpad, prime, ...toolOpts } = config;
  for (const tool of scratchpadTools(scratchpad, toolOpts)) {
    glove.fold(tool);
  }
  if (prime !== false) {
    const existing = glove.getSystemPrompt();
    glove.setSystemPrompt(
      existing ? `${SCRATCHPAD_PREAMBLE}\n\n${existing}` : SCRATCHPAD_PREAMBLE,
    );
  }
  return glove;
}
