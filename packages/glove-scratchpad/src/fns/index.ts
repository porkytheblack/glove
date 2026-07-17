/**
 * `glove-scratchpad/fns` — capabilities as plain callables, the light
 * alternative to the {@link ../db/provider!ResourceTable} table contract.
 *
 * Author with {@link defineFn}, wrap existing Glove tools with
 * {@link fnFromTool}, or bridge a whole MCP server with `fnsFromMcp` (from
 * `glove-scratchpad/fns/mcp` — optional-peer subpath). Mount the resulting
 * catalog on a REPL surface: glove-lisp's function mode or glove-js.
 */
export {
  assertFnName,
  defineFn,
  FnCatalog,
  summarizeZodError,
  type DefineFnSpec,
  type ToolFn,
  type ToolFnContext,
} from "./catalog";
export { fnFromTool, parseToolData, type FnFromToolOptions } from "./from-tool";
export { defineModelFn, newModelFnUsage, type DefineModelFnSpec, type ModelFnUsage } from "./model";
export {
  describeFn,
  fnSignature,
  missingRequired,
  unknownKeys,
  type FnDescription,
  type FnParam,
} from "./signature";
export { deriveShape, sampleOne, sampleResultShapes, type SampleShapesOptions } from "./shape";
export {
  serverOf,
  groupByServer,
  serverSummaries,
  fnsForServer,
  serverFunctionSignatures,
  searchFns,
  type ServerSummary,
} from "./discovery";
export { closest, DEFAULT_ELIDE, elide, type ElideLimits, type ElideOptions } from "./shared";
