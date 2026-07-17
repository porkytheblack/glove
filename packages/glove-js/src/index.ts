/**
 * glove-js — a JavaScript REPL for LLM tool use.
 *
 * Instead of loading many tool definitions, expose an agent's capabilities as
 * async FUNCTIONS in a tiny, sandboxed JavaScript interpreter it drives with ONE
 * `execute_js` tool. Register a {@link ToolFn} (the same catalog glove-lisp's
 * function mode consumes) and calling `github.list_pull_requests({ state: "open" })`
 * invokes the tool with that object and returns its data. Top-level `const`/`let`
 * persist across calls, big values stay out of context via structural elision,
 * and a fuel budget + depth cap bound runaway work.
 *
 * ```ts
 * import { JsSession, mountJs } from "glove-js";
 * import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
 *
 * const session = JsSession.create();
 * session.registerAll(await fnsFromMcp(conn));   // ToolFn[] — no table modeling
 * mountJs(agent, { session });
 * // → the agent runs github.list_pull_requests({ state: "open" }).length,
 * //   branches with if/else in one program, and binds big intermediates to const.
 * ```
 *
 * The evaluator is an async tree-walker over an acorn parse (parse.ts validates
 * the whole tree against a whitelist before anything runs); member access is
 * mediated by a sandbox boundary (members.ts) so a program can't escape to the
 * host through a constructor chain.
 */
export { JsSession } from "./session";
export type { JsSessionOptions, JsExecuteOptions, JsExecuteResult } from "./session";

export {
  mountJs,
  buildExecuteJsTool,
  buildJsPreamble,
  buildJsPreambleBody,
  jsToolName,
  JS_PREAMBLE,
  type Frame,
  type JsToolOptions,
  type MountJsConfig,
} from "./mount";

export { parseProgram, type Program } from "./parse";
export { JsError } from "./errors";
export { runProgram, applyFunction, chargeFuel, BudgetError, Closure, type EvalCtx } from "./interp";
export { Scope } from "./scope";

// Re-exported for convenience — author functions and mount them on a session.
export {
  defineFn,
  fnFromTool,
  FnCatalog,
  type ToolFn,
  type ToolFnContext,
  type DefineFnSpec,
} from "glove-scratchpad";
