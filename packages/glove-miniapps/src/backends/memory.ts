/**
 * The in-memory backend: every app is a glove-sql database on the heap, and
 * the whole backend serialises to bytes. Nothing to install, nothing to
 * connect to, and it runs wherever JavaScript does.
 *
 * glove-sql is an analytical engine first, so three things are done here
 * rather than by the engine:
 *
 * - **Atomicity.** Its BEGIN/ROLLBACK are accepted and ignored, so a
 *   transaction is a dump before and a restore on failure. That costs the size
 *   of the app per action — fine for the hundreds-to-thousands of rows a mini
 *   app holds, and the reason this backend is not the one for a big one.
 * - **Structure changes.** It has no ALTER TABLE, so a column change rebuilds
 *   the table through a copy (the same move SQLite documents for the ALTERs it
 *   lacks). Indexes are accepted and not built: every query is a scan.
 * - **Constraints.** It parses NOT NULL / UNIQUE / PRIMARY KEY and enforces
 *   none, so the runtime checks them after each action (`capabilities.constraints`
 *   is false).
 */

import { MemoryBackend } from "glove-sql";
import { applyOps } from "../schema";
import type { Schema, TableDef } from "../types";
import {
  q,
  renderCreateTable,
  standardLiteral,
  type AppStorage,
  type Backend,
  type Dialect,
  type MigrateOptions,
  type Row,
  type StructuralOp,
} from "./backend";

const dialect: Dialect = {
  type: (t) =>
    ({ text: "text", integer: "bigint", real: "double precision", boolean: "boolean", json: "jsonb", timestamp: "timestamptz" })[t],
  literal: (v, t) => standardLiteral(v, t, (j) => `'${JSON.stringify(j).replace(/'/g, "''")}'::jsonb`),
  // `max + 1`, evaluated per inserted row: the SQLite rowid rule.
  autoKey: (table, column) => `DEFAULT (SELECT coalesce(max(${q(column)}), 0) + 1 FROM ${q(table)})`,
};

class MemoryAppStorage implements AppStorage {
  constructor(public db: MemoryBackend) {}

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    return (await this.db.query(sql, params)).rows;
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const before = await this.db.dump();
    try {
      return await fn();
    } catch (err) {
      this.db = await MemoryBackend.create({ load: before });
      throw err;
    }
  }

  async migrate(ops: StructuralOp[], before: Schema, opts: MigrateOptions = {}): Promise<void> {
    let schema = before;
    for (const op of ops) {
      const after = applyOps(schema, [op], opts);
      switch (op.op) {
        case "create_table":
          await this.db.exec(renderCreateTable(dialect, op.table, op.def, { constraints: false }));
          break;
        case "drop_table":
          await this.db.exec(`DROP TABLE ${q(op.table)}`);
          break;
        case "rename_table":
          await this.copy(op.from, schema[op.from], op.to, after[op.to], (c) => c);
          await this.db.exec(`DROP TABLE ${q(op.from)}`);
          break;
        case "add_column":
        case "drop_column":
        case "rename_column": {
          const rename = op.op === "rename_column" ? op : undefined;
          await this.rebuild(op.table, schema[op.table], after[op.table], (c) => (rename && c === rename.to ? rename.from : c));
          break;
        }
        case "add_index":
        case "drop_index":
          break;
      }
      schema = after;
    }
  }

  /** Replace a table with a new definition, keeping its rows. */
  private async rebuild(table: string, from: TableDef, to: TableDef, source: (col: string) => string): Promise<void> {
    const hold = `__rebuild_${table}`;
    await this.db.exec(`CREATE TABLE ${q(hold)} AS SELECT * FROM ${q(table)}`);
    await this.db.exec(`DROP TABLE ${q(table)}`);
    await this.copy(hold, from, table, to, source);
    await this.db.exec(`DROP TABLE ${q(hold)}`);
  }

  /** Create `to` and fill it from `from`; a column with no source takes its default. */
  private async copy(fromTable: string, from: TableDef, toTable: string, to: TableDef, source: (col: string) => string): Promise<void> {
    await this.db.exec(renderCreateTable(dialect, toTable, to, { constraints: false }));
    const cols = Object.keys(to.columns).filter((c) => from.columns[source(c)]);
    if (cols.length === 0) return;
    await this.db.query(
      `INSERT INTO ${q(toTable)} (${cols.map(q).join(", ")}) SELECT ${cols.map((c) => q(source(c))).join(", ")} FROM ${q(fromTable)}`,
    );
  }

  async dump(): Promise<Uint8Array> {
    return this.db.dump();
  }

  async close(): Promise<void> {}
}

export interface MemoryBackendOptions {
  /** Restore from {@link Backend.snapshot}. */
  load?: Uint8Array;
}

interface MemorySnapshot {
  v: 1;
  apps: Record<string, string>;
}

// btoa/atob rather than Buffer, so a snapshot round-trips in a browser too.
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function fromBase64(text: string): Uint8Array {
  const bin = atob(text);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Every app in memory, on glove-sql. `snapshot()` is the whole backend as bytes. */
export function memoryBackend(options: MemoryBackendOptions = {}): Backend {
  const apps = new Map<string, MemoryAppStorage>();
  const saved: Record<string, string> = options.load
    ? (JSON.parse(new TextDecoder().decode(options.load)) as MemorySnapshot).apps
    : {};

  return {
    name: "memory",
    capabilities: { constraints: false, jsonAsText: false },
    async open(app) {
      let storage = apps.get(app);
      if (!storage) {
        const load = saved[app] ? fromBase64(saved[app]) : undefined;
        storage = new MemoryAppStorage(await MemoryBackend.create(load ? { load } : {}));
        apps.set(app, storage);
      }
      return storage;
    },
    async drop(app) {
      apps.delete(app);
      delete saved[app];
    },
    async snapshot() {
      const out: MemorySnapshot = { v: 1, apps: { ...saved } };
      for (const [name, storage] of apps) out.apps[name] = toBase64(await storage.dump());
      return new TextEncoder().encode(JSON.stringify(out));
    },
    async close() {
      apps.clear();
    },
  };
}
