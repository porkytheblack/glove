import { readFile, writeFile, mkdir, rm, chmod } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Per-MCP token record persisted by the auth CLI and read by the agent.
 *
 * `meta` is whatever the OAuth provider returns alongside the access token —
 * for Notion that's `workspace_id`, `workspace_name`, `bot_id`, etc. We don't
 * model it tightly because each provider's response differs.
 */
export interface StoredToken {
  access_token: string;
  obtained_at: string;
  expires_at?: string | null;
  refresh_token?: string | null;
  meta?: Record<string, unknown>;
}

interface TokenFile {
  version: 1;
  tokens: Record<string, StoredToken>;
}

/**
 * Tiny file-backed token store keyed by McpCatalogueEntry.id.
 *
 * Writes a single JSON file with `chmod 600` so other local users can't
 * read your access tokens. Atomic via write-temp-then-rename.
 */
export class FsTokenStore {
  constructor(private readonly path: string) {}

  async getAll(): Promise<TokenFile> {
    if (!existsSync(this.path)) {
      return { version: 1, tokens: {} };
    }
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as TokenFile;
      if (parsed.version !== 1) {
        throw new Error(
          `Unsupported token file version ${(parsed as { version?: unknown }).version} at ${this.path}`,
        );
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `Failed to read token file at ${this.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async get(id: string): Promise<StoredToken | null> {
    const file = await this.getAll();
    return file.tokens[id] ?? null;
  }

  async set(id: string, token: StoredToken): Promise<void> {
    const file = existsSync(this.path)
      ? await this.getAll()
      : ({ version: 1, tokens: {} } as TokenFile);
    file.tokens[id] = token;
    await this.write(file);
  }

  async delete(id: string): Promise<boolean> {
    if (!existsSync(this.path)) return false;
    const file = await this.getAll();
    if (!(id in file.tokens)) return false;
    delete file.tokens[id];
    await this.write(file);
    return true;
  }

  async clear(): Promise<void> {
    if (existsSync(this.path)) await rm(this.path);
  }

  private async write(file: TokenFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    // rename is atomic on POSIX. On Windows it's still safe enough for
    // single-process development.
    const { rename } = await import("node:fs/promises");
    await rename(tmp, this.path);
    // Belt-and-suspenders: ensure mode even if the file already existed.
    try {
      await chmod(this.path, 0o600);
    } catch {
      // best-effort on platforms where chmod is a no-op (Windows)
    }
  }
}
