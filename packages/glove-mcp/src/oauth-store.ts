import { readFile, writeFile, mkdir, rm, chmod, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";

import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

/**
 * State a single MCP OAuth session keeps for one MCP server.
 *
 * The MCP SDK calls each piece independently — the store rolls them up so
 * we can persist atomically and dump them out together for diagnostics.
 */
export interface OAuthProviderState {
  clientInformation: OAuthClientInformationMixed | null;
  tokens: OAuthTokens | null;
  codeVerifier: string | null;
}

export function emptyOAuthState(): OAuthProviderState {
  return { clientInformation: null, tokens: null, codeVerifier: null };
}

/**
 * Where MCP OAuth state lives. Implementations are typically per-conversation
 * (each user has their own `.mcp-oauth.json` or DB row).
 *
 * State is keyed inside the store by an arbitrary string — usually the
 * `McpCatalogueEntry.id` (`"notion"`, `"gmail"`, …) so a single store can
 * hold sessions for many MCP servers.
 */
export interface OAuthStore {
  /** Read state for a key; missing keys return an empty state, never null. */
  get(key: string): Promise<OAuthProviderState>;
  /** Replace state for a key wholesale. */
  set(key: string, state: OAuthProviderState): Promise<void>;
  /** Wipe state for a key. */
  delete(key: string): Promise<void>;
  /** Optional convenience — wipe everything. */
  clear?(): Promise<void>;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// MemoryOAuthStore
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/** In-process store. Useful for tests and single-shot scripts. */
export class MemoryOAuthStore implements OAuthStore {
  private map = new Map<string, OAuthProviderState>();

  async get(key: string): Promise<OAuthProviderState> {
    return this.map.get(key) ?? emptyOAuthState();
  }
  async set(key: string, state: OAuthProviderState): Promise<void> {
    this.map.set(key, state);
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
  async clear(): Promise<void> {
    this.map.clear();
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// FsOAuthStore
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

interface FileShape {
  version: 1;
  providers: Record<string, OAuthProviderState>;
}

/**
 * Single-file JSON-backed store. Atomic writes via temp+rename, mode `0600`.
 *
 * One file holds state for any number of MCP servers — keys are the
 * `McpCatalogueEntry.id` you pass to {@link runMcpOAuth} or
 * {@link findStoredOAuthProvider}.
 *
 * For production, replace with an implementation backed by your DB —
 * the interface is three methods.
 */
export class FsOAuthStore implements OAuthStore {
  constructor(private readonly path: string) {}

  async get(key: string): Promise<OAuthProviderState> {
    const file = await this.readFile();
    return file.providers[key] ?? emptyOAuthState();
  }

  async set(key: string, state: OAuthProviderState): Promise<void> {
    const file = existsSync(this.path)
      ? await this.readFile()
      : ({ version: 1 as const, providers: {} } satisfies FileShape);
    file.providers[key] = state;
    await this.writeFile(file);
  }

  async delete(key: string): Promise<void> {
    if (!existsSync(this.path)) return;
    const file = await this.readFile();
    if (!(key in file.providers)) return;
    delete file.providers[key];
    await this.writeFile(file);
  }

  async clear(): Promise<void> {
    if (existsSync(this.path)) await rm(this.path);
  }

  private async readFile(): Promise<FileShape> {
    if (!existsSync(this.path)) return { version: 1, providers: {} };
    try {
      const raw = await readFile(this.path, "utf8");
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1) {
        throw new Error(
          `Unsupported OAuth store version ${(parsed as { version?: unknown }).version} at ${this.path}`,
        );
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `Failed to read OAuth store at ${this.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async writeFile(file: FileShape): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
    try {
      await chmod(this.path, 0o600);
    } catch {
      // best-effort on platforms without POSIX permissions (Windows)
    }
  }
}
