/**
 * Shared core types for glove-scratchpad.
 *
 * The package is a SQL interpreter over live resources; these are the small,
 * backend-agnostic types the interpreter and its backends share. The
 * manipulation surface is a defined Postgres subset — the backend behind it is
 * swappable (the default {@link "glove-sql".MemoryBackend}, the optional
 * {@link "glove-scratchpad/pglite".PgliteBackend}, or your own).
 */

/**
 * The closed value space a normalized column can take (§"the closure premise").
 * Used to coerce JS values into the form bound as a SQL parameter.
 */
export type ColumnType =
  | "text"
  | "bigint"
  | "double"
  | "boolean"
  | "jsonb"
  | "timestamptz";

/**
 * A row set returned by the backend. Structurally identical to `glove-sql`'s
 * `SqlResult` — kept here so the backend contract stays decoupled from any one
 * engine.
 */
export interface BackendResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID?: number }[];
}

/**
 * The Postgres-dialect backend contract, as a swappable adapter. Structurally
 * the same four methods as `glove-sql`'s `SqlBackend`, so `MemoryBackend`
 * satisfies it directly and a consumer can bring real Postgres / SQLite / PGlite.
 */
export interface ScratchpadBackend {
  /** Run a parameterised query (`$1`, `$2`, … placeholders). */
  query(sql: string, params?: unknown[]): Promise<BackendResult>;
  /** Run one or more statements with no result rows (DDL / batched DML). */
  exec(sql: string): Promise<void>;
  /** Serialise the entire backing state to bytes. */
  dump(): Promise<Uint8Array>;
  /** Release any resources (connections, WASM instances). */
  close(): Promise<void>;
}
