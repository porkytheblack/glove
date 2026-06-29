/**
 * The resource-table contract — the substrate-independent core of the database
 * emulator. A **resource** is an entity / data type (e.g. `github_pr`,
 * `linear_issue`, `emails`, `time`, `images`) presented to the model as a SQL
 * table. Its CRUD verbs map to (possibly different) underlying capabilities:
 *
 *   - `SELECT` → `select(bindings)` — read/list/get/search. WHERE equalities are
 *     pushed down as arguments (Steampipe's "required key columns" model), not
 *     just filters: `SELECT url FROM images WHERE prompt = '…'` feeds `prompt`
 *     to the resolver as an input.
 *   - `INSERT` → `insert(rows)` — create / send.
 *   - `UPDATE` → `update(set, bindings)` — modify.
 *   - `DELETE` → `delete(bindings)` — remove / close.
 *
 * Every verb is OPTIONAL and independently wired, so a read-only `time` resource
 * has only `select`, an `emails` (send) resource is `insert`-only, and a
 * `github_pr` resource wires all four to different tools.
 *
 * This module knows nothing about Glove or MCP — `defineResource` /
 * `resourceFromTool` (resource.ts) and `mcpResources` (mcp.ts) build these.
 */

export type Volatility = "immutable" | "stable" | "volatile";

/** The closed value space a pushed-down argument can take. */
export type SqlScalar = string | number | boolean | null;

export interface ResourceColumn {
  /** Column name as it appears in SQL and `information_schema`. */
  name: string;
  /**
   * Postgres-dialect type string used for the materialized table's DDL and for
   * `information_schema` (`text`, `bigint`, `double precision`, `boolean`,
   * `jsonb`, `timestamptz`).
   */
  type: string;
  description?: string;
  /**
   * A REQUIRED KEY column (Steampipe model): the resource cannot be SELECTed
   * unless this column is bound by a `WHERE col = …` equality. These are
   * resolver arguments, not filters over stored rows.
   */
  requiredKey?: boolean;
}

/**
 * Equality / IN arguments pushed down from WHERE / JOIN-ON, keyed by column
 * name. A column maps to one or more values (multi-valued when the predicate is
 * `col IN (a, b)`).
 */
export interface Bindings {
  readonly eq: ReadonlyMap<string, SqlScalar[]>;
  /** First value for a column, or `undefined` if unbound. */
  one(col: string): SqlScalar | undefined;
  /** All values bound to a column (empty if unbound). */
  all(col: string): SqlScalar[];
  has(col: string): boolean;
}

export interface ResourceContext {
  /** Forwarded from the active request so resolvers can abort long work. */
  signal?: AbortSignal;
  /**
   * Per-`execute` scratch. STABLE/IMMUTABLE resolvers may cache here; the
   * emulator also uses it to dedupe resolver calls within one statement.
   */
  readonly cache: Map<string, unknown>;
  /** Who is running the query (stamped for logging / provenance). */
  readonly actor?: string;
}

/**
 * A resource presented as a SQL table. The resolvers return arbitrary JSON; the
 * emulator shapes it to rows against {@link ResourceColumn} declarations.
 */
export interface ResourceTable {
  /** Physical relation name, e.g. `"time"`, `"github_pr"`. */
  name: string;
  description: string;
  /** All columns (pushdown/key columns AND result columns). */
  columns: ResourceColumn[];
  /**
   * Effect classification (Postgres `IMMUTABLE`/`STABLE`/`VOLATILE`). The
   * emulator resolves a resource EXACTLY ONCE per `execute` regardless, so a
   * volatile/effectful read can never be invoked N times by the planner; this
   * additionally governs caching: `stable` caches within one `execute`,
   * `immutable` across the database's lifetime.
   */
  volatility: Volatility;
  /** Read rows for the pushed-down arguments. Absent → the table is not readable. */
  select?(bindings: Bindings, ctx: ResourceContext): Promise<unknown>;
  /** Create rows. Absent → INSERT is rejected. */
  insert?(rows: Record<string, unknown>[], ctx: ResourceContext): Promise<unknown>;
  /** Update matching rows. Absent → UPDATE is rejected. */
  update?(set: Record<string, unknown>, bindings: Bindings, ctx: ResourceContext): Promise<unknown>;
  /** Delete matching rows. Absent → DELETE is rejected. */
  delete?(bindings: Bindings, ctx: ResourceContext): Promise<unknown>;
}

/** Build a {@link Bindings} view over an equality map. */
export function makeBindings(eq: Map<string, SqlScalar[]>): Bindings {
  return {
    eq,
    one: (col) => eq.get(col)?.[0],
    all: (col) => eq.get(col) ?? [],
    has: (col) => eq.has(col),
  };
}

/** Canonical key for a bindings map — dedupe/cache resolver calls. */
export function bindingsKey(eq: ReadonlyMap<string, SqlScalar[]>): string {
  return JSON.stringify(
    [...eq.entries()]
      .map(([k, v]) => [k, [...v].sort()] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
  );
}
