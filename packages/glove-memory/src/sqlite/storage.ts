import { chmodSync, closeSync, constants, fstatSync, mkdirSync, openSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { deserialize, serialize } from "node:v8";
import type { z } from "zod";

export interface SqliteMemoryStorageOptions {
  /** A dedicated SQLite file on a local persistent volume. Not an in-memory URI. */
  file: string;
  /** Trusted ownership key. Include tenant/workspace and agent instance identity. */
  namespace: string;
  /** Cross-process lock wait bound. Default 5000 ms. */
  busyTimeoutMs?: number;
  /** Per-subsystem snapshot limit. Default 16 MiB; exceeding it fails without committing. */
  maxSnapshotBytes?: number;
}

export class MemoryStorageError extends Error {
  override readonly name = "MemoryStorageError";
}

// Serialize callers sharing a file in this process. Otherwise a synchronous
// SQLite busy wait could block the microtask which commits our own prior write.
const queues = new Map<string, Promise<void>>();
function exclusive<T>(file: string, operation: () => Promise<T>): Promise<T> {
  const result = (queues.get(file) ?? Promise.resolve()).then(operation);
  const settled = result.then(() => undefined, () => undefined);
  queues.set(file, settled);
  void settled.then(() => { if (queues.get(file) === settled) queues.delete(file); });
  return result;
}

export class SqliteMemoryStorage {
  private readonly file: string;
  private readonly namespace: string;
  private readonly timeout: number;
  private readonly maximum: number;

  /**
   * Facts hold a cross-process lock through asynchronous consumer commits, but
   * each fact save must commit independently. Use a separate SQLite lock file:
   * process death releases its OS lock, and consumer writes to this data file
   * cannot deadlock against it. Deliberately serializes all fact scopes per file.
   */
  async withFactLock<T>(operation: () => Promise<T>): Promise<T> {
    const lock = new SqliteMemoryStorage({ file: `${this.file}.facts-lock`, namespace: "lock", busyTimeoutMs: this.timeout });
    return exclusive(lock.file, async () => {
      const db = new DatabaseSync(lock.file, { allowExtension: false });
      let held = false;
      try {
        db.exec("PRAGMA busy_timeout = 0");
        const deadline = Date.now() + this.timeout;
        while (!held) {
          try { db.exec("BEGIN IMMEDIATE"); held = true; }
          catch (error) {
            const code = (error as { errcode?: number }).errcode;
            if (code === undefined || ![5, 6].includes(code & 255) || Date.now() >= deadline) throw error;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
        }
        return await operation();
      } finally {
        try { if (held) db.exec("ROLLBACK"); } finally { db.close(); }
      }
    });
  }

  constructor(options: SqliteMemoryStorageOptions) {
    if (!options.file.trim() || options.file === ":memory:" || options.file.startsWith("file:")) {
      throw new MemoryStorageError("Memory requires a durable local database path.");
    }
    if (!options.namespace.trim()) throw new MemoryStorageError("Memory requires an explicit ownership namespace.");
    this.timeout = options.busyTimeoutMs ?? 5_000;
    this.maximum = options.maxSnapshotBytes ?? 16 * 1024 * 1024;
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 0 || this.timeout > 60_000 ||
      !Number.isSafeInteger(this.maximum) || this.maximum < 1024) {
      throw new MemoryStorageError("Invalid memory storage limits.");
    }
    const file = resolve(options.file);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    // Create privately before SQLite opens it, so its journal sidecars inherit
    // private permissions too. Never follow a database-file symlink.
    const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
      if (!fstatSync(fd).isFile()) throw new MemoryStorageError("Memory database must be a regular file.");
    } finally { closeSync(fd); }
    this.file = realpathSync(file);
    chmodSync(this.file, 0o600);
    this.namespace = options.namespace;
  }

  private open(): DatabaseSync {
    const db = new DatabaseSync(this.file, { allowExtension: false });
    try {
      db.exec(`PRAGMA busy_timeout = ${this.timeout}; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;`);
      db.exec(`CREATE TABLE IF NOT EXISTS glove_memory_state (
        namespace TEXT NOT NULL,
        subsystem TEXT NOT NULL,
        version INTEGER NOT NULL,
        state BLOB NOT NULL,
        PRIMARY KEY (namespace, subsystem)
      ) STRICT`);
      return db;
    } catch (cause) { db.close(); throw cause; }
  }

  private read<S>(db: DatabaseSync, subsystem: string, schema: z.ZodType<S>): S | undefined {
    const row = db.prepare("SELECT version, state FROM glove_memory_state WHERE namespace = ? AND subsystem = ?")
      .get(this.namespace, subsystem);
    if (!row) return undefined;
    if (row.version !== 1 || !(row.state instanceof Uint8Array) || row.state.byteLength > this.maximum) {
      throw new MemoryStorageError("Memory storage has an unsupported version or invalid snapshot. No data was reset.");
    }
    try { return schema.parse(deserialize(Buffer.from(row.state))); }
    catch { throw new MemoryStorageError("Memory storage is invalid. Restore or migrate the database; no data was reset."); }
  }

  run<S, A extends { snapshot(): S }, R>(
    subsystem: string,
    schema: z.ZodType<S>,
    create: (state: S | undefined) => A,
    write: boolean,
    operation: (adapter: A) => Promise<R>,
  ): Promise<R> {
    return exclusive(this.file, async () => {
      const db = this.open();
      let transaction = false;
      let closed = false;
      try {
        if (write) { db.exec("BEGIN IMMEDIATE"); transaction = true; }
        const adapter = create(this.read(db, subsystem, schema));
        // Reads operate on a detached, coherent snapshot. No database lock or
        // handle stays open while an optional embedding provider is consulted.
        if (!write) { db.close(); closed = true; }
        const result = await operation(adapter);
        if (write) {
          const state = serialize(schema.parse(adapter.snapshot()));
          if (state.byteLength > this.maximum) throw new MemoryStorageError("Memory snapshot exceeds its configured storage limit; write rolled back.");
          db.prepare(`INSERT INTO glove_memory_state (namespace, subsystem, version, state) VALUES (?, ?, 1, ?)
            ON CONFLICT(namespace, subsystem) DO UPDATE SET version = excluded.version, state = excluded.state`)
            .run(this.namespace, subsystem, state);
          db.exec("COMMIT");
          transaction = false;
        }
        return result;
      } finally {
        try { if (transaction) db.exec("ROLLBACK"); }
        finally { if (!closed) db.close(); }
      }
    });
  }
}
