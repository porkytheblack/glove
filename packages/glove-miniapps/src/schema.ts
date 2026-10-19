/**
 * The schema is a value. Migrations are ops over that value, so the host can
 * apply an agent's ops to the current schema and compare the result with the
 * schema the new definition declares — before any database is touched. A
 * migration that does not produce the declared schema is refused with the
 * difference, which is the class of mistake an agent makes most (a rename
 * written as a drop and an add, a new required column with no default).
 */

import type { ColumnDef, ColumnType, MigrationOp, Schema, TableDef } from "./types";

export const IDENT = /^[a-z][a-z0-9_]*$/;
export const COLUMN_TYPES: readonly ColumnType[] = ["text", "integer", "real", "boolean", "json", "timestamp"];

export class SchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaError";
  }
}

/** A reserved prefix: the runtime keeps its own tables (`_events`, `_meta`) beside the app's. */
const RESERVED_PREFIX = "_";

export function validateSchema(schema: Schema): void {
  if (!schema || typeof schema !== "object") throw new SchemaError("schema must be an object of tables");
  for (const [table, def] of Object.entries(schema)) validateTable(table, def);
}

function validateTable(table: string, def: TableDef, reserved = false): void {
  if (!IDENT.test(reserved ? table.replace(/^_+/, "") : table)) {
    throw new SchemaError(
      `table "${table}": names are lowercase letters, digits and _, starting with a letter` +
        (table.startsWith(RESERVED_PREFIX) ? " (a leading _ is reserved for the runtime's own tables)" : ""),
    );
  }
  if (!def || typeof def.columns !== "object" || Object.keys(def.columns).length === 0) {
    throw new SchemaError(`table "${table}" needs at least one column`);
  }
  let keys = 0;
  for (const [col, c] of Object.entries(def.columns)) {
    validateColumn(table, col, c);
    if (c.primaryKey) keys++;
  }
  if (keys > 1) throw new SchemaError(`table "${table}" has ${keys} primary key columns; declare at most one`);
  for (const index of def.indexes ?? []) {
    if (!Array.isArray(index) || index.length === 0) throw new SchemaError(`table "${table}": an index is a non-empty list of columns`);
    for (const col of index) {
      if (!def.columns[col]) throw new SchemaError(`table "${table}": index column "${col}" is not a column of the table`);
    }
  }
}

function validateColumn(table: string, col: string, c: ColumnDef): void {
  if (!IDENT.test(col)) throw new SchemaError(`${table}.${col}: column names are lowercase letters, digits and _`);
  if (!c || !COLUMN_TYPES.includes(c.type)) {
    throw new SchemaError(`${table}.${col}: type must be one of ${COLUMN_TYPES.join(", ")} (got ${JSON.stringify(c?.type)})`);
  }
  if (c.primaryKey && c.nullable) throw new SchemaError(`${table}.${col}: a primary key cannot be nullable`);
  if (c.default !== undefined && c.default !== null && c.type !== "json") {
    const ok =
      (c.type === "text" || c.type === "timestamp") ? typeof c.default === "string"
      : c.type === "boolean" ? typeof c.default === "boolean"
      : typeof c.default === "number" && (c.type === "real" || Number.isInteger(c.default));
    if (!ok) throw new SchemaError(`${table}.${col}: default ${JSON.stringify(c.default)} is not a ${c.type}`);
  }
}

/** The integer primary key the runtime assigns on insert, if the table has one. */
export function autoKey(def: TableDef): string | undefined {
  for (const [col, c] of Object.entries(def.columns)) if (c.primaryKey && c.type === "integer") return col;
  return undefined;
}

