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

  async save(key: string, bytes: Uint8Array): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const target = this.path(key);
    const tmp = `${target}.tmp`;
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, target); // atomic on POSIX
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
