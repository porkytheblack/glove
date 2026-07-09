/**
 * glove-scratchpad — a database emulator for LLM tool use.
 *
 * Instead of loading many tool definitions, expose an agent's capabilities as a
 * relational database it queries with ONE `execute_sql` tool. **Resources** —
 * entities/data types like `github_pr`, `linear_issue`, `emails`, `time`,
 * `images` — become tables; their CRUD verbs map to underlying tools. The model
 * discovers capabilities via `information_schema`, invokes them by querying their
 * tables (pushing arguments through `WHERE`), composes across services in a
 * single statement, and stages outbound effects with transactions. It is a SQL
 * interpreter: every statement is parsed and inspected before any tool runs.
 *
 * ```ts
 * import { Database, resourceFromTool, mountDatabase } from "glove-scratchpad";
 *
 * const db = await Database.create();
 * db.register(resourceFromTool(getTimeTool, {
 *   name: "time", volatility: "stable", columns: [{ name: "now", type: "timestamptz" }],
 * }));
 * mountDatabase(agent, { db });
 * // → the agent runs `SELECT now FROM time`, discovers more via information_schema, etc.
 * ```
 *
 * The query engine is `glove-sql` (a zero-dependency pure-JS Postgres subset);
 * the emulator materializes each resolved resource into it once per `execute`,
 * then runs the synchronous query. Bring `glove-scratchpad/pglite` for a full
 * Postgres dialect, or any backend satisfying {@link ScratchpadBackend}.
 */
export * from "./db";
export * from "./core";
export {
  assertFnName,
  defineFn,
  describeFn,
  FnCatalog,
  fnFromTool,
  fnSignature,
  missingRequired,
  parseToolData,
  unknownKeys,
  type DefineFnSpec,
  type FnDescription,
  type FnFromToolOptions,
  type FnParam,
  type ToolFn,
  type ToolFnContext,
} from "./fns";
export { MemoryBackend, type MemoryBackendOptions } from "glove-sql";
