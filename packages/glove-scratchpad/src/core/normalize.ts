/**
 * First-level normalization (§7).
 *
 * Turns an arbitrary JSON value into a *plan* of tables the store can create
 * and fill. The rule, applied exactly once (depth-1):
 *
 *   - scalar fields of the top object  → typed columns of the root table;
 *   - nested arrays                    → child tables with a foreign key back
 *                                        to the parent plus an `_idx` column
 *                                        preserving array order;
 *   - anything deeper (nested objects, arrays-of-arrays, mixed scalars)
 *                                      → a `jsonb` column, reachable in place
 *                                        via `->` / `->>` (§6.2).
 *
 * "However many levels deep" is just iterating this same pass; depth-1 is the
 * pass run once. Un-normalized depth is never out of reach — it is one `jsonb`
 * operator away — so stopping here is an ergonomics choice, not a capability
 * gate (§7).
 *
 * The planner is pure and deterministic: it assigns row ids in JS (`_rid`,
 * `_parent`, `_idx`) so ingestion needs no `RETURNING`/serial round-trips and
 * snapshots are reproducible.
 */
import type { ColumnType } from "./types";
import { childTableName, uniqueColumn } from "./keys";

/** Internal columns. Sanitised field names never start with `_`, so these never collide. */
export const RID = "_rid";
export const PARENT = "_parent";
export const IDX = "_idx";

export interface NormColumn {
  /** SQL identifier. */
  name: string;
  /** Original JSON field name. */
  field: string;
  type: ColumnType;
}

export interface NormTable {
  table: string;
  role: "root" | "child";
  /** For child tables: the parent field this array came from. */
  parentField?: string;
  columns: NormColumn[];
  /** Column names (SQL identifiers) that hold `jsonb` and need a `::jsonb` cast on insert. */
  jsonbCols: string[];
  /** Whether rows carry an `_idx` (root that came from an array, or any child). */
  hasIdx: boolean;
  /** Whether rows carry a `_parent` FK (child tables). */
  isChild: boolean;
  /** Row objects keyed by column name, plus `_rid` / `_parent` / `_idx`. */
  rows: Array<Record<string, unknown>>;
}

export interface NormalizationPlan {
  kind: "table" | "scalar" | "text";
  rootTable: string;
  /** Root table first, then child tables. */
  tables: NormTable[];
  rawBytes: number;
  textLength?: number;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const SAFE_INT_MAX = Number.MAX_SAFE_INTEGER;

/** Infer a column type from the values a single field takes across all rows. */
function inferScalarType(values: unknown[]): ColumnType {
  let sawBool = false;
  let sawNum = false;
  let sawStr = false;
  let sawOther = false;
  let allInt = true;
  let allNull = true;
  for (const v of values) {
    if (v === null || v === undefined) continue;
    allNull = false;
    if (typeof v === "boolean") sawBool = true;
    else if (typeof v === "number") {
      sawNum = true;
      if (!Number.isInteger(v) || Math.abs(v) > SAFE_INT_MAX) allInt = false;
    } else if (typeof v === "string") sawStr = true;
    else sawOther = true;
  }
  if (allNull) return "text";
  if (sawOther) return "jsonb";
  if (sawBool && !sawNum && !sawStr) return "boolean";
  if (sawNum && !sawBool && !sawStr) return allInt ? "bigint" : "double";
  if (sawStr && !sawBool && !sawNum) return "text";
  return "jsonb"; // mixed scalar types → keep lossless
}

/** Union of field names across a set of row objects, in first-seen order. */
function fieldUnion(rows: Record<string, unknown>[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
    }
  }
  return out;
}

/** Coerce a JS value into the form bound as a SQL parameter for `type`. */
export function coerceForInsert(type: ColumnType, value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (type === "jsonb") return JSON.stringify(value);
  if (type === "bigint") return typeof value === "number" ? value : Number(value);
  if (type === "double") return typeof value === "number" ? value : Number(value);
  if (type === "boolean") return Boolean(value);
  if (type === "text") return typeof value === "string" ? value : String(value);
  return value;
}

/**
 * Decide columns for a set of row objects.
 *
 * `extractChildren` is true only for the root: array-valued fields become child
 * tables (returned via `childFields`) instead of columns. In child tables,
 * arrays collapse to `jsonb` (no grandchild extraction — that would be level 2).
 */
function inferColumns(
  rows: Record<string, unknown>[],
  extractChildren: boolean,
): { columns: NormColumn[]; jsonbCols: string[]; childFields: string[] } {
  const fields = fieldUnion(rows);
  const columns: NormColumn[] = [];
  const jsonbCols: string[] = [];
  const childFields: string[] = [];
  const usedNames = new Set<string>([RID, PARENT, IDX]);

  for (const field of fields) {
    const values = rows.map((r) => r[field]);
    const nonNull = values.filter((v) => v !== null && v !== undefined);
    const anyArray = values.some((v) => Array.isArray(v));
    const anyObject = values.some((v) => isPlainObject(v));
    // Promote a field to a child table only when EVERY non-null value is an
    // array. A heterogeneous field (e.g. `[{tags:["a"]}, {tags:"b"}]`) would
    // otherwise lose its non-array cells in the extraction path — keep it as a
    // jsonb column instead so nothing is dropped.
    const allArray = nonNull.length > 0 && nonNull.every((v) => Array.isArray(v));

    if (extractChildren && allArray) {
      childFields.push(field);
      continue;
    }

    let type: ColumnType;
    if (anyArray || anyObject) type = "jsonb";
    else type = inferScalarType(values);

    const name = uniqueColumn(field, usedNames);
    usedNames.add(name);

    columns.push({ name, field, type });
    if (type === "jsonb") jsonbCols.push(name);
  }

  return { columns, jsonbCols, childFields };
}

