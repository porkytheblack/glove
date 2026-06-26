/**
 * glove-scratchpad/persist-fs — a filesystem-backed {@link ScratchpadStore}.
 *
 * Node-only (imports `node:fs`), so it lives on its own subpath to keep the main
 * barrel browser-safe — same split as `glove-scratchpad/pglite`. One file per
 * key, written atomically (temp + rename) with mode 0600. Mirrors glove-mcp's
 * `FsOAuthStore`. Swap in your DB-backed `ScratchpadStore` for production.
 */
import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { ScratchpadStore } from "./index";

export class FsScratchpadStore implements ScratchpadStore {
  constructor(private readonly dir: string) {}

  private path(key: string): string {
    return join(this.dir, `${encodeURIComponent(key)}.snapshot`);
  }

  /** Monotonic per-instance counter — part of each write's unique temp name. */
  private seq = 0;

  async save(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(key);
    // Unique temp path per write so two concurrent saves of the same key can't
    // clobber each other's temp file before the atomic rename publishes it.
    const tmp = `${target}.${process.pid}.${this.seq++}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    try {
      await rename(tmp, target); // atomic on POSIX
    } catch (err) {
      await unlink(tmp).catch(() => {}); // don't leak the temp file on failure
      throw err;
    }
  }

  async load(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.path(key)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.path(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}
