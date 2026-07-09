/**
 * glove-python — a Python REPL for LLM tool use.
 *
 * Instead of loading many tool definitions, expose an agent's capabilities as
 * FUNCTIONS in a tiny, sandboxed Python interpreter it drives with ONE
 * `execute_python` tool. Register a {@link ToolFn} (the same catalog glove-js and
 * glove-lisp's function mode consume) and calling
 * `github.list_pull_requests(state="open")` invokes the tool with that keyword
 * object and returns its data. Top-level names persist across calls, big values
 * stay out of context via structural elision, and a fuel budget + depth cap
 * bound runaway work.
 *
 * ```ts
 * import { PySession, mountPy } from "glove-python";
 * import { fnsFromMcp } from "glove-scratchpad/fns/mcp";
 *
 * const session = PySession.create();
 * session.registerAll(await fnsFromMcp(conn));   // ToolFn[] — no table modeling
 * mountPy(agent, { session });
 * // → the agent runs len(github.list_pull_requests(state="open")),
 * //   filters with a comprehension, and binds big intermediates to a name.
 * ```
 *
 * The evaluator is an async tree-walker over a `@lezer/python` parse (parse.ts
 * normalizes the CST to a small AST and rejects anything outside the subset
 * before anything runs); attribute access is mediated by a sandbox boundary
 * (members.ts) that blocks dunder attributes so a program can't climb to the
 * host through the `().__class__.__subclasses__()` chain.
 */
export { PySession } from "./session";
export type { PySessionOptions, PyExecuteOptions, PyExecuteResult } from "./session";

export {
  mountPy,
  buildExecutePythonTool,
  buildPyPreamble,
  PY_PREAMBLE,
  type PyToolOptions,
  type MountPyConfig,
} from "./mount";

export { parseProgram } from "./parse";
export type { Module } from "./ast";
export { PyError } from "./errors";
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
