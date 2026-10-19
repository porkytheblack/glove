/**
 * SQLite, one database per app: a file per app under `dir` (copy the file and
 * the app moves with its rows and event log), or `:memory:` when no `dir` is
 * given. Tables are STRICT, so SQLite enforces the declared types as well as
 * the constraints.
 *
 * Uses Node's built-in `node:sqlite` (Node 22.13+, no flag) unless `open` is
 * supplied — which also takes a better-sqlite3 `Database`, since the two share
 * the `exec` / `prepare().all()` / `prepare().run()` shape this needs.
 */

import { nativeMigrate } from "./native";
import type { Schema } from "../types";
import {
  standardLiteral,
  type AppStorage,
  type Backend,
  type Dialect,
  type MigrateOptions,
  type Row,
  type StructuralOp,
} from "./backend";

export interface SqliteStatementLike {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
  /** better-sqlite3 sets this; `all()` throws there on a statement that returns nothing. */
  readonly reader?: boolean;
}

export interface SqliteDatabaseLike {
  exec(sql: string): unknown;
  prepare(sql: string): SqliteStatementLike;
  close(): unknown;
}

export interface SqliteBackendOptions {
  /** One `<app>.sqlite` per app in this directory. Absent: every app is `:memory:`. */
  dir?: string;
  /** Open a database at a path (or `:memory:`). Default: `node:sqlite`'s DatabaseSync. */
  open?: (path: string) => SqliteDatabaseLike | Promise<SqliteDatabaseLike>;
}

const dialect: Dialect = {
  type: (t) => ({ text: "TEXT", integer: "INTEGER", real: "REAL", boolean: "INTEGER", json: "TEXT", timestamp: "TEXT" })[t],
  literal: (v, t) =>
    t === "boolean" && typeof v === "boolean"
      ? (v ? "1" : "0")
      : standardLiteral(v, t, (j) => `'${JSON.stringify(j).replace(/'/g, "''")}'`),
  autoKey: () => "PRIMARY KEY",
};

function encode(v: unknown): unknown {
  if (v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (v !== null && typeof v === "object" && !(v instanceof Uint8Array)) return JSON.stringify(v);
  return v;
}

class SqliteAppStorage implements AppStorage {
  constructor(private db: SqliteDatabaseLike) {}

  async query(sql: string, params: unknown[] = []): Promise<Row[]> {
    const stmt = this.db.prepare(sql);
    const values = params.map(encode);
    if (stmt.reader === false) {
      stmt.run(...values);
      return [];
    }
    return stmt.all(...values).map((r) => ({ ...(r as Row) }));
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const out = await fn();
      this.db.exec("COMMIT");
      return out;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  async migrate(ops: StructuralOp[], before: Schema, opts: MigrateOptions = {}): Promise<void> {
    await nativeMigrate(async (sql) => void this.db.exec(sql), dialect, ops, before, { ...opts, tableSuffix: " STRICT" });
  }

  async close(): Promise<void> {
    this.db.close();
  }
}

async function defaultOpen(path: string): Promise<SqliteDatabaseLike> {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(path) as unknown as SqliteDatabaseLike;
}

export function sqliteBackend(options: SqliteBackendOptions = {}): Backend {
  const open = options.open ?? defaultOpen;
  const apps = new Map<string, SqliteAppStorage>();
  const pathFor = async (app: string) => {
    if (!options.dir) return ":memory:";
    const { join } = await import("node:path");
    return join(options.dir, `${app}.sqlite`);
  };

  return {
    name: "sqlite",
    capabilities: { constraints: true, jsonAsText: true },
    placeholder: (n) => `?${n}`,
    async open(app) {
      let storage = apps.get(app);
      if (!storage) {
        if (options.dir) await (await import("node:fs/promises")).mkdir(options.dir, { recursive: true });
        const db = await open(await pathFor(app));
        if (options.dir) db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
        storage = new SqliteAppStorage(db);
        apps.set(app, storage);
      }
      return storage;
    },
    async drop(app) {
      await apps.get(app)?.close();
      apps.delete(app);
      if (!options.dir) return;
      const { rm } = await import("node:fs/promises");
      const base = await pathFor(app);
      for (const p of [base, `${base}-wal`, `${base}-shm`]) await rm(p, { force: true });
    },
    async close() {
      for (const s of apps.values()) await s.close();
      apps.clear();
    },
  };
}