/** Build the row objects (keyed by column name) for a table from its source rows. */
function materialiseRows(
  sourceRows: Record<string, unknown>[],
  columns: NormColumn[],
  opts: { startRid: number; withIdx: boolean; parentIds?: number[]; idx?: number[] },
): { rows: Array<Record<string, unknown>>; nextRid: number } {
  const rows: Array<Record<string, unknown>> = [];
  let rid = opts.startRid;
  for (let i = 0; i < sourceRows.length; i++) {
    const src = sourceRows[i];
    const row: Record<string, unknown> = { [RID]: rid };
    if (opts.withIdx) row[IDX] = opts.idx ? opts.idx[i] : i;
    if (opts.parentIds) row[PARENT] = opts.parentIds[i];
    for (const col of columns) {
      row[col.name] = coerceForInsert(col.type, src[col.field]);
    }
    rows.push(row);
    rid++;
  }
  return { rows, nextRid: rid };
}

/** Wrap scalar array elements as `{ value: el }` rows so they get a `value` column. */
function asRowObjects(elements: unknown[]): Record<string, unknown>[] {
  return elements.map((el) =>
    isPlainObject(el) ? el : ({ value: el } as Record<string, unknown>),
  );
}

/**
 * Plan how to lay out `value` under root table `ref`. Pure — performs no I/O.
 */
export function planNormalization(value: unknown, ref: string): NormalizationPlan {
  const json = JSON.stringify(value);
  const rawBytes = json === undefined ? 0 : new TextEncoder().encode(json).length;

  // ── scalar / text record ────────────────────────────────────────────────
  if (!Array.isArray(value) && !isPlainObject(value)) {
    const isText = typeof value === "string";
    const type: ColumnType =
      typeof value === "boolean"
        ? "boolean"
        : typeof value === "number"
          ? Number.isInteger(value)
            ? "bigint"
            : "double"
          : "text";
    const col: NormColumn = { name: "value", field: "value", type };
    return {
      kind: isText ? "text" : "scalar",
      rootTable: ref,
      rawBytes,
      textLength: isText ? (value as string).length : undefined,
      tables: [
        {
          table: ref,
          role: "root",
          columns: [col],
          jsonbCols: [], // a bare scalar/text record never produces a jsonb column
          hasIdx: false,
          isChild: false,
          rows: [
            { [RID]: 1, value: coerceForInsert(type, value) },
          ],
        },
      ],
    };
  }

  // ── tabular record (object or array) ──────────────────────────────────────
  const rootIsArray = Array.isArray(value);
  const sourceRows: Record<string, unknown>[] = rootIsArray
    ? asRowObjects(value as unknown[])
    : [value as Record<string, unknown>];

  const { columns, jsonbCols, childFields } = inferColumns(sourceRows, true);
  const rootMat = materialiseRows(sourceRows, columns, {
    startRid: 1,
    withIdx: rootIsArray,
  });

  const tables: NormTable[] = [
    {
      table: ref,
      role: "root",
      columns,
      jsonbCols,
      hasIdx: rootIsArray,
      isChild: false,
      rows: rootMat.rows,
    },
  ];

  // ── child tables: one per array-valued root field ─────────────────────────
  let ridCursor = rootMat.nextRid;
  for (const field of childFields) {
    const childElements: unknown[] = [];
    const parentIds: number[] = [];
    const childIdx: number[] = [];
    for (let i = 0; i < sourceRows.length; i++) {
      const cell = sourceRows[i][field];
      if (!Array.isArray(cell)) continue;
      const parentRid = rootMat.rows[i][RID] as number;
      cell.forEach((el, j) => {
        childElements.push(el);
        parentIds.push(parentRid);
        childIdx.push(j); // `_idx` resets per parent row, preserving array order
      });
    }
    if (childElements.length === 0) continue;

    const childRowObjects = asRowObjects(childElements);
    const childCols = inferColumns(childRowObjects, false); // arrays → jsonb here
    const childMat = materialiseRows(childRowObjects, childCols.columns, {
      startRid: ridCursor,
      withIdx: true,
      parentIds,
      idx: childIdx,
    });
    ridCursor = childMat.nextRid;

    tables.push({
      table: childTableName(ref, field),
      role: "child",
      parentField: field,
      columns: childCols.columns,
      jsonbCols: childCols.jsonbCols,
      hasIdx: true,
      isChild: true,
      rows: childMat.rows,
    });
  }

  return { kind: "table", rootTable: ref, tables, rawBytes };
}