export function indexName(table: string, columns: string[]): string {
  return `${table}__${columns.join("_")}__idx`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ops over the value
// ─────────────────────────────────────────────────────────────────────────────

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** Apply migration ops to a schema value. Throws on an op that cannot apply. */
export function applyOps(schema: Schema, ops: MigrationOp[], opts: { reserved?: boolean } = {}): Schema {
  const next = clone(schema);
  ops.forEach((op, i) => {
    const where = `migration op ${i + 1} (${op.op})`;
    const table = (name: string): TableDef => {
      const t = next[name];
      if (!t) throw new SchemaError(`${where}: there is no table "${name}"`);
      return t;
    };
    switch (op.op) {
      case "create_table":
        if (next[op.table]) throw new SchemaError(`${where}: table "${op.table}" already exists`);
        validateTable(op.table, op.def, opts.reserved);
        next[op.table] = clone(op.def);
        break;
      case "drop_table":
        table(op.table);
        delete next[op.table];
        break;
      case "rename_table":
        if (next[op.to]) throw new SchemaError(`${where}: table "${op.to}" already exists`);
        if (!IDENT.test(op.to)) throw new SchemaError(`${where}: "${op.to}" is not a valid table name`);
        next[op.to] = table(op.from);
        delete next[op.from];
        break;
      case "add_column": {
        const t = table(op.table);
        if (t.columns[op.column]) throw new SchemaError(`${where}: ${op.table}.${op.column} already exists`);
        validateColumn(op.table, op.column, op.def);
        if (op.def.primaryKey) throw new SchemaError(`${where}: a primary key cannot be added to an existing table`);
        if (op.def.unique) throw new SchemaError(`${where}: add ${op.table}.${op.column} first, fill it, then add a unique index`);
        if (!op.def.nullable && op.def.default === undefined) {
          throw new SchemaError(
            `${where}: ${op.table}.${op.column} is required and has no default, so existing rows would have no value. ` +
              `Give it a default, or make it nullable and fill it with a { op: "sql" } step.`,
          );
        }
        t.columns[op.column] = clone(op.def);
        break;
      }
      case "drop_column": {
        const t = table(op.table);
        if (!t.columns[op.column]) throw new SchemaError(`${where}: ${op.table}.${op.column} does not exist`);
        if (t.columns[op.column].primaryKey) throw new SchemaError(`${where}: the primary key cannot be dropped`);
        delete t.columns[op.column];
        t.indexes = (t.indexes ?? []).filter((ix) => !ix.includes(op.column));
        if (t.indexes.length === 0) delete t.indexes;
        if (Object.keys(t.columns).length === 0) throw new SchemaError(`${where}: drop the table instead of its last column`);
        break;
      }
      case "rename_column": {
        const t = table(op.table);
        if (!t.columns[op.from]) throw new SchemaError(`${where}: ${op.table}.${op.from} does not exist`);
        if (t.columns[op.to]) throw new SchemaError(`${where}: ${op.table}.${op.to} already exists`);
        if (!IDENT.test(op.to)) throw new SchemaError(`${where}: "${op.to}" is not a valid column name`);
        // Rebuild so column order is kept: the schema compare ignores order,
        // but `describe` shows columns as the author wrote them.
        t.columns = Object.fromEntries(Object.entries(t.columns).map(([k, v]) => [k === op.from ? op.to : k, v]));
        if (t.indexes) t.indexes = t.indexes.map((ix) => ix.map((c) => (c === op.from ? op.to : c)));
        break;
      }
      case "add_index": {
        const t = table(op.table);
        for (const c of op.columns) if (!t.columns[c]) throw new SchemaError(`${where}: ${op.table}.${c} does not exist`);
        if ((t.indexes ?? []).some((ix) => sameList(ix, op.columns))) throw new SchemaError(`${where}: that index already exists`);
        t.indexes = [...(t.indexes ?? []), [...op.columns]];
        break;
      }
      case "drop_index": {
        const t = table(op.table);
        const before = t.indexes?.length ?? 0;
        t.indexes = (t.indexes ?? []).filter((ix) => !sameList(ix, op.columns));
        if (t.indexes.length === before) throw new SchemaError(`${where}: there is no index on ${op.table}(${op.columns.join(", ")})`);
        if (t.indexes.length === 0) delete t.indexes;
        break;
      }
      case "sql":
        if (typeof op.sql !== "string" || !op.sql.trim()) throw new SchemaError(`${where}: sql is empty`);
        break;
      default:
        throw new SchemaError(`${where}: unknown op ${JSON.stringify((op as { op: unknown }).op)}`);
    }
  });
  return next;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/** Normalised for comparison: descriptions and column order don't matter, defaults and flags do. */
function canonicalColumn(c: ColumnDef) {
  return {
    type: c.type,
    nullable: !!c.nullable,
    default: c.default === undefined ? undefined : JSON.stringify(c.default),
    primaryKey: !!c.primaryKey,
    unique: !!c.unique,
  };
}

/** Human-readable differences between two schemas; empty when they match. */
export function diffSchemas(actual: Schema, expected: Schema): string[] {
  const out: string[] = [];
  for (const t of Object.keys(expected)) if (!actual[t]) out.push(`table "${t}" is missing`);
  for (const t of Object.keys(actual)) if (!expected[t]) out.push(`table "${t}" is not in the new schema`);
  for (const [t, exp] of Object.entries(expected)) {
    const act = actual[t];
    if (!act) continue;
    for (const c of Object.keys(exp.columns)) if (!act.columns[c]) out.push(`${t}.${c} is missing`);
    for (const c of Object.keys(act.columns)) if (!exp.columns[c]) out.push(`${t}.${c} is not in the new schema`);
    for (const [c, ec] of Object.entries(exp.columns)) {
      const ac = act.columns[c];
      if (!ac) continue;
      const a = canonicalColumn(ac);
      const e = canonicalColumn(ec);
      for (const k of Object.keys(e) as Array<keyof typeof e>) {
        if (a[k] !== e[k]) out.push(`${t}.${c}: ${k} is ${a[k] ?? "unset"}, the new schema says ${e[k] ?? "unset"}`);
      }
    }
    const key = (ix: string[]) => ix.join(",");
    const ai = new Set((act.indexes ?? []).map(key));
    const ei = new Set((exp.indexes ?? []).map(key));
    for (const ix of ei) if (!ai.has(ix)) out.push(`${t}: index (${ix}) is missing`);
    for (const ix of ai) if (!ei.has(ix)) out.push(`${t}: index (${ix}) is not in the new schema`);
  }
  return out;
}

/**
 * Derive ops for a purely additive change: new tables, new columns that are
 * nullable or defaulted, new indexes. Anything else — a drop, a rename, a type
 * change — returns undefined, because a rename and a drop-plus-add look the
 * same from the outside and only the author knows which one they meant.
 */
export function deriveAdditiveOps(from: Schema, to: Schema): MigrationOp[] | undefined {
  const ops: MigrationOp[] = [];
  for (const t of Object.keys(from)) if (!to[t]) return undefined;
  for (const [t, def] of Object.entries(to)) {
    const cur = from[t];
    if (!cur) {
      ops.push({ op: "create_table", table: t, def: clone(def) });
      continue;
    }
    for (const c of Object.keys(cur.columns)) if (!def.columns[c]) return undefined;
    for (const [c, cd] of Object.entries(def.columns)) {
      const existing = cur.columns[c];
      if (existing) {
        if (JSON.stringify(canonicalColumn(existing)) !== JSON.stringify(canonicalColumn(cd))) return undefined;
        continue;
      }
      if (cd.primaryKey || cd.unique || (!cd.nullable && cd.default === undefined)) return undefined;
      ops.push({ op: "add_column", table: t, column: c, def: clone(cd) });
    }
    const have = new Set((cur.indexes ?? []).map((ix) => ix.join(",")));
    const want = new Set((def.indexes ?? []).map((ix) => ix.join(",")));
    for (const ix of have) if (!want.has(ix)) return undefined;
    for (const ix of def.indexes ?? []) if (!have.has(ix.join(","))) ops.push({ op: "add_index", table: t, columns: [...ix] });
  }
  return ops;
}
