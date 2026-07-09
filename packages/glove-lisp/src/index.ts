/**
 * glove-lisp — a Lisp REPL for LLM tool use.
 *
 * Instead of loading many tool definitions, expose an agent's capabilities as
 * FUNCTIONS in a tiny, sandboxed, Clojure-flavored Lisp it drives with ONE
 * `execute_lisp` tool. Two ways to register capabilities:
 *
 *   - **Resources** (the same {@link ResourceTable} contract as glove-scratchpad):
 *     reads push arguments down as maps, writes go through
 *     `insert!`/`update!`/`delete!`, `(stage …)`/`(commit!)` stages outbound
 *     effects, `(tables)`/`(describe :name)` is discovery.
 *   - **Functions** ({@link ToolFn} from `glove-scratchpad/fns`): the light path
 *     when tools/resources are unknown up front (an arbitrary MCP server). No
 *     columns, no pushdown, no staging — calling `(github__list_prs {:state "open"})`
 *     invokes the tool with that map and returns its data. Discover with `(fns)`.
 *
 * `def` keeps intermediate data in the session — out of the context window.
 *
 * ```ts
 * import { LispSession, mountLisp } from "glove-lisp";
 * import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
 *
 * const session = LispSession.create();
 * session.registerFns(await fnsFromMcp(conn));   // ToolFn[] — no table modeling
 * mountLisp(agent, { session });
 * // → the agent runs (count (github__list_pull_requests {:state "open"})),
 * //   branches with if/cond inside one program, and defs big intermediates.
 * ```
 *
 * Every program is read into a syntax tree before anything runs
 * (homoiconicity = the inspection surface is free), evaluation is strict
 * call-by-value (effects are exactly-once by construction), and a fuel budget
 * bounds runaway work.
 */
export { LispSession } from "./session";
export type {
  LispPolicy,
  LispSessionOptions,
  LispExecuteOptions,
  LispExecuteResult,
  LispStagedView,
  TouchedResource,
} from "./session";

export {
  mountLisp,
  buildExecuteLispTool,
  buildExplainLispTool,
  buildLispPreamble,
  LISP_PREAMBLE,
  LISP_FN_PREAMBLE,
  LISP_FN_SECTION,
  type LispToolOptions,
  type MountLispConfig,
} from "./mount";

// Re-exported for convenience — author functions and mount them on a session.
export {
  defineFn,
  fnFromTool,
  FnCatalog,
  type ToolFn,
  type ToolFnContext,
  type DefineFnSpec,
} from "glove-scratchpad";

export { explainProgram, type LispExplainResult, type ExplainedTouch } from "./explain";

export { readAll } from "./reader";
export { evalForm, apply, chargeFuel, LispError, NativeFn, Lambda, type EvalCtx } from "./eval";
export { Env, closest } from "./env";
export { stdlib } from "./stdlib";
export {
  Keyword,
  Sym,
  LList,
  Vec,
  MapLit,
  type Form,
  truthy,
  eq,
  printForm,
  elide,
  DEFAULT_ELIDE,
  type ElideLimits,
} from "./values";
