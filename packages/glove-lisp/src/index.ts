/**
 * glove-lisp — a Lisp REPL for LLM tool use.
 *
 * Instead of loading many tool definitions, expose an agent's capabilities as
 * FUNCTIONS in a tiny, sandboxed, Clojure-flavored Lisp it drives with ONE
 * `execute_lisp` tool. Resources (the same {@link ResourceTable} contract as
 * glove-scratchpad) become functions; reads push arguments down as maps,
 * writes go through `insert!`/`update!`/`delete!`, `(stage …)`/`(commit!)`
 * stages outbound effects, `(tables)`/`(describe :name)` is discovery, and
 * `def` keeps intermediate data in the session — out of the context window.
 *
 * ```ts
 * import { LispSession, mountLisp } from "glove-lisp";
 *
 * const session = LispSession.create({ policy: { writes: true } });
 * session.registerAll(resources);          // ResourceTable[] — same catalog as glove-scratchpad
 * mountLisp(agent, { session, allowWrites: true });
 * // → the agent runs (count (github_pull_requests {:state "open"})), branches
 * //   with if/cond inside one program, and defs big intermediates off-context.
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
  LISP_PREAMBLE,
  type LispToolOptions,
  type MountLispConfig,
} from "./mount";

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
