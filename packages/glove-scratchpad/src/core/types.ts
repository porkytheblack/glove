/**
 * Core types for the Scratchpad Computer.
 *
 * These are the load-bearing vocabulary of the architecture:
 *
 * - A {@link Reference} is a readable key naming a record in the store.
 * - A {@link Descriptor} is the *metadata surface* of a record — columns,
 *   types, row count, preview, provenance — what agents reason over instead
 *   of payloads (§8 "the descriptor economy").
 * - A {@link Stub} is what a tool returns instead of a payload: a reference
 *   plus a descriptor plus a "read more" hint (§3 "store-and-truncate").
 * - A {@link ScratchpadBackend} is the swappable implementation of the
 *   Postgres-dialect contract (§6.1 "the dialect is the interface; the
 *   backend is an implementation detail").
 */

/** A readable key naming a record in the store. */
export type Reference = string;

/**
 * Where a record came from. Nearly free to capture, and it pays for itself
 * twice: graph debugging and a cost ledger (§6.3).
 */
export interface Provenance {
  /**
   * What produced this record. Conventionally a short tag:
   * `"ingest"`, `"query"`, `"tool:notion__search"`, `"mcp:gmail__list"`.
   */
  source: string;
  /** Which subagent / actor produced it (e.g. a subagent name). */
  actor?: string;
  /** ISO 8601 timestamp. Stamped by the store at ingest time when omitted. */
  timestamp?: string;
  /** Free-form rationale — e.g. the SQL string that produced a derived record. */
  note?: string;
}

/**
 * The closed value space every ingest is reduced to (§4 "the closure premise").
 * Every MCP/tool return is one of: an array, an object (possibly with nested
 * arrays), or a scalar/string.
 */
export type ColumnType =
  | "text"
  | "bigint"
  | "double"
  | "boolean"
  | "jsonb"
  | "timestamptz";

export interface ColumnDescriptor {
  /** Logical column name (the original JSON field, sanitised for SQL). */
  name: string;
  /** The original JSON field name, before identifier sanitisation. */
  field: string;
  type: ColumnType;
  nullable: boolean;
}

/**
 * How a record was laid out by first-level normalization (§7).
 *
 * - `role: "root"` — the top-level table: scalar fields promoted to columns,
 *   nested objects / mixed depth left in `jsonb`.
 * - `role: "child"` — a nested array pulled into its own table with a foreign
 *   key back to the parent and an `idx` column preserving array order.
 */
export interface TableDescriptor {
  /** Physical table name in the backend. */
  table: string;
  role: "root" | "child";
  columns: ColumnDescriptor[];
  rowCount: number;
  /** For child tables: the parent table and the field this array came from. */
  parent?: { table: string; field: string };
}

/**
 * The metadata surface of a record. Agents plan against this; they touch
 * `value` only by deliberately materialising a bounded slice (§8.1).
 *
 * This is the real interface (§8.1): if it is too thin, agents materialise
 * *defensively* just to see what they are holding, and the discipline
 * collapses. It must carry enough shape to plan without peeking.
 */
export interface Descriptor {
  ref: Reference;
  /**
   * - `table` — normalized rows (object / array of objects).
   * - `scalar` — a single non-string scalar (number / boolean).
   * - `text` — a string blob (the common MCP "joined text" return).
   */
  kind: "table" | "scalar" | "text";
  /** Columns of the root table (convenience mirror of `tables[0].columns`). */
  columns: ColumnDescriptor[];
  /** Row count of the root table. */
  rowCount: number;
  /** The root table plus any child tables produced by normalization. */
  tables: TableDescriptor[];
  /** A representative bounded sample of the root table. */
  preview: Record<string, unknown>[];
  provenance: Provenance;
  /** Serialised byte size of the original payload — feeds the cost ledger. */
  rawBytes?: number;
  /** For `kind: "text"` records, the character length of the string. */
  textLength?: number;
}

/**
 * What crosses the wire between subagents instead of a payload (§8).
 * A reference, a descriptor, and a hint on how to read more — never values.
 */
export interface Stub {
  ref: Reference;
  descriptor: Descriptor;
  /** Agent-facing instruction on how to narrow or materialise this record. */
  readMore: string;
}

/** A row set returned by the backend. */
export interface BackendResult {
  rows: Record<string, unknown>[];
  fields: { name: string; dataTypeID?: number }[];
}

/**
 * The Postgres-dialect contract, as a swappable adapter (§6.1).
 *
 * The Scratchpad emits Postgres-dialect SQL against this interface and never
 * knows what is actually backing it — real Postgres, an embedded engine
 * (the shipped {@link "glove-scratchpad/pglite".PgliteBackend}), or a
 * user-built emulator over a plain object. **The subset is the standard,
 * not the backend.**
 */
export interface ScratchpadBackend {
  /** Run a parameterised query (`$1`, `$2`, … placeholders). */
  query(sql: string, params?: unknown[]): Promise<BackendResult>;
  /** Run one or more statements with no result rows (DDL / batched DML). */
  exec(sql: string): Promise<void>;
  /**
   * Serialise the entire backing state to bytes — the substrate of
   * "computation as a value" (§10). The whole store becomes a value that can
   * be torn down and brought back to life later.
   */
  dump(): Promise<Uint8Array>;
  /** Release any resources (connections, WASM instances). */
  close(): Promise<void>;
}
