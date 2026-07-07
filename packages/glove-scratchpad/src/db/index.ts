/**
 * glove-scratchpad/db — the database emulator: resources as tables, queried with
 * a single `execute_sql` tool.
 *
 * ```ts
 * import { Database, defineResource, resourceFromTool, mountDatabase } from "glove-scratchpad";
 *
 * const db = await Database.create({ policy: { writes: true } });
 * db.register(resourceFromTool(getTimeTool, { name: "time", volatility: "stable", columns: [{ name: "now", type: "timestamptz" }] }));
 * mountDatabase(agent, { db });
 * // …the model now discovers via information_schema and invokes tools as SQL.
 * ```
 */
export {
  Database,
  type DatabaseOptions,
  type DatabasePolicy,
  type ExecuteOptions,
  type ExecuteResult,
  type ExplainResult,
  type TouchedRelation,
} from "./database";

export { Catalog } from "./catalog";

export {
  defineResource,
  resourceFromTool,
  columnsFromZod,
  type DefineResourceSpec,
  type DefineZodResourceSpec,
  type ResourceFromToolSpec,
} from "./resource";

export {
  makeBindings,
  bindingsKey,
  type ResourceTable,
  type ResourceColumn,
  type ResourceContext,
  type Bindings,
  type TypedBindings,
  type Volatility,
  type SqlScalar,
} from "./provider";

export { materializeTable, toRows, pgToColumnType } from "./materialize";

export {
  Transaction,
  type StagedWrite,
  type StagedWriteView,
} from "./transaction";

export {
  buildExecuteSqlTool,
  buildExplainSqlTool,
  type DatabaseToolOptions,
} from "./surface";

export { mountDatabase, DATABASE_PREAMBLE, type MountDatabaseConfig } from "./mount";
