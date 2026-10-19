/**
 * Migrations for engines with a real ALTER TABLE (SQLite ≥ 3.35, Postgres).
 * Index names are derived from table and column names, so a rename recreates
 * the indexes it touches under their new names; otherwise a later
 * `drop_index` would look for a name that no longer exists.
 */

import { applyOps } from "../schema";
import type { Schema } from "../types";
import { dropIndex, q, renderColumn, renderCreateTable, renderIndex, type Dialect, type MigrateOptions, type StructuralOp } from "./backend";

export async function nativeMigrate(
  exec: (sql: string) => Promise<void>,
  d: Dialect,
  ops: StructuralOp[],
  before: Schema,
  opts: MigrateOptions & { tableSuffix?: string } = {},
): Promise<void> {
  let schema = before;
  const suffix = opts.tableSuffix ?? "";
  for (const op of ops) {
    const after = applyOps(schema, [op], opts);
    switch (op.op) {
      case "create_table":
        await exec(renderCreateTable(d, op.table, op.def, { constraints: true }) + suffix);
        for (const ix of op.def.indexes ?? []) await exec(renderIndex(op.table, ix));
        break;
      case "drop_table":
        await exec(`DROP TABLE ${q(op.table)}`);
        break;
      case "rename_table": {
        const indexes = schema[op.from].indexes ?? [];
        for (const ix of indexes) await exec(dropIndex(op.from, ix));
        await exec(`ALTER TABLE ${q(op.from)} RENAME TO ${q(op.to)}`);
        for (const ix of indexes) await exec(renderIndex(op.to, ix));
        break;
      }
      case "add_column":
        await exec(`ALTER TABLE ${q(op.table)} ADD COLUMN ${renderColumn(d, op.table, op.column, op.def, { constraints: true })}`);
        break;
      case "drop_column": {
        // An index over the column goes first: SQLite refuses to drop an indexed column.
        for (const ix of schema[op.table].indexes ?? []) if (ix.includes(op.column)) await exec(dropIndex(op.table, ix));
        await exec(`ALTER TABLE ${q(op.table)} DROP COLUMN ${q(op.column)}`);
        break;
      }
      case "rename_column": {
        const touched = (schema[op.table].indexes ?? []).filter((ix) => ix.includes(op.from));
        for (const ix of touched) await exec(dropIndex(op.table, ix));
        await exec(`ALTER TABLE ${q(op.table)} RENAME COLUMN ${q(op.from)} TO ${q(op.to)}`);
        for (const ix of touched) await exec(renderIndex(op.table, ix.map((c) => (c === op.from ? op.to : c))));
        break;
      }
      case "add_index":
        await exec(renderIndex(op.table, op.columns));
        break;
      case "drop_index":
        await exec(dropIndex(op.table, op.columns));
        break;
    }
    schema = after;
  }
}
