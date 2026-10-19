export type {
  AppDefinition,
  AppDescription,
  AppEvent,
  AppSummary,
  CallResult,
  ColumnDef,
  ColumnType,
  Delivery,
  DeployResult,
  Grant,
  MethodDef,
  MethodKind,
  Migration,
  MigrationOp,
  OutputDef,
  OutputResult,
  ParamDef,
  ParamType,
  Principal,
  Schema,
  SubscriptionDef,
  TableDef,
} from "./types";

export { defineMiniApp, validateDefinition, parseInterval } from "./define";
export { MiniAppError, isMiniAppError, HTTP_STATUS, type MiniAppErrorCode } from "./errors";
export { applyOps, diffSchemas, deriveAdditiveOps, SchemaError } from "./schema";
export { checkStatement, compileNamed, inspectStatement, PORTABLE_FUNCTIONS } from "./sql";
export { createAppHost, startTicker, type AppHost, type AppHostOptions, type Caller, type DeployOptions } from "./host";

export type { AppStorage, Backend, BackendCapabilities, Row } from "./backends/backend";
export { memoryBackend, type MemoryBackendOptions } from "./backends/memory";
// SQLite and Postgres are subpath exports (`glove-miniapps/sqlite`,
// `glove-miniapps/postgres`): they need Node, and the root entry — the
// in-memory host, the tools, the HTTP client — runs anywhere.

export {
  MINIAPPS_GUIDE,
  describeApps,
  methodTools,
  miniAppFns,
  miniAppTools,
  mountMiniApps,
  paramsSchema,
  type MiniAppFn,
  type MiniAppTool,
  type MiniAppToolResult,
  type MiniAppsMountable,
  type MountMiniAppsOptions,
  type MountedMiniApps,
} from "./tools";
export { EXAMPLE_APP } from "./example";
export { serveMiniApps, remoteAppHost, type Authenticated, type ServeOptions, type RemoteAppHostOptions } from "./http";
