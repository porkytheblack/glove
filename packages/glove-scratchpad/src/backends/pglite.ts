/**
 * PGlite reference backend.
 *
 * An embedded Postgres (WASM) that satisfies the {@link ScratchpadBackend}
 * contract — real Postgres dialect, real `jsonb`, and a serialisable data dir
 * for "computation as a value" (§10). This is one backend behind the contract;
 * the dialect is the standard, not this engine (§6.1).
 *
 * `@electric-sql/pglite` is an optional peer dependency — install it only if you
 * use this backend. Other backends (real Postgres over a pool, an emulator over
 * a plain object) can implement the same contract without it.
 */
import { PGlite } from "@electric-sql/pglite";
import type { BackendResult, ScratchpadBackend } from "../core/types";

export interface PgliteBackendOptions {
  /** Restore from a previous {@link Scratchpad.snapshot} (bytes from `dump()`). */
  load?: Uint8Array;
  /**
   * Persist to a data directory (e.g. a filesystem path in Node). Omit for an
   * ephemeral in-memory database — the common case for a per-workflow scratchpad.
   */
  dataDir?: string;
}

export class PgliteBackend implements ScratchpadBackend {
  private constructor(private readonly pg: PGlite) {}

  static async create(opts: PgliteBackendOptions = {}): Promise<PgliteBackend> {
    const init: Record<string, unknown> = {};
    if (opts.dataDir) init.dataDir = opts.dataDir;
    if (opts.load) init.loadDataDir = new Blob([opts.load as unknown as BlobPart]);
    const pg = await PGlite.create(init as never);
    return new PgliteBackend(pg);
  }

  async query(sql: string, params: unknown[] = []): Promise<BackendResult> {
    const res = await this.pg.query(sql, params as unknown[]);
    return {
      rows: (res.rows ?? []) as Record<string, unknown>[],
      fields: (res.fields ?? []).map((f: { name: string; dataTypeID: number }) => ({
        name: f.name,
        dataTypeID: f.dataTypeID,
      })),
    };
  }

  async exec(sql: string): Promise<void> {
    await this.pg.exec(sql);
  }

  async dump(): Promise<Uint8Array> {
    const file = await this.pg.dumpDataDir();
    const buf = await (file as Blob).arrayBuffer();
    return new Uint8Array(buf);
  }

  async close(): Promise<void> {
    await this.pg.close();
  }

  /** Escape hatch for advanced consumers needing the raw PGlite instance. */
  get raw(): PGlite {
    return this.pg;
  }
}
