/**
 * Materialize resolver rows into the transient SQL backend.
 *
 * The interpreter resolves each resource ONCE, up front, then writes the rows
 * into a real (ephemeral) table so the synchronous engine can JOIN / GROUP /
 * window over them. This is the seam that reconciles async resolvers with the
 * engine's synchronous evaluator (which calls FROM-resolution lazily and
 * repeatedly — so an inline async hook would invoke an effectful resolver N
 * times; pre-materialization invokes it exactly once).
 *
 * The DDL is authored from the resource's DECLARED columns (not inferred from
 * data) so the schema is stable for `SELECT col …` and `information_schema` even
 * when a call returns zero rows. Rows are mapped onto declared columns by name;
 * nested object/array cells land in `jsonb` columns, reachable via `-> / ->>`.
 *
 * The chunked-insert logic mirrors the (removed) Scratchpad store so the same
 * Postgres bind-parameter limits are respected.
 */
import { quoteIdent } from "../core/keys";
import { coerceForInsert } from "../core/normalize";
import type { ColumnType } from "../core/types";
import type { SqlBackend } from "glove-sql";
import type { ResourceColumn } from "./provider";

/** Postgres max bind params per statement; chunk inserts well under it. */
const MAX_PARAMS = 60000;

/** Map a Postgres-dialect type string to the normalize layer's coercion type. */
export function pgToColumnType(pg: string): ColumnType {
  const t = pg.trim().toLowerCase();
  if (t === "bigint" || t === "int" || t === "integer" || t === "smallint" || t === "int4" || t === "int8") {
    return "bigint";
  }
  if (t.startsWith("double") || t === "real" || t === "numeric" || t === "decimal" || t === "float" || t === "float8") {
    return "double";
  }
  if (t === "boolean" || t === "bool") return "boolean";
  if (t === "jsonb" || t === "json") return "jsonb";
  if (t === "timestamptz" || t.startsWith("timestamp")) return "timestamptz";
  return "text";
}

/** Normalize a resolver's return value into an array of flat row objects. */
export function toRows(data: unknown): Record<string, unknown>[] {
  if (data === null || data === undefined) return [];
  if (Array.isArray(data)) {
    return data.map((d) => (isPlainObject(d) ? d : ({ value: d } as Record<string, unknown>)));
  }
  if (isPlainObject(data)) return [data];
  // A bare scalar/string resolves to a single { value } row.
  return [{ value: data }];
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `CREATE TABLE <name>` from declared columns, then bulk-insert `rows`. Rows are
 * keyed by column name; undeclared fields are ignored, missing ones become null.
 */
export async function materializeTable(
  backend: SqlBackend,
  name: string,
  columns: ResourceColumn[],
  rows: Record<string, unknown>[],
): Promise<void> {
  if (columns.length === 0) {
    throw new Error(`glove-scratchpad: resource "${name}" declares no columns`);
  }
  const colDefs = columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(",\n  ");
  // DROP first so a table leaked by an earlier partially-failed materialization
  // (or a name that collides with a prior statement's ephemeral) can never make
  // this CREATE fail with "relation already exists".
  await backend.exec(`DROP TABLE IF EXISTS ${quoteIdent(name)} CASCADE;`);
  await backend.exec(`CREATE TABLE ${quoteIdent(name)} (\n  ${colDefs}\n);`);
  if (rows.length === 0) return;

  const colTypes = columns.map((c) => pgToColumnType(c.type));
  const jsonbIdx = new Set(colTypes.map((t, i) => (t === "jsonb" ? i : -1)).filter((i) => i >= 0));
  const colList = columns.map((c) => quoteIdent(c.name)).join(", ");
  const perChunk = Math.max(1, Math.floor(MAX_PARAMS / Math.max(1, columns.length)));

  for (let start = 0; start < rows.length; start += perChunk) {
    const chunk = rows.slice(start, start + perChunk);
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const row of chunk) {
      const placeholders: string[] = [];
      for (let i = 0; i < columns.length; i++) {
        params.push(coerceForInsert(colTypes[i], row[columns[i].name]));
        const ph = `$${params.length}`;
        placeholders.push(jsonbIdx.has(i) ? `${ph}::jsonb` : ph);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }
    await backend.query(
      `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES ${tuples.join(", ")}`,
      params,
    );
  }
}
