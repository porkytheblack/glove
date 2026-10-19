/**
 * The backend adapter: where an app's rows live. It is deliberately small —
 * run a statement, run a block atomically, change the structure — because
 * everything portable (named parameters, defaults, key assignment, value
 * normalisation, constraint checks the engine cannot do) lives in the runtime
 * above it. Writing a new backend means rendering four kinds of DDL in your
 * dialect and keeping a transaction honest.
 */

import type { ColumnDef, ColumnType, MigrationOp, Schema, TableDef } from "../types";

export type Row = Record<string, unknown>;

export type StructuralOp = Exclude<MigrationOp, { op: "sql" }>;

export interface MigrateOptions {
  /** Allow `_`-prefixed tables: set by the runtime for its own tables, never for an app's. */
  reserved?: boolean;
}

/**
 * One app's database. Every app gets its own, so an app is self-contained —
 * its rows, its event log and its applied version travel together, the way a
 * Durable Object's storage does.
 */
export interface AppStorage {
  /** Run one statement with `$1…$n` placeholders. */
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /**
   * Run `fn` atomically: all of its statements commit, or — when it throws —
   * none do. The runtime never nests these.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
  /**
   * Apply structural ops. Called inside `transaction`, so a failed migration
   * leaves the old structure in place. `before` is the schema the ops start
   * from; backends that rebuild tables need it.
   */
  migrate(ops: StructuralOp[], before: Schema, opts?: MigrateOptions): Promise<void>;
  /** Move key generators past explicitly inserted keys, where the engine needs it. */
  syncKeys?(schema: Schema): Promise<void>;
  /** The whole app as bytes, when the backend can (the memory backend can). */
  dump?(): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface BackendCapabilities {
  /** The engine enforces column types, NOT NULL, PRIMARY KEY and UNIQUE itself. */
  constraints: boolean;
  /** A json column comes back as text and is parsed on the way out. */
  jsonAsText: boolean;
}

export interface Backend {
  readonly name: string;
  readonly capabilities: BackendCapabilities;
  /** How the n-th (1-based) parameter is written in a statement. Default `$n`. */
  readonly placeholder?: (n: number) => string;
  /** Open (creating when absent) one app's database. `"_system"` is the host's registry. */
  open(app: string): Promise<AppStorage>;
  /** Delete an app's database. */
  drop(app: string): Promise<void>;
  /** The whole backend as bytes, when it lives in memory. */
  snapshot?(): Promise<Uint8Array>;
  close(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared DDL rendering
// ─────────────────────────────────────────────────────────────────────────────

export const q = (ident: string) => `"${ident.replace(/"/g, '""')}"`;

export interface Dialect {
  type(t: ColumnType): string;
  /** A column default as SQL, or undefined to leave it out. */
  literal(value: unknown, t: ColumnType): string;
  /** The clause that makes an integer primary key assign itself. */
  autoKey(table: string, column: string): string;
}

export function renderColumn(d: Dialect, table: string, name: string, c: ColumnDef, opts: { constraints: boolean }): string {
  const parts = [q(name), d.type(c.type)];
  if (c.primaryKey) {
    parts.push(c.type === "integer" ? d.autoKey(table, name) : "PRIMARY KEY");
  } else {
    if (c.default !== undefined) parts.push(`DEFAULT ${d.literal(c.default, c.type)}`);
    if (opts.constraints && !c.nullable) parts.push("NOT NULL");
    if (opts.constraints && c.unique) parts.push("UNIQUE");
  }
  return parts.join(" ");
}

export function renderCreateTable(d: Dialect, table: string, def: TableDef, opts: { constraints: boolean }): string {
  const cols = Object.entries(def.columns).map(([name, c]) => renderColumn(d, table, name, c, opts));
  return `CREATE TABLE ${q(table)} (${cols.join(", ")})`;
}

export function renderIndex(table: string, columns: string[]): string {
  return `CREATE INDEX ${q(`${table}__${columns.join("_")}__idx`)} ON ${q(table)} (${columns.map(q).join(", ")})`;
}

export function dropIndex(table: string, columns: string[]): string {
  return `DROP INDEX ${q(`${table}__${columns.join("_")}__idx`)}`;
}

/** SQL standard literals; good for SQLite and Postgres. */
export function standardLiteral(value: unknown, t: ColumnType, json: (v: unknown) => string): string {
  if (value === null) return "NULL";
  if (t === "json") return json(value);
  if (typeof value === "string") return `'${value.replace(/'/g, "''")}'`;
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new Error(`cannot write ${JSON.stringify(value)} as a ${t} default`);
}

/** The runtime's own tables, created in every app database. */
export const SYSTEM_TABLES: Schema = {
  _meta: {
    columns: {
      key: { type: "text", primaryKey: true },
      value: { type: "text", nullable: true },
    },
  },
  _events: {
    columns: {
      seq: { type: "integer", primaryKey: true },
      version: { type: "integer" },
      event: { type: "text" },
      data: { type: "text", nullable: true },
      caller: { type: "text" },
      at: { type: "text" },
    },
  },
};
