/**
 * Descriptor derivation — the metadata surface (§8.1).
 *
 * Reads shape from the *live* backend schema (not just the ingest plan), so it
 * works identically for ingested records and for records derived by
 * `CREATE TABLE AS <select>`. This is "the metadata surface is the real
 * interface": rich enough that a downstream subagent can plan without peeking.
 */
import type {
  ColumnDescriptor,
  ColumnType,
  ScratchpadBackend,
} from "./types";
import { quoteIdent } from "./keys";
import { RID, PARENT, IDX } from "./normalize";

const INTERNAL = new Set([RID, PARENT, IDX]);

/** Map a Postgres `information_schema` data type onto our compact {@link ColumnType}. */
export function pgTypeToColumnType(dataType: string): ColumnType {
  const t = dataType.toLowerCase();
  if (t === "boolean") return "boolean";
  if (t === "bigint" || t === "integer" || t === "smallint") return "bigint";
  if (t === "double precision" || t === "numeric" || t === "real") return "double";
  if (t === "jsonb" || t === "json") return "jsonb";
  if (t.startsWith("timestamp")) return "timestamptz";
  return "text";
}

interface RawColumn {
  name: string;
  type: ColumnType;
}

/** All columns of a table in ordinal order, including internal plumbing columns. */
export async function readRawColumns(
  backend: ScratchpadBackend,
  table: string,
): Promise<RawColumn[]> {
  const res = await backend.query(
    `SELECT column_name, data_type
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table],
  );
  return res.rows.map((r) => ({
    name: String(r.column_name),
    type: pgTypeToColumnType(String(r.data_type)),
  }));
}

/** Logical columns (internal plumbing filtered out), as {@link ColumnDescriptor}s. */
export function toColumnDescriptors(raw: RawColumn[]): ColumnDescriptor[] {
  return raw
    .filter((c) => !INTERNAL.has(c.name))
    .map((c) => ({
      name: c.name,
      field: c.name,
      type: c.type,
      nullable: true,
    }));
}

export async function readRowCount(
  backend: ScratchpadBackend,
  table: string,
): Promise<number> {
  const res = await backend.query(`SELECT count(*)::bigint AS n FROM ${quoteIdent(table)}`);
  return Number(res.rows[0]?.n ?? 0);
}

/**
 * A bounded, representative sample of a table's logical columns, ordered by
 * `_rid` when present so ingest order is stable.
 */
export async function readPreview(
  backend: ScratchpadBackend,
  table: string,
  raw: RawColumn[],
  limit: number,
): Promise<Record<string, unknown>[]> {
  const logical = raw.filter((c) => !INTERNAL.has(c.name)).map((c) => c.name);
  const cols = logical.length > 0 ? logical.map(quoteIdent).join(", ") : "*";
  const hasRid = raw.some((c) => c.name === RID);
  const order = hasRid ? ` ORDER BY ${quoteIdent(RID)}` : "";
  const res = await backend.query(
    `SELECT ${cols} FROM ${quoteIdent(table)}${order} LIMIT ${Math.max(0, Math.floor(limit))}`,
  );
  return res.rows;
}
