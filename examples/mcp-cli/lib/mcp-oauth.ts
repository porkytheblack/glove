import type { OAuthClientProvider } from "glove-mcp";
import type {
  OAuthClientInformation,
  OAuthClientInformationFull,
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";

import { readFile, writeFile, mkdir, rm, chmod, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

/**
 * File-backed `OAuthClientProvider` for the MCP authorization spec.
 *
 * The MCP SDK runs discovery, dynamic client registration, PKCE, and token
 * refresh internally. Our job here is purely persistence: the SDK calls
 * `saveClientInformation`, `saveTokens`, `saveCodeVerifier` after each step
 * and reads them back via the corresponding getters on subsequent connects.
 *
 * Fields stored in the file (mode 0600):
 *
 *   {
 *     "version": 1,
 *     "providers": {
 *       "<key>": {
 *         "clientInformation": { client_id, client_secret?, ... } | null,
 *         "tokens": { access_token, refresh_token?, expires_in? } | null,
 *         "codeVerifier": "<random>" | null
 *       }
 *     }
 *   }
 *
 * One file holds providers for any number of MCP servers, keyed by an
 * arbitrary string (`notion`, `linear`, …). The single-file approach makes
 * it trivial to inspect / nuke.
 */

interface ProviderState {
  clientInformation: OAuthClientInformationMixed | null;
  tokens: OAuthTokens | null;
  codeVerifier: string | null;
}

interface FileShape {
  version: 1;
  providers: Record<string, ProviderState>;
}

function emptyState(): ProviderState {
  return { clientInformation: null, tokens: null, codeVerifier: null };
}

export class FsMcpOAuthProvider implements OAuthClientProvider {
  /**
   * @param path  Where to persist the file. One file can hold many providers.
   * @param key   Stable string keying this provider's state (typically the
   *              MCP entry id, e.g. `"notion"`).
   * @param opts.redirectUrl       The redirect URL the SDK builds the authorize
   *                               URL with — and where your local listener
   *                               must accept the callback.
   * @param opts.clientMetadata    Sent to the server during DCR. The SDK
   *                               persists what comes back via `saveClientInformation`.
   * @param opts.onAuthorizeUrl    Called when the SDK wants the user to visit
   *                               the authorize URL (browser-open hook).
   */
  constructor(
    private readonly path: string,
    private readonly key: string,
    private readonly opts: {
      redirectUrl: string | URL;
      clientMetadata: OAuthClientMetadata;
      onAuthorizeUrl: (url: URL) => void | Promise<void>;
    },
  ) {}

  // ── interface getters ─────────────────────────────────────────────────────

  get redirectUrl(): string | URL {
    return this.opts.redirectUrl;
  }

  get clientMetadata(): OAuthClientMetadata {
    return this.opts.clientMetadata;
  }

  state(): string {
    return randomBytes(24).toString("hex");
  }

  // ── client info ───────────────────────────────────────────────────────────

  async clientInformation(): Promise<OAuthClientInformation | undefined> {
    const s = await this.readState();
    return (s.clientInformation as OAuthClientInformation | null) ?? undefined;
  }

  async saveClientInformation(info: OAuthClientInformationFull): Promise<void> {
    await this.mutate((s) => {
      s.clientInformation = info;
    });
  }

  // ── tokens ────────────────────────────────────────────────────────────────

  async tokens(): Promise<OAuthTokens | undefined> {
    const s = await this.readState();
    return s.tokens ?? undefined;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.mutate((s) => {
      s.tokens = tokens;
    });
  }

  // ── PKCE verifier ─────────────────────────────────────────────────────────

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.mutate((s) => {
      s.codeVerifier = codeVerifier;
    });
  }

  async codeVerifier(): Promise<string> {
    const s = await this.readState();
    if (!s.codeVerifier) {
      throw new Error(
        `No PKCE code_verifier saved for "${this.key}". The SDK calls saveCodeVerifier ` +
          `before redirectToAuthorization — if you're seeing this error, the auth flow ` +
          `wasn't started by this provider, or the file was tampered with.`,
      );
    }
    return s.codeVerifier;
  }

  // ── redirect ──────────────────────────────────────────────────────────────

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    await this.opts.onAuthorizeUrl(authorizationUrl);
  }

  // ── invalidation ──────────────────────────────────────────────────────────

  async invalidateCredentials(
    scope: "all" | "client" | "tokens" | "verifier" | "discovery",
  ): Promise<void> {
    await this.mutate((s) => {
      if (scope === "all") {
        s.clientInformation = null;
        s.tokens = null;
        s.codeVerifier = null;
      }
      if (scope === "client") s.clientInformation = null;
      if (scope === "tokens") s.tokens = null;
      if (scope === "verifier") s.codeVerifier = null;
      // 'discovery' state isn't persisted by this provider, no-op
    });
  }

  // ── housekeeping ──────────────────────────────────────────────────────────

  /** Wipe all state for this provider's key. */
  async reset(): Promise<void> {
    await this.mutate((s) => {
      s.clientInformation = null;
      s.tokens = null;
      s.codeVerifier = null;
    });
  }

  /** Wipe the entire file. */
  async clearAll(): Promise<void> {
    if (existsSync(this.path)) await rm(this.path);
  }

  // ── private ───────────────────────────────────────────────────────────────

  private async readFile(): Promise<FileShape> {
    if (!existsSync(this.path)) return { version: 1, providers: {} };
    const raw = await readFile(this.path, "utf8");
    try {
      const parsed = JSON.parse(raw) as FileShape;
      if (parsed.version !== 1) {
        throw new Error(`Unsupported version ${parsed.version}`);
      }
      return parsed;
    } catch (err) {
      throw new Error(
        `Failed to read ${this.path}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async readState(): Promise<ProviderState> {
    const file = await this.readFile();
    return file.providers[this.key] ?? emptyState();
  }

  private async mutate(fn: (s: ProviderState) => void): Promise<void> {
    const file = existsSync(this.path) ? await this.readFile() : { version: 1 as const, providers: {} };
    const current = file.providers[this.key] ?? emptyState();
    fn(current);
    file.providers[this.key] = current;
    await this.writeFile(file);
  }

  private async writeFile(file: FileShape): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.tmp`;
    await writeFile(tmp, JSON.stringify(file, null, 2), { mode: 0o600 });
    await rename(tmp, this.path);
    try {
      await chmod(this.path, 0o600);
    } catch {
      // best-effort on platforms where chmod is a no-op (Windows)
    }
  }
}
