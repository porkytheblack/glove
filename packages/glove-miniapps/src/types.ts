/**
 * The shapes a mini app is made of. Everything here is plain JSON on purpose:
 * an agent writes a definition through a tool call, a host stores it as text,
 * and Kuiper receives the same object over HTTP. Code (a method body) travels
 * as a string and is checked at deploy time, not at first call.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The portable column types. Each backend renders them in its own dialect
 * (`json` is `jsonb` on Postgres and TEXT on SQLite), and values are
 * normalised on the way out so a boolean is a boolean on every backend.
 */
export type ColumnType = "text" | "integer" | "real" | "boolean" | "json" | "timestamp";

export interface ColumnDef {
  type: ColumnType;
  /** NULL allowed. Default false: a column is required unless it says otherwise. */
  nullable?: boolean;
  /** A literal used when an INSERT omits the column. JSON columns take any JSON value. */
  default?: string | number | boolean | null | Record<string, unknown> | unknown[];
  /**
   * The row's key. On an `integer` column it is also assigned on insert when
   * omitted (the SQLite `INTEGER PRIMARY KEY` rule, on every backend).
   */
  primaryKey?: boolean;
  unique?: boolean;
  description?: string;
}

export interface TableDef {
  description?: string;
  columns: Record<string, ColumnDef>;
  /** Each entry is one index over the listed columns. */
  indexes?: string[][];
}

export type Schema = Record<string, TableDef>;

// ─────────────────────────────────────────────────────────────────────────────
// Methods: the app's ABI
// ─────────────────────────────────────────────────────────────────────────────

export type ParamType = "string" | "integer" | "number" | "boolean" | "object" | "array" | "any";

export interface ParamDef {
  type: ParamType;
  optional?: boolean;
  description?: string;
  enum?: Array<string | number>;
}

/**
 * `query` reads and may be called concurrently with nothing else changing;
 * `action` runs in one transaction and either commits whole or not at all
 * (a throw, a failed constraint or running out of fuel reverts it). The split
 * is the smart-contract `view` / state-changing distinction, and it is what
 * lets a host hand read access around freely.
 */
export type MethodKind = "query" | "action";

export interface MethodDef {
  kind: MethodKind;
  description: string;
  params?: Record<string, ParamDef>;
  /**
   * SQL statements, run in order. Parameters are `:name`; `:caller` and `:now`
   * are always bound. The result is the last statement's rows.
   */
  sql?: string | string[];
  /**
   * A glove-js program. `args` and `ctx` are in scope; `db.query({ sql, params })`,
   * `db.one(...)`, `app.emit({ event, data })` and `apps.query({ app, method, args })`
   * are the only capabilities. The last expression is the result; `throw` reverts.
   */
  js?: string;
  /** For `sql` methods: return the first row (or null) instead of the row list. */
  returns?: "rows" | "one";
  /** For `sql` actions: emit this event with the result after the statements run. */
  emits?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Outputs and subscriptions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A read-only computation the host runs on a cadence, for the "every Monday,
 * tell me what slipped" shape. A string result is treated as markdown.
 */
export interface OutputDef {
  description: string;
  /** `30m`, `6h`, `1d`, `7d`. Absent: on demand only. */
  every?: string;
  sql?: string | string[];
  js?: string;
}

/**
 * Run one of this app's actions when another app emits an event. The
 * subscribing app's owner must hold the `events` grant on the source app; the
 * action runs with `caller` set to `app:<source>`.
 */
export interface SubscriptionDef {
  /** `<app>.<event>` */
  on: string;
  /** An action of this app. It receives the event's data as its args. */
  run: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The definition
// ─────────────────────────────────────────────────────────────────────────────

export interface AppDefinition {
  /** `[a-z][a-z0-9_]*`, unique per host. */
  name: string;
  description: string;
  schema: Schema;
  methods: Record<string, MethodDef>;
  outputs?: Record<string, OutputDef>;
  subscriptions?: SubscriptionDef[];
  /** Rows inserted when the app is first created (never on upgrade). */
  seed?: Record<string, Array<Record<string, unknown>>>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Migrations
// ─────────────────────────────────────────────────────────────────────────────

export type MigrationOp =
  | { op: "create_table"; table: string; def: TableDef }
  | { op: "drop_table"; table: string }
  | { op: "rename_table"; from: string; to: string }
  | { op: "add_column"; table: string; column: string; def: ColumnDef }
  | { op: "drop_column"; table: string; column: string }
  | { op: "rename_column"; table: string; from: string; to: string }
  | { op: "add_index"; table: string; columns: string[] }
  | { op: "drop_index"; table: string; columns: string[] }
  /** A data step, run after the structural ops before it. `:now` and `:caller` are bound. */
  | { op: "sql"; sql: string };

export interface Migration {
  ops: MigrationOp[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Access
// ─────────────────────────────────────────────────────────────────────────────

/** Who is calling: `agent:planner`, `user:42`, `app:tasks`. The host decides the namespace. */
export type Principal = string;

export interface Grant {
  /** A principal, or `*` for everyone the host lets reach the app. */
  to: Principal;
  /** Methods this principal may call, or `*` for all of them. */
  methods: string[] | "*";
  /** May read the event log and subscribe to it. */
  events?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the host reports
// ─────────────────────────────────────────────────────────────────────────────

export interface AppSummary {
  name: string;
  description: string;
  owner: Principal;
  /** `owner`, or `granted` when the caller holds a grant. */
  access: "owner" | "granted";
  version: number;
  methods: Array<{ name: string; kind: MethodKind; description: string }>;
  outputs: string[];
  updatedAt: string;
}

/** The app's interface: what a caller needs to use it. */
export interface AppDescription {
  name: string;
  description: string;
  owner: Principal;
  access: "owner" | "granted";
  version: number;
  updatedAt: string;
  schema: Schema;
  /** The methods this caller may call. */
  methods: Array<{ name: string; kind: MethodKind; description: string; params: Record<string, ParamDef> }>;
  outputs: Array<{ name: string; description: string; every?: string }>;
  subscriptions: SubscriptionDef[];
  /** Owner only: who else can reach the app. */
  grants?: Grant[];
  /** Owner only: the current definition, to edit and deploy again. */
  definition?: AppDefinition;
}

export interface AppEvent {
  seq: number;
  app: string;
  version: number;
  event: string;
  data: unknown;
  caller: Principal;
  at: string;
}

export interface CallResult<T = unknown> {
  value: T;
  /** Events emitted by this call, in order. */
  events: AppEvent[];
  /** The version the call ran against. */
  version: number;
  /** Subscribed actions that ran because of those events. A failure there does not undo this call. */
  deliveries?: Delivery[];
}

export interface Delivery {
  app: string;
  method: string;
  event: string;
  ok: boolean;
  error?: string;
}

export interface OutputResult {
  app: string;
  output: string;
  at: string;
  value: unknown;
  /** True when the value is a string, which is shown as markdown. */
  markdown: boolean;
}

export interface DeployResult {
  app: string;
  version: number;
  created: boolean;
  /** The ops that ran. For an additive change these were derived, not supplied. */
  migration: MigrationOp[];
  dryRun: boolean;
  warnings: string[];
}
